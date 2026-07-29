// =============================================
//  clan-screen.js — ClanScreen
//
//  Split layout, same grammar as the Rankings / City / Lord screens
//  (rkv-body / cv-body / ls-body → clv-body):
//    Left panel  — the clan itself: crest + tag, total clan points and
//                  world rank, roster/applications/war counters, and a
//                  mini list of active wars. Counter rows double as tab
//                  switchers, exactly like the ranking screen's category
//                  rows. Unclanned players get the same panel shape,
//                  filled with world-level clan info instead.
//    Right pane  — underline tab bar over the scrollable content:
//                  Members (or Browse Clans when unclanned) · Wars ·
//                  Rankings, plus roadmap tabs (Treasury, Diplomacy)
//                  that render a "coming soon" preview rather than
//                  sitting there dead.
//
//  All membership/war changes stay server-authoritative (see
//  server/actions/clan-*.js); this screen just renders whatever
//  /api/clan/list + RankingService's leaderboard currently say, always
//  re-fetched on render (no local caching — this screen isn't opened
//  often enough to need it).
//
//  Joining is a leader-approved application, not instant — see
//  clan-apply.js/clan-accept.js/clan-reject.js. Wars are a time-boxed,
//  score-race "flag" between two clans (see clan-war-declare.js) — no
//  attack-permission changes come from being at war; only being in the SAME
//  clan blocks an attack (server-enforced in combat-resolver.js).
// =============================================

