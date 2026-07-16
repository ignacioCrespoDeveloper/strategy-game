// =============================================
//  catch-up.js — Offline progression engine
//
//  Pure ES module. Zero imports. Works identically
//  in Node.js (≥ 16 with "type":"module") and Deno.
//
//  Takes a player's state snapshot + current timestamp,
//  returns the updated state with all time-based
//  progressions applied as if the player had been
//  online the whole time.
//
//  Covered systems:
//    ✓ Lord downtime expiry (post-battle recovery)
//    ✓ Lord HP regeneration (2%/min up to maxHp)
//    ✓ Lord action queue completions (move + search)
//    ✓ Building construction completions
//    ✓ Unit recruitment completions (adds to army)
//    ✓ Resource production (food/wood/stone/iron)
//    ✓ Population growth
//    ✓ Gold income + upkeep deduction
// =============================================

// ── Lord constants ────────────────────────────────────────────

const _LORD_BASE_HP = 100;

const _LORD_CLASS_HP_MOD = {
  warrior: 0, rogue: 0, priest: 0, mage: 0, dark_lord: 0,
};

// Buildings that set city.landmark on completion (isLandmark: true in buildings.js)
const _LANDMARK_IDS = new Set([
  'imperial_palace', 'sacred_grove', 'grand_forge',
  'great_war_camp', 'slave_market', 'blood_citadel', 'dragon_lair',
]);

// ── Phase 1b: Building production & economic constants ────────

// Mirrors buildings.js _scale()
function _scale(base, factor, level) {
  return Math.floor(base * Math.pow(factor, level - 1));
}

// Resource output per hour at building level l.
// Matches each building's production(level) in buildings.js.
const _BUILDING_PRODUCTION = {
  farm:           l => ({ food:  _scale(30,  1.3,  l) }),
  granary:        l => ({ food:  _scale(15,  1.25, l) }),
  lumber_mill:    l => ({ wood:  _scale(25,  1.3,  l) }),
  stone_quarry:   l => ({ stone: _scale(20,  1.3,  l) }),
  iron_mine:      l => ({ iron:  _scale(15,  1.3,  l) }),
  blacksmith:     l => ({ iron:  _scale(12,  1.25, l) }),
  sacred_grove:   l => ({ food:  40 * l }),
  grand_forge:    l => ({ iron:  80 * l }),
  great_war_camp: l => ({ food:  60 * l }),
  slave_market:   l => ({ food:  30 * l, iron: 30 * l }),
};

