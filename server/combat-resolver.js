// =============================================
//  combat-resolver.js — POST /api/pvp/resolve
//
//  Authoritative PvP battle resolution.
//
//  Flow:
//    1. Verify Supabase JWT → caller's UUID
//    2. Validate intent: { attackerLordId, targetTileX, targetTileY }
//    3. Server-side checks (ownership, stance, same-tile arrival)
//    4. Load attacker data via service-role key (bypasses RLS)
//    5. Collect ALL enemy lords on target tile (+ city garrison seam)
//    6. Load each defender's armies, lords, and activity_feed
//    7. Build one combined defending side; run BattleEngine.resolve()
//    8. Write losses to all participants atomically-ish (Promise.all)
//    9. Append vague "under attack" notification to each defender's feed
//   10. Return full BattleReport to caller
//
//  The client is never trusted for any outcome.
//  After a successful resolve, the client applies the attacker-side losses
//  from the returned report to its local localStorage cache directly
//  (no page refresh needed).
//
//  Known limitation (Phase 1): Army composition is still client-authoritative
//  at recruitment time. Making recruitment authoritative is a follow-on task.
//
//  Known limitation (Phase 1): Movement timing is client-authoritative.
//  The dodge window (travel time = defender's warning window) is honored for
//  honest clients, but a cheater could write a fake lord position to skip
//  travel. Server-authoritative movement (or a resolveAt timestamp) is the
//  hardening follow-on — identical to the existing recruitment caveat.
//
//  Known limitation (Phase 1): DB writes are not a true Postgres transaction.
//  If one write fails, others may succeed. Phase 2 hardening: wrap in a
//  Postgres function with SECURITY DEFINER.
// =============================================

import { createClient } from '@supabase/supabase-js';
import { catchUp }       from './tick/catch-up.js';
import {
  BattleEngine,
  UNIT_DEFS,
  BUILDING_DEFS,
  LORD_BASE_STATS,
  LORD_CLASSES,
  STANCE_DEFS,
  MOUNT_POOL,
} from './engine-loader.js';

// ── Supabase clients ──────────────────────────────────────────
//
//  Two separate clients:
//    _authClient()  — anon key  — only used for auth.getUser(jwt).
//                    Supabase auth endpoint rejects service role key here.
//    _adminClient() — service role key — bypasses RLS for all DB ops.

function _authClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function _adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// ── Pure helpers (no StorageService dependency) ───────────────

function _effectiveStats(lord) {
  const base  = lord.baseStats || { ...LORD_BASE_STATS };
  const cls   = LORD_CLASSES[lord.classId];
  const mods  = cls?.modifiers || {};
  const mount = lord.mountId ? (MOUNT_POOL?.[lord.mountId]?.effects || {}) : {};
  const result = {};
  for (const key of Object.keys(LORD_BASE_STATS)) {
    result[key] = (base[key] ?? LORD_BASE_STATS[key]) + (mods[key] || 0) + (mount[key] || 0);
  }
  return result;
}

const _ARMY_TIERS = [
  { min: 0,  max: 0,  score: 0,  label: 'None'          },
  { min: 1,  max: 3,  score: 20, label: 'Small Force'    },
  { min: 4,  max: 6,  score: 40, label: 'Medium Force'   },
  { min: 7,  max: 9,  score: 65, label: 'Large Force'    },
  { min: 10, max: 10, score: 90, label: 'Massive Force'  },
];
const _CLASS_VIS_MULT = { rogue: 0.35 };

// Total unit count across an army's stacks — the single "does this army
// exist at all" check, shared by visibility scoring, scanning, and combat.
function _armyTotal(units) {
  return (units || []).reduce((s, u) => s + u.count, 0);
}

