// =============================================
//  tick/ranking-updater.js
//
//  Runs every 5 minutes on the server (plus once on boot).
//  Reads all players' state from Supabase, recomputes ranking scores, and
//  writes them back — no player visit required. This is the single
//  authoritative recompute path; js/domain/ranking.js's client-side
//  computeScore() is a read-your-own-fresh-score convenience for the
//  player currently looking at the Rankings screen, but THIS is what keeps
//  every other player's row from going stale for everyone else.
//
//  IMPORTANT: the scoring formula here must be kept byte-for-byte identical
//  to js/domain/ranking.js's computeScore() (that file has its own header
//  comment doc for what each point category means) — divergence between
//  the two is exactly what caused different players to see wildly
//  different numbers for the same account.
// =============================================

import { createClient } from '@supabase/supabase-js';
import { UNIT_DEFS, EconomyCore } from '../engine-loader.js';

// QUEST_PTS lived here — a per-discovery scoring map (9/18/27 by tier). It
// went with the expedition rework on 2026-07-29: expeditions already pay in
// gold, resources and recruits, and a bad one kills units (which costs
// armyPts), so scoring the log double-counted the wins and ignored the losses.
// It also had to be hand-maintained against discoveries.js — the two new
// `recruits` defs were never added to it and silently scored zero.

const HOUR_MS = 60 * 60 * 1000;

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// Tier 1 is worth NOTHING on purpose (2026-07-28). Every player founds a city
// immediately, so a flat 100 for tier 1 was a participation prize paid to
// everyone equally — it moved nobody up or down the table and just inflated the
// floor. City tier now only starts scoring once a town hall actually reaches
// tier 2, so the category measures development rather than existence.
// Keep in lockstep with js/domain/ranking.js's copy (see this file's header):
// the client renders its own score and any drift shows the same account two
// different numbers.
function _cityTierBonus(buildings) {
  const th = buildings?.town_hall || 0;
  if (th >= 16) return 3000;
  if (th >= 11) return 1500;
  if (th >= 6)  return 500;
  return 0;
}

// Army points use the same PWR score as the recruit cap
// (EconomyCore.getArmyPower: linear per-model cost + combat-trait tax).
function _armyPowerFor(army) {
  if (!army) return 0;
  return Math.round(EconomyCore.getArmyPower(army.units, UNIT_DEFS));
}

// Cumulative XP to REACH level N is 50×(N²−1) (see js/domain/lord.js's
// tickActions: xpToNext at level N = 50×(2N+1), telescoped). A fresh
// level-1 lord with 0 xp is worth exactly 0 lord points.
function _lordTotalXp(l) {
  const level = l.level || 1;
  return 50 * (level * level - 1) + (l.xp || 0);
}

function _computeScore(playerId, player, lords, cities, armies) {
  const playerLords  = Object.values(lords).filter(l => l.playerId === playerId);
  const playerCities = Object.values(cities).filter(c => c.playerId === playerId);

  const buildingPts = playerCities.reduce((sum, city) => {
    return sum + Object.values(city.buildings || {}).reduce((s, lvl) => s + (lvl || 0), 0) * 10;
  }, 0);

  const tierPts = playerCities.reduce((sum, city) => sum + _cityTierBonus(city.buildings), 0);

  const lordPts = playerLords.reduce((sum, l) => sum + Math.round(_lordTotalXp(l) / 3), 0);
  const armyPts = playerLords.reduce((sum, l) => sum + _armyPowerFor(armies[l.id]), 0);

  // Expeditions award NO ranking points (removed 2026-07-29) — they already
  // pay in gold, resources and recruits, and a bad one kills units, which
  // costs armyPts. See js/domain/ranking.js for the full reasoning; the two
  // scorers must stay in step or a player's rank would change depending on
  // whether the client or this background updater computed it last.
  //
  // Militar (armyPts) is the ONLY military ranking source — PvP wins and
  // conquests no longer award points (honor is PvP's reward instead).
  const total = buildingPts + tierPts + lordPts + armyPts;

  const topLord = [...playerLords].sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;

  return {
    total,
    breakdown: { buildingPts, tierPts, lordPts, armyPts },
    lordMeta: topLord
      ? { name: topLord.name, classId: topLord.classId, level: topLord.level || 1 }
      : null,
  };
}

export async function runRankingUpdate() {
  const admin = _admin();

  // Load all relevant state in a single query. rank_score/rank_score_1h are
  // included so we can roll the hourly snapshot forward the same way
  // js/domain/ranking.js's saveScore() does (see below) — doing it here
  // too means the rank-delta badges stay correct even for players who
  // never personally revisit the Rankings screen.
  const { data: rows, error } = await admin
    .from('storage')
    .select('player_id, key, value')
    .in('key', ['players', 'lords', 'cities', 'armies', 'honor_points', 'rank_score', 'rank_score_1h']);

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
  const now = Date.now();

  for (const [playerId, data] of Object.entries(byPlayer)) {
    const playersMap   = data.players       || {};
    const lordsMap      = data.lords        || {};
    const citiesMap     = data.cities       || {};
    const armiesMap      = data.armies      || {};

    const player = playersMap[playerId];
    if (!player) continue;

    try {
      const scoreObj = _computeScore(playerId, player, lordsMap, citiesMap, armiesMap);
      const honorPoints = data.honor_points ?? 0;

      const value = {
        username:    player.username || 'Player',
        score:       scoreObj.total,
        breakdown:   scoreObj.breakdown,
        lordMeta:    scoreObj.lordMeta,
        honorPoints,
        updatedAt:   now,
      };

      upserts.push({ player_id: playerId, key: 'rank_score', value });

      const snap    = data.rank_score_1h || null;
      const snapAge = snap ? now - (snap.updatedAt || 0) : Infinity;
      if (snapAge > HOUR_MS) {
        upserts.push({ player_id: playerId, key: 'rank_score_1h', value: data.rank_score || value });
      }
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
    console.log(`[ranking-updater] updated ${byPlayer ? Object.keys(byPlayer).length : 0} player scores (${upserts.length} rows written)`);
  }
}
