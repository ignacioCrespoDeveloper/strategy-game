// =============================================
//  clan-screen.js — ClanScreen
//
//  Create/browse/apply/accept/reject/leave/kick + clan wars — one clan per
//  player, max 5 members. All membership/war changes are server-authoritative
//  (see server/actions/clan-*.js); this screen just renders whatever
//  /api/clan/list + RankingService's leaderboard currently say, always
//  re-fetched on render (no local caching — this screen isn't opened often
//  enough to need it).
//
//  Joining is now a leader-approved application, not instant — see
//  clan-apply.js/clan-accept.js/clan-reject.js. Wars are a time-boxed,
//  score-race "flag" between two clans (see clan-war-declare.js) — no
//  attack-permission changes come from being at war; only being in the SAME
//  clan blocks an attack (server-enforced in combat-resolver.js).
// =============================================

const ClanScreen = (() => {
  let _root      = null;
  let _player     = null;
  let _clans      = [];
  let _myClan     = null;
  let _wars       = []; // every clan_wars row in the game, named absolutely (clanA/clanB) — see clan-list.js
  let _honorByPid = {};
  let _scoreByPid = {};
  let _activeTab  = 'mine';

  const _TABS = [
    { id: 'mine',     label: gi('round-shield') + ' My Clan' },
    { id: 'wars',     label: gi('crossed-swords') + ' All Wars' },
    { id: 'rankings', label: gi('trophy') + ' Rankings' },
  ];

  async function render(root, { player }) {
    _root      = root;
    _player    = player;
    _activeTab = 'mine';
    root.innerHTML = _loadingHtml();

    const [clanResult, leaderboard] = await Promise.all([
      ServerActions.clanList(),
      RankingService.fetchLeaderboard(),
    ]);
    _clans  = clanResult.ok ? clanResult.clans : [];
    _wars   = clanResult.ok ? (clanResult.wars || []) : [];
    _myClan = _clans.find(c => c.id === _player.clanId) || null;

    _honorByPid = {};
    _scoreByPid = {};
    leaderboard.forEach(e => { _honorByPid[e.playerId] = e.honorPoints || 0; _scoreByPid[e.playerId] = e.score || 0; });
    // Own row may not have saved yet this session — fall back to the live
    // player object so the "you" row never shows 0 honor by mistake.
    if (_honorByPid[_player.id] == null) _honorByPid[_player.id] = _player.honorPoints || 0;

    _renderFull();
  }

  function _renderFull() {
    _root.innerHTML = _html();
    _renderTabContent();
    _bindEvents();
  }

  function _html() {
    const tabsHtml = _TABS.map(t => `
      <button class="rank-tab ${_activeTab === t.id ? 'rank-tab--active' : ''}" data-clan-tab="${t.id}">${t.label}</button>
    `).join('');

    return `
      <div class="clan-screen">
        <div class="clan-header">
          <h2 class="clan-title">${gi('round-shield')} Clan</h2>
        </div>
        <div class="clan-content">
          <div class="rank-tabs-row">${tabsHtml}</div>
          <div class="rank-tab-content" id="clan-tab-content"></div>
        </div>
      </div>`;
  }

  function _renderTabContent() {
    const el = document.getElementById('clan-tab-content');
    if (!el) return;
    el.innerHTML = _tabHtml(_activeTab);
  }

  function _tabHtml(tab) {
    if (tab === 'wars')     return _allWarsHtml();
    if (tab === 'rankings') return _clanRankingsHtml();
    return _myClan ? _myClanHtml() : _noClanHtml();
  }

  // ── In a clan ─────────────────────────────────────────────────

  function _myClanHtml() {
    const isLeader   = _myClan.leaderId === _player.id;
    const soleMember = _myClan.memberCount === 1;
    const leaveLabel = isLeader
      ? (soleMember ? gi('trash-can') + ' Disband Clan' : gi('exit-door') + ' Leave (passes leadership on)')
      : gi('exit-door') + ' Leave Clan';

    return `
      <section class="clan-section">
        <div class="clan-card">
          <div class="clan-card-header">
            <span class="clan-tag">[${_myClan.tag}]</span>
            <span class="clan-name">${_myClan.name}</span>
            <span class="clan-member-count">${_myClan.memberCount}/${_myClan.maxMembers}</span>
          </div>
          <div class="clan-members">
            ${_myClan.members.map(m => _memberRowHtml(m, isLeader)).join('')}
          </div>
          <button class="clan-leave-btn" id="clan-leave-btn">${leaveLabel}</button>
        </div>
      </section>
      ${isLeader ? _applicationsHtml() : ''}
      ${_warsHtml(isLeader)}`;
  }

  function _memberRowHtml(m, isLeader) {
    const honor = _honorByPid[m.playerId] || 0;
    const score = _scoreByPid[m.playerId] || 0;
    const tier  = getHonorTier(honor);
    const sign  = honor > 0 ? '+' : honor < 0 ? '−' : '';
    const honorCls = honor > 0 ? 'clan-honor--pos' : honor < 0 ? 'clan-honor--neg' : 'clan-honor--zero';
    return `
      <div class="clan-member-row${m.playerId === _player.id ? ' clan-member-row--you' : ''}">
        <span class="clan-member-name">${m.playerId === _myClan.leaderId ? gi('crown') + ' ' : ''}${m.username}${m.playerId === _player.id ? ' (you)' : ''}</span>
        <span class="clan-member-honor">${tier ? honorCrestHtml(tier, 'clan-honor-crest') : ''}<span class="${honorCls}">${sign}${Math.abs(honor)}</span></span>
        <span class="clan-member-score">${score.toLocaleString()} pts</span>
        ${isLeader && m.playerId !== _player.id
          ? `<button class="clan-kick-btn" data-target="${m.playerId}">Kick</button>`
          : ''}
      </div>`;
  }

  function _applicationsHtml() {
    const pending = _myClan.pending || [];
    return `
      <section class="clan-section">
        <div class="clan-section-title">Applications${pending.length ? ` (${pending.length})` : ''}</div>
        ${pending.length === 0
          ? '<p class="clan-empty">No pending applications.</p>'
          : `<div class="clan-applications-list">
              ${pending.map(p => `
                <div class="clan-application-row">
                  <span class="clan-member-name">${p.username}</span>
                  <div class="clan-application-actions">
                    <button class="clan-accept-btn" data-target="${p.playerId}">✔ Accept</button>
                    <button class="clan-reject-btn" data-target="${p.playerId}">✕ Reject</button>
                  </div>
                </div>`).join('')}
            </div>`}
      </section>`;
  }

  function _warsHtml(isLeader) {
    const wars = _myClan.wars || [];
    const active = wars.filter(w => w.status === 'active');
    const ended  = wars.filter(w => w.status === 'ended').slice(0, 5);
    const otherClans = _clans.filter(c => c.id !== _myClan.id);

    return `
      <section class="clan-section">
        <div class="clan-section-title">Clan Wars</div>
        ${active.length === 0
          ? '<p class="clan-empty">No active wars.</p>'
          : `<div class="clan-war-list">${active.map(_warRowHtml).join('')}</div>`}
        ${ended.length > 0
          ? `<div class="clan-war-history">${ended.map(_warRowHtml).join('')}</div>`
          : ''}
        ${isLeader ? _declareWarHtml(otherClans) : ''}
      </section>`;
  }

  function _warRowHtml(w) {
    const myScore  = Math.round(w.myScore);
    const oppScore = Math.round(w.opponentScore);
    const leading = myScore === oppScore ? 'even' : (myScore > oppScore ? 'me' : 'opponent');
    const statusHtml = w.status === 'active'
      ? `<span class="clan-war-countdown">${_countdown(w.endsAt)}</span>`
      : `<span class="clan-war-result">${w.isWinner === null ? 'Draw' : w.isWinner ? 'Victory' : 'Defeat'}</span>`;
    return `
      <div class="clan-war-row clan-war-row--${w.status}">
        <div class="clan-war-sides">
          <span class="clan-war-side clan-war-side--mine${leading === 'me' ? ' clan-war-side--leading' : ''}">${_myClan.tag} <b>${myScore.toLocaleString()}</b></span>
          <span class="clan-war-vs">vs</span>
          <span class="clan-war-side clan-war-side--enemy${leading === 'opponent' ? ' clan-war-side--leading' : ''}">[${w.opponentTag}] ${w.opponentName} <b>${oppScore.toLocaleString()}</b></span>
        </div>
        ${statusHtml}
      </div>`;
  }

  // "All Wars" tab — every clan war in the game (not just the player's own),
  // named absolutely (clanA/clanB) since neither side is "mine" here. Same
  // row shape/classes as _warRowHtml, just without a fixed "mine" side —
  // both sides get --enemy-toned styling and only the leading one goes gold.
  function _allWarsHtml() {
    if (_wars.length === 0) return '<p class="clan-empty">No clan wars yet.</p>';
    const active = _wars.filter(w => w.status === 'active');
    const ended  = _wars.filter(w => w.status === 'ended').slice(0, 20);
    return `
      <section class="clan-section">
        <div class="clan-section-title">Active Wars${active.length ? ` (${active.length})` : ''}</div>
        ${active.length === 0
          ? '<p class="clan-empty">No active wars right now.</p>'
          : `<div class="clan-war-list">${active.map(_globalWarRowHtml).join('')}</div>`}
        ${ended.length > 0 ? `
          <div class="clan-section-title" style="margin-top:1rem">Recently Ended</div>
          <div class="clan-war-history">${ended.map(_globalWarRowHtml).join('')}</div>` : ''}
      </section>`;
  }

  function _globalWarRowHtml(w) {
    const scoreA = Math.round(w.scoreA);
    const scoreB = Math.round(w.scoreB);
    const leading = scoreA === scoreB ? 'even' : (scoreA > scoreB ? 'a' : 'b');
    const statusHtml = w.status === 'active'
      ? `<span class="clan-war-countdown">${_countdown(w.endsAt)}</span>`
      : `<span class="clan-war-result">${w.winnerClanId ? `[${w.winnerClanId === w.clanAId ? w.clanATag : w.clanBTag}] wins` : 'Draw'}</span>`;
    return `
      <div class="clan-war-row clan-war-row--${w.status}">
        <div class="clan-war-sides">
          <span class="clan-war-side clan-war-side--mine${leading === 'a' ? ' clan-war-side--leading' : ''}">[${w.clanATag}] ${w.clanAName} <b>${scoreA.toLocaleString()}</b></span>
          <span class="clan-war-vs">vs</span>
          <span class="clan-war-side clan-war-side--enemy${leading === 'b' ? ' clan-war-side--leading' : ''}">[${w.clanBTag}] ${w.clanBName} <b>${scoreB.toLocaleString()}</b></span>
        </div>
        ${statusHtml}
      </div>`;
  }

  // "Rankings" tab — every clan ranked by the sum of its members' ranking
  // score, using data already fetched for this screen (_clans' member
  // lists, _scoreByPid from the leaderboard) — no extra server call.
  function _clanRankingsHtml() {
    if (_clans.length === 0) return '<p class="clan-empty">No clans yet.</p>';
    const ranked = _clans.map(c => {
      const totalPoints = (c.members || []).reduce((sum, m) => sum + (_scoreByPid[m.playerId] || 0), 0);
      const activeWar = (c.wars || []).find(w => w.status === 'active') || null;
      return { clan: c, totalPoints, playerCount: (c.members || []).length, activeWar };
    }).sort((a, b) => b.totalPoints - a.totalPoints);

    return `
      <section class="clan-section">
        <div class="clan-section-title">Clans by Total Points</div>
        <div class="clan-rankings-list">
          ${ranked.map((r, i) => `
            <div class="clan-rank-row${r.clan.id === _myClan?.id ? ' clan-member-row--you' : ''}">
              <span class="clan-rank-pos">#${i + 1}</span>
              <span class="clan-tag">[${r.clan.tag}]</span>
              <span class="clan-name">${r.clan.name}</span>
              <span class="clan-rank-points">${Math.round(r.totalPoints).toLocaleString()} pts</span>
              <span class="clan-rank-count">${r.playerCount} player${r.playerCount === 1 ? '' : 's'}</span>
              <span class="clan-rank-war">${r.activeWar ? `${gi('crossed-swords')} vs [${r.activeWar.opponentTag}]` : ''}</span>
            </div>`).join('')}
        </div>
      </section>`;
  }

  function _declareWarHtml(otherClans) {
    if (otherClans.length === 0) {
      return '<p class="clan-empty">No other clans to declare war on yet.</p>';
    }
    return `
      <div class="clan-declare-war">
        <select class="clan-select" id="clan-war-target">
          ${otherClans.map(c => `<option value="${c.id}">[${c.tag}] ${c.name}</option>`).join('')}
        </select>
        <select class="clan-select" id="clan-war-duration">
          <option value="86400">1 day</option>
          <option value="259200">3 days</option>
          <option value="604800">7 days</option>
        </select>
        <button class="btn-primary" id="clan-war-declare-btn">${gi('crossed-swords')} Declare War</button>
      </div>
      <p class="clan-error" id="clan-war-error"></p>`;
  }

  function _countdown(endsAtIso) {
    const msLeft = new Date(endsAtIso).getTime() - Date.now();
    if (msLeft <= 0) return 'Ending…';
    const h = Math.floor(msLeft / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h left`;
    const m = Math.floor((msLeft % 3600000) / 60000);
    return `${h}h ${m}m left`;
  }

  // ── Not in a clan ─────────────────────────────────────────────

  function _noClanHtml() {
    const myPendingClan = _clans.find(c => (c.pending || []).some(p => p.playerId === _player.id));
    const browsable = _clans.filter(c => c.memberCount < c.maxMembers);

    return `
      <section class="clan-section">
        <div class="clan-section-title">Create a Clan</div>
        <div class="clan-create-card">
          <input class="clan-input" id="clan-name-input" placeholder="Clan name" maxlength="30" autocomplete="off" />
          <input class="clan-input clan-input--tag" id="clan-tag-input" placeholder="TAG" maxlength="5" autocomplete="off" />
          <button class="btn-primary" id="clan-create-btn">Create</button>
        </div>
        <p class="clan-error" id="clan-create-error"></p>
      </section>
      <section class="clan-section">
        <div class="clan-section-title">Join a Clan</div>
        ${myPendingClan ? `<p class="clan-pending-note">${gi('hourglass')} Application pending — waiting for [${myPendingClan.tag}] ${myPendingClan.name}'s leader to respond.</p>` : ''}
        ${browsable.length === 0
          ? '<p class="clan-empty">No joinable clans yet — be the first to create one!</p>'
          : `<div class="clan-browse-list">
              ${browsable.map(c => {
                const applied = c.id === myPendingClan?.id;
                const disabled = !!myPendingClan;
                return `
                <div class="clan-browse-row">
                  <span class="clan-tag">[${c.tag}]</span>
                  <span class="clan-name">${c.name}</span>
                  <span class="clan-member-count">${c.memberCount}/${c.maxMembers}</span>
                  <button class="clan-join-btn" data-clan-id="${c.id}" ${disabled ? 'disabled' : ''}>${applied ? 'Pending…' : 'Apply'}</button>
                </div>`;
              }).join('')}
            </div>`}
      </section>`;
  }

  // ── Events ────────────────────────────────────────────────────

  // Tab buttons are only ever created once (in _html(), on the initial
  // full render) — switching tabs just swaps #clan-tab-content's innerHTML,
  // so only the content-specific listeners below need rebinding each time.
  function _bindEvents() {
    document.querySelectorAll('.rank-tab[data-clan-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.clanTab;
        document.querySelectorAll('.rank-tab[data-clan-tab]').forEach(b => b.classList.remove('rank-tab--active'));
        btn.classList.add('rank-tab--active');
        _renderTabContent();
        _bindContentEvents();
      });
    });
    _bindContentEvents();
  }

  // Rebinds everything interactive inside #clan-tab-content — needed both
  // on the initial render and every time a tab switch replaces that
  // element's innerHTML with fresh DOM (old listeners went with the old
  // nodes). Harmless no-op for tabs with nothing interactive (All Wars,
  // Rankings) since every selector below just matches zero elements there.
  function _bindContentEvents() {
    document.getElementById('clan-create-btn')?.addEventListener('click', async () => {
      const btn   = document.getElementById('clan-create-btn');
      const name  = document.getElementById('clan-name-input')?.value || '';
      const tag   = document.getElementById('clan-tag-input')?.value || '';
      const errEl = document.getElementById('clan-create-error');
      if (errEl) errEl.textContent = '';
      btn.disabled = true;
      const result = await ServerActions.clanCreate(name, tag);
      if (!result.ok) {
        if (errEl) errEl.textContent = result.error || 'Server error';
        btn.disabled = false;
        return;
      }
      _player = PlayerService.getById(_player.id);
      HUD.refresh();
      await render(_root, { player: _player });
    });

    document.querySelectorAll('.clan-join-btn[data-clan-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanApply(btn.dataset.clanId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _toast('Application sent!');
        await render(_root, { player: _player });
      });
    });

    document.getElementById('clan-leave-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('clan-leave-btn');
      const isLeader   = _myClan.leaderId === _player.id;
      const soleMember = _myClan.memberCount === 1;
      const msg = isLeader && soleMember
        ? 'Disband your clan? This cannot be undone.'
        : isLeader
          ? 'Leave the clan? Leadership will pass to another member.'
          : 'Leave the clan?';
      if (!confirm(msg)) return;
      btn.disabled = true;
      const result = await ServerActions.clanLeave();
      if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
      _player = PlayerService.getById(_player.id);
      HUD.refresh();
      await render(_root, { player: _player });
    });

    document.querySelectorAll('.clan-kick-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Kick this member from the clan?')) return;
        btn.disabled = true;
        const result = await ServerActions.clanKick(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await render(_root, { player: _player });
      });
    });

    document.querySelectorAll('.clan-accept-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanAccept(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await render(_root, { player: _player });
      });
    });

    document.querySelectorAll('.clan-reject-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanReject(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await render(_root, { player: _player });
      });
    });

    document.getElementById('clan-war-declare-btn')?.addEventListener('click', async () => {
      const btn      = document.getElementById('clan-war-declare-btn');
      const targetId = document.getElementById('clan-war-target')?.value;
      const duration = Number(document.getElementById('clan-war-duration')?.value);
      const errEl    = document.getElementById('clan-war-error');
      if (errEl) errEl.textContent = '';
      if (!targetId) return;
      btn.disabled = true;
      const result = await ServerActions.clanWarDeclare(targetId, duration);
      if (!result.ok) {
        if (errEl) errEl.textContent = result.error || 'Server error';
        btn.disabled = false;
        return;
      }
      await render(_root, { player: _player });
    });
  }

  function _toast(msg) { ToastService.show(msg); }

  function _loadingHtml() {
    return `
      <div class="clan-screen">
        <div class="clan-header"><h2 class="clan-title">${gi('round-shield')} Clan</h2></div>
        <div class="clan-loading">Loading clan info…</div>
      </div>`;
  }

  return { render };
})();