// Stat effects per building level → [[statName, value], ...].
// Matches each building's effects(level) in buildings.js.
const _BUILDING_EFFECTS = {
  town_hall:            l => [['hygiene',6*l],['corruption',-4*l],['culture',3*l],['stability',3*l]],
  aqueduct:             l => [['hygiene',8*l],['happiness',2*l]],
  sewers:               l => [['hygiene',14*l]],
  library:              l => [['culture',8*l],['stability',2*l]],
  courthouse:           l => [['corruption',-5*l],['stability',4*l]],
  temple:               l => [['religion',12*l],['happiness',5*l],['corruption',-3*l],['hygiene',2*l]],
  farm:                 l => [['happiness',4*l],['unemployment',-5*l]],
  granary:              l => [['happiness',3*l],['stability',4*l]],
  lumber_mill:          l => [['unemployment',-4*l],['hygiene',-2*l]],
  stone_quarry:         l => [['unemployment',-4*l],['happiness',-1*l]],
  iron_mine:            l => [['unemployment',-4*l],['hygiene',-5*l],['happiness',-2*l]],
  warehouse:            l => [['unemployment',-2*l]],
  blacksmith:           l => [['unemployment',-4*l]],
  tavern:               l => [['happiness',5*l],['culture',3*l],['unemployment',-3*l],['corruption',2*l]],
  marketplace:          l => [['unemployment',-5*l],['corruption',6*l],['happiness',4*l],['culture',4*l]],
  barracks:             l => [['unemployment',-6*l],['happiness',-3*l],['religion',-2*l],['security',5*l]],
  watchtower:           l => [['security',10*l],['stability',2*l]],
  archery_range:        l => [['security',3*l],['unemployment',-4*l]],
  stables:              l => [['security',4*l],['unemployment',-3*l]],
  monster_pit:          l => [['security',8*l],['happiness',-5*l]],
  guard_post:           l => [['security',4*l],['unemployment',-3*l]],
  fortress:             l => [['security',8*l],['stability',4*l],['happiness',-2*l]],
  gunpowder_workshop:   l => [['security',3*l],['culture',2*l],['happiness',-1*l]],
  engineering_guild:    l => [['security',6*l],['culture',4*l],['stability',3*l]],
  engineering_workshop: l => [['security',4*l],['culture',3*l],['stability',2*l]],
  slayer_lodge:         l => [['security',5*l],['stability',3*l],['happiness',-2*l]],
  eagle_tower:          l => [['security',8*l],['culture',4*l]],
  goblin_camp:          l => [['security',3*l],['happiness',-2*l]],
  boar_pens:            l => [['security',5*l]],
  monster_den:          l => [['security',10*l],['happiness',-5*l]],
  siege_workshop:       l => [['security',6*l]],
  dragon_lair:          l => [['security',15*l],['happiness',-8*l]],
  imperial_palace:      l => [['happiness',8*l],['stability',10*l],['culture',6*l],['corruption',-5*l]],
  sacred_grove:         l => [['culture',10*l],['happiness',7*l],['hygiene',6*l],['religion',5*l]],
  grand_forge:          l => [['unemployment',-8*l],['stability',8*l],['hygiene',-4*l]],
  great_war_camp:       l => [['unemployment',-15*l],['security',10*l],['stability',5*l],['happiness',-3*l]],
  slave_market:         l => [['unemployment',-12*l],['corruption',8*l],['happiness',-5*l],['stability',-4*l]],
  blood_citadel:        l => [['stability',12*l],['security',8*l],['religion',-8*l],['happiness',-5*l],['corruption',-4*l]],
};

// Race resource production multipliers (from races.js bonuses).
const _RACE_BONUSES = {
  human:    { food: 0.05, wood: 0.05, stone: 0.05, iron: 0.05 },
  dwarf:    { food: 0.00, wood: 0.00, stone: 0.30, iron: 0.30 },
  orc:      { food: 0.20, wood: 0.00, stone: 0.00, iron: 0.00 },
  high_elf: { food: 0.15, wood: 0.10, stone: 0.00, iron: 0.00 },
  dark_elf: { food: 0.00, wood: 0.20, stone: 0.00, iron: 0.30 },
};

// Unit upkeep gold/hour per unit. Mirrors units.js upkeep field.
const _UNIT_UPKEEP = {
  dreadspears:1, bleakswords:1, darkshards:1, witch_elves:1, dark_riders:1,
  war_hydra:7, black_dragon:24,
  dwarf_warriors:1, longbeards:1, thunderers:1, ironbreakers:3, slayers:1,
  dwarf_cannon:3, gyrocopter:2,
  spearmen:1, swordsmen:1, handgunners:1, empire_knights:1, greatswords:2,
  steam_tank:11, great_cannon:3,
  he_spearmen:1, archers:1, silver_helms:2, swordmasters_of_hoeth:2,
  phoenix_guard:2, eagle_claw_bolt_thrower:2, star_dragon:20,
  orc_boyz:1, orc_goblin_archers:1, boar_boyz:2, black_orcs:2, trolls:3,
  rock_lobber:2, arachnarok_spider:13,
  bandits:3, bandit_archers:4,
  goblin_spearmen:2, pikemen:4, crossbowmen:4,
  ogre_bulls:12, ironguts:18,
  goblin_rabble:0, goblin_archers:2, goblin_wolf_riders:5,
  mercenary_spearmen:0, mercenary_crossbows:0,
  forest_troll:0, ogre_warrior:0, ogre_champion:0,
  dragon_guard:0, young_dragon:0,
  city_guard:0, militia_archer:0, garrison_soldier:0,
};