function _visibilityScore(lord, armyUnits) {
  const count = _armyTotal(armyUnits);
  const tier  = _ARMY_TIERS.find(t => count >= t.min && count <= t.max) || _ARMY_TIERS[0];
  let score   = tier.score;
  const stanceDef = STANCE_DEFS[lord.stance?.id || 'idle'];
  if (stanceDef?.visibilityMult != null) score *= stanceDef.visibilityMult;
  const cm = _CLASS_VIS_MULT[lord.classId];
  if (cm != null) score *= cm;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Bucketed force-size label for a given unit list — used at 'vague' intel
// tier so an approximate size is shown without leaking exact composition.
function _forceLabel(units) {
  const count = _armyTotal(units);
  const tier  = _ARMY_TIERS.find(t => count >= t.min && count <= t.max) || _ARMY_TIERS[0];
  return tier.label;
}

// Progressive fog-of-war tier: vague → clear → precise, same ramp for
// enemy_lord and enemy_city. Rogue scanners always get precise instantly.
// currentTier is whatever the caller already knows for this specific
// entity (lordId/cityId) — passed up from the client's IntelligenceService.
function _qualityTier(callerClassId, currentTier) {
  if (callerClassId === 'rogue') return 'precise';
  if (!currentTier)               return 'vague';
  if (currentTier === 'vague')    return 'clear';
  return 'precise';
}

// Truncate a fully-built enemy_lord rawData payload down to what the given
// tier is allowed to reveal. Enforced server-side so a vague-tier response
// never puts full army composition on the wire in the first place.
function _truncateLordData(tier, raw) {
  if (tier === 'vague') {
    return { lordId: raw.lordId, forceSize: raw.forceSize };
  }
  if (tier === 'clear') {
    return {
      lordId: raw.lordId, lordName: raw.lordName, lordRace: raw.lordRace,
      lordLevel: raw.lordLevel, lordClass: raw.lordClass,
      playerUsername: raw.playerUsername, forceSize: raw.forceSize,
    };
  }
  return raw; // precise — full detail, including stance for rogue scanners
}

// Same idea for enemy_city — vague only reveals name + a bucketed garrison
// size (never an exact count), clear adds full garrison composition,
// precise adds exact population.
function _truncateCityData(tier, raw) {
  if (tier === 'vague') {
    return { cityId: raw.cityId, name: raw.name, forceSize: raw.forceSize };
  }
  if (tier === 'clear') {
    return { cityId: raw.cityId, name: raw.name, forceSize: raw.forceSize, garrisonUnits: raw.garrisonUnits };
  }
  return raw; // precise — + population, exact garrisonCount
}

// Server-side mirror of CityService.getGarrison (js/domain/city.js) — the
// client's version can't run here (RLS-scoped browser storage), so combat
// resolution and enemy-city scans both compute garrison from BUILDING_DEFS
// directly, capped at 10 units same as the client.
function _getGarrison(city) {
  const totals = {};
  Object.entries(city.buildings || {}).forEach(([bId, level]) => {
    const def = BUILDING_DEFS[bId];
    if (!def?.garrisonRoster) return;
    def.garrisonRoster(level).forEach(({ unitId, count }) => {
      totals[unitId] = (totals[unitId] || 0) + count;
    });
  });
  const roster = Object.entries(totals).map(([unitId, count]) => ({ unitId, count }));
  const total  = roster.reduce((s, r) => s + r.count, 0);
  if (total > 10) {
    const scale = 10 / total;
    roster.forEach(r => { r.count = Math.max(1, Math.floor(r.count * scale)); });
  }
  return roster;
}

// Find the city (if any) sitting on a tile, and who owns it. Cities are
// globally visible via the shared world_state table (world.tiles[x,y] =
// cityId); the owner has to be found with one cross-player scan of the
// 'cities' storage key, same pattern already used for lords elsewhere in
// this file. Returns null if no city, or if it belongs to excludePlayerId.
async function _findCityAtTile(admin, tileX, tileY, excludePlayerId) {
  const { data: worldRows } = await admin.from('world_state').select('value').eq('key', 'world').maybeSingle();
  const cityId = worldRows?.value?.tiles?.[`${tileX},${tileY}`];
  if (!cityId) return null;

  const { data: cityRows } = await admin.from('storage').select('player_id, value').eq('key', 'cities');
  for (const row of (cityRows || [])) {
    if (excludePlayerId && row.player_id === excludePlayerId) continue;
    const city = (row.value || {})[cityId];
    if (city) return { playerId: row.player_id, city };
  }
  return null;
}

// Removes any lingering 'pvp_threat' entry naming this attacker from every
// player's activity_feed. Normally the threat entry is replaced by a
// 'pvp_result' entry for whichever defenders were actually found on arrival
// (see the defPlayerIds.forEach loop below) — but if the target evaded
// before the attacker arrived (no lord, no city on the tile anymore), that
// replacement never runs and the "Incoming attack!" warning is left
// dangling forever. A lord can only have one attack in flight at a time,
// so matching on attacker name alone is safe — there's nothing else it
// could belong to.
async function _clearStaleThreats(admin, attackerName) {
  const { data: rows } = await admin.from('storage').select('player_id, value').eq('key', 'activity_feed');
  const writes = [];
  for (const row of (rows || [])) {
    const feed = row.value?.[row.player_id];
    if (!Array.isArray(feed)) continue;
    const filtered = feed.filter(e => !(e.type === 'pvp_threat' && e.lordName === attackerName));
    if (filtered.length !== feed.length) {
      writes.push(admin.from('storage').upsert(
        { player_id: row.player_id, key: 'activity_feed', value: { ...row.value, [row.player_id]: filtered } },
        { onConflict: 'player_id,key' }
      ));
    }
  }
  if (writes.length > 0) await Promise.all(writes);
}

// ── PvP rewards ────────────────────────────────────────────────
//
// Gold: attacker-only, on victory — scaled by the value of what was beaten
// (defending army power + garrison power + a cut of the city's population).
// Resources: attacker-only, on victory, only when a city was involved — a
// slice of the city owner's resource pool. Resources live on player.resources
// (empire-wide), not per-city — see catch-up.js's production tick — so this
// loots from the city OWNER's pool, not a per-city stockpile.
// XP: both sides, every outcome — winner gets full value, loser/draw get a
// reduced share, so losing still teaches you something (matches the existing
// PvE bandit-camp xpWin/xpLoss convention). Scaled by opponent strength, so
// beating a tougher force is worth more.
//
// These are initial balancing numbers — tunable without touching the
// resolution flow itself. Lord-capture bonus gold is a natural extension
// once conquest/capture (currently just downtime) becomes a real state.

const _GOLD_PER_POWER    = 0.5;   // gold per point of defeated army power
const _CITY_GOLD_PCT     = 0.03;  // gold = this fraction of city population
const _CITY_XP_PCT       = 0.006; // xp = this fraction of city population
const _XP_PER_POWER      = 0.15;  // xp per point of opponent army power
const _CITY_XP_FLAT      = 20;    // flat xp bonus for engaging a city at all
const _XP_LOSS_RATIO     = 0.25;  // consolation xp ratio on defeat
const _XP_DRAW_RATIO     = 0.5;   // xp ratio on draw
const _MIN_VICTORY_GOLD  = 10;
const _MIN_XP            = 5;
// City fights get their own, much higher floors — even a weak/empty-garrison
// city should be worth more than a random weak lord skirmish (this was the
// bug: an empty-garrison city fell all the way through to the generic
// _MIN_XP=5 / _MIN_VICTORY_GOLD=10 floor, which felt worthless).
const _MIN_CITY_VICTORY_GOLD = 50;
const _MIN_CITY_XP           = 30;
const _RESOURCE_LOOT_PCT = 0.05;  // fraction of the city owner's resource pool looted

// Sum of unit "power" for a battle-army stack list — mirrors the combat
// power formula already used client-side (lord-screen.js, map-view.js) and
// server-side in catch-up.js's own copy of the same formula.
function _armyPower(units) {
  return (units || []).reduce((sum, u) => {
    const def = UNIT_DEFS[u.unitId];
    if (!def) return sum;
    const s = def.combatStats || {};
    return sum + ((s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0)) * u.count;
  }, 0);
}

// XP threshold + level-up — mirrors js/domain/lord.js checkLevelUp(). This
// is a third independent copy of the same small formula (server/tick/catch-up.js
// already has its own, by design — that module is dependency-free).
function _xpToNextLevel(level) { return 50 * (2 * level + 1); }
function _checkLevelUp(lord) {
  const cls     = LORD_CLASSES[lord.classId];
  const clsKeys = new Set(Object.keys(cls?.modifiers || {}));
  let leveled = 0;
  while ((lord.xp || 0) >= (lord.xpToNext || _xpToNextLevel(lord.level || 1))) {
    lord.xp           = Math.max(0, (lord.xp || 0) - (lord.xpToNext || _xpToNextLevel(lord.level || 1)));
    lord.level        = (lord.level || 1) + 1;
    lord.xpToNext     = _xpToNextLevel(lord.level);
    lord.talentPoints = (lord.talentPoints || 0) + 1;
    if (lord.baseStats) {
      for (const key of Object.keys(LORD_BASE_STATS)) {
        lord.baseStats[key] = (lord.baseStats[key] ?? LORD_BASE_STATS[key]) + (clsKeys.has(key) ? 2 : 1);
      }
    }
    leveled++;
  }
  return leveled;
}

// Applies XP + level-up to a lord record in place. Full-heals on level-up
// (matching client behavior in lord.js) but only if the lord actually
// survived the fight — a lord left in downtime by _applyLordHp should not
// be silently re-healed just because a level-up happened to trigger.
function _awardXp(lord, xpEarned) {
  if (!lord || xpEarned <= 0) return { xpEarned: 0, leveled: 0 };
  lord.xp = (lord.xp || 0) + xpEarned;
  const leveled = _checkLevelUp(lord);
  if (leveled > 0 && !lord.downtimeUntil) lord.currentHp = _effectiveStats(lord).health;
  return { xpEarned, leveled };
}

// Loots a slice of the defender's resource pool into the attacker's, in
// place on both player records. Returns { [resType]: amountLooted }.
function _lootResources(defenderPlayer, attackerPlayer) {
  const loot   = {};
  const defRes = defenderPlayer.resources || {};
  attackerPlayer.resources = attackerPlayer.resources || {};
  ['food', 'wood', 'stone', 'iron'].forEach(r => {
    const avail  = defRes[r] || 0;
    const amount = Math.floor(avail * _RESOURCE_LOOT_PCT);
    if (amount <= 0) return;
    defRes[r] = avail - amount;
    attackerPlayer.resources[r] = (attackerPlayer.resources[r] || 0) + amount;
    loot[r] = amount;
  });
  defenderPlayer.resources = defRes;
  return loot;
}

// Pure reward calculation for a resolved PvP fight — no I/O, no mutation.
function _computeRewards({ winner, defenders, garrisonUnits, cityHit }) {
  const defArmyPower  = defenders.reduce((s, d) => s + _armyPower(d.army?.units), 0);
  const garrisonPower = _armyPower(garrisonUnits);
  const opponentPower = defArmyPower + garrisonPower;
  const population    = cityHit?.city.population || 0;

  // City population scales BOTH gold and xp — previously only gold used it,
  // which is why an empty-garrison city gave a flat, population-independent
  // 15 xp regardless of how big the city actually was.
  const cityGoldBase = cityHit ? Math.round(population * _CITY_GOLD_PCT) : 0;
  const cityXpBase    = cityHit ? Math.round(population * _CITY_XP_PCT) + _CITY_XP_FLAT : 0;

  const goldBase = Math.round(opponentPower * _GOLD_PER_POWER) + cityGoldBase;
  const xpBase   = Math.round(opponentPower * _XP_PER_POWER) + cityXpBase;

  const minGold = cityHit ? _MIN_CITY_VICTORY_GOLD : _MIN_VICTORY_GOLD;
  const minXp   = cityHit ? _MIN_CITY_XP : _MIN_XP;

  let atkGold = 0, atkXp, defXp;
  if (winner === 'attacker') {
    atkGold = Math.max(minGold, Math.round(goldBase * (0.85 + Math.random() * 0.3)));
    atkXp   = Math.max(minXp, xpBase);
    defXp   = Math.max(_MIN_XP, Math.round(xpBase * _XP_LOSS_RATIO));
  } else if (winner === 'defender') {
    atkXp   = Math.max(_MIN_XP, Math.round(xpBase * _XP_LOSS_RATIO));
    defXp   = Math.max(minXp, xpBase);
  } else {
    atkXp   = Math.max(_MIN_XP, Math.round(xpBase * _XP_DRAW_RATIO));
    defXp   = Math.max(_MIN_XP, Math.round(xpBase * _XP_DRAW_RATIO));
  }

  return { atkGold, atkXp, defXp };
}

function _terrain(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  const keys = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
  return keys[h % keys.length];
}

function _unitRole(def) {
  if (def.category === 'ranged')   return 'ranged';
  if (def.category === 'cavalry')  return 'cavalry';
  if (def.category === 'monster' || def.category === 'legendary') return 'monster';
  if ((def.traits || []).includes('ranged')) return 'ranged';
  return 'infantry';
}

// ── Battle context builders ───────────────────────────────────

// Build a lord unit for the battle context.
// prefix: 'a' for attacker, 'd0'/'d1'/... for defenders.
// sourceId is always lord.id (unique globally) — no prefix needed.
function _makeLordUnit(lord, stats, prefix) {
  return {
    id:          `${prefix}_lord`,
    sourceId:    lord.id,
    name:        lord.name,
    role:        'lord',
    traits:      ['backline'],
    abilities:   [],
    maxHp:       stats.health,
    currentHp:   lord.currentHp ?? stats.health,
    attack:      stats.attack,
    defense:     stats.defense,
    speed:       stats.speed,
    leadership:  stats.leadership,
    count:       1,
    startCount:  1,
    isLord:      true,
    isRouting:   false,
    _frenzBonus: 0,
    _burning:    false,
  };
}

// Build an army stack unit.
// Attacker: sourceId = stack.unitId (no prefix) so client cache update works.
// Defenders: sourceId = `${prefix}_${stack.unitId}` (unique per-defender) so
//   multi-defender loss application can route losses back to the right army.
function _makeStack(stack, prefix, idx, usePrefix) {
  const def = UNIT_DEFS[stack.unitId];
  if (!def) return null;
  return {
    id:          `${prefix}_${idx}`,
    sourceId:    usePrefix ? `${prefix}_${stack.unitId}` : stack.unitId,
    name:        def.name,
    role:        _unitRole(def),
    traits:      [...(def.traits || [])],
    abilities:   [...(def.abilities || [])],
    maxHp:       def.combatStats?.hp      ?? 100,
    currentHp:   stack.currentHp          ?? (def.combatStats?.hp ?? 100),
    attack:      def.combatStats?.attack  ?? 5,
    defense:     def.combatStats?.defense ?? 5,
    speed:       def.combatStats?.speed   ?? 5,
    leadership:  0,
    count:       stack.count,
    startCount:  stack.count,
    isLord:      false,
    isRouting:   false,
    _frenzBonus: 0,
    _burning:    false,
  };
}

// Build a full BattleContext from attacker data + array of defender entries.
// defenders: [{ lord, army: { lordId, units: [{ unitId, count, currentHp? }] } }]
//
// Defender unit sourceIds are prefixed (d0_dreadspears, d1_dreadspears) so
// _applyDefLosses can route casualties back to the correct army even when
// multiple defenders share the same unit types.
//
// garrisonUnits (optional): [{ unitId, count }] from _getGarrison(city).
// Fed through the same _makeStack builder with prefix 'garrison' — a
// distinct, non-'d{idx}' prefix means _applyDefLosses (which only matches
// 'd{idx}_' prefixes) naturally never writes losses back for it. Garrison
// is recomputed fresh from building levels every fight (static/renewable),
// so nothing needs to persist here.
function _buildMultiContext(atkLord, atkArmy, defenders, garrisonUnits, terrain) {
  const atkStats = _effectiveStats(atkLord);

  const defUnits = [];
  defenders.forEach(({ lord, army }, dIdx) => {
    const stats  = _effectiveStats(lord);
    const prefix = `d${dIdx}`;
    defUnits.push(_makeLordUnit(lord, stats, prefix));
    (army?.units || []).forEach((stack, sIdx) => {
      const u = _makeStack(stack, prefix, sIdx, true); // usePrefix = true for defenders
      if (u) defUnits.push(u);
    });
  });

  (garrisonUnits || []).forEach((stack, gIdx) => {
    const u = _makeStack(stack, 'garrison', gIdx, true);
    if (u) defUnits.push(u);
  });

  const maxDefLeadership = defenders.reduce(
    (m, { lord }) => Math.max(m, _effectiveStats(lord).leadership), 0
  );

  return {
    terrain,
    attacker: {
      id:    atkLord.playerId,
      units: [
        _makeLordUnit(atkLord, atkStats, 'a'),
        ...(atkArmy?.units || []).map((s, i) => _makeStack(s, 'a', i, false)).filter(Boolean),
      ],
      morale: Math.min(100, 75 + atkStats.leadership * 1.5),
    },
    defender: {
      id:    defenders.map(d => d.lord.playerId).join('+'),
      units: defUnits,
      morale: Math.min(100, 75 + maxDefLeadership * 1.5),
    },
  };
}

// ── Loss application ──────────────────────────────────────────

// Apply attacker-side losses to their armies blob.
// Attacker army stack sourceIds have no prefix (= stack.unitId).
function _applyAtkLosses(armiesObj, lord, sideReport) {
  const army = armiesObj[lord.id] || { lordId: lord.id, units: [] };
  sideReport.unitsStart.forEach(({ sourceId }) => {
    if (sourceId === lord.id) return; // lord unit — HP handled by _applyLordHp
    const surviving = sideReport.unitsSurviving.find(s => s.sourceId === sourceId);
    const stack     = army.units.find(u => u.unitId === sourceId);
    if (!stack) return;
    stack.count = surviving?.count ?? 0;
    if (surviving && stack.count > 0) stack.currentHp = Math.round(surviving.avgHp);
  });
  army.units        = army.units.filter(u => u.count > 0);
  armiesObj[lord.id] = army;
}

// Apply defender-side losses to each defender's armies blob.
// Defender army stack sourceIds are prefixed: `d${idx}_${unitId}`.
function _applyDefLosses(defenders, defArmiesByPlayer, sideReport) {
  defenders.forEach(({ lord, playerId }, dIdx) => {
    const prefix  = `d${dIdx}`;
    const armies  = defArmiesByPlayer[playerId] || {};
    const army    = armies[lord.id] || { lordId: lord.id, units: [] };

    sideReport.unitsStart.forEach(({ sourceId }) => {
      if (!sourceId.startsWith(prefix + '_')) return; // belongs to another defender
      const unitId    = sourceId.slice(prefix.length + 1);
      const surviving = sideReport.unitsSurviving.find(s => s.sourceId === sourceId);
      const stack     = army.units.find(u => u.unitId === unitId);
      if (!stack) return;
      stack.count = surviving?.count ?? 0;
      if (surviving && stack.count > 0) stack.currentHp = Math.round(surviving.avgHp);
    });

    army.units           = army.units.filter(u => u.count > 0);
    armies[lord.id]      = army;
    defArmiesByPlayer[playerId] = armies;
  });
}

// Update lord HP and downtime from the battle report's surviving units list.
// winner: 'attacker'|'defender'|'draw'
// side:   'attacker'|'defender' — which side this lord fought on
// Eliminated defenders against a winning attacker are 'captured'; all others are 'defeated'.
function _applyLordHp(lordsObj, lordId, unitsSurviving, winner, side) {
  const lord = lordsObj[lordId];
  if (!lord) return;
  const unit = unitsSurviving.find(u => u.sourceId === lordId);
  if (unit) {
    lord.currentHp      = Math.max(1, Math.round(unit.avgHp));
    lord.downtimeUntil  = null;
    lord.downtimeReason = null;
  } else {
    lord.currentHp      = 0;
    lord.downtimeUntil  = Date.now() + 60 * 60 * 1000; // 1 hour
    lord.downtimeReason = (side === 'defender' && winner === 'attacker') ? 'captured' : 'defeated';
  }
  lordsObj[lordId] = lord;
}

// ── Tile scanner ─────────────────────────────────────────────
//
//  POST /api/scan/tile
//  Body: { tileX, tileY, knownTiers?: { [lordId|cityId]: 'vague'|'clear'|'precise' } }
//
//  Called by Search Area quest resolution to advance intel on a tile.
//  Returns enemy lords AND an enemy city (if present) on the given tile.
//  Army-less lords are skipped entirely — they don't exist for detection
//  purposes. Response payloads are truncated server-side to whatever tier
//  the caller currently knows for that specific entity (knownTiers, keyed
//  by lordId/cityId) — a 'vague'-tier response never contains full army
//  composition or garrison detail, only a bucketed force-size label.
//
//  Response: { ok, discoveries: [{ type, tileX, tileY, ttl, rawData }] }

// Both lord and city intel expire and need re-scouting. Cities are static
// structures, so their intel decays slower than a mobile lord's.
const _LORD_INTEL_TTL_MS = 30 * 60 * 1000;
const _CITY_INTEL_TTL_MS = 90 * 60 * 1000;

// Shared discovery-gathering core, used by both the scanTile HTTP endpoint
// and resolveScout (the dedicated Scout action) — same tiered-truncation
// contract either caller uses.
async function _gatherTileIntel(admin, callerId, callerClassId, x, y, knownTiers) {
  const tiers = (knownTiers && typeof knownTiers === 'object') ? knownTiers : {};
  const discoveries = [];

  // ── Enemy city on this tile ────────────────────────────────
  const cityHit = await _findCityAtTile(admin, x, y, callerId);
  if (cityHit) {
    const garrison      = _getGarrison(cityHit.city);
    const garrisonCount = garrison.reduce((s, r) => s + r.count, 0);
    const rawFull = {
      cityId:        cityHit.city.id,
      name:          cityHit.city.name,
      population:    Math.floor(cityHit.city.population || 0),
      garrisonCount,
      garrisonUnits: garrison,
      forceSize:     _forceLabel(garrison),
    };
    const tier = _qualityTier(callerClassId, tiers[cityHit.city.id] || null);
    discoveries.push({ type: 'enemy_city', tileX: x, tileY: y, ttl: _CITY_INTEL_TTL_MS, rawData: _truncateCityData(tier, rawFull) });
  }

  // ── Enemy lords on this tile ───────────────────────────────
  const [lordResult, armyResult, playerResult] = await Promise.all([
    admin.from('storage').select('player_id, value').eq('key', 'lords'),
    admin.from('storage').select('player_id, value').eq('key', 'armies'),
    admin.from('storage').select('player_id, value').eq('key', 'players'),
  ]);

  const armyByPlayer    = {};
  const profileByPlayer = {};
  (armyResult.data || []).forEach(r => { armyByPlayer[r.player_id]   = r.value || {}; });
  (playerResult.data || []).forEach(r => { profileByPlayer[r.player_id] = (r.value || {})[r.player_id] || {}; });

  for (const row of (lordResult.data || [])) {
    if (row.player_id === callerId) continue;
    const username = profileByPlayer[row.player_id]?.username || null;
    for (const lord of Object.values(row.value || {})) {
      if (lord.x !== x || lord.y !== y) continue;
      if (lord.downtimeUntil && Date.now() < lord.downtimeUntil) continue; // downed — not visible

      const armyObj   = armyByPlayer[row.player_id] || {};
      const armyUnits = (armyObj[lord.id] || {}).units || [];
      if (_armyTotal(armyUnits) <= 0) continue; // army-less lords don't exist for detection

      const stanceDef    = STANCE_DEFS[lord.stance?.id || 'idle'];
      const unitsSummary = armyUnits.map(u => ({ unitId: u.unitId, count: u.count }));
      const armyPoints   = _armyTotal(armyUnits);
      const isRogue      = callerClassId === 'rogue';

      const rawFull = {
        lordId:         lord.id,
        lordName:       lord.name,
        lordRace:       lord.race,
        lordLevel:      lord.level || 1,
        lordClass:      lord.classId,
        playerUsername: username,
        armyCapacity:   armyPoints,
        units:          unitsSummary,
        lastActivity:   lord.actionQueue?.length > 0 ? lord.actionQueue[0].actionId : 'idle',
        forceSize:      _forceLabel(armyUnits),
        stanceId:       isRogue ? (lord.stance?.id || 'idle') : null,
        stanceName:     isRogue ? (stanceDef?.name || null) : null,
      };
      const tier = _qualityTier(callerClassId, tiers[lord.id] || null);
      discoveries.push({
        type:    'enemy_lord',
        tileX:   x,
        tileY:   y,
        ttl:     _LORD_INTEL_TTL_MS,
        rawData: _truncateLordData(tier, rawFull),
      });
    }
  }

  return discoveries;
}

export async function scanTile(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try { authClient = _authClient(); admin = _adminClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;
  const { tileX, tileY, knownTiers } = req.body || {};
  const x = Number(tileX), y = Number(tileY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'tileX and tileY required' });
  }

  // Load the scanning lord's class (Rogue always gets precise tier instantly).
  const { data: callerStorageRows } = await admin.from('storage')
    .select('key, value').eq('player_id', callerId).eq('key', 'lords');
  const callerLords    = Object.values(callerStorageRows?.[0]?.value || {});
  const scanningLord   = callerLords.find(l => l.x === x && l.y === y);
  const callerClassId  = scanningLord?.classId || null;

  const discoveries = await _gatherTileIntel(admin, callerId, callerClassId, x, y, knownTiers);
  return res.json({ ok: true, discoveries });
}

