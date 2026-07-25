// =============================================
//  ranking-screen.js — RankingScreen
//
//  5 tabs: Overall · Infrastructure · Lords · Militar · Honor
//    Infrastructure = Buildings + City Tier Bonus
//    Lords          = Lord Levels + Quests
//    Militar        = Army PWR only (PvP wins/conquests no longer score
//                      ranking points — PvP's reward is honor instead,
//                      scaled by power destroyed; see combat-resolver.js)
//  Each tab sorts the same leaderboard data by a different field.
//  No extra Supabase fetches on tab switch. Each row shows a ▲/▼ badge
//  when the player's rank in that tab has moved in roughly the last hour.
//  "YOUR SCORE" is a closed-by-default <details> dropdown — only the
//  grouped category totals show, the per-field breakdown is opt-in.
// =============================================

const RankingScreen = (() => {

  let _root       = null;
  let _player     = null;
  let _leaderboard = [];
  let _ownScore   = null;
  let _activeTab  = 'overall';
  let _clanByPid  = {};

  async function render(root, { player }) {
    _root      = root;
    _player    = player;
    _activeTab = 'overall';

    root.innerHTML = _loadingHtml();

    const scoreObj = RankingService.computeScore(player);
    _ownScore      = scoreObj;

    // saveScore's write and fetchLeaderboard's reads don't depend on each
    // other — running them together (instead of awaiting the save before
    // even starting the fetch) was the main reason this screen felt slow.
    // This does mean fetchLeaderboard can occasionally win the race and
    // return our OWN entry a moment stale; the patch below always
    // overwrites it with the just-computed local values regardless, so
    // that race never actually reaches the screen.
    const [, leaderboard, clanMap] = await Promise.all([
      RankingService.saveScore(player, scoreObj),
      RankingService.fetchLeaderboard(),
      ClanService.getPlayerClanMap(),
    ]);
    _leaderboard = leaderboard;
    _clanByPid   = clanMap;

    // Inject own entry if not yet saved, or overwrite it with the fresh
    // local computation so this visit's own row/score/breakdown are never
    // stale regardless of how the save/fetch race above landed.
    const ownIdx = _leaderboard.findIndex(e => e.playerId === player.id);
    const ownEntry = {
      playerId:    player.id,
      username:    player.username,
      score:       scoreObj.total,
      breakdown:   scoreObj.breakdown,
      lordMeta:    scoreObj.lordMeta,
      honorPoints: player.honorPoints || 0,
    };
    if (ownIdx === -1) {
      _leaderboard.push(ownEntry);
    } else {
      _leaderboard[ownIdx] = { ..._leaderboard[ownIdx], ...ownEntry };
    }

    _renderFull();
  }

  // ── Render ────────────────────────────────────────────────────

  function _renderFull() {
    _root.innerHTML = _html();
    _renderTabContent();
    _bindEvents();
  }

  const _TABS = [
    { id: 'overall',  label: '🏆 Overall',        name: 'Overall'        },
    { id: 'infra',    label: '🏛 Infrastructure', name: 'Infrastructure' },
    { id: 'lords',    label: '👑 Lords',          name: 'Lords'          },
    { id: 'militar',  label: '⚔ Military',        name: 'Military'       },
    { id: 'honor',    label: '🛡 Honor',          name: 'Honor'          },
  ];

  // Grouped-category totals — the single source of truth for what each
  // group means, shared by tab sorting, the own-score dropdown, and row
  // subtitles so they can never drift out of sync with each other.
  // Militar is pure army PWR now — PvP wins and conquests no longer award
  // ranking points at all (PvP's reward is honor, scaled by power
  // destroyed — see combat-resolver.js).
  function _militarPts(entry) {
    return entry.breakdown?.armyPts || 0;
  }
  function _infraPts(entry) {
    const b = entry.breakdown || {};
    return (b.buildingPts || 0) + (b.tierPts || 0);
  }
  function _lordsPts(entry) {
    const b = entry.breakdown || {};
    return (b.lordPts || 0) + (b.questPts || 0);
  }

  // Single source of truth for "how is this tab sorted" — used both to
  // render the list and to compute the header's position-in-this-tab,
  // so the two can never drift out of sync again. Always sorts a copy;
  // never mutates the shared _leaderboard array.
  function _sortedForTab(tab) {
    const sorted = [..._leaderboard];
    switch (tab) {
      case 'overall': sorted.sort((a, b) => b.score - a.score); break;
      case 'infra':   sorted.sort((a, b) => _infraPts(b) - _infraPts(a)); break;
      case 'lords':   sorted.sort((a, b) => _lordsPts(b) - _lordsPts(a)); break;
      case 'militar': sorted.sort((a, b) => _militarPts(b) - _militarPts(a)); break;
      case 'honor':   sorted.sort((a, b) => (b.honorPoints || 0) - (a.honorPoints || 0)); break;
    }
    return sorted;
  }

  // Same shape as _sortedForTab, but built from each entry's ~1h-old
  // snapshot (falling back to their CURRENT values when they have no
  // snapshot yet, so the population used for ranking stays apples-to-apples
  // with _sortedForTab — only entries with real historical data ever get a
  // delta badge, but everyone else still occupies a sane relative slot).
  function _historicalSortedForTab(tab) {
    const historical = _leaderboard.map(e => ({
      playerId:    e.playerId,
      score:       e.snapshot?.score       ?? e.score,
      breakdown:   e.snapshot?.breakdown   ?? e.breakdown,
      honorPoints: e.snapshot?.honorPoints ?? e.honorPoints,
    }));
    switch (tab) {
      case 'overall': historical.sort((a, b) => b.score - a.score); break;
      case 'infra':   historical.sort((a, b) => _infraPts(b) - _infraPts(a)); break;
      case 'lords':   historical.sort((a, b) => _lordsPts(b) - _lordsPts(a)); break;
      case 'militar': historical.sort((a, b) => _militarPts(b) - _militarPts(a)); break;
      case 'honor':   historical.sort((a, b) => (b.honorPoints || 0) - (a.honorPoints || 0)); break;
    }
    return historical;
  }

  // Positions moved in the last ~hour: positive = moved up (rank number
  // got smaller), negative = moved down. Null when this player has no
  // snapshot yet (brand new to the leaderboard — nothing to diff against).
  function _rankDelta(tab, playerId) {
    const entry = _leaderboard.find(e => e.playerId === playerId);
    if (!entry || !entry.snapshot) return null;
    const curIdx  = _sortedForTab(tab).findIndex(e => e.playerId === playerId);
    const histIdx = _historicalSortedForTab(tab).findIndex(e => e.playerId === playerId);
    if (curIdx === -1 || histIdx === -1) return null;
    return histIdx - curIdx;
  }

  function _deltaBadgeHtml(tab, playerId) {
    const delta = _rankDelta(tab, playerId);
    if (delta == null || delta === 0) return '';
    const up = delta > 0;
    return `<span class="rank-delta ${up ? 'rank-delta--up' : 'rank-delta--down'}">${up ? '▲' : '▼'}${Math.abs(delta)}</span>`;
  }

  function _rankForTab(tab) {
    return _sortedForTab(tab).findIndex(e => e.playerId === _player.id) + 1;
  }

  function _headerSubtitle() {
    const rank  = _rankForTab(_activeTab);
    const tabDef = _TABS.find(t => t.id === _activeTab);
    const suffix = _activeTab !== 'overall' ? ` (${tabDef?.name || ''})` : '';
    return `Your position: #${rank} of ${_leaderboard.length}${suffix}`;
  }

  function _html() {
    const tabsHtml = _TABS.map(t => `
      <button class="rank-tab ${_activeTab === t.id ? 'rank-tab--active' : ''}" data-rank-tab="${t.id}">${t.label}</button>
    `).join('');

    return `
      <div class="rank-screen">
        <div class="rank-header">
          <h2 class="rank-title">📊 Rankings</h2>
          <div class="rank-subtitle" id="rank-subtitle">${_headerSubtitle()}</div>
        </div>

        <div class="rank-content">
          ${_ownScoreCard()}
          <div class="rank-tabs-row">${tabsHtml}</div>
          <div class="rank-tab-content" id="rank-tab-content"></div>
        </div>
      </div>`;
  }

  // Tiered Good/Evil crest, shown only once honor clears the first tier threshold.
  function _honorTag(pts) {
    const tier = getHonorTier(pts);
    return tier ? `<span class="rank-honor-tag">${honorCrestHtml(tier)}</span> ` : '';
  }

  // Signed honor value shown in parens right after the username.
  function _honorValue(pts) {
    const n = pts || 0;
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    const cls  = n > 0 ? 'rank-honor--pos' : n < 0 ? 'rank-honor--neg' : 'rank-honor--zero';
    return `<span class="rank-honor-value ${cls}">(${sign}${_fmt(Math.abs(n))})</span>`;
  }
  // Clan tag prefix, e.g. "[TAG] " — looked up by playerId, blank if unclanned.
  function _clanTag(playerId) {
    const c = _clanByPid[playerId];
    return c ? `<span class="rank-clan-tag">[${c.tag}]</span> ` : '';
  }

  // "[Good/Evil] [TAG] username (honor)" — the single shared format for every
  // place username + honor points appear together on the Rankings screen.
  function _nameWithHonor(username, honor, extraHtml, playerId) {
    return `${_honorTag(honor)}${_clanTag(playerId)}${username || '?'}${extraHtml || ''} ${_honorValue(honor)}`;
  }

  function _ownScoreCard() {
    const b     = _ownScore.breakdown;
    const honor = _player.honorPoints || 0;
    const entry = { breakdown: b };
    const groups = [
      { icon: '⚔', label: 'Military',       pts: _militarPts(entry), sub: `Army Power ${_fmt(b.armyPts || 0)} (lords' combined PWR)` },
      { icon: '🏛', label: 'Infrastructure', pts: _infraPts(entry),   sub: `Buildings ${_fmt(b.buildingPts || 0)} · City Tier Bonus ${_fmt(b.tierPts || 0)}` },
      { icon: '👑', label: 'Lords',          pts: _lordsPts(entry),   sub: `Lord Levels ${_fmt(b.lordPts || 0)} · Quests ${_fmt(b.questPts || 0)}` },
    ];

    return `
      <section class="rank-section">
        <div class="rank-section-title">YOUR SCORE</div>
        <details class="rank-own-card">
          <summary class="rank-own-top">
            <span class="rank-own-name">${_nameWithHonor(_player.username, honor, '', _player.id)}</span>
            <div class="rank-own-right">
              <span class="rank-own-total">${_fmt(_ownScore.total)} <span class="rank-pts-unit">pts</span></span>
              <span class="rank-own-chevron">▾</span>
            </div>
          </summary>
          <div class="rank-breakdown">
            ${groups.map(g => `
              <div class="rank-brow">
                <span class="rank-brow-icon">${g.icon}</span>
                <div class="rank-brow-body">
                  <div class="rank-brow-top">
                    <span class="rank-brow-label">${g.label}</span>
                    <span class="rank-brow-pts">${_fmt(g.pts)}</span>
                  </div>
                  <div class="rank-brow-sub">${g.sub}</div>
                </div>
              </div>`).join('')}
          </div>
        </details>
      </section>`;
  }

  function _renderTabContent() {
    const el = document.getElementById('rank-tab-content');
    if (!el) return;
    el.innerHTML = _tabHtml(_activeTab);
  }

  const _ROW_FNS = {
    overall: _overallRow, infra: _infraRow, lords: _lordsRow,
    militar: _militarRow, honor: _honorRow,
  };

  function _tabHtml(tab) {
    const sorted = _sortedForTab(tab);
    const rowFn  = _ROW_FNS[tab];
    return rowFn ? _listHtml(sorted, rowFn) : '';
  }

  // Always shows the top 50, but the viewer's own row is never allowed to
  // silently vanish just because they're ranked below that cutoff — it's
  // appended with its real position if it fell outside the visible slice.
  function _listHtml(sorted, rowFn) {
    if (!sorted.length) return '<div class="rank-empty">No scores yet.</div>';
    const top    = sorted.slice(0, 50);
    const ownIdx = sorted.findIndex(e => e.playerId === _player.id);
    let rowsHtml = top.map((entry, i) => rowFn(entry, i)).join('');
    if (ownIdx >= 50) {
      rowsHtml += `<div class="rank-list-gap">⋯</div>${rowFn(sorted[ownIdx], ownIdx)}`;
    }
    return `<div class="rank-list">${rowsHtml}</div>`;
  }

  function _medalOf(i) {
    return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
  }

  function _cls(entry) {
    return entry.playerId === _player.id ? ' rank-row--own' : '';
  }

  function _youBadge(entry) {
    return entry.playerId === _player.id ? ' <span class="rank-you">YOU</span>' : '';
  }


  function _row(entry, i, pts, subtitle, tab) {
    const delta = tab ? _deltaBadgeHtml(tab, entry.playerId) : '';
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${_nameWithHonor(entry.username, entry.honorPoints || 0, _youBadge(entry), entry.playerId)}</span>
            <div class="rank-row-right">
              ${delta}
              <span class="rank-row-score">${_fmt(pts)} pts</span>
            </div>
          </div>
          ${subtitle ? `<div class="rank-row-sub">${subtitle}</div>` : ''}
        </div>
      </div>`;
  }

  function _honorRow(entry, i) {
    const h     = entry.honorPoints || 0;
    const delta = _deltaBadgeHtml('honor', entry.playerId);
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${_nameWithHonor(entry.username, h, _youBadge(entry), entry.playerId)}</span>
            <div class="rank-row-right">${delta}</div>
          </div>
        </div>
      </div>`;
  }

  function _overallRow(entry, i) { return _row(entry, i, entry.score || 0, null, 'overall'); }
  function _infraRow(entry, i) {
    const sub = `Buildings ${entry.breakdown?.buildingPts || 0}pts · City Tier ${entry.breakdown?.tierPts || 0}pts`;
    return _row(entry, i, _infraPts(entry), sub, 'infra');
  }
  function _lordsRow(entry, i)   {
    const m = entry.lordMeta;
    const lordSub = m ? `${m.name} · Level ${m.level}` : '';
    const sub = `${lordSub}${lordSub ? ' · ' : ''}Quests ${entry.breakdown?.questPts || 0}pts`;
    return _row(entry, i, _lordsPts(entry), sub, 'lords');
  }
  function _militarRow(entry, i) {
    return _row(entry, i, _militarPts(entry), null, 'militar');
  }

  function _fmt(n) { return Math.round(n || 0).toLocaleString(); }

  function _loadingHtml() {
    return `
      <div class="rank-screen">
        <div class="rank-header"><h2 class="rank-title">📊 Rankings</h2></div>
        <div class="rank-loading">Loading scores…</div>
      </div>`;
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    document.querySelectorAll('.rank-tab[data-rank-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.rankTab;
        document.querySelectorAll('.rank-tab').forEach(b => b.classList.remove('rank-tab--active'));
        btn.classList.add('rank-tab--active');
        _renderTabContent();
        const subtitleEl = document.getElementById('rank-subtitle');
        if (subtitleEl) subtitleEl.textContent = _headerSubtitle();
      });
    });
  }

  return { render };
})();