// ── Phase 1b helpers ──────────────────────────────────────────

const _STAT_BASE = {
  corruption: 0, happiness: 50, hygiene: 50,
  unemployment: 15, religion: 50, culture: 50,
  stability: 50, security: 20,
};

function _clampStat(v) { return Math.max(0, Math.min(100, Math.round(v))); }

// Mirrors CityStatsService.getStats() — no active-event modifiers (server side).
function _getStats(buildings, population) {
  const s = { ..._STAT_BASE };
  for (const [id, lvl] of Object.entries(buildings || {})) {
    if (!lvl || lvl <= 0) continue;
    const efn = _BUILDING_EFFECTS[id];
    if (!efn) continue;
    for (const [stat, value] of efn(lvl)) s[stat] = (s[stat] || 0) + value;
  }
  const pop = population || 1000;
  if (pop > 1000) {
    s.hygiene      -= Math.floor((pop - 1000) / 2000);
    s.unemployment += Math.floor((pop - 1000) / 5000);
  }
  for (const k of Object.keys(s)) s[k] = _clampStat(s[k]);
  if (s.corruption   > 20) s.happiness  -= Math.floor((s.corruption   - 20) * 0.4);
  if (s.culture      > 50) s.happiness  += Math.floor((s.culture      - 50) * 0.2);
  if (s.religion     > 60) s.corruption -= Math.floor((s.religion     - 60) * 0.2);
  if (s.unemployment > 20) s.happiness  -= Math.floor((s.unemployment - 20) * 0.3);
  for (const k of Object.keys(s)) s[k] = _clampStat(s[k]);
  return s;
}

// Mirrors ProductionService.getRates().
function _getRates(buildings, raceId) {
  const t = { food: 0, wood: 0, stone: 0, iron: 0 };
  for (const [id, lvl] of Object.entries(buildings || {})) {
    if (!lvl || lvl <= 0) continue;
    const pfn = _BUILDING_PRODUCTION[id];
    if (!pfn) continue;
    for (const [res, amt] of Object.entries(pfn(lvl))) t[res] = (t[res] || 0) + amt;
  }
  const b = _RACE_BONUSES[raceId] || {};
  t.food  = Math.floor(t.food  * (1 + (b.food  || 0)));
  t.wood  = Math.floor(t.wood  * (1 + (b.wood  || 0)));
  t.stone = Math.floor(t.stone * (1 + (b.stone || 0)));
  t.iron  = Math.floor(t.iron  * (1 + (b.iron  || 0)));
  return t;
}

// Mirrors ProductionService.getGoldRate().
function _getGoldRate(city) {
  const stats     = _getStats(city.buildings || {}, city.population || 1000);
  const happiness = Math.max(0, stats.happiness);
  const pop       = city.population || 1000;
  let   rate      = pop * 0.013 * (happiness / 100);
  const mkLevel   = (city.buildings || {}).marketplace || 0;
  if (mkLevel > 0) rate *= (1 + 0.08 * mkLevel);
  return Math.floor(rate);
}

// Mirrors CityStatsService.getPopulationGrowthRate().
function _getPopGrowthRate(city, stats, rates) {
  let pct = 0;

  if      (stats.happiness >= 70) pct += 0.30;
  else if (stats.happiness >= 50) pct += 0.15;
  else if (stats.happiness >= 35) pct += 0.05;
  else if (stats.happiness <  20) pct -= 0.20;
  else                             pct -= 0.08;

  if      (stats.hygiene >= 60) pct += 0.15;
  else if (stats.hygiene <  25) pct -= 0.10;
  else if (stats.hygiene <  10) pct -= 0.25;

  const food = rates.food || 0;
  if (food > 0)  pct += 0.08;
  else           pct -= 0.05;

  // Count stats in Warning or Critical
  const warnings = Object.keys(stats).filter(k => {
    const goodHigh = ['happiness','hygiene','religion','culture','stability','security'].includes(k);
    const val = goodHigh ? stats[k] : (100 - stats[k]);
    return val < 45;
  }).length;
  if (warnings >= 3) pct -= 0.10;
  if (warnings >= 5) pct -= 0.20;

  pct = Math.max(-0.50, Math.min(0.55, pct));
  return Math.round(pct * 1130);
}

