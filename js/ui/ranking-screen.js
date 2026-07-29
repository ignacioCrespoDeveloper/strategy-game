// =============================================
//  ranking-screen.js — RankingScreen
//
//  City-view-style split layout:
//    Left panel  — the viewer's identity (lord portrait, crest, clan
//                  tag) + total score + per-category breakdown. Each
//                  category row is ALSO a tab switcher, mirroring how
//                  the city screen's left stat rows drive the right pane.
//    Right pane  — underline tab bar (Overall · Infrastructure · Lords ·
//                  Military · Honor) over the scrollable leaderboard.
//
//    Infrastructure = Buildings + City Tier Bonus
//    Lords          = Lord Levels + Quests
//    Militar        = Army PWR only (PvP wins/conquests no longer score
//                      ranking points — PvP's reward is honor instead,
//                      scaled by power destroyed; see combat-resolver.js)
//  Each tab sorts the same leaderboard data by a different field.
//  No extra Supabase fetches on tab switch. Each row shows a ▲/▼ badge
//  when the player's rank in that tab has moved in roughly the last hour.
// =============================================

const RankingScreen = (() => {

  let _root       = null;
  let _player     = null;
  let _lord       = null;
  let _leaderboard = [];
  let _ownScore   = null;
  let _activeTab  = 'overall';
  let _clanByPid  = {};

  async function render(root, { player, lord }) {
    _root      = root;
    _player    = player;
    _lord      = lord || (player?.lordId ? LordService.getById(player.lordId) : null);
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
    { id: 'overall',  label: gi('trophy') + ' Overall',        name: 'Overall'        },
    { id: 'infra',    label: gi('capitol') + ' Infrastructure', name: 'Infrastructure' },
    { id: 'lords',    label: gi('crown') + ' Lords',          name: 'Lords'          },
    { id: 'militar',  label: gi('crossed-swords') + ' Military',        name: 'Military'       },
    { id: 'honor',    label: gi('round-shield') + ' Honor',          name: 'Honor'          },
  ];

  // Grouped-category totals — the single source of truth for what each
  // group means, shared by tab sorting, the left-panel breakdown, and row
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
  // Lords = lord XP only. Expeditions stopped awarding points on 2026-07-29;
  // `questPts` is still tolerated in the sum so historic leaderboard rows
  // saved before that change don't suddenly drop in rank, but nothing writes
  // it any more and it will vanish on its own as scores are recomputed.
  function _lordsPts(entry) {
    const b = entry.breakdown || {};
    return (b.lordPts || 0) + (b.questPts || 0);
  }

  // Single source of truth for "how is this tab sorted" — used both to
  // render the list and to compute each rank position, so the two can
  // never drift out of sync. Always sorts a copy; never mutates the
  // shared _leaderboard array.
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

  function _posText() {
    return `Your position: #${_rankForTab(_activeTab)} of ${_leaderboard.length}`;
  }

  function _html() {
    return `
      <div class="rank-screen">
        <div class="rkv-body">
          <aside class="rkv-left">
            ${_leftPanelHtml()}
          </aside>
          <div class="rkv-right">
            <div class="rkv-tabs" id="rkv-tabs">
              ${_TABS.map(t => `
                <button class="rkv-tab ${_activeTab === t.id ? 'rkv-tab--active' : ''}" data-rank-tab="${t.id}">${t.label}</button>
              `).join('')}
              <span class="rkv-pos" id="rkv-pos">${_posText()}</span>
            </div>
            <div class="rkv-list-area" id="rank-tab-content"></div>
          </div>
        </div>
      </div>`;
  }

  // ── Left panel ────────────────────────────────────────────────

  function _portraitHtml() {
    const race = RACES[_lord?.race] || {};
    const src  = _lord
      ? (_lord.portrait || pickLordPortrait(_lord.race, _lord.classId, _lord.id) || race.portrait)
      : null;
    const overallRank = _rankForTab('overall');

    const artHtml = src
      ? `<img class="rkv-portrait-img" src="${src}" alt="${_lord?.name || _player.username}" />`
      : `<div class="rkv-portrait-empty">${gi('trophy')}</div>`;

    return `
      <div class="rkv-portrait">
        ${artHtml}
        <div class="rkv-portrait-fade"></div>
        <div class="rkv-portrait-rank">${gi('trophy')} Rank #${overallRank}</div>
      </div>`;
  }

  function _leftPanelHtml() {
    const b     = _ownScore.breakdown;
    const honor = _player.honorPoints || 0;
    const tier  = getHonorTier(honor);
    const race  = RACES[_lord?.race] || {};
    const meta  = _ownScore.lordMeta;

    const cats = [
      {
        tab: 'militar', icon: gi('crossed-swords'), label: 'Military',
        pts: `${_fmt(_militarPts({ breakdown: b }))}`,
        sub: `Army Power ${_fmt(b.armyPts || 0)}`,
      },
      {
        tab: 'infra', icon: gi('capitol'), label: 'Infrastructure',
        pts: `${_fmt(_infraPts({ breakdown: b }))}`,
        sub: `Buildings ${_fmt(b.buildingPts || 0)} · City Tier ${_fmt(b.tierPts || 0)}`,
      },
      {
        tab: 'lords', icon: gi('crown'), label: 'Lords',
        pts: `${_fmt(_lordsPts({ breakdown: b }))}`,
        sub: `Lord Levels ${_fmt(b.lordPts || 0)}`,
      },
      {
        tab: 'honor', icon: gi('round-shield'), label: 'Honor',
        pts: _honorValue(honor),
        sub: tier ? `${tier.side === 'good' ? 'Good' : 'Evil'} · ${tier.name}` : 'Reputation earned in PvP',
      },
    ];

    const catsHtml = cats.map(c => `
      <button class="rkv-cat ${_activeTab === c.tab ? 'rkv-cat--active' : ''}" data-rank-tab="${c.tab}">
        <span class="rkv-cat-icon">${c.icon}</span>
        <span class="rkv-cat-body">
          <span class="rkv-cat-label">${c.label}</span>
          <span class="rkv-cat-sub">${c.sub}</span>
        </span>
        <span class="rkv-cat-right">
          <span class="rkv-cat-pts">${c.pts}</span>
          <span class="rkv-cat-rank">#${_rankForTab(c.tab)} ${_deltaBadgeHtml(c.tab, _player.id)}</span>
        </span>
      </button>`).join('');

    return `
      ${_portraitHtml()}

      <div class="rkv-id">
        <h1 class="rkv-name">${_honorTag(honor)}${_clanTag(_player.id)}${_player.username}</h1>
        <div class="rkv-id-sub">${race.icon || ''} ${race.name || '—'}${meta ? ` · ${meta.name} · Lv ${meta.level}` : ''}</div>
      </div>

      <div class="rkv-divider"></div>

      <button class="rkv-total ${_activeTab === 'overall' ? 'rkv-total--active' : ''}" data-rank-tab="overall">
        <div class="rkv-total-label">${gi('trophy')} Total Score</div>
        <div class="rkv-total-value">${_fmt(_ownScore.total)} <span class="rkv-total-unit">pts</span></div>
        <div class="rkv-total-sub">#${_rankForTab('overall')} of ${_leaderboard.length} lords ${_deltaBadgeHtml('overall', _player.id)}</div>
      </button>

      <div class="rkv-divider"></div>
      <div class="rkv-cats-header">Score Breakdown</div>
      <div class="rkv-cats">${catsHtml}</div>
    `;
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

  // ── Right pane: leaderboard ───────────────────────────────────

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
    return i === 0 ? gi('podium-winner', 'gi--gold') : i === 1 ? gi('medal', 'gi--silver') : i === 2 ? gi('medal', 'gi--bronze') : `#${i + 1}`;
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
    const sub = lordSub;
    return _row(entry, i, _lordsPts(entry), sub, 'lords');
  }
  function _militarRow(entry, i) {
    return _row(entry, i, _militarPts(entry), null, 'militar');
  }

  function _fmt(n) { return Math.round(n || 0).toLocaleString(); }

  function _loadingHtml() {
    return `
      <div class="rank-screen">
        <div class="rank-loading">Loading scores…</div>
      </div>`;
  }

  // ── Events ────────────────────────────────────────────────────

  // Tab switches come from TWO places — the underline tab bar on the right
  // AND the left panel's total/category rows — so both carry data-rank-tab
  // and funnel into the same handler, then _syncActive keeps every switcher's
  // active state in agreement.
  function _bindEvents() {
    _root.querySelectorAll('[data-rank-tab]').forEach(el => {
      el.addEventListener('click', () => {
        if (_activeTab === el.dataset.rankTab) return;
        _activeTab = el.dataset.rankTab;
        _syncActive();
        _renderTabContent();
      });
    });
  }

  function _syncActive() {
    _root.querySelectorAll('.rkv-tab').forEach(b =>
      b.classList.toggle('rkv-tab--active', b.dataset.rankTab === _activeTab));
    _root.querySelectorAll('.rkv-cat').forEach(b =>
      b.classList.toggle('rkv-cat--active', b.dataset.rankTab === _activeTab));
    const total = _root.querySelector('.rkv-total');
    if (total) total.classList.toggle('rkv-total--active', _activeTab === 'overall');
    const pos = document.getElementById('rkv-pos');
    if (pos) pos.textContent = _posText();
  }

  return { render };
})();