// ── Presence scanner ──────────────────────────────────────────
//
//  POST /api/scan/presence
//
//  Live, zero-stats "is there something attackable here" layer for lords —
//  cities already have an equivalent via the global world_state table
//  (WorldService.getOccupiedTiles() client-side), so this only covers
//  lords. One cross-player scan of 'lords' + 'armies', filtered to
//  positioned lords with a non-empty army (army-less lords don't exist
//  for detection purposes) and excluding the caller's own lords. Returns
//  anonymized coordinates only — no names, classes, or army composition.
//
//  Response: { ok, lords: [{ x, y }] }

export async function scanPresence(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try { authClient = _authClient(); admin = _adminClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;

  const [lordResult, armyResult] = await Promise.all([
    admin.from('storage').select('player_id, value').eq('key', 'lords'),
    admin.from('storage').select('player_id, value').eq('key', 'armies'),
  ]);
  if (lordResult.error) return res.status(500).json({ error: 'Failed to scan lords: ' + lordResult.error.message });

  const armyByPlayer = {};
  (armyResult.data || []).forEach(r => { armyByPlayer[r.player_id] = r.value || {}; });

  const presence = [];
  for (const row of (lordResult.data || [])) {
    if (row.player_id === callerId) continue;
    const armies = armyByPlayer[row.player_id] || {};
    Object.values(row.value || {}).forEach(l => {
      if (l.x == null || l.y == null) return;
      if (l.downtimeUntil && Date.now() < l.downtimeUntil) return;
      const armyUnits = (armies[l.id] || {}).units || [];
      if (_armyTotal(armyUnits) <= 0) return;
      presence.push({ x: l.x, y: l.y });
    });
  }

  return res.json({ ok: true, lords: presence });
}

// ── Attack declaration ────────────────────────────────────────
//
//  POST /api/attack/declare
//  Called when the attacker confirms the attack order (before travel begins).
//  Writes a pvp_threat notification to every defender on the target tile
//  so they see the incoming attack immediately.
//
//  Body: { attackerLordId, targetTileX, targetTileY, etaSecs }
//  Response: { ok }

export async function declareAttack(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try { authClient = _authClient(); admin = _adminClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;
  const { attackerLordId, targetTileX, targetTileY, etaSecs } = req.body || {};
  const tX = Number(targetTileX), tY = Number(targetTileY);
  if (!attackerLordId || !Number.isFinite(tX) || !Number.isFinite(tY)) {
    return res.status(400).json({ error: 'Required: attackerLordId, targetTileX, targetTileY' });
  }

  // Get attacker lord name
  const { data: atkRows } = await admin.from('storage')
    .select('value').eq('player_id', callerId).eq('key', 'lords').single();
  const atkLords = atkRows?.value || {};
  const atkLord  = atkLords[attackerLordId];
  const atkName  = atkLord?.name || 'Lord enemigo';

  // Find all defenders on that tile
  const [lordResult, feedResult] = await Promise.all([
    admin.from('storage').select('player_id, value').eq('key', 'lords'),
    admin.from('storage').select('player_id, value').eq('key', 'activity_feed'),
  ]);

  const feedByPlayer = {};
  (feedResult.data || []).forEach(r => { feedByPlayer[r.player_id] = r.value || {}; });

  const MAX_FEED = 50;
  const defPlayerIds = new Set();
  for (const row of (lordResult.data || [])) {
    if (row.player_id === callerId) continue;
    const lords = Object.values(row.value || {});
    if (lords.some(l => l.x === tX && l.y === tY)) {
      defPlayerIds.add(row.player_id);
    }
  }

  const etaStr = etaSecs > 0
    ? `ETA ${Math.ceil(etaSecs / 60)} min`
    : 'inmediato';

  const writes = [];
  for (const defId of defPlayerIds) {
    const feed = feedByPlayer[defId] || {};
    if (!feed[defId]) feed[defId] = [];
    const entry = {
      id:       'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      at:       Date.now(),
      etaAt:    Date.now() + (Number(etaSecs) || 0) * 1000,
      type:     'pvp_threat',
      icon:     '⚔',
      title:    `Incoming attack from ${atkName}!`,
      detail:   `Arriving at (${tX}, ${tY}) · ${etaStr}`,
      lordName: atkName,
    };
    feed[defId].unshift(entry);
    if (feed[defId].length > MAX_FEED) feed[defId] = feed[defId].slice(0, MAX_FEED);
    writes.push(admin.from('storage').upsert(
      { player_id: defId, key: 'activity_feed', value: feed },
      { onConflict: 'player_id,key' }
    ));
  }

  if (writes.length > 0) await Promise.all(writes);
  return res.json({ ok: true, notified: defPlayerIds.size });
}

// ── Core resolution logic (no HTTP dependency) ───────────────
//
// Called from the HTTP handler (online) and programmatically
// from sync.js / check-incoming (offline battles).
//
// Returns one of:
//   { ok: true, report, terrain, defPlayerIds, atkLords, atkArmies, atkPlayer }
//   { ok: true, noDefenders: true, atkLords, atkArmies, atkPlayer }
//   { ok: false, error, hidden?: true }
async function _resolveCore(admin, attackerPlayerId, attackerLordId, tileX, tileY, opts = {}) {
  // 1. Load attacker data.
  const { data: atkRows, error: atkErr } = await admin.from('storage')
    .select('key, value')
    .eq('player_id', attackerPlayerId)
    .in('key', ['lords', 'armies', 'players', 'honor_points']);
  if (atkErr) return { ok: false, error: 'Failed to load attacker data: ' + atkErr.message };

  const atkData      = Object.fromEntries((atkRows || []).map(r => [r.key, r.value]));
  const atkLords     = atkData.lords   || {};
  const atkArmies    = atkData.armies  || {};
  const atkPlayers   = atkData.players || {};
  const attackerLord = atkLords[attackerLordId];

  if (!attackerLord) return { ok: false, error: 'Attacking lord not found' };
  if (attackerLord.playerId !== attackerPlayerId) return { ok: false, error: 'Lord does not belong to caller' };

  // 2. Stance + busy check.
  if (attackerLord.downtimeUntil && Date.now() < attackerLord.downtimeUntil) {
    return { ok: false, error: 'Attacking lord is incapacitated' };
  }
  if ((attackerLord.actionQueue || []).length > 0) {
    return { ok: false, error: 'Lord is busy with another action' };
  }
  // skipAttackerStanceGate: used when an ambush/raid-stanced lord is reacting
  // to a scout entering their tile (server/combat-resolver.js resolveScout) —
  // this gate exists to stop a stanced lord from *issuing new orders*, which
  // doesn't apply to a stance passively triggering a fight it's the cause of.
  const atkStance = STANCE_DEFS[attackerLord.stance?.id || 'idle'];
  if (!opts.skipAttackerStanceGate && atkStance?.restrictions?.includes('action')) {
    return { ok: false, error: `Cannot attack while in ${atkStance.name} stance` };
  }

  // 3. Same-tile arrival check.
  if (attackerLord.x !== tileX || attackerLord.y !== tileY) {
    return {
      ok: false,
      error: `Attacker has not arrived at (${tileX}, ${tileY}) yet — current position is (${attackerLord.x}, ${attackerLord.y})`,
    };
  }

  // 4. Find ALL enemy lords on the target tile, and the tile's city (if any).
  const { data: allLordRows, error: lordErr } = await admin.from('storage')
    .select('player_id, value').eq('key', 'lords');
  if (lordErr) return { ok: false, error: 'Failed to scan lords: ' + lordErr.message };

  const defenderEntries = [];
  for (const row of (allLordRows || [])) {
    if (row.player_id === attackerPlayerId) continue;
    Object.values(row.value || {}).forEach(l => {
      if (l.x === tileX && l.y === tileY) {
        if (l.downtimeUntil && Date.now() < l.downtimeUntil) return;
        defenderEntries.push({ playerId: row.player_id, lord: l });
      }
    });
  }

  const cityHit = await _findCityAtTile(admin, tileX, tileY, attackerPlayerId);

  // A city (even with an empty garrison) makes the tile attackable without
  // any lord present — this is the "attack with zero information" seam.
  if (defenderEntries.length === 0 && !cityHit) {
    // Clear the pending attack flag even when there are no defenders.
    if (atkLords[attackerLordId]) {
      atkLords[attackerLordId].pendingPvpAttack = null;
      await admin.from('storage').upsert(
        { player_id: attackerPlayerId, key: 'lords', value: atkLords },
        { onConflict: 'player_id,key' }
      );
    }
    // The target evaded before arrival — nobody to write a pvp_result for,
    // but whoever got the original "Incoming attack!" warning still needs
    // it cleared, or it lingers in their Activity tab forever.
    await _clearStaleThreats(admin, attackerLord.name);
    return { ok: true, noDefenders: true, atkLords, atkArmies, atkPlayer: atkPlayers[attackerPlayerId] || null };
  }

  // 5. Load each defender's storage + attacker's activity_feed in one batched query.
  // The city owner is included even with zero lord defenders on this tile,
  // so a garrison-only defense still gets an activity-feed notification.
  const defPlayerIds = [...new Set([
    ...defenderEntries.map(e => e.playerId),
    ...(cityHit ? [cityHit.playerId] : []),
  ])];
  const [defResult, atkFeedResult] = await Promise.all([
    admin.from('storage')
      .select('player_id, key, value')
      .in('player_id', defPlayerIds)
      .in('key', ['armies', 'lords', 'activity_feed', 'players', 'honor_points']),
    admin.from('storage')
      .select('value')
      .eq('player_id', attackerPlayerId)
      .eq('key', 'activity_feed')
      .maybeSingle(),
  ]);
  if (defResult.error) return { ok: false, error: 'Failed to load defender data: ' + defResult.error.message };

  const defArmiesByPlayer   = {};
  const defLordsByPlayer    = {};
  const defActivityByPlayer = {};
  const defPlayersByPlayer  = {}; // flattened to the player object itself, not the {[pid]: obj} storage shape
  const defHonorByPlayer    = {};
  for (const row of (defResult.data || [])) {
    if (row.key === 'armies')        defArmiesByPlayer[row.player_id]   = row.value || {};
    if (row.key === 'lords')         defLordsByPlayer[row.player_id]    = row.value || {};
    if (row.key === 'activity_feed') defActivityByPlayer[row.player_id] = row.value || {};
    if (row.key === 'players')       defPlayersByPlayer[row.player_id]  = (row.value || {})[row.player_id] || {};
    if (row.key === 'honor_points')  defHonorByPlayer[row.player_id]    = row.value ?? 0;
  }
  const atkActivityFeed = atkFeedResult.data?.value || {};
  const atkHonorRow     = (atkRows || []).find(r => r.key === 'honor_points');
  const atkHonorCurrent = atkHonorRow?.value ?? 0;

  // Army-less lords don't exist for combat purposes — filtered out here,
  // not just scored low, so they can never be dragged into a fight.
  const defenders = defenderEntries
    .map(({ playerId, lord }) => ({
      playerId,
      lord,
      army: (defArmiesByPlayer[playerId] || {})[lord.id] || { lordId: lord.id, units: [] },
    }))
    .filter(({ army }) => _armyTotal(army.units) > 0);

  const garrisonUnits = cityHit ? _getGarrison(cityHit.city) : [];

  // 6. Visibility check: a city is always attackable (no scouting required);
  // otherwise at least one defending lord must be detectable.
  const anyVisible = !!cityHit || defenders.some(({ lord, army }) => _visibilityScore(lord, army.units) > 0);
  if (!anyVisible) {
    return { ok: false, error: 'All defenders are undetectable (visibility score 0)', hidden: true };
  }

  // 7. Build context and resolve.
  const terrain = _terrain(tileX, tileY);
  const ctx     = _buildMultiContext(attackerLord, atkArmies[attackerLord.id], defenders, garrisonUnits, terrain);
  const report  = BattleEngine.resolve(ctx);

  // Rewards — gold/resources are attacker-only and only on victory; XP goes
  // to both sides on every outcome. See _computeRewards for the formula.
  const rewards = _computeRewards({ winner: report.winner, defenders, garrisonUnits, cityHit });
  let resourceLoot = null;
  if (report.winner === 'attacker' && cityHit) {
    const cityOwnerPlayer = defPlayersByPlayer[cityHit.playerId];
    if (cityOwnerPlayer && atkPlayers[attackerPlayerId]) {
      resourceLoot = _lootResources(cityOwnerPlayer, atkPlayers[attackerPlayerId]);
    }
  }

  // 8. Apply losses.
  const atkPlayer = atkPlayers[attackerPlayerId];
  if (atkPlayer) {
    if (report.winner === 'attacker') {
      atkPlayer.rankingStats = atkPlayer.rankingStats || { pvpWins: 0, conquests: 0 };
      atkPlayer.rankingStats.pvpWins = (atkPlayer.rankingStats.pvpWins || 0) + 1;
    }
    if (rewards.atkGold > 0) atkPlayer.coins = (atkPlayer.coins || 0) + rewards.atkGold;
    atkPlayers[attackerPlayerId] = atkPlayer;
  }

  const updatedAtkArmies = { ...atkArmies };
  _applyAtkLosses(updatedAtkArmies, attackerLord, report.attacker);
  _applyDefLosses(defenders, defArmiesByPlayer, report.defender);
  _applyLordHp(atkLords, attackerLord.id, report.attacker.unitsSurviving, report.winner, 'attacker');
  _awardXp(attackerLord, rewards.atkXp);
  defenders.forEach(({ lord, playerId }) => {
    _applyLordHp(defLordsByPlayer[playerId] || {}, lord.id, report.defender.unitsSurviving, report.winner, 'defender');
    _awardXp((defLordsByPlayer[playerId] || {})[lord.id], rewards.defXp);
  });

  // Clear the deferred attack flag now that battle is resolved.
  if (atkLords[attackerLordId]) atkLords[attackerLordId].pendingPvpAttack = null;

  // 9. Build activity feed entries for both sides.
  const now     = Date.now();
  const rndTag  = () => Math.random().toString(36).slice(2, 5);
  const atkIcon  = report.winner === 'attacker' ? '⚔' : report.winner === 'draw' ? '🤝' : '☠';
  const atkTitle = report.winner === 'attacker' ? 'PvP Victory' : report.winner === 'draw' ? 'PvP Draw' : 'PvP Defeat';
  const atkDetail = `${report.rounds} rounds · casualties: ${report.attacker.modelsLost} · +${rewards.atkXp}⭐`
    + (rewards.atkGold > 0 ? ` · +${rewards.atkGold}💰` : '');

  // What/who was actually attacked — a city, or the first defending lord.
  // Distinct from `lordName`/`lordId` above (which always identify the
  // feed OWNER's own lord) so the client can render "Lord X (Lv Y) attacked
  // <opponent>" instead of a hardcoded "Enemy lord" regardless of target.
  const atkOpponentType = cityHit ? 'city' : 'lord';
  const atkOpponentName = cityHit ? cityHit.city.name : (defenders[0]?.lord?.name || 'Enemy Lord');

  if (!atkActivityFeed[attackerPlayerId]) atkActivityFeed[attackerPlayerId] = [];
  atkActivityFeed[attackerPlayerId].unshift({
    id: `act_pvp_atk_${now}_${rndTag()}`, at: now, type: 'pvp_result',
    icon: atkIcon, title: atkTitle, detail: atkDetail,
    lordName: attackerLord.name, lordId: attackerLordId, lordLevel: attackerLord.level || 1,
    opponentType: atkOpponentType, opponentName: atkOpponentName,
    outcome: report.winner === 'attacker' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat',
    report, terrain, rounds: report.rounds, modelsLost: report.attacker.modelsLost,
    xpEarned: rewards.atkXp, goldEarned: rewards.atkGold, resourceLoot,
  });
  atkActivityFeed[attackerPlayerId] = atkActivityFeed[attackerPlayerId].slice(0, 50);

  defPlayerIds.forEach(pid => {
    const defIcon   = report.winner === 'defender' ? '🛡' : report.winner === 'draw' ? '🤝' : '☠';
    const defTitle  = report.winner === 'defender' ? 'Attack repelled!' : report.winner === 'draw' ? 'Battle draw' : '☠ Defeat — lord attacked';
    const defDetail = `${attackerLord.name} attacked at (${tileX},${tileY}) · ${report.rounds} rounds · casualties: ${report.defender.modelsLost} · +${rewards.defXp}⭐`;
    const feed = defActivityByPlayer[pid] || {};
    if (!feed[pid]) feed[pid] = [];
    feed[pid] = feed[pid].filter(e => !(e.type === 'pvp_threat' && e.lordName === attackerLord.name));
    const defLordEntry = defenders.find(d => d.playerId === pid);
    const isCityOwner   = !defLordEntry && cityHit && cityHit.playerId === pid;
    const defLordId     = defLordEntry?.lord?.id   || null;
    const defLordName   = defLordEntry?.lord?.name || (isCityOwner ? cityHit.city.name : '?');
    feed[pid].unshift({
      id: `act_pvp_def_${now}_${rndTag()}`, at: now, type: 'pvp_result',
      icon: defIcon, title: defTitle, detail: defDetail,
      lordName: defLordName, lordId: defLordId, lordLevel: defLordEntry?.lord?.level || null,
      opponentType: 'lord', opponentName: attackerLord.name,
      outcome: report.winner === 'defender' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat',
      report, terrain, rounds: report.rounds, modelsLost: report.defender.modelsLost,
      xpEarned: defLordEntry ? rewards.defXp : 0, // no lord present (garrison-only) → nobody to award XP to
    });
    feed[pid] = feed[pid].slice(0, 50);
    defActivityByPlayer[pid] = feed;
  });

  // 10. Write all results.
  // Fallback to a city-shaped stand-in when the defense was garrison-only
  // (no lord present) — defenders[0] would otherwise be undefined here.
  // `defender_lord_id` is NOT NULL in the battle_reports schema — use a
  // prefixed placeholder id rather than null for garrison-only defenses.
  const primaryDefender = defenders[0]
    || (cityHit ? { playerId: cityHit.playerId, lord: { id: `garrison_${cityHit.city.id}`, name: cityHit.city.name } } : null);
  // Honor: attacker always loses 15 for PvP attacking; defenders gain 15 on victory, 3 on draw.
  const atkHonorNew = atkHonorCurrent - 15;
  const defHonorDelta = report.winner === 'defender' ? 15 : report.winner === 'draw' ? 3 : 0;

  const writes = [
    admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'armies',        value: updatedAtkArmies },  { onConflict: 'player_id,key' }),
    admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'lords',         value: atkLords },          { onConflict: 'player_id,key' }),
    admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'activity_feed', value: atkActivityFeed },   { onConflict: 'player_id,key' }),
    admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'players',       value: atkPlayers },        { onConflict: 'player_id,key' }),
    admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'honor_points',  value: atkHonorNew },       { onConflict: 'player_id,key' }),
    ...defPlayerIds.flatMap(pid => [
      admin.from('storage').upsert({ player_id: pid, key: 'armies',        value: defArmiesByPlayer[pid]   || {} }, { onConflict: 'player_id,key' }),
      admin.from('storage').upsert({ player_id: pid, key: 'lords',         value: defLordsByPlayer[pid]    || {} }, { onConflict: 'player_id,key' }),
      admin.from('storage').upsert({ player_id: pid, key: 'activity_feed', value: defActivityByPlayer[pid] || {} }, { onConflict: 'player_id,key' }),
      admin.from('storage').upsert({ player_id: pid, key: 'players',       value: { [pid]: defPlayersByPlayer[pid] || {} } }, { onConflict: 'player_id,key' }),
      ...(defHonorDelta > 0 ? [admin.from('storage').upsert({ player_id: pid, key: 'honor_points', value: (defHonorByPlayer[pid] ?? 0) + defHonorDelta }, { onConflict: 'player_id,key' })] : []),
    ]),
    admin.from('battle_reports').insert({
      attacker_id:      attackerPlayerId,
      defender_id:      primaryDefender.playerId,
      attacker_lord_id: attackerLord.id,
      defender_lord_id: primaryDefender.lord.id,
      tile_x:           tileX,
      tile_y:           tileY,
      terrain,
      winner:           report.winner,
      reason:           report.reason,
      rounds:           report.rounds,
      report_json:      report,
    }),
  ];

  const writeResults = await Promise.all(writes);
  const writeError   = writeResults.find(r => r.error)?.error;
  if (writeError) console.error('[combat-resolver] write error:', writeError.message);

  return {
    ok: true,
    report,
    terrain,
    defPlayerIds,
    atkLords,
    atkArmies: updatedAtkArmies,
    atkPlayer: atkPlayers[attackerPlayerId] || null,
  };
}