// Degrades buildings randomly when usedSlots > maxSlots (after a tier-downgrade).
function _degradeExcessBuildings(city) {
  const usedSlots = Object.values(city.buildings || {}).reduce((s, v) => s + v, 0);
  const pop = city.population || 1000;
  const maxSlots =
    pop >= 100000 ? 320 :
    pop >= 50000  ? 220 :
    pop >= 25000  ? 150 :
    pop >= 10000  ? 100 : 60;

  let excess = usedSlots - maxSlots;
  if (excess <= 0) return false;

  const entries = Object.entries(city.buildings || {}).filter(([, v]) => v > 0);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  for (const [id, lvl] of entries) {
    if (excess <= 0) break;
    const degrade = Math.min(lvl, excess);
    city.buildings[id] = lvl - degrade;
    if (city.buildings[id] <= 0) delete city.buildings[id];
    excess -= degrade;
  }
  return true;
}

// ── Lord helper ───────────────────────────────────────────────

function _maxHp(lord) {
  const baseHp   = (lord.baseStats?.health) ?? _LORD_BASE_HP;
  const classMod = _LORD_CLASS_HP_MOD[lord.classId] ?? 0;
  return baseHp + classMod;
}

// ── Server-side quest resolution helpers ──────────────────────
// Used when engine data is passed into catchUp().
// Mirrors client-side logic in discovery.js / lord.js — kept here
// so search_area rewards are applied even when the browser is closed.

// Deterministic terrain — mirrors WorldService.getTerrain(). No storage needed.
function _getTerrain(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  const keys = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
  return keys[h % keys.length];
}

// XP threshold for the next level. Mirrors lord.js xpToNext formula.
function _xpToNextLevel(level) { return 50 * (2 * level + 1); }

// Apply pending level-ups after an XP gain. Mirrors lord.js checkLevelUp().
function _checkLevelUp(lord, engine) {
  const cls     = engine?.LORD_CLASSES?.[lord.classId];
  const clsKeys = new Set(Object.keys(cls?.modifiers || {}));
  while ((lord.xp || 0) >= (lord.xpToNext || _xpToNextLevel(lord.level || 1))) {
    lord.xp           = Math.max(0, (lord.xp || 0) - (lord.xpToNext || _xpToNextLevel(lord.level || 1)));
    lord.level        = (lord.level || 1) + 1;
    lord.xpToNext     = _xpToNextLevel(lord.level);
    lord.talentPoints = (lord.talentPoints || 0) + 1;
    const baseStats   = engine?.LORD_BASE_STATS;
    if (baseStats && lord.baseStats) {
      for (const key of Object.keys(baseStats)) {
        lord.baseStats[key] = (lord.baseStats[key] ?? baseStats[key]) + (clsKeys.has(key) ? 2 : 1);
      }
    }
  }
}

// Army combat power from the armies map — mirrors _armyPower() in lord-screen.js.
function _armyPower(armies, lordId, UNIT_DEFS) {
  const army = armies?.[lordId];
  if (!army?.units || !UNIT_DEFS) return 0;
  return army.units.reduce((sum, u) => {
    const d = UNIT_DEFS[u.unitId];
    if (!d) return sum;
    const s = d.combatStats || {};
    return sum + ((s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0)) * (u.count || 0);
  }, 0);
}

