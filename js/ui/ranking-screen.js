// =============================================
//  ranking-screen.js — RankingScreen
//
//  5 tabs: Overall · Cities · Lords · PvP · Quests
//  Each tab sorts the same leaderboard data by a different field.
//  No extra Supabase fetches on tab switch.
// =============================================

const RankingScreen = (() => {

  let _root       = null;
  let _player     = null;
  let _leaderboard = [];
  let _ownScore   = null;
  let _activeTab  = 'overall';

  async function render(root, { player }) {
    _root      = root;
    _player    = player;
    _activeTab = 'overall';

    root.innerHTML = _loadingHtml();

    const scoreObj = RankingService.computeScore(player);
    _ownScore      = scoreObj;

    await RankingService.saveScore(player, scoreObj);

    _leaderboard = await RankingService.fetchLeaderboard();

    // Inject own entry if not yet saved (or patch honorPoints if missing)
    const ownIdx = _leaderboard.findIndex(e => e.playerId === player.id);
    if (ownIdx === -1) {
      _leaderboard.push({
        playerId:    player.id,
        username:    player.username,
        score:       scoreObj.total,
        breakdown:   scoreObj.breakdown,
        lordMeta:    scoreObj.lordMeta,
        honorPoints: player.honorPoints || 0,
      });
    } else {
      // Ensure honorPoints is present (may be missing on stale Supabase rows)
      if (_leaderboard[ownIdx].honorPoints == null) {
        _leaderboard[ownIdx].honorPoints = player.honorPoints || 0;
      }
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
    { id: 'overall', label: '🏆 Overall', name: 'Overall' },
    { id: 'cities',  label: '🏰 Cities',  name: 'Cities'  },
    { id: 'lords',   label: '👑 Lords',   name: 'Lords'   },
    { id: 'pvp',     label: '⚔ PvP',     name: 'PvP'     },
    { id: 'quests',  label: '🔍 Quests',  name: 'Quests'  },
    { id: 'honor',   label: '🛡 Honor',   name: 'Honor'   },
  ];

  // Single source of truth for "how is this tab sorted" — used both to
  // render the list and to compute the header's position-in-this-tab,
  // so the two can never drift out of sync again. Always sorts a copy;
  // never mutates the shared _leaderboard array.
  function _sortedForTab(tab) {
    const sorted = [..._leaderboard];
    switch (tab) {
      case 'overall': sorted.sort((a, b) => b.score - a.score); break;
      case 'cities':  sorted.sort((a, b) => (b.breakdown?.buildingPts || 0) - (a.breakdown?.buildingPts || 0)); break;
      case 'lords':   sorted.sort((a, b) => (b.breakdown?.lordPts || 0) - (a.breakdown?.lordPts || 0)); break;
      case 'pvp':     sorted.sort((a, b) => (b.breakdown?.pvpPts || 0) - (a.breakdown?.pvpPts || 0)); break;
      case 'quests':  sorted.sort((a, b) => (b.breakdown?.questPts || 0) - (a.breakdown?.questPts || 0)); break;
      case 'honor':   sorted.sort((a, b) => (b.honorPoints || 0) - (a.honorPoints || 0)); break;
    }
    return sorted;
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

  function _honorIcon(pts) {
    if (pts >= 50)  return '⚜';
    if (pts <= -50) return '☠';
    return '';   // no icon between thresholds
  }

  function _honorChip(pts, compact) {
    const n    = pts || 0;
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    const cls  = n > 0 ? 'rank-honor--pos' : n < 0 ? 'rank-honor--neg' : 'rank-honor--zero';
    const icon = _honorIcon(n);
    const val  = `${icon ? icon + ' ' : ''}${sign}${_fmt(Math.abs(n))}`;
    return compact
      ? `<span class="rank-honor-chip rank-honor-chip--compact ${cls}">${val}</span>`
      : `<span class="rank-honor-chip ${cls}">${val}</span>`;
  }

  function _ownScoreCard() {
    const b     = _ownScore.breakdown;
    const honor = _player.honorPoints || 0;
    const rows  = [
      { icon: '🏰', label: 'Buildings',       pts: b.buildingPts },
      { icon: '🏙', label: 'City Tier Bonus', pts: b.tierPts || 0 },
      { icon: '👑', label: 'Lords',           pts: b.lordPts     },
      { icon: '🔍', label: 'Quests',          pts: b.questPts    },
      { icon: '⚔',  label: 'PvP',             pts: b.pvpPts      },
      { icon: '🏯', label: 'Conquests',       pts: b.conquestPts },
    ];

    return `
      <section class="rank-section">
        <div class="rank-section-title">YOUR SCORE</div>
        <div class="rank-own-card">
          <div class="rank-own-top">
            <span class="rank-own-name">${_player.username}</span>
            <div class="rank-own-right">
              ${_honorChip(honor)}
              <span class="rank-own-total">${_fmt(_ownScore.total)} <span class="rank-pts-unit">pts</span></span>
            </div>
          </div>
          <div class="rank-breakdown">
            ${rows.map(r => `
              <div class="rank-brow">
                <span class="rank-brow-icon">${r.icon}</span>
                <span class="rank-brow-label">${r.label}</span>
                <span class="rank-brow-pts">${_fmt(r.pts)}</span>
              </div>`).join('')}
          </div>
        </div>
      </section>`;
  }

  function _renderTabContent() {
    const el = document.getElementById('rank-tab-content');
    if (!el) return;
    el.innerHTML = _tabHtml(_activeTab);
  }

  const _ROW_FNS = {
    overall: _overallRow, cities: _citiesRow, lords: _lordsRow,
    pvp: _pvpRow, quests: _questsRow, honor: _honorRow,
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


  function _row(entry, i, pts, subtitle) {
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <div class="rank-row-right">
              ${_honorChip(entry.honorPoints || 0, true)}
              <span class="rank-row-score">${_fmt(pts)} pts</span>
            </div>
          </div>
          ${subtitle ? `<div class="rank-row-sub">${subtitle}</div>` : ''}
        </div>
      </div>`;
  }

  function _honorRow(entry, i) {
    const h   = entry.honorPoints || 0;
    const cls = h > 0 ? 'rank-honor--pos' : h < 0 ? 'rank-honor--neg' : 'rank-honor--zero';
    const icon = _honorIcon(h);
    const sign = h > 0 ? '+' : h < 0 ? '−' : '';
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score ${cls}">${icon ? icon + ' ' : ''}${sign}${_fmt(Math.abs(h))}</span>
          </div>
        </div>
      </div>`;
  }

  function _overallRow(entry, i) { return _row(entry, i, entry.score || 0); }
  function _citiesRow(entry, i)  { return _row(entry, i, (entry.breakdown?.buildingPts || 0) + (entry.breakdown?.tierPts || 0)); }
  function _lordsRow(entry, i)   {
    const m = entry.lordMeta;
    const sub = m ? `${m.name} · Level ${m.level}` : '';
    return _row(entry, i, entry.breakdown?.lordPts || 0, sub);
  }
  function _pvpRow(entry, i)     { return _row(entry, i, entry.breakdown?.pvpPts   || 0); }
  function _questsRow(entry, i)  { return _row(entry, i, entry.breakdown?.questPts || 0); }

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