// ── Main HTTP handler ─────────────────────────────────────────

export async function resolvePvpAttack(req, res) {
  // 1. Authenticate.
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try {
    authClient = _authClient();
    admin      = _adminClient();
  } catch (e) {
    return res.status(500).json({ error: 'Server misconfiguration: ' + e.message });
  }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;

  // 2. Parse + coerce input.
  const { attackerLordId, targetTileX, targetTileY } = req.body || {};
  if (!attackerLordId || targetTileX == null || targetTileY == null) {
    return res.status(400).json({ error: 'Required: attackerLordId, targetTileX, targetTileY' });
  }
  const tX = Number(targetTileX);
  const tY = Number(targetTileY);
  if (!Number.isInteger(tX) || !Number.isInteger(tY) || tX < 0 || tY < 0) {
    return res.status(400).json({ error: 'targetTileX/Y must be non-negative integers' });
  }

  // 3. Resolve.
  const result = await _resolveCore(admin, callerId, attackerLordId, tX, tY);
  if (!result.ok) {
    if (result.error.includes('not found'))       return res.status(404).json({ error: result.error });
    if (result.error.includes('does not belong')) return res.status(403).json({ error: result.error });
    return res.status(400).json({ error: result.error });
  }
  if (result.noDefenders) return res.status(404).json({ error: 'No enemy lords at target tile' });

  return res.status(200).json({ ok: true, report: result.report, terrain: result.terrain, player: result.atkPlayer });
}

