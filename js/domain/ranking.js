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

  function _cityTierBonus(city) {
    const th = city.buildings?.town_hall || 0;
    if (th >= 16) return 300;
    if (th >= 11) return 150;
    if (th >= 6)  return 50;
    return 10;
  }

  function computeScore(player) {
    const cities = CityService.getPlayerCities(player.id);

    // Building pts — 1 pt per building level across all cities
    const buildingPts = cities.reduce((sum, city) => {
      return sum + Object.values(city.buildings || {}).reduce((s, lvl) => s + (lvl || 0), 0);
    }, 0);

    // City tier bonus — rewards reaching town_hall milestones
    // Tier 1 (th 1-5): +10 · Tier 2 (th 6-10): +50 · Tier 3 (th 11-15): +150 · Tier 4 (th 16+): +300
    const tierPts = cities.reduce((sum, city) => sum + _cityTierBonus(city), 0);

    // Lord pts — level² × 2 (level 10 = 200 pts, level 20 = 800 pts)
    const lordPts = LordService.getAll()
      .filter(l => l.playerId === player.id)
      .reduce((sum, l) => sum + Math.pow(l.level || 1, 2) * 2, 0);

    // Quest discoveries — tier 1 = 1pt, tier 2 = 2pts, legendary = 3pts
    const questPts = DiscoveryService.getLog(player.id)
      .filter(e => {
        const def = DISCOVERY_DEFS[e.definitionId];
        return def && def.category !== 'nothing' && def.category !== 'intelligence' && def.category !== 'combat';
      })
      .reduce((sum, e) => {
        const def  = DISCOVERY_DEFS[e.definitionId];
        const tier = def?.tier || 1;
        const pts  = def?.category === 'legendary' ? 3 : tier >= 2 ? 2 : 1;
        return sum + pts;
      }, 0);

    // PvP wins + conquests
    const pvpPts      = (player.rankingStats?.pvpWins   || 0) * 5;
    const conquestPts = (player.rankingStats?.conquests || 0) * 25;

    const total = buildingPts + tierPts + lordPts + questPts + pvpPts + conquestPts;

    // Primary lord — highest-level lord for display
    const allLords = LordService.getAll().filter(l => l.playerId === player.id);
    const topLord  = allLords.sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;
    const lordMeta = topLord
      ? { name: topLord.name, classId: topLord.classId, level: topLord.level || 1 }
      : null;

    return {
      total,
      breakdown: { buildingPts, tierPts, lordPts, questPts, pvpPts, conquestPts },
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
          username:     player.username,
          score:        scoreObj.total,
          breakdown:    scoreObj.breakdown,
          lordMeta:     scoreObj.lordMeta,
          honorPoints:  player.honorPoints || 0,
          updatedAt:    Date.now(),
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

  function addHonor(playerId, delta) {
    const p = PlayerService.getById(playerId);
    if (!p) return;
    const newVal = (p.honorPoints || 0) + delta;
    PlayerService.update(playerId, { honorPoints: newVal });
    // Persist to Supabase under its own key so it survives page-reload hydration
    SupabaseService.client
      .from('storage')
      .upsert({ player_id: playerId, key: 'honor_points', value: newVal },
               { onConflict: 'player_id,key' })
      .catch(e => console.warn('[honor] persist failed', e));
  }

  function getPlayerRank(playerId, leaderboard) {
    const idx = leaderboard.findIndex(e => e.playerId === playerId);
    return idx === -1 ? null : idx + 1;
  }

  return { computeScore, saveScore, fetchLeaderboard, getPlayerRank, addHonor };
})();
