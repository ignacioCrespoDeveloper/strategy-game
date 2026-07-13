// =============================================
//  ranking.js — RankingService
//
//  Computes a player's total score from:
//    🏰 City score  — cumulative build cost of all buildings + city tier
//    👑 Lord score  — level × 500 + XP
//    ⚔  Army score  — gold cost of all recruited units
//    🔍 Discovery score — log entries × 75
//
//  Leaderboard is stored in Supabase under key 'rank_score'
//  so other players' scores are visible to everyone.
// =============================================

const RankingService = (() => {

  const RANK_KEY = 'rank_score';

  // ── Score helpers ──────────────────────────────────────────────

  // Cumulative resource investment in a city's buildings.
  // Sums cost(1..level) for every built building; 1 resource = 2 pts.
  function _buildingScore(city) {
    let score = 0;
    Object.entries(city.buildings || {}).forEach(([bid, level]) => {
      const def = BUILDING_DEFS[bid];
      if (!def || level <= 0) return;
      for (let l = 1; l <= level; l++) {
        const c = def.cost(l);
        score += ((c.wood || 0) + (c.stone || 0) + (c.iron || 0) + (c.food || 0)) * 2;
      }
    });
    return Math.round(score);
  }

  function _cityScore(cities) {
    return cities.reduce((sum, city) => {
      const tierPts = (city.tier || 1) * 800;
      return sum + tierPts + _buildingScore(city);
    }, 0);
  }

  function _lordScore(lord) {
    if (!lord) return 0;
    return (lord.level || 1) * 500 + (lord.xp || 0);
  }

  function _armyScore(lordId) {
    if (!lordId) return 0;
    const army = ArmyService.get(lordId);
    return (army?.units || []).reduce((s, u) => {
      return s + (UNIT_DEFS[u.unitId]?.goldCost || 0) * u.count;
    }, 0);
  }

  function _discoveryScore(playerId) {
    return DiscoveryService.getLog(playerId).length * 75;
  }

  // ── Public: compute a score object for the given player ────────

  function computeScore(player) {
    const cities    = CityService.getPlayerCities(player.id);
    const lord      = player.lordId ? LordService.getById(player.lordId) : null;
    const cityPts   = _cityScore(cities);
    const lordPts   = _lordScore(lord);
    const armyPts   = _armyScore(player.lordId);
    const discPts   = _discoveryScore(player.id);
    const total     = cityPts + lordPts + armyPts + discPts;

    return {
      total,
      breakdown: {
        cities:      cityPts,
        lord:        lordPts,
        army:        armyPts,
        discoveries: discPts,
      },
      meta: {
        cityCount:   cities.length,
        lordLevel:   lord?.level || 0,
        lordXp:      lord?.xp    || 0,
        armyUnits:   (ArmyService.get(player.lordId)?.units || []).reduce((s, u) => s + u.count, 0),
        discCount:   DiscoveryService.getLog(player.id).length,
      },
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
          meta:      scoreObj.meta,
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

  return { computeScore, saveScore, fetchLeaderboard };
})();