// ── Programmatic entry point for offline PvP resolution ───────
//
// Called by sync.js (attacker's next login) and check-incoming
// (defender's overview screen poll). Reads + writes Supabase directly.
export async function resolvePvpBattle(admin, attackerPlayerId, attackerLordId, tileX, tileY) {
  return _resolveCore(admin, attackerPlayerId, attackerLordId, tileX, tileY);
}

// ── Scout / Spy resolution ─────────────────────────────────────
//
// Called when a 'scout' lord action completes: server/tick/catch-up.js sets
// lord.pendingScoutResolve = { tileX, tileY } (it can't do more than that —
// it's a pure, single-player module with no cross-player visibility). This
// function is what actually has admin access, drained by both:
//   - server/tick/event-dispatcher.js's _advancePlayer (offline case)
//   - POST /api/lord/scout-resolve (online case, mirrors resolvePvpAttack)
//
// Army-less lords are always safe (already invisible/unattackable per the
// existing army-less rule) and go straight to gathering intel. A lord
// scouting WITH an army risks an ambush: if an enemy lord on that exact tile
// is in 'ambush' or 'raid' stance, roll _visibilityScore (the same formula
// used everywhere else for "can this army be seen") as the detection chance.
// If detected, the ambusher becomes the attacker in a full _resolveCore
// fight and the scout gets NO intel regardless of outcome — getting caught
// replaces the scouting result, it never stacks with it.
async function _clearScoutPending(admin, playerId, lords, lordId) {
  if (!lords[lordId]) return;
  lords[lordId].pendingScoutResolve = null;
  await admin.from('storage').upsert(
    { player_id: playerId, key: 'lords', value: lords },
    { onConflict: 'player_id,key' }
  );
}

