// =============================================
//  ranking.js — RankingService
//
//  Computes a player's total score from:
//    🏰 Building pts  — 1 point per building level across all cities
//    👑 Lord pts      — 1 point per level gained across all lords
//    🔍 Quest pts     — tier 1 = 1pt, tier 2+ = 2pts per discovery
//    ⚔  PvP pts       — pvpWins × 5
//    🏰 Conquest pts  — conquests × 25
//
//  Leaderboard is stored in Supabase under key 'rank_score'
//  so other players' scores are visible to everyone.
// =============================================

const RankingService = (() => {

  const RANK_KEY = 'rank_score';

  // ── Public: compute a score object for the given player ────────

  function computeScore(player) {
    // City buildings — 1 point per building level across all cities
    const buildingPts = CityService.getPlayerCities(player.id)
      .reduce((sum, city) => {
        return sum + Object.values(city.buildings || {}).reduce((s, lvl) => s + (lvl || 0), 0);
      }, 0);

    // Lord levels — 1 point per level gained (level 1 = 0 pts)
    const lordPts = LordService.getAll()
      .filter(l => l.playerId === player.id)
      .reduce((sum, l) => sum + Math.max(0, (l.level || 1) - 1), 0);

    // Quest discoveries — tier 1 = 1pt, tier 2+ = 2pts
    const questPts = DiscoveryService.getLog(player.id)
      .filter(e => {
        const def = DISCOVERY_DEFS[e.definitionId];
        return def && def.category !== 'nothing' && def.category !== 'intelligence' && def.category !== 'combat';
      })
      .reduce((sum, e) => {
        const tier = DISCOVERY_DEFS[e.definitionId]?.tier || 1;
        return sum + (tier >= 2 ? 2 : 1);
      }, 0);

    // PvP wins + conquests
    const pvpPts      = (player.rankingStats?.pvpWins   || 0) * 5;
    const conquestPts = (player.rankingStats?.conquests || 0) * 25;

    const total = buildingPts + lordPts + questPts + pvpPts + conquestPts;

    // Primary lord — highest-level lord for display
    const allLords  = LordService.getAll().filter(l => l.playerId === player.id);
    const topLord   = allLords.sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;
    const lordMeta  = topLord
      ? { name: topLord.name, classId: topLord.classId, level: topLord.level || 1 }
      : null;

    return {
      total,
      breakdown: { buildingPts, lordPts, questPts, pvpPts, conquestPts },
      lordMeta,
    };
  }

  // ── Supabase: push own score, fetch all ───────────────────────

  async function saveScore(player, scoreObj) {
    try {
      await SupabaseService.client.from('storage').upsert({
        player_id: player.id,
        key:       RANK_KEY,
        value:     {
          username:  player.username,
          score:     scoreObj.total,
          breakdown: scoreObj.breakdown,
          lordMeta:  scoreObj.lordMeta,
          updatedAt: Date.now(),
        },
      }, { onConflict: 'player_id,key' });
    } catch (e) {
      console.warn('RankingService: failed to save score', e);
    }
  }

  async function fetchLeaderboard() {
    try {
      const { data, error } = await SupabaseService.client
        .from('storage')
        .select('player_id, value')
        .eq('key', RANK_KEY);
      if (error || !data) return [];
      return data
        .map(row => ({ playerId: row.player_id, ...row.value }))
        .sort((a, b) => b.score - a.score);
    } catch (e) {
      console.warn('RankingService: failed to fetch leaderboard', e);
      return [];
    }
  }

  function getPlayerRank(playerId, leaderboard) {
    const idx = leaderboard.findIndex(e => e.playerId === playerId);
    return idx === -1 ? null : idx + 1;
  }

  return { computeScore, saveScore, fetchLeaderboard, getPlayerRank };
})();
