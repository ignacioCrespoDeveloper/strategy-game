// =============================================
//  ranking-screen.js — RankingScreen
// =============================================

const RankingScreen = (() => {

  let _root   = null;
  let _player = null;

  async function render(root, { player, lord }) {
    _root   = root;
    _player = player;

    // Show loading state immediately
    root.innerHTML = _loadingHtml();

    const scoreObj   = RankingService.computeScore(player);

    // Fire-and-forget save (don't block the UI)
    RankingService.saveScore(player, scoreObj);

    // Fetch leaderboard from Supabase
    const leaderboard = await RankingService.fetchLeaderboard();

    // If this player isn't in the leaderboard yet (save is async), inject locally
    if (!leaderboard.find(e => e.playerId === player.id)) {
      leaderboard.push({
        playerId: player.id,
        username: player.username,
        score:    scoreObj.total,
        breakdown: scoreObj.breakdown,
        meta:      scoreObj.meta,
      });
      leaderboard.sort((a, b) => b.score - a.score);
    }

    root.innerHTML = _html(player, scoreObj, leaderboard);
  }

  // ── Templates ─────────────────────────────────────────────────

  function _loadingHtml() {
    return `
      <div class="rank-screen">
        <div class="rank-header"><h2 class="rank-title">📊 Rankings</h2></div>
        <div class="rank-loading">Loading scores…</div>
      </div>`;
  }

  function _html(player, scoreObj, leaderboard) {
    const playerRank = leaderboard.findIndex(e => e.playerId === player.id) + 1;

    return `
      <div class="rank-screen">
        <div class="rank-header">
          <h2 class="rank-title">📊 Rankings</h2>
          <div class="rank-subtitle">Your position: #${playerRank} of ${leaderboard.length}</div>
        </div>

        <div class="rank-content">
          ${_ownScoreCard(player, scoreObj)}
          ${_leaderboardHtml(leaderboard, player.id)}
        </div>
      </div>`;
  }

  function _fmt(n) { return Math.round(n).toLocaleString(); }

  function _ownScoreCard(player, s) {
    const b = s.breakdown;
    const m = s.meta;

    const rows = [
      {
        icon: '🏰', label: 'Cities & Buildings',
        pts: b.cities,
        detail: `${m.cityCount} cit${m.cityCount !== 1 ? 'ies' : 'y'} · build investment`,
      },
      {
        icon: '👑', label: 'Lord',
        pts: b.lord,
        detail: m.lordLevel
          ? `Lv ${m.lordLevel} · ${_fmt(m.lordXp)} XP`
          : 'No lord yet',
      },
      {
        icon: '⚔', label: 'Army',
        pts: b.army,
        detail: `${m.armyUnits} unit${m.armyUnits !== 1 ? 's' : ''} recruited`,
      },
      {
        icon: '🔍', label: 'Discoveries',
        pts: b.discoveries,
        detail: `${m.discCount} discover${m.discCount !== 1 ? 'ies' : 'y'} logged`,
      },
    ];

    return `
      <section class="rank-section">
        <div class="rank-section-title">YOUR SCORE</div>
        <div class="rank-own-card">
          <div class="rank-own-top">
            <span class="rank-own-name">${player.username}</span>
            <span class="rank-own-total">${_fmt(s.total)} <span class="rank-pts-unit">pts</span></span>
          </div>
          <div class="rank-breakdown">
            ${rows.map(r => `
              <div class="rank-brow">
                <span class="rank-brow-icon">${r.icon}</span>
                <span class="rank-brow-label">${r.label}</span>
                <span class="rank-brow-detail">${r.detail}</span>
                <span class="rank-brow-pts">${_fmt(r.pts)}</span>
              </div>`).join('')}
          </div>
        </div>
      </section>`;
  }

  function _leaderboardHtml(leaderboard, ownId) {
    if (!leaderboard.length) {
      return `
        <section class="rank-section">
          <div class="rank-section-title">LEADERBOARD</div>
          <div class="rank-empty">No scores yet — be the first!</div>
        </section>`;
    }

    const top = leaderboard.slice(0, 50);
    const maxScore = top[0]?.score || 1;

    const rows = top.map((entry, i) => {
      const rank    = i + 1;
      const isOwn   = entry.playerId === ownId;
      const medal   = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
      const barPct  = Math.max(2, Math.round((entry.score / maxScore) * 100));
      const b       = entry.breakdown || {};

      return `
        <div class="rank-row${isOwn ? ' rank-row--own' : ''}">
          <div class="rank-row-medal">${medal}</div>
          <div class="rank-row-body">
            <div class="rank-row-top">
              <span class="rank-row-name">${entry.username || 'Unknown'}${isOwn ? ' <span class="rank-you">YOU</span>' : ''}</span>
              <span class="rank-row-score">${_fmt(entry.score)}</span>
            </div>
            <div class="rank-row-bar">
              <div class="rank-row-bar-fill" style="width:${barPct}%"></div>
            </div>
            ${b.cities !== undefined ? `
            <div class="rank-row-breakdown">
              <span>🏰 ${_fmt(b.cities)}</span>
              <span>👑 ${_fmt(b.lord)}</span>
              <span>⚔ ${_fmt(b.army)}</span>
              <span>🔍 ${_fmt(b.discoveries)}</span>
            </div>` : ''}
          </div>
        </div>`;
    }).join('');

    return `
      <section class="rank-section">
        <div class="rank-section-title">LEADERBOARD</div>
        <div class="rank-list">${rows}</div>
      </section>`;
  }

  return { render };
})();