// Weighted random roll over DISCOVERY_DEFS. Mirrors DiscoveryService._roll().
const _GOLD_DISC_IDS = new Set(['coin_cache','lost_treasure','buried_vault','merchant_caravan','traveling_merchant','ancient_relic','bog_crystal']);
function _rollDef(DISCOVERY_DEFS, terrainId, goldBonus) {
  const entries = Object.values(DISCOVERY_DEFS).map(def => {
    const mults  = def.terrainMultipliers || {};
    const mult   = (terrainId in mults) ? mults[terrainId] : 1.0;
    let   weight = def.baseWeight * mult;
    if (goldBonus && _GOLD_DISC_IDS.has(def.id)) weight *= (1 + goldBonus);
    return { def, weight };
  }).filter(e => e.weight > 0);
  let total = 0;
  entries.forEach(e => total += e.weight);
  let rand = Math.random() * total;
  for (const e of entries) { rand -= e.weight; if (rand <= 0) return e.def; }
  return entries[entries.length - 1].def;
}

// Camp difficulty roll. Mirrors DiscoveryService._rollCampLevel/_rollCampDetails().
function _rollCampDetails(CAMP_DEFS, defId, armyPower) {
  const campDef = CAMP_DEFS?.[defId];
  if (!campDef) return null;
  const [minL, maxL] = campDef.levelRange;
  const base  = armyPower < 100 ? 1 : armyPower < 300 ? 2 : armyPower < 700 ? 3 : armyPower < 1400 ? 4 : 5;
  const level = Math.max(minL, Math.min(maxL, base + Math.floor(Math.random() * 3) - 1));
  const defenders = campDef.defenderRosterByLevel?.[level] || campDef.defenderRosterByLevel?.[minL] || [{ unitId: 'bandits', count: 2 }];
  return { level, type: defId, defenders };
}

// Loot roll for non-combat discoveries. Mirrors DiscoveryService._rollRewards().
const _DISC_BASE_REWARDS = {
  iron_vein: { iron: 1, xp: 15 }, cliff_face: { stone: 1, xp: 15 },
  fertile_fields: { food: 1, xp: 15 }, river_crossing: { food: 1, xp: 15 },
  coin_cache: { gold: 1, xp: 15 }, timber_cache: { wood: 1, xp: 30 },
  abandoned_mine: { iron: 1, xp: 40 }, stone_deposit: { stone: 1, xp: 30 },
  wild_game: { food: 1, xp: 20 }, lost_treasure: { gold: 1, xp: 60 },
  ancient_forest: { wood: 1, xp: 70 }, deep_ore_shaft: { iron: 1, xp: 80 },
  marble_quarry: { stone: 1, xp: 80 }, bountiful_hunt: { food: 1, xp: 60 },
  buried_vault: { gold: 1, xp: 100 }, ancient_ruins: { xp: 80 },
  abandoned_keep: { gold: 1, xp: 50 }, wandering_sage: { xp: 100 },
  merchant_caravan: { gold: 1, xp: 20 }, traveling_merchant: { gold: 1, xp: 20 },
  ancient_relic: { gold: 1, xp: 160 }, bog_crystal: { gold: 1, xp: 120 },
};
const _DISC_TIER_RANGES = {
  1: { res: [20, 60],   gold: [30, 80]   },
  2: { res: [40, 120],  gold: [50, 150]  },
  3: { res: [100, 250], gold: [150, 400] },
};
function _rollDiscRewards(def, lordLevel) {
  if (def.category === 'combat') return [];
  const level  = Math.max(1, lordLevel || 1);
  const scalar = 1 + 0.12 * (level - 1);
  const tier   = def.tier || 2;
  const ranges = _DISC_TIER_RANGES[tier] || _DISC_TIER_RANGES[2];
  const base   = _DISC_BASE_REWARDS[def.id];
  const rewards = [];
  if (base) {
    ['gold','food','wood','stone','iron'].forEach(t => {
      if (!base[t]) return;
      const [min, max] = t === 'gold'
        ? (def.id === 'lost_treasure' ? [80, 200] : ranges.gold)
        : ranges.res;
      rewards.push({ type: t, amount: Math.floor((min + Math.random() * (max - min + 1)) * scalar) });
    });
    if (base.xp > 0) rewards.push({ type: 'xp', amount: base.xp });
  } else {
    rewards.push({ type: 'xp', amount: 20 });
  }
  return rewards;
}