export async function resolveScout(admin, playerId, lordId, tileX, tileY, knownTiers = {}) {
  const { data: rows, error } = await admin.from('storage')
    .select('key, value').eq('player_id', playerId).in('key', ['lords', 'armies']);
  if (error) return { ok: false, error: 'Failed to load scout data: ' + error.message };

  const data   = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
  const lords  = data.lords  || {};
  const armies = data.armies || {};
  const lord   = lords[lordId];
  if (!lord) return { ok: false, error: 'Scouting lord not found' };
  if (lord.x !== tileX || lord.y !== tileY) {
    return { ok: false, error: 'Lord is no longer at the scouted tile' };
  }

  const armyUnits = (armies[lordId]?.units) || [];

  // No army → always safe, no ambush check at all.
  if (_armyTotal(armyUnits) <= 0) {
    const discoveries = await _gatherTileIntel(admin, playerId, lord.classId, tileX, tileY, knownTiers);
    await _clearScoutPending(admin, playerId, lords, lordId);
    return { ok: true, outcome: 'intel', discoveries };
  }

  // Look for an enemy (never own-player) lord in ambush/raid stance on this
  // exact tile — same-tile only, no adjacent-tile interception.
  const { data: allLordRows } = await admin.from('storage')
    .select('player_id, value').eq('key', 'lords');
  const now = Date.now();
  let ambusher = null;
  for (const row of (allLordRows || [])) {
    if (row.player_id === playerId) continue;
    const hit = Object.values(row.value || {}).find(l =>
      l.x === tileX && l.y === tileY &&
      !(l.downtimeUntil && now < l.downtimeUntil) &&
      (l.stance?.id === 'ambush' || l.stance?.id === 'raid') &&
      !(l.stance?.finishAt && now >= l.stance.finishAt)
    );
    if (hit) { ambusher = { playerId: row.player_id, lord: hit }; break; }
  }

  if (ambusher && Math.random() * 100 < _visibilityScore(lord, armyUnits)) {
    // Caught — no intel, just the fight. The ambusher becomes the attacker;
    // _resolveCore picks the scout up automatically as a defender on that
    // tile via its existing "find all enemy lords here" scan — no
    // special-casing needed there.
    await _clearScoutPending(admin, playerId, lords, lordId);
    const result = await _resolveCore(admin, ambusher.playerId, ambusher.lord.id, tileX, tileY, { skipAttackerStanceGate: true });
    if (!result.ok) return result;
    return { ok: true, outcome: 'ambushed', report: result.report, terrain: result.terrain };
  }

  // Safe — no ambusher present, or the detection roll missed. Either way the
  // ambusher (if any) never learns a scout was even there.
  const discoveries = await _gatherTileIntel(admin, playerId, lord.classId, tileX, tileY, knownTiers);
  await _clearScoutPending(admin, playerId, lords, lordId);
  return { ok: true, outcome: 'intel', discoveries };
}

