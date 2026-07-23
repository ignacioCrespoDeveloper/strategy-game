// =============================================
//  tick/ranking-updater.js
//
//  Runs every 5 minutes on the server.
//  Reads all players' state from Supabase,
//  recomputes ranking scores, and writes them
//  back — no player visit required.
// =============================================

import { createClient } from '@supabase/supabase-js';

// Quest scoring map (mirrors js/data/discoveries.js)
// skip = combat, nothing, intelligence (not in map → 0 pts)
const QUEST_PTS = {
  // resource tier 1
  iron_vein: 1, cliff_face: 1, fertile_fields: 1, river_crossing: 1, coin_cache: 1,
  // resource tier 2
  timber_cache: 2, abandoned_mine: 2, stone_deposit: 2, wild_game: 2, lost_treasure: 2,
  // resource tier 3
  ancient_forest: 2, deep_ore_shaft: 2, marble_quarry: 2, bountiful_hunt: 2, buried_vault: 2,
  // event
  ancient_ruins: 1, abandoned_keep: 2, wandering_sage: 2,
  // trade
  merchant_caravan: 1, traveling_merchant: 2,
  // legendary
  ancient_relic: 3, bog_crystal: 3,
};

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

function _cityTierBonus(buildings) {
  const th = buildings?.town_hall || 0;
  if (th >= 16) return 300;
  if (th >= 11) return 150;
  if (th >= 6)  return 50;
  return 10;
}

function _computeScore(playerId, player, lords, cities, discoveryLog) {
  const playerCities = Object.values(cities).filter(c => c.playerId === playerId);

  const buildingPts = playerCities.reduce((sum, city) => {
    return sum + Object.values(city.buildings || {}).reduce((s, lvl) => s + (lvl || 0), 0);
  }, 0);

  const tierPts = playerCities.reduce((sum, city) => sum + _cityTierBonus(city.buildings), 0);

  const playerLords = Object.values(lords).filter(l => l.playerId === playerId);
  const lordPts = playerLords.reduce((sum, l) => sum + Math.pow(l.level || 1, 2) * 2, 0);

  const log = discoveryLog[playerId] || [];
  const questPts = log.reduce((sum, e) => sum + (QUEST_PTS[e.definitionId] || 0), 0);

  const pvpPts      = (player.rankingStats?.pvpWins   || 0) * 5;
  const conquestPts = (player.rankingStats?.conquests || 0) * 25;

  const total = buildingPts + tierPts + lordPts + questPts + pvpPts + conquestPts;

  const topLord = playerLords.sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;

  return {
    total,
    breakdown: { buildingPts, tierPts, lordPts, questPts, pvpPts, conquestPts },
    lordMeta: topLord
      ? { name: topLord.name, classId: topLord.classId, level: topLord.level || 1 }
      : null,
  };
}

export async function runRankingUpdate() {
  const admin = _admin();

  // Load all relevant state in a single query
  const { data: rows, error } = await admin
    .from('storage')
    .select('player_id, key, value')
    .in('key', ['players', 'lords', 'cities', 'discovery_log']);

  if (error) {
    console.error('[ranking-updater] load error:', error.message);
    return;
  }

  // Group by player_id
  const byPlayer = {};
  for (const row of rows || []) {
    if (!byPlayer[row.player_id]) byPlayer[row.player_id] = {};
    byPlayer[row.player_id][row.key] = row.value;
  }

  const upserts = [];

  for (const [playerId, data] of Object.entries(byPlayer)) {
    const playersMap   = data.players      || {};
    const lordsMap     = data.lords        || {};
    const citiesMap    = data.cities       || {};
    const discoveryLog = data.discovery_log || {};

    const player = playersMap[playerId];
    if (!player) continue;

    try {
      const scoreObj = _computeScore(playerId, player, lordsMap, citiesMap, discoveryLog);

      upserts.push({
        player_id: playerId,
        key:       'rank_score',
        value: {
          username:  player.username || 'Player',
          score:     scoreObj.total,
          breakdown: scoreObj.breakdown,
          lordMeta:  scoreObj.lordMeta,
          updatedAt: Date.now(),
        },
      });
    } catch (e) {
      console.warn(`[ranking-updater] score error for ${playerId}:`, e.message);
    }
  }

  if (!upserts.length) return;

  const { error: saveErr } = await admin
    .from('storage')
    .upsert(upserts, { onConflict: 'player_id,key' });

  if (saveErr) {
    console.error('[ranking-updater] save error:', saveErr.message);
  } else {
    console.log(`[ranking-updater] updated ${upserts.length} player scores`);
  }
}