// Full search_area resolution. Returns a pending discovery object to be stored on the lord
// and drained by the client (online) or the sync endpoint (offline).
const _SEARCH_AREA_XP = 8; // mirrors LORD_ACTIONS.search_area.xpReward in lord.js
function _resolveSearchArea(lord, armies, nowMs, engine) {
  if (lord.x == null || lord.y == null) return null;
  const { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, UNIT_DEFS } = engine;

  const terrainId     = _getTerrain(lord.x, lord.y);
  const talentEffects = (TALENT_POOL && lord.talentId) ? (TALENT_POOL[lord.talentId]?.effects || {}) : {};
  const def           = _rollDef(DISCOVERY_DEFS, terrainId, talentEffects.goldDiscoveryBonus || 0);

  if (def.category === 'nothing') {
    return { defId: def.id, category: 'nothing', record: null, rewards: [] };
  }

  const record = {
    id:           'disc_' + nowMs + '_' + Math.floor(Math.random() * 100000),
    definitionId: def.id,
    tileX:        lord.x,
    tileY:        lord.y,
    terrain:      terrainId,
    lordId:       lord.id,
    discoveredAt: nowMs,
    expiresAt:    def.baseDuration > 0 ? nowMs + def.baseDuration * 1000 : null,
  };

  if (def.category === 'combat') {
    const ap = _armyPower(armies, lord.id, UNIT_DEFS);
    record.campDetails = _rollCampDetails(CAMP_DEFS, def.id, ap);
    return { defId: def.id, category: def.category, record, rewards: [] };
  }

  const rewards = _rollDiscRewards(def, lord.level);
  return { defId: def.id, category: def.category, record, rewards };
}

// ── Main entry point ──────────────────────────────────────────

/**
 * Apply all time-based game progressions accumulated
 * since each entity's last-updated timestamp.
 *
 * @param {{ lords, cities, armies, player }} state
 * @param {number} nowMs    Server timestamp in milliseconds
 * @param {object} [engine] Optional engine data for server-side quest resolution.
 *   When provided, completed search_area actions apply XP + roll a discovery and
 *   store the result in lord.pendingDiscoveries[] for the client to drain.
 *   Shape: { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS }
 * @returns {{ lords, cities, armies, player, events, changed }}
 */