const ClanScreen = (() => {
  let _root       = null;
  let _player     = null;
  let _clans      = [];
  let _myClan     = null;
  let _wars       = []; // every clan_wars row in the game, named absolutely (clanA/clanB) — see clan-list.js
  let _honorByPid = {};
  let _scoreByPid = {};
  let _activeTab  = null;

  // Roadmap tabs — visible from day one so the screen advertises what's
  // coming, but they render a preview panel instead of a dead button.
  const _SOON = {
    treasury: {
      icon:  'two-coins',
      title: 'Clan Treasury',
      blurb: 'A shared vault every member can donate gold and resources to, spent on clan-wide projects.',
      bullets: [
        'Member donations with a per-clan contribution ledger',
        'Clan-wide upgrades funded from the vault',
        'Leader-set weekly tribute targets',
      ],
    },
    diplomacy: {
      icon:  'shaking-hands',
      title: 'Diplomacy',
      blurb: 'Standing relations between clans — not just the time-boxed wars you can declare today.',
      bullets: [
        'Non-aggression pacts and formal alliances',
        'Allied vision on the world map',
        'Coordinated war declarations between allied clans',
      ],
    },
  };

  // The first tab depends on membership: roster when you're in a clan,
  // the browse/create list when you aren't. Everything after it is shared.
  function _tabs() {
    const first = _myClan
      ? { id: 'members', icon: 'three-friends',    label: 'Members' }
      : { id: 'browse',  icon: 'magnifying-glass', label: 'Browse Clans' };
    return [
      first,
      { id: 'wars',      icon: 'crossed-swords', label: 'Wars' },
      { id: 'rankings',  icon: 'trophy',         label: 'Rankings' },
      { id: 'treasury',  icon: 'two-coins',      label: 'Treasury',  soon: true },
      { id: 'diplomacy', icon: 'shaking-hands',  label: 'Diplomacy', soon: true },
    ];
  }

  // ── Entry points ──────────────────────────────────────────────

  async function render(root, { player }) {
    _root      = root;
    _player    = player;
    _activeTab = null; // fresh entry always lands on the default tab
    root.innerHTML = _loadingHtml();
    await _load();
    _renderFull();
  }

  // Re-fetch + repaint after a membership/war change. Unlike render() this
  // KEEPS the current tab — kicking a member shouldn't bounce you back to
  // the roster from wherever you were.
  async function _reload() {
    await _load();
    _renderFull();
  }

  async function _load() {
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

    // Joining/leaving swaps the first tab in and out, so re-validate.
    const ids = _tabs().map(t => t.id);
    if (!_activeTab || !ids.includes(_activeTab)) _activeTab = ids[0];
  }

  function _renderFull() {
    _root.innerHTML = _html();
    _renderTabContent();
    _bindEvents();
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _html() {
    const tabsHtml = _tabs().map(t => `
      <button class="clv-tab ${_activeTab === t.id ? 'clv-tab--active' : ''}" data-clan-tab="${t.id}">
        <span>${gi(t.icon)}</span><span>${t.label}</span>
        ${t.soon ? '<span class="clv-tab-soon">Soon</span>' : ''}
      </button>`).join('');

    return `
      <div class="clan-screen">
        <div class="clv-body">
          <aside class="clv-left">${_leftPanelHtml()}</aside>
          <div class="clv-right">
            <div class="clv-tabs">
              ${tabsHtml}
              <span class="clv-meta">${_metaText()}</span>
            </div>
            <div class="clv-content" id="clan-tab-content"></div>
          </div>
        </div>
      </div>`;
  }

  function _metaText() {
    if (_myClan) return `[${_myClan.tag}] ${_myClan.name} · ${_myClan.memberCount}/${_myClan.maxMembers} members`;
    return `${_clans.length} clan${_clans.length === 1 ? '' : 's'} in the world`;
  }

  // ── Shared derivations ────────────────────────────────────────

  // Every clan ranked by the sum of its members' ranking score, built from
  // data already fetched for this screen (_clans' member lists +
  // _scoreByPid) — no extra server call. Single source of truth for both
  // the left panel's standing card and the Rankings tab.
  function _clanRanked() {
    return _clans.map(c => ({
      clan:        c,
      totalPoints: (c.members || []).reduce((sum, m) => sum + (_scoreByPid[m.playerId] || 0), 0),
      playerCount: (c.members || []).length,
      activeWar:   (c.wars || []).find(w => w.status === 'active') || null,
    })).sort((a, b) => b.totalPoints - a.totalPoints);
  }

  function _myStanding() {
    if (!_myClan) return null;
    const ranked = _clanRanked();
    const idx    = ranked.findIndex(r => r.clan.id === _myClan.id);
    return idx === -1 ? null : { ...ranked[idx], rank: idx + 1, of: ranked.length };
  }

  function _warRecord(clan) {
    const ended = (clan.wars || []).filter(w => w.status === 'ended');
    return {
      wins:   ended.filter(w => w.isWinner === true).length,
      losses: ended.filter(w => w.isWinner === false).length,
      draws:  ended.filter(w => w.isWinner === null).length,
    };
  }

  function _isLeader() { return !!_myClan && _myClan.leaderId === _player.id; }

  function _fmt(n) { return Math.round(n || 0).toLocaleString(); }

  // Stable per-clan tint for the crest, hashed from tag+name so the same
  // clan always reads the same colour without needing a stored field.
  function _crestHue(seed) {
    let h = 0;
    for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }

  // ── Left panel ────────────────────────────────────────────────

  function _leftPanelHtml() {
    return _myClan ? _myClanPanelHtml() : _noClanPanelHtml();
  }

  function _statRowHtml({ tab, icon, label, sub, value, valueCls }) {
    return `
      <button class="clv-stat ${_activeTab === tab ? 'clv-stat--active' : ''}" data-clan-tab="${tab}">
        <span class="clv-stat-icon">${gi(icon)}</span>
        <span class="clv-stat-body">
          <span class="clv-stat-label">${label}</span>
          <span class="clv-stat-sub">${sub}</span>
        </span>
        <span class="clv-stat-val ${valueCls || ''}">${value}</span>
      </button>`;
  }

  function _myClanPanelHtml() {
    const standing = _myStanding();
    const record   = _warRecord(_myClan);
    const active   = (_myClan.wars || []).filter(w => w.status === 'active');
    const pending  = _myClan.pending || [];
    const leader   = (_myClan.members || []).find(m => m.playerId === _myClan.leaderId);
    const hue      = _crestHue(_myClan.tag + _myClan.name);

    const soleMember = _myClan.memberCount === 1;
    const leaveLabel = _isLeader()
      ? (soleMember ? gi('trash-can') + ' Disband Clan' : gi('exit-door') + ' Leave (passes leadership on)')
      : gi('exit-door') + ' Leave Clan';

    const statsHtml = [
      _statRowHtml({
        tab: 'members', icon: 'three-friends', label: 'Members',
        sub: `${_myClan.maxMembers - _myClan.memberCount} slot${_myClan.maxMembers - _myClan.memberCount === 1 ? '' : 's'} open`,
        value: `${_myClan.memberCount}/${_myClan.maxMembers}`,
      }),
      _isLeader() ? _statRowHtml({
        tab: 'members', icon: 'scroll-unfurled', label: 'Applications',
        sub: pending.length ? 'Awaiting your decision' : 'Nothing to review',
        value: `${pending.length}`,
        valueCls: pending.length ? 'clv-stat-val--alert' : '',
      }) : '',
      _statRowHtml({
        tab: 'wars', icon: 'crossed-swords', label: 'Active Wars',
        sub: active.length ? 'Score race in progress' : 'At peace',
        value: `${active.length}`,
        valueCls: active.length ? 'clv-stat-val--alert' : '',
      }),
      _statRowHtml({
        tab: 'wars', icon: 'laurel-crown', label: 'War Record',
        sub: `${record.wins}W · ${record.losses}L · ${record.draws}D`,
        value: `${record.wins + record.losses + record.draws}`,
      }),
    ].join('');

    return `
      ${_crestHtml(_myClan.tag, hue, `${gi('three-friends')} ${_myClan.memberCount}/${_myClan.maxMembers}`)}

      <div class="clv-id">
        <h1 class="clv-name">${_myClan.name}</h1>
        <div class="clv-id-sub">${gi('crown')} ${leader ? leader.username : 'Unknown'}${_isLeader() ? ' (you)' : ''}</div>
      </div>

      <div class="clv-divider"></div>

      <button class="clv-total ${_activeTab === 'rankings' ? 'clv-total--active' : ''}" data-clan-tab="rankings">
        <div class="clv-total-label">${gi('trophy')} Clan Points</div>
        <div class="clv-total-value">${_fmt(standing?.totalPoints)} <span class="clv-total-unit">pts</span></div>
        <div class="clv-total-sub">${standing ? `#${standing.rank} of ${standing.of} clans` : 'Unranked'}</div>
      </button>

      <div class="clv-divider"></div>
      <div class="clv-stats-header">Clan Overview</div>
      <div class="clv-stats">${statsHtml}</div>

      <div class="clv-divider"></div>
      <div class="clv-stats-header">Active Wars</div>
      ${active.length === 0
        ? '<p class="clv-mini-empty">No wars in progress.</p>'
        : `<div class="clv-mini-wars">
            ${active.slice(0, 3).map(w => `
              <button class="clv-mini-war" data-clan-tab="wars">
                <span class="clv-mini-war-top">
                  <span class="clv-mini-war-vs">vs [${w.opponentTag}]</span>
                  <span class="clv-mini-war-time">${_countdown(w.endsAt)}</span>
                </span>
                <span class="clv-mini-war-score">
                  <b class="${w.myScore >= w.opponentScore ? 'clv-lead' : ''}">${_fmt(w.myScore)}</b>
                  <span class="clan-war-vs">—</span>
                  <b class="${w.opponentScore > w.myScore ? 'clv-lead' : ''}">${_fmt(w.opponentScore)}</b>
                </span>
              </button>`).join('')}
          </div>`}

      <div class="clv-actions">
        <button class="clan-leave-btn" id="clan-leave-btn">${leaveLabel}</button>
      </div>`;
  }

  function _noClanPanelHtml() {
    const ranked      = _clanRanked();
    const top         = ranked[0] || null;
    const openClans   = _clans.filter(c => c.memberCount < c.maxMembers).length;
    const activeWars  = _wars.filter(w => w.status === 'active').length;
    const myPending   = _clans.find(c => (c.pending || []).some(p => p.playerId === _player.id)) || null;

    const statsHtml = [
      _statRowHtml({
        tab: 'browse', icon: 'scroll-unfurled', label: 'Your Application',
        sub: myPending ? `Waiting on ${myPending.name}` : 'Not applied anywhere',
        value: myPending ? `[${myPending.tag}]` : '—',
        valueCls: myPending ? 'clv-stat-val--alert' : '',
      }),
      _statRowHtml({
        tab: 'wars', icon: 'crossed-swords', label: 'Active Wars',
        sub: activeWars ? 'Clans currently fighting' : 'The world is at peace',
        value: `${activeWars}`,
      }),
      _statRowHtml({
        tab: 'rankings', icon: 'laurel-crown', label: 'Top Clan',
        sub: top ? `${_fmt(top.totalPoints)} pts` : 'No clans ranked yet',
        value: top ? `[${top.clan.tag}]` : '—',
      }),
    ].join('');

    return `
      ${_crestHtml('—', 210, gi('person') + ' Unaffiliated', true)}

      <div class="clv-id">
        <h1 class="clv-name">No Clan</h1>
        <div class="clv-id-sub">Found your own or apply to an existing one</div>
      </div>

      <div class="clv-divider"></div>

      <button class="clv-total ${_activeTab === 'browse' ? 'clv-total--active' : ''}" data-clan-tab="browse">
        <div class="clv-total-label">${gi('round-shield')} Clans in the World</div>
        <div class="clv-total-value">${_clans.length}</div>
        <div class="clv-total-sub">${openClans} with open slots</div>
      </button>

      <div class="clv-divider"></div>
      <div class="clv-stats-header">World Overview</div>
      <div class="clv-stats">${statsHtml}</div>

      <div class="clv-actions">
        <button class="btn-primary clv-cta" data-clan-tab="browse">${gi('round-shield')} Found a Clan</button>
      </div>`;
  }

  function _crestHtml(tag, hue, badgeHtml, muted) {
    return `
      <div class="clv-crest ${muted ? 'clv-crest--muted' : ''}" style="--clv-hue:${hue}">
        <div class="clv-crest-mark">${gi('round-shield')}</div>
        <div class="clv-crest-tag">${tag}</div>
        <div class="clv-crest-fade"></div>
        <div class="clv-crest-badge">${badgeHtml}</div>
      </div>`;
  }

  // ── Right pane ────────────────────────────────────────────────

  function _renderTabContent() {
    const el = document.getElementById('clan-tab-content');
    if (!el) return;
    el.innerHTML = _tabHtml(_activeTab);
  }

  function _tabHtml(tab) {
    if (_SOON[tab])         return _soonHtml(_SOON[tab]);
    if (tab === 'wars')     return _warsTabHtml();
    if (tab === 'rankings') return _rankingsTabHtml();
    if (tab === 'browse')   return _browseTabHtml();
    return _membersTabHtml();
  }

  function _panelHtml(titleHtml, noteHtml, bodyHtml, bare) {
    return `
      <section class="clv-panel">
        <div class="clv-panel-head">
          <span class="clv-panel-title">${titleHtml}</span>
          ${noteHtml ? `<span class="clv-panel-note">${noteHtml}</span>` : ''}
        </div>
        ${bare ? bodyHtml : `<div class="clv-panel-body">${bodyHtml}</div>`}
      </section>`;
  }

  // ── Members tab ───────────────────────────────────────────────

  function _membersTabHtml() {
    if (!_myClan) return '<p class="clan-empty">You are not in a clan.</p>';
    const roster = _panelHtml(
      `${gi('three-friends')} Roster`,
      `${_myClan.memberCount}/${_myClan.maxMembers} members`,
      `<div class="clan-members">${_myClan.members.map(m => _memberRowHtml(m)).join('')}</div>`,
      true);
    return roster + (_isLeader() ? _applicationsHtml() : '');
  }

  function _memberRowHtml(m) {
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
        ${_isLeader() && m.playerId !== _player.id
          ? `<button class="clan-kick-btn" data-target="${m.playerId}">Kick</button>`
          : ''}
      </div>`;
  }

  function _applicationsHtml() {
    const pending = _myClan.pending || [];
    return _panelHtml(
      `${gi('scroll-unfurled')} Applications`,
      pending.length ? `${pending.length} waiting` : '',
      pending.length === 0
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
          </div>`);
  }

  // ── Wars tab ──────────────────────────────────────────────────
  //
  //  Own wars first (expressed as "me vs opponent", from _myClan.wars),
  //  then every war in the game (named absolutely as clanA/clanB — see
  //  clan-list.js, since neither side is "mine" there).

  function _warsTabHtml() {
    const globalActive = _wars.filter(w => w.status === 'active');
    const globalEnded  = _wars.filter(w => w.status === 'ended').slice(0, 20);

    let html = '';

    if (_isLeader()) html += _declareWarHtml();

    if (_myClan) {
      const mine       = _myClan.wars || [];
      const mineActive = mine.filter(w => w.status === 'active');
      const mineEnded  = mine.filter(w => w.status === 'ended').slice(0, 5);
      html += _panelHtml(
        `${gi('crossed-swords')} Our Wars`,
        mineActive.length ? `${mineActive.length} active` : '',
        (mineActive.length === 0
          ? '<p class="clan-empty">No active wars.</p>'
          : `<div class="clan-war-list">${mineActive.map(_warRowHtml).join('')}</div>`) +
        (mineEnded.length > 0
          ? `<div class="clan-war-history">${mineEnded.map(_warRowHtml).join('')}</div>`
          : ''));
    }

    html += _panelHtml(
      `${gi('round-shield')} All Wars`,
      globalActive.length ? `${globalActive.length} active worldwide` : '',
      globalActive.length === 0
        ? '<p class="clan-empty">No active wars right now.</p>'
        : `<div class="clan-war-list">${globalActive.map(_globalWarRowHtml).join('')}</div>`);

    if (globalEnded.length > 0) {
      html += _panelHtml(
        `${gi('hourglass')} Recently Ended`,
        '',
        `<div class="clan-war-history">${globalEnded.map(_globalWarRowHtml).join('')}</div>`);
    }

    return html;
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
          <span class="clan-war-side clan-war-side--mine${leading === 'me' ? ' clan-war-side--leading' : ''}">[${_myClan.tag}] ${_myClan.name} <b>${myScore.toLocaleString()}</b></span>
          <span class="clan-war-vs">vs</span>
          <span class="clan-war-side clan-war-side--enemy${leading === 'opponent' ? ' clan-war-side--leading' : ''}">[${w.opponentTag}] ${w.opponentName} <b>${oppScore.toLocaleString()}</b></span>
        </div>
        ${statusHtml}
      </div>`;
  }

  // Same row shape/classes as _warRowHtml, just without a fixed "mine"
  // side — both sides get --enemy-toned styling and only the leading one
  // goes gold.
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

  function _declareWarHtml() {
    const otherClans = _clans.filter(c => c.id !== _myClan.id);
    if (otherClans.length === 0) {
      return _panelHtml(`${gi('crossed-swords')} Declare War`, '', '<p class="clan-empty">No other clans to declare war on yet.</p>');
    }
    return _panelHtml(`${gi('crossed-swords')} Declare War`, 'Leader only', `
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
      <p class="clan-error" id="clan-war-error"></p>`);
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

  // ── Rankings tab ──────────────────────────────────────────────

  function _rankingsTabHtml() {
    const ranked = _clanRanked();
    if (ranked.length === 0) return '<p class="clan-empty">No clans yet.</p>';
    return _panelHtml(
      `${gi('trophy')} Clans by Total Points`,
      `${ranked.length} ranked`,
      `<div class="clan-rankings-list">
        ${ranked.map((r, i) => `
          <div class="clan-rank-row${r.clan.id === _myClan?.id ? ' clan-member-row--you' : ''}">
            <span class="clan-rank-pos">${_medalOf(i)}</span>
            <span class="clan-tag">[${r.clan.tag}]</span>
            <span class="clan-name">${r.clan.name}</span>
            <span class="clan-rank-points">${_fmt(r.totalPoints)} pts</span>
            <span class="clan-rank-count">${r.playerCount} player${r.playerCount === 1 ? '' : 's'}</span>
            <span class="clan-rank-war">${r.activeWar ? `${gi('crossed-swords')} vs [${r.activeWar.opponentTag}]` : ''}</span>
          </div>`).join('')}
      </div>`,
      true);
  }

  function _medalOf(i) {
    return i === 0 ? gi('podium-winner', 'gi--gold')
         : i === 1 ? gi('medal', 'gi--silver')
         : i === 2 ? gi('medal', 'gi--bronze')
         : `#${i + 1}`;
  }

  // ── Browse tab (not in a clan) ────────────────────────────────

  function _browseTabHtml() {
    const myPendingClan = _clans.find(c => (c.pending || []).some(p => p.playerId === _player.id));
    const browsable = _clans.filter(c => c.memberCount < c.maxMembers);

    const createHtml = _panelHtml(`${gi('round-shield')} Found a Clan`, 'Costs nothing — you become its leader', `
      <div class="clan-create-card">
        <input class="clan-input" id="clan-name-input" placeholder="Clan name" maxlength="30" autocomplete="off" />
        <input class="clan-input clan-input--tag" id="clan-tag-input" placeholder="TAG" maxlength="5" autocomplete="off" />
        <button class="btn-primary" id="clan-create-btn">Create</button>
      </div>
      <p class="clan-error" id="clan-create-error"></p>`);

    const joinHtml = _panelHtml(`${gi('shaking-hands')} Join a Clan`,
      browsable.length ? `${browsable.length} with open slots` : '',
      `${myPendingClan ? `<p class="clan-pending-note">${gi('hourglass')} Application pending — waiting for [${myPendingClan.tag}] ${myPendingClan.name}'s leader to respond.</p>` : ''}
      ${browsable.length === 0
        ? '<p class="clan-empty">No joinable clans yet — be the first to create one!</p>'
        : `<div class="clan-browse-list">
            ${browsable.map(c => {
              const applied  = c.id === myPendingClan?.id;
              const disabled = !!myPendingClan;
              const points   = (c.members || []).reduce((sum, m) => sum + (_scoreByPid[m.playerId] || 0), 0);
              return `
              <div class="clan-browse-row">
                <span class="clan-tag">[${c.tag}]</span>
                <span class="clan-name">${c.name}</span>
                <span class="clan-rank-points">${_fmt(points)} pts</span>
                <span class="clan-member-count">${c.memberCount}/${c.maxMembers}</span>
                <button class="clan-join-btn" data-clan-id="${c.id}" ${disabled ? 'disabled' : ''}>${applied ? 'Pending…' : 'Apply'}</button>
              </div>`;
            }).join('')}
          </div>`}`);

    return createHtml + joinHtml;
  }

  // ── Roadmap tabs ──────────────────────────────────────────────

  function _soonHtml(def) {
    return `
      <div class="clv-soon">
        <div class="clv-soon-icon">${gi(def.icon)}</div>
        <div class="clv-soon-title">${def.title}</div>
        <div class="clv-soon-badge">${gi('hourglass')} Coming in a future release</div>
        <p class="clv-soon-text">${def.blurb}</p>
        <ul class="clv-soon-list">
          ${def.bullets.map(b => `<li>${b}</li>`).join('')}
        </ul>
      </div>`;
  }

  // ── Events ────────────────────────────────────────────────────

  // Tab switches come from TWO places — the underline tab bar on the right
  // AND the left panel's total/counter rows — so both carry data-clan-tab
  // and funnel into the same handler, then _syncActive keeps every
  // switcher's active state in agreement. Only the content area is
  // re-rendered on a switch, so its listeners are rebound each time.
  function _bindEvents() {
    _root.querySelectorAll('[data-clan-tab]').forEach(el => {
      el.addEventListener('click', () => {
        if (_activeTab === el.dataset.clanTab) return;
        _activeTab = el.dataset.clanTab;
        _syncActive();
        _renderTabContent();
        _bindContentEvents();
      });
    });
    _bindContentEvents();
  }

  function _syncActive() {
    _root.querySelectorAll('.clv-tab').forEach(b =>
      b.classList.toggle('clv-tab--active', b.dataset.clanTab === _activeTab));
    _root.querySelectorAll('.clv-stat').forEach(b =>
      b.classList.toggle('clv-stat--active', b.dataset.clanTab === _activeTab));
    const total = _root.querySelector('.clv-total');
    if (total) total.classList.toggle('clv-total--active', total.dataset.clanTab === _activeTab);
  }

  // Rebinds everything interactive inside #clan-tab-content — needed both
  // on the initial render and every time a tab switch replaces that
  // element's innerHTML with fresh DOM (old listeners went with the old
  // nodes). Harmless no-op for tabs with nothing interactive (Rankings,
  // the roadmap tabs) since every selector below just matches zero
  // elements there. The Leave button lives in the left panel, which only
  // changes on a full render — bound here too, which is safe because a
  // full render replaces it along with everything else.
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
      await _reload();
    });

    document.querySelectorAll('.clan-join-btn[data-clan-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanApply(btn.dataset.clanId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _toast('Application sent!');
        await _reload();
      });
    });

    document.getElementById('clan-leave-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('clan-leave-btn');
      const isLeader   = _isLeader();
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
      await _reload();
    });

    document.querySelectorAll('.clan-kick-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Kick this member from the clan?')) return;
        btn.disabled = true;
        const result = await ServerActions.clanKick(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await _reload();
      });
    });

    document.querySelectorAll('.clan-accept-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanAccept(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await _reload();
      });
    });

    document.querySelectorAll('.clan-reject-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.clanReject(btn.dataset.target);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        await _reload();
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
      await _reload();
    });
  }

  function _toast(msg) { ToastService.show(msg); }

  function _loadingHtml() {
    return `
      <div class="clan-screen">
        <div class="clan-loading">Loading clan info…</div>
      </div>`;
  }

  return { render };
})();