// ── POST /api/pvp/check-incoming ─────────────────────────────
//
// Called by the defender's overview screen every 30 s.
// Handles two cases:
//   A) attacker synced before defender: lord.pendingPvpAttack is set
//   B) attacker is still offline: expired attack-intent move in actionQueue,
//      catchUp never ran → lord position still at march start in Supabase.
//      We run catchUp for the attacker here so _resolveCore finds the
//      lord at the correct tile.
export async function checkIncomingAttacks(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try {
    authClient = _authClient();
    admin      = _adminClient();
  } catch (e) {
    return res.status(500).json({ error: 'Server misconfiguration: ' + e.message });
  }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;

  // Find this player's lord positions.
  const { data: defRow } = await admin.from('storage')
    .select('value').eq('player_id', callerId).eq('key', 'lords').maybeSingle();
  const defLords     = Object.values(defRow?.value || {});
  const defPositions = new Set(defLords.map(l => `${l.x},${l.y}`));

  if (defPositions.size === 0) return res.json({ ok: true, battles: [] });

  // Scan all lords for both types of pending attacks.
  const { data: allRows, error: scanErr } = await admin.from('storage')
    .select('player_id, value').eq('key', 'lords');
  if (scanErr) return res.status(500).json({ error: 'Failed to scan lords' });

  const nowMs   = Date.now();
  const pending = [];
  for (const row of (allRows || [])) {
    if (row.player_id === callerId) continue;
    Object.values(row.value || {}).forEach(lord => {
      // Case A: attacker already synced, pendingPvpAttack flag is set
      if (lord.pendingPvpAttack) {
        const { tileX, tileY } = lord.pendingPvpAttack;
        if (defPositions.has(`${tileX},${tileY}`)) {
          pending.push({ attackerPlayerId: row.player_id, attackerLordId: lord.id, tileX, tileY });
        }
        return;
      }
      // Case B: attacker is offline, catchUp never ran — march is expired in actionQueue
      const expiredAttack = (lord.actionQueue || []).find(
        a => a.intent === 'attack' && a.finishAt != null && a.finishAt <= nowMs
      );
      if (expiredAttack && defPositions.has(`${expiredAttack.destX},${expiredAttack.destY}`)) {
        pending.push({
          attackerPlayerId: row.player_id,
          attackerLordId:   lord.id,
          tileX:            expiredAttack.destX,
          tileY:            expiredAttack.destY,
          needsCatchUp:     true,
        });
      }
    });
  }

  if (pending.length === 0) return res.json({ ok: true, battles: [] });

  const battles = [];
  for (const { attackerPlayerId, attackerLordId, tileX, tileY, needsCatchUp } of pending) {
    // Case B: run catchUp for the offline attacker so their lord position is
    // updated in Supabase before _resolveCore reads it.
    if (needsCatchUp) {
      try {
        const { data: atkRows } = await admin.from('storage')
          .select('key, value')
          .eq('player_id', attackerPlayerId)
          .in('key', ['lords', 'armies', 'cities', 'players']);
        if (atkRows?.length) {
          const raw    = Object.fromEntries(atkRows.map(r => [r.key, r.value]));
          const player = (raw.players || {})[attackerPlayerId];
          if (player) {
            // No engine param — quest resolution not needed; position update is enough
            const cuResult = catchUp(
              { player, lords: raw.lords || {}, cities: raw.cities || {}, armies: raw.armies || {} },
              nowMs
            );
            if (cuResult.changed) {
              const updatedPlayers = { ...(raw.players || {}), [attackerPlayerId]: cuResult.player };
              await Promise.all([
                admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'lords',   value: cuResult.lords   }, { onConflict: 'player_id,key' }),
                admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'armies',  value: cuResult.armies  }, { onConflict: 'player_id,key' }),
                admin.from('storage').upsert({ player_id: attackerPlayerId, key: 'players', value: updatedPlayers   }, { onConflict: 'player_id,key' }),
              ]);
            }
          }
        }
      } catch (e) {
        console.warn('[check-incoming] catchUp for offline attacker failed:', e.message);
        continue;
      }
    }

    const result = await _resolveCore(admin, attackerPlayerId, attackerLordId, tileX, tileY);
    if (result.ok && result.report) {
      battles.push({
        report:  result.report,
        terrain: result.terrain,
        outcome: result.report.winner === 'defender' ? 'victory'
               : result.report.winner === 'draw'     ? 'draw'
               : 'defeat',
      });
    }
  }

  return res.json({ ok: true, battles });
}