export function catchUp(state, nowMs, engine = null) {
  // Deep-copy — never mutate the caller's objects
  const lords  = JSON.parse(JSON.stringify(state.lords  || {}));
  const cities = JSON.parse(JSON.stringify(state.cities || {}));
  const armies = JSON.parse(JSON.stringify(state.armies || {}));
  const player = JSON.parse(JSON.stringify(state.player || {}));
  const events = [];
  let   changed = false;

  // ── 1. Lord ticks ───────────────────────────────────────────

  for (const lord of Object.values(lords)) {
    if (!lord?.id) continue;

    // 1a. Clear expired downtime
    if (lord.downtimeUntil && nowMs >= lord.downtimeUntil) {
      lord.downtimeUntil  = null;
      lord.downtimeReason = null;
      lord.currentHp      = 1;
      lord.hpRegenAt      = nowMs;
      events.push({ type: 'lord_recovered', lordId: lord.id, lordName: lord.name || '' });
      changed = true;
    }

    if (lord.downtimeUntil && nowMs < lord.downtimeUntil) continue;

    // 1b. HP regeneration — 2% of maxHp per minute
    const maxHp = _maxHp(lord);
    const curHp = lord.currentHp ?? maxHp;
    if (curHp < maxHp) {
      const from        = lord.hpRegenAt || nowMs;
      const elapsedMins = (nowMs - from) / 60_000;
      if (elapsedMins > 0) {
        lord.currentHp = Math.min(maxHp, Math.round(curHp + maxHp * 0.02 * elapsedMins));
        lord.hpRegenAt = nowMs;
        changed = true;
      }
    }

    // 1c. Action queue
    const queue = lord.actionQueue || [];
    let queueChanged = false;
    while (queue.length > 0 && nowMs >= queue[0].finishAt) {
      const done = queue.shift();
      queueChanged = changed = true;
      if (done.destX != null) { lord.x = done.destX; lord.y = done.destY; }

      // search_area: resolve XP + discovery server-side when engine data is available.
      // This ensures rewards are applied even when the browser was closed during the quest.
      if (done.actionId === 'search_area' && engine) {
        const talentEffects = (engine.TALENT_POOL && lord.talentId)
          ? (engine.TALENT_POOL[lord.talentId]?.effects || {}) : {};
        const xpMult = talentEffects.xpMultiplier || 1;
        lord.xp = (lord.xp || 0) + Math.round(_SEARCH_AREA_XP * xpMult);

        const pending = _resolveSearchArea(lord, armies, nowMs, engine);
        if (pending) {
          // Apply gold / resource rewards to player immediately.
          for (const r of (pending.rewards || [])) {
            if      (r.type === 'gold') player.coins = Math.floor((player.coins || 0) + r.amount);
            else if (r.type === 'xp')  lord.xp = (lord.xp || 0) + r.amount;
            else if (['food','wood','stone','iron'].includes(r.type)) {
              player.resources = player.resources || {};
              player.resources[r.type] = Math.floor((player.resources[r.type] || 0) + r.amount);
            }
          }
          _checkLevelUp(lord, engine);
          lord.pendingDiscoveries = lord.pendingDiscoveries || [];
          lord.pendingDiscoveries.push(pending);
        }
      }

      // attack-intent move: flag for deferred PvP resolution.
      // The battle fires once the updated position is saved to Supabase (sync or check-incoming).
      if (done.intent === 'attack' && done.destX != null) {
        lord.pendingPvpAttack = { tileX: done.destX, tileY: done.destY };
      }

      events.push({
        type: 'lord_action_done', lordId: lord.id, lordName: lord.name || '',
        actionId: done.actionId || 'move_lord',
        destX: done.destX ?? null, destY: done.destY ?? null, intent: done.intent ?? null,
      });
    }
    if (queueChanged) lord.actionQueue = queue;
  }

  // ── 2. City queue ticks ─────────────────────────────────────

  for (const city of Object.values(cities)) {
    if (!city?.id) continue;

    // 2a. Construction queue
    const doneBuildings = [];
    city.constructionQueue = (city.constructionQueue || []).filter(item => {
      if (nowMs < item.finishAt) return true;
      city.buildings = city.buildings || {};
      city.buildings[item.buildingId] = item.targetLevel;
      if (_LANDMARK_IDS.has(item.buildingId)) city.landmark = item.buildingId;
      doneBuildings.push(item.buildingId);
      return false;
    });
    if (doneBuildings.length > 0) {
      changed = true;
      doneBuildings.forEach(bid => events.push({
        type: 'building_completed', cityId: city.id, cityName: city.name || '', buildingId: bid,
      }));
    }

    // 2b. Recruitment queue
    const doneRecruits = [];
    city.recruitmentQueue = (city.recruitmentQueue || []).filter(item => {
      if (nowMs < item.finishAt) return true;
      if (item.lordId) {
        if (!armies[item.lordId]) armies[item.lordId] = { lordId: item.lordId, units: [] };
        const army     = armies[item.lordId];
        const existing = army.units.find(u => u.unitId === item.unitId);
        if (existing) existing.count += item.count;
        else army.units.push({ unitId: item.unitId, count: item.count });
      }
      doneRecruits.push({ unitId: item.unitId, count: item.count, lordId: item.lordId });
      return false;
    });
    if (doneRecruits.length > 0) {
      changed = true;
      doneRecruits.forEach(r => events.push({
        type: 'recruitment_completed', cityId: city.id, cityName: city.name || '',
        unitId: r.unitId, count: r.count, lordId: r.lordId,
      }));
    }
  }

  // ── 3. Resource production, population & economy ─────────────

  // One-time migration: seed rankingStats for existing players
  if (!player.rankingStats) {
    player.rankingStats = { pvpWins: 0, conquests: 0 };
    changed = true;
  }

  // One-time migration: seed player.resources from existing city stockpiles
  if (!player.resources) {
    player.resources = { food: 0, wood: 0, stone: 0, iron: 0 };
    for (const c of Object.values(cities)) {
      if (!c?.id) continue;
      for (const k of ['food','wood','stone','iron']) {
        player.resources[k] = (player.resources[k] || 0) + Math.floor(c.resources?.[k] || 0);
      }
    }
  }

  const mainLord = lords[player.lordId];
  const raceId   = mainLord?.race || null;
  let   totalGoldEarned = 0;

  const MAX_ELAPSED_H = 720; // cap at 30 days to avoid runaway catch-up

  for (const city of Object.values(cities)) {
    if (!city?.id) continue;

    const lastUpdate = city.lastResourceUpdate;
    if (!lastUpdate || lastUpdate >= nowMs) continue;

    const elapsedH = Math.min((nowMs - lastUpdate) / 3_600_000, MAX_ELAPSED_H);
    if (elapsedH <= 0) continue;

    // Resource production → empire-wide player.resources pool
    const rates = _getRates(city.buildings || {}, raceId);
    for (const [res, perHour] of Object.entries(rates)) {
      if (perHour > 0) player.resources[res] = (player.resources[res] || 0) + perHour * elapsedH;
    }

    // Gold income (accumulated, applied to player after all cities)
    totalGoldEarned += _getGoldRate(city) * elapsedH;

    // Population growth
    const stats   = _getStats(city.buildings || {}, city.population || 1000);
    const popRate = _getPopGrowthRate(city, stats, rates);
    if (popRate !== 0) {
      city.population = Math.max(1, Math.round((city.population || 1000) + popRate * elapsedH));
    }
    _degradeExcessBuildings(city);

    // freePopulation: +5/day ≈ 0.2083/h, cap 20
    city.freePopulation = Math.min(20, (city.freePopulation ?? 3) + (5 / 24) * elapsedH);

    city.lastResourceUpdate   = nowMs;
    city.lastPopulationUpdate = nowMs;
    changed = true;
  }

  // Gold income + upkeep — net once per player across all cities
  const lastUpkeepAt   = player.lastUpkeepAt;
  const upkeepElapsedH = lastUpkeepAt
    ? Math.min((nowMs - lastUpkeepAt) / 3_600_000, MAX_ELAPSED_H)
    : 0;

  if (totalGoldEarned > 0 || upkeepElapsedH > 0) {
    let upkeepPerHour = 0;
    if (upkeepElapsedH > 0) {
      for (const lord of Object.values(lords)) {
        if (!lord?.id) continue;
        upkeepPerHour += 5 + (lord.level || 1);
      }
      for (const army of Object.values(armies)) {
        for (const stack of (army?.units || [])) {
          upkeepPerHour += (_UNIT_UPKEEP[stack.unitId] || 0) * stack.count;
        }
      }
    }
    const upkeepCost = upkeepPerHour * upkeepElapsedH;
    player.coins = Math.max(0, Math.floor((player.coins || 0) + totalGoldEarned - upkeepCost));
    if (upkeepElapsedH > 0) player.lastUpkeepAt = nowMs;
    changed = true;
  }

  return { lords, cities, armies, player, events, changed };
}
