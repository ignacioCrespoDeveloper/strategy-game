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

    RankingService.saveScore(player, scoreObj);

    _leaderboard = await RankingService.fetchLeaderboard();

    // Inject own entry if not yet saved
    if (!_leaderboard.find(e => e.playerId === player.id)) {
      _leaderboard.push({
        playerId: player.id,
        username: player.username,
        score:    scoreObj.total,
        breakdown: scoreObj.breakdown,
        lordMeta:  scoreObj.lordMeta,
      });
    }

    _renderFull();
    _bindEvents();
  }

  // ── Render ────────────────────────────────────────────────────

  function _renderFull() {
    _root.innerHTML = _html();
    _renderTabContent();
    _bindEvents();
  }

  function _html() {
    const rank = _leaderboard.sort((a, b) => b.score - a.score)
      .findIndex(e => e.playerId === _player.id) + 1;

    const tabs = [
      { id: 'overall', label: '🏆 Overall'  },
      { id: 'cities',  label: '🏰 Cities'   },
      { id: 'lords',   label: '👑 Lords'    },
      { id: 'pvp',     label: '⚔ PvP'      },
      { id: 'quests',  label: '🔍 Quests'   },
    ];

    const tabsHtml = tabs.map(t => `
      <button class="rank-tab ${_activeTab === t.id ? 'rank-tab--active' : ''}" data-rank-tab="${t.id}">${t.label}</button>
    `).join('');

    return `
      <div class="rank-screen">
        <div class="rank-header">
          <h2 class="rank-title">📊 Rankings</h2>
          <div class="rank-subtitle">Your position: #${rank} of ${_leaderboard.length}</div>
        </div>

        ${_ownScoreCard()}

        <div class="rank-tabs-row">${tabsHtml}</div>
        <div class="rank-tab-content" id="rank-tab-content"></div>
      </div>`;
  }

  function _ownScoreCard() {
    const b = _ownScore.breakdown;
    const rows = [
      { icon: '🏰', label: 'Buildings',  pts: b.buildingPts },
      { icon: '👑', label: 'Lords',      pts: b.lordPts     },
      { icon: '🔍', label: 'Quests',     pts: b.questPts    },
      { icon: '⚔',  label: 'PvP',        pts: b.pvpPts      },
      { icon: '🏯', label: 'Conquests',  pts: b.conquestPts },
    ];

    return `
      <section class="rank-section">
        <div class="rank-section-title">YOUR SCORE</div>
        <div class="rank-own-card">
          <div class="rank-own-top">
            <span class="rank-own-name">${_player.username}</span>
            <span class="rank-own-total">${_fmt(_ownScore.total)} <span class="rank-pts-unit">pts</span></span>
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

  function _tabHtml(tab) {
    const sorted = [..._leaderboard];

    switch (tab) {
      case 'overall':
        sorted.sort((a, b) => b.score - a.score);
        return _listHtml(sorted, (entry, i) => _overallRow(entry, i));

      case 'cities':
        sorted.sort((a, b) => (b.breakdown?.buildingPts || 0) - (a.breakdown?.buildingPts || 0));
        return _listHtml(sorted, (entry, i) => _citiesRow(entry, i));

      case 'lords':
        sorted.sort((a, b) => (b.breakdown?.lordPts || 0) - (a.breakdown?.lordPts || 0));
        return _listHtml(sorted, (entry, i) => _lordsRow(entry, i));

      case 'pvp':
        sorted.sort((a, b) => (b.breakdown?.pvpPts || 0) - (a.breakdown?.pvpPts || 0));
        return _listHtml(sorted, (entry, i) => _pvpRow(entry, i));

      case 'quests':
        sorted.sort((a, b) => (b.breakdown?.questPts || 0) - (a.breakdown?.questPts || 0));
        return _listHtml(sorted, (entry, i) => _questsRow(entry, i));

      default:
        return '';
    }
  }

  function _listHtml(sorted, rowFn) {
    if (!sorted.length) return '<div class="rank-empty">No scores yet.</div>';
    return `<div class="rank-list">${sorted.slice(0, 50).map(rowFn).join('')}</div>`;
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

  function _lordBadge(entry) {
    const lm = entry.lordMeta;
    if (!lm) return '';
    const cls = LORD_CLASSES?.[lm.classId];
    const icon = cls ? `<span style="color:${cls.color}">${cls.icon}</span>` : '';
    return `<span class="rank-lord-badge">${icon} ${lm.name} Lv${lm.level}</span>`;
  }

  function _overallRow(entry, i) {
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score">${_fmt(entry.score)} pts</span>
          </div>
          <div class="rank-row-sub">${_lordBadge(entry)}</div>
        </div>
      </div>`;
  }

  function _citiesRow(entry, i) {
    const pts = entry.breakdown?.buildingPts || 0;
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score">${_fmt(pts)} pts</span>
          </div>
          <div class="rank-row-sub">🏰 Building levels</div>
        </div>
      </div>`;
  }

  function _lordsRow(entry, i) {
    const pts = entry.breakdown?.lordPts || 0;
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score">${_fmt(pts)} pts</span>
          </div>
          <div class="rank-row-sub">${_lordBadge(entry)}</div>
        </div>
      </div>`;
  }

  function _pvpRow(entry, i) {
    const pts  = entry.breakdown?.pvpPts || 0;
    const wins = Math.round(pts / 5);
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score">${_fmt(pts)} pts</span>
          </div>
          <div class="rank-row-sub">⚔ ${wins} win${wins !== 1 ? 's' : ''}</div>
        </div>
      </div>`;
  }

  function _questsRow(entry, i) {
    const pts = entry.breakdown?.questPts || 0;
    return `
      <div class="rank-row${_cls(entry)}">
        <div class="rank-row-medal">${_medalOf(i)}</div>
        <div class="rank-row-body">
          <div class="rank-row-top">
            <span class="rank-row-name">${entry.username || '?'}${_youBadge(entry)}</span>
            <span class="rank-row-score">${_fmt(pts)} pts</span>
          </div>
          <div class="rank-row-sub">🔍 Discoveries</div>
        </div>
      </div>`;
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
      });
    });
  }

  return { render };
})();
