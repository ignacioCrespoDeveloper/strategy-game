// =============================================
//  economy-core.js — Pure, isomorphic economy math
//
//  THE single source of truth for resource rates, city stats,
//  gold rate, population growth and building slots. No service
//  dependencies — only plain data in, plain data out, plus the
//  BUILDING_DEFS global.
//
//  There is NO water/energy production factor and never was one in
//  code — production is building output × race bonus × terrain
//  multiplier, full stop (see ECONOMY-OVERHAUL.md §0, Nacho's call
//  on 2026-07-26). Water became the `hygiene` city stat, which
//  affects population growth only. scripts/test-economy.js asserts
//  the mechanic's absence; this header used to claim otherwise.
//
//  Loaded in the browser (index.html) AND on the server via
//  server/engine-loader.js — never duplicate these formulas.
//  server/tick/catch-up.js receives this module as engine.EconomyCore.
// =============================================

var EconomyCore = (() => {

  const RESOURCE_KEYS = ['food', 'wood', 'stone'];

  // Global tuning dials — see js/data/tuning.js, which is THE file to edit to
  // make the game faster or slower. Read through a local shim so economy-core
  // still works if tuning.js is missing (a stale cached index.html), in which
  // case every dial reads 1.0 and nothing changes.
  function _tune(key) {
    return (typeof tune === 'function') ? tune(key) : 1.0;
  }

  const STAT_BASE = {
    corruption:   0,
    happiness:    50,
    hygiene:      50,
    unemployment: 15,
    religion:     50,
    culture:      50,
    stability:    50,
    security:     20,
  };

  // Stats where a HIGH value is good (used for warning counting).
  const GOOD_HIGH = new Set(['happiness', 'hygiene', 'religion', 'culture', 'stability', 'security']);

  // ── Resource rates (per hour) ─────────────────────────────────
  // Plain building output × race bonus × terrain multiplier.
  // raceBonuses:  { food_production, wood_production, stone_production } (race.bonuses or {})
  //               — the caller SUMS race + research + blessing into these keys.
  // terrainMods:  { food, wood, stone } multipliers (TERRAIN_RESOURCE_MODS[terrainId] or {})
  //
  // The summed bonus is clamped. Every other multiplier path in this file is
  // bounded (getBuildTime/getRecruitTime/getMarchFoodCost all floor at 0.2) but
  // production was not, so an uncapped stack could scale output without limit.
  // Today's realistic ceiling is ~+55% (dwarf stone +30% + God of Nature +25%),
  // so +300% leaves generous headroom for future Library tomes while keeping the
  // multiplier finite. The floor stops a hypothetical penalty inverting output.
  const PRODUCTION_BONUS_MAX =  3.0;   // ×4 output
  const PRODUCTION_BONUS_MIN = -0.9;   // ×0.1 output

  function getRates(buildings, raceBonuses, terrainMods) {
    const totals = { food: 0, wood: 0, stone: 0 };
    for (const [id, lvl] of Object.entries(buildings || {})) {
      if (!lvl || lvl <= 0) continue;
      const def = BUILDING_DEFS[id];
      if (!def) continue;
      const prod = def.production(lvl);
      for (const [res, amt] of Object.entries(prod)) {
        if (totals[res] !== undefined) totals[res] += amt;
      }
    }

    const race = raceBonuses || {};
    const terr = terrainMods || {};
    const dial = _tune('buildingProduction');
    for (const res of RESOURCE_KEYS) {
      const bonus = Math.max(PRODUCTION_BONUS_MIN,
                    Math.min(PRODUCTION_BONUS_MAX, race[res + '_production'] || 0));
      totals[res] = Math.floor(
        totals[res]
        * (1 + bonus)
        * (terr[res] !== undefined ? terr[res] : 1)
        * dial
      );
    }
    return totals;
  }

  // ── City stats ────────────────────────────────────────────────
  // extraEffects: additional [{ stat, value }] modifiers (active events,
  // terrain stat mods) collected by the caller.

  function getStats(buildings, population, extraEffects) {
    const stats = { ...STAT_BASE };

    for (const [id, lvl] of Object.entries(buildings || {})) {
      if (!lvl || lvl <= 0) continue;
      const def = BUILDING_DEFS[id];
      if (!def || !def.effects) continue;
      for (const { stat, value } of def.effects(lvl)) {
        if (stats[stat] !== undefined) stats[stat] += value;
      }
    }

    for (const { stat, value } of (extraEffects || [])) {
      if (stats[stat] !== undefined) stats[stat] += value;
    }

    // Population pressure — larger populations demand more services
    const pop = population || 1000;
    if (pop > 1000) {
      stats.hygiene      -= Math.floor((pop - 1000) / 2000);
      stats.unemployment += Math.floor((pop - 1000) / 5000);
    }

    _clamp(stats);

    // Cross-stat influences (intentionally simple arithmetic)
    if (stats.corruption   > 20) stats.happiness  -= Math.floor((stats.corruption   - 20) * 0.4);
    if (stats.culture      > 50) stats.happiness  += Math.floor((stats.culture      - 50) * 0.2);
    if (stats.religion     > 60) stats.corruption -= Math.floor((stats.religion     - 60) * 0.2);
    if (stats.unemployment > 20) stats.happiness  -= Math.floor((stats.unemployment - 20) * 0.3);

    _clamp(stats);
    return stats;
  }

  function _clamp(stats) {
    Object.keys(stats).forEach(k => {
      stats[k] = Math.max(0, Math.min(100, Math.round(stats[k])));
    });
  }

  // ── Gold income per hour for one city ─────────────────────────
  // Base: pop × 0.004 × (happiness/100), +8% per marketplace level.
  // (0.013 → 0.004 in the 2026-07-26 review: gold was far too abundant.)

  function getGoldRate(buildings, population, happiness) {
    const pop  = population || 1000;
    let   rate = pop * 0.004 * (Math.max(0, happiness || 0) / 100);
    const mkLevel = (buildings || {}).marketplace || 0;
    if (mkLevel > 0) rate *= (1 + 0.08 * mkLevel);
    return Math.floor(rate * _tune('populationGold'));
  }

  // ── Library research effects ──────────────────────────────────
  // Sums every researched book's bonuses(level) into one flat-key object
  // ({ food_production, construction_speed, march_food_cost, … }) — the
  // same grammar as race bonuses, so callers can add the two together.
  // research: player.research = { bookId: level }

  function getResearchEffects(research) {
    const out = {};
    if (typeof RESEARCH_DEFS === 'undefined') return out;
    for (const [bookId, level] of Object.entries(research || {})) {
      const def = RESEARCH_DEFS[bookId];
      if (!def || !level) continue;
      // Every book today carries bonuses, but a book that only UNLOCKED
      // something (the Library's stated third job) would legitimately have
      // none. Without this guard that book throws a TypeError here — i.e.
      // on every economy calculation, client and server. Cheap insurance.
      if (typeof def.bonuses !== 'function') continue;
      for (const [key, value] of Object.entries(def.bonuses(level))) {
        out[key] = (out[key] || 0) + value;
      }
    }
    return out;
  }

  // ── Temple blessing effects ───────────────────────────────────
  // Returns the flat-key effect object of the player's single active
  // blessing ({ battle_loot_bonus, raid_bonus, gold_income_bonus,
  // *_production, pop_growth_bonus }), or {} when none is active.
  //
  // `activeBlessing`: player.activeBlessing = { id, startedAt, finishAt }.
  // When `now` (ms) is provided, an expired blessing (now >= finishAt) is
  // treated as inactive — the server clears lapsed blessings in catch-up,
  // this keeps client displays honest in the gap before the next sync.
  // Callers that have already filtered expiry may omit `now`.
  function getBlessingEffects(activeBlessing, now) {
    const out = {};
    if (typeof BLESSING_DEFS === 'undefined') return out;
    if (!activeBlessing || !activeBlessing.id) return out;
    if (now != null && activeBlessing.finishAt && now >= activeBlessing.finishAt) return out;
    const def = BLESSING_DEFS[activeBlessing.id];
    if (!def) return out;
    return { ...(def.effects || {}) };
  }

  // ── Build / recruit time (race + research + building modifiers) ──
  // construction_speed / recruit_speed are % deltas, negative = faster
  // (floored at −80%). On top of that, buildings with buildTimeDivisor
  // DIVIDE the result, OGame Robotics/Nanite style: Town Hall Lv N = ÷(1+N),
  // and multiple divisor buildings multiply together.

  function getCityBuildDivisor(buildings) {
    let divisor = 1;
    for (const [id, lvl] of Object.entries(buildings || {})) {
      if (!lvl || lvl <= 0) continue;
      const def = BUILDING_DEFS[id];
      if (def?.buildTimeDivisor) divisor *= Math.max(1, def.buildTimeDivisor(lvl));
    }
    return divisor;
  }

  function getBuildTime(def, level, raceBonuses, researchEffects, cityBuildings) {
    const mult = Math.max(0.2,
      1 + ((raceBonuses || {}).construction_speed || 0)
        + ((researchEffects || {}).construction_speed || 0));
    return Math.max(5, Math.round(def.buildTime(level) * mult / getCityBuildDivisor(cityBuildings)));
  }

  // Where a unit trains: { buildingId, minLevel } from UNIT_ROSTER, or null
  // (mercenaries and garrison units have no training building).
  function getUnitTraining(raceId, unitId) {
    if (typeof UNIT_ROSTER === 'undefined') return null;
    const roster = UNIT_ROSTER[raceId];
    if (!roster) return null;
    for (const [buildingId, lvlMap] of Object.entries(roster)) {
      for (const [minLevel, ids] of Object.entries(lvlMap)) {
        if (ids.includes(unitId)) return { buildingId, minLevel: Number(minLevel) };
      }
    }
    return null;
  }

  // Recruit time — OGame-hangar rule: every level of the training building
  // ABOVE the unit's unlock level divides the time (÷1 at unlock, ÷2 one
  // level later, …). recruit_speed modifiers — Library books and an active
  // God of War blessing, summed by the caller — apply as a % on top.
  function getRecruitTime(unitDef, count, researchEffects, trainingLevel = 0, unlockLevel = 0) {
    const mult    = Math.max(0.2, 1 + ((researchEffects || {}).recruit_speed || 0));
    const divisor = 1 + Math.max(0, (trainingLevel || 0) - (unlockLevel || 0));
    return Math.max(1, Math.round(unitDef.recruitTime * count * mult / divisor));
  }

  // ── Veterancy (the OGame Weapons/Armour techs) ────────────────
  // Units fight with +2% attack and +2% defense per level of their
  // TRAINING building, SUMMED across ALL of the player's cities
  // (empire-wide and retroactive, like OGame research). Mercenaries have
  // no training building → no buff. Garrison units key off the DEFENDING
  // city's Guard Post + Fortress instead. PWR (the recruit cap) always
  // uses base stats — veterancy is combat-only power.

  const VETERANCY_PER_LEVEL = 0.02;

  // citiesBuildings: array of city.buildings objects for the player's cities.
  function getVeterancyPct(raceId, unitId, citiesBuildings) {
    const training = getUnitTraining(raceId, unitId);
    if (!training) return 0;
    let levels = 0;
    for (const buildings of (citiesBuildings || [])) {
      levels += (buildings?.[training.buildingId] || 0);
    }
    return VETERANCY_PER_LEVEL * levels;
  }

  // Garrison veterancy: the defending city's own defensive buildings.
  function getGarrisonVeterancyPct(cityBuildings) {
    const levels = (cityBuildings?.guard_post || 0) + (cityBuildings?.fortress || 0);
    return VETERANCY_PER_LEVEL * levels;
  }

  // ── Lord travel time ──────────────────────────────────────────
  // THE march-duration formula: 20s per tile at speed 5, scaled by the lord's
  // effective speed, times the travelTime tuning dial.
  //
  // Lived in FIVE hand-copied places until 2026-07-30 (js/domain/lord.js,
  // server/actions/lord-action.js, js/ui/map-view.js and twice in
  // js/ui/attack-confirm-view.js) — so a previewed ETA could disagree with the
  // march the server actually queued. They are all thin callers now; do not
  // re-inline it.
  //
  // opts.minSecs is the attack-intent floor (60s) that gives a defender a
  // warning window; it applies even at distance 0 so a same-tile attack still
  // announces itself.
  const TRAVEL_SECS_PER_TILE = 20;
  const TRAVEL_REF_SPEED     = 5;

  function getTravelTime(distance, speed, opts) {
    const minSecs = Math.max(0, opts?.minSecs || 0);
    const dist    = Math.max(0, distance || 0);
    if (dist <= 0) return minSecs;
    const spd = Math.max(1, speed || TRAVEL_REF_SPEED);
    return Math.max(minSecs, Math.round(
      dist * TRAVEL_SECS_PER_TILE * (TRAVEL_REF_SPEED / spd) * _tune('travelTime'),
    ));
  }

  // ── Raiding stance — hourly payout ────────────────────────────
  // THE raid rate. Lived in three hand-synced copies until 2026-07-29
  // (server/tick/catch-up.js, js/ui/lord-screen.js's preview, and
  // scripts/generate-raid-guide.js) — they are all thin callers now, so a
  // rate change lands in the payout, the in-game preview and the published
  // guide at once. Do not re-inline it.
  //
  // Raiding is the PASSIVE channel: zero attention once started, but the
  // lord is locked for the whole duration, nothing pays until the raid
  // ENDS, and any enemy army arriving forfeits the lot. Rates raised
  // ~6× (gold) / ~13× (resources) on 2026-07-29: the old 25+5×lvl paid a
  // level-8 lord 65 gold/hr, against a 1,250 gold/hr Temple blessing and a
  // Lumber Mill's 778 wood/hr — raiding a full day was worth less than one
  // cheap expedition find, so nobody had a reason to ever use the stance.
  // Expeditions still pay several times more per hour, which is the point:
  // you are paid for attention and casualties, not for parking a lord.
  const RAID_BASE      = { gold: 40, res: 60 };
  const RAID_PER_LEVEL = { gold: 45, res: 55 };

  function getRaidHourlyRewards(lordLevel) {
    const lvl  = Math.max(1, lordLevel || 1);
    const gold = Math.round((RAID_BASE.gold + lvl * RAID_PER_LEVEL.gold) * _tune('raidGold'));
    const res  = Math.round((RAID_BASE.res  + lvl * RAID_PER_LEVEL.res)  * _tune('raidResources'));
    return { gold, food: res, wood: res, stone: res };
  }

  // ── Army power (PWR) — the recruit/hire cap currency ──────────
  // ONE formula for every PWR display and gate (recruit, expedition recruits,
  // lord screen, rankings, camp difficulty). Battle DAMAGE dampening
  // (battle-engine _stackDamageMult, count^0.8) is a separate,
  // deliberate mechanic and stays where it is.
  //
  //   unit PWR = (atk×3 + def×2 + hp/10 + speed) × (1 + 0.08 × combat traits)
  //   army PWR = Σ unit PWR × count            (LINEAR in count)
  //
  // Linear count: the cap used to charge stacks at count^0.8 like combat
  // damage, but a stack's HP pool scales linearly — so mono-unit
  // doomstacks bought more real durability than they paid for (balance
  // suite 2026-07-27: 10×Ironbreakers+10×Cannon hit 78% win rate).
  //
  // Trait tax: traits like terror/fear/regeneration are real combat
  // power the raw stats never show; untaxed, trait-rich races dominated
  // at equal PWR (Dark Elves 63.9%). Only traits the battle engine
  // actually implements as a benefit are taxed — flavor-only traits and
  // drawbacks (fragile, large) stay free. Weights are priced against
  // what the engine actually does with each trait (balance suite
  // 2026-07-27): terror is a −15 enemy-morale hit before round 1,
  // regeneration heals 15% max HP every round, armor_piercing ignores
  // 80% of defense — none of which a flat tax priced correctly.

  const PWR_TRAIT_TAXES = {
    terror:         0.12,  // −15 enemy morale pre-battle (capped at −25/side)
    fear:           0.06,  // −8 enemy morale pre-battle (capped at −25/side)
    regeneration:   0.10,  // heal 15% maxHp per round
    armor_piercing: 0.14,  // target defense ×0.20
    dodge:          0.10,  // 30% chance to ignore a hit
    shield_wall:    0.10,  // melee damage reduction (infantry)
    heavy_armor:    0.10,  // −25% damage taken (armor_piercing bypasses)
    artillery:      0.10,  // top-end ranged attack that never takes melee retaliation
    anti_large:     0.14,  // damage bonus vs large (counters every monster)
    anti_infantry:  0.12,  // damage bonus vs infantry lines
    accurate:       0.10,  // +30% damage in the ranged phase
    aggressive:     0.04,  // +15% damage in the melee phase (Orc Boyz)
    berserk:        0.08,  // +35% damage in the melee phase (Slayers)
    discipline:     0.06,  // steadies morale (full weight, morale-only stubborn)
    duelist:        0.08,  // 25% chance to parry a melee hit
    monster:        0.12,  // −5 enemy morale pre-battle + ×1.4 damage (mass)
    charge:         0.08,  // round-1 charge phase + damage bonus (cavalry)
    impact:         0.05,  // charge lands at ×1.7 instead of ×1.4 (orc boars)
    bloodlust:      0.06,  // damage bonus vs wounded targets
    fire_attack:    0.08,  // burning suppresses regeneration
    frenzy:         0.08,  // +1 attack per round (max +4)
    flanker:        0.08,  // targeting: bypasses the front line
    double_strike:  0.08,  // 30% chance of a second melee attack
    pyroblast:      0.08,  // round-1 magic splash
    fearless:       0.15,  // immune to fear/terror/monster morale hits
    stubborn:       0.10,  // casualty morale reduced (−30% max) + −10% damage taken
                           // (deliberately underpriced .12→.10 on 2026-07-29 — the
                           // dwarf-exclusive identity trait, mirroring 'accurate' for
                           // High Elves; lifts the dwarf mid/end fade)
    flying:         0.05,  // targeting: bypasses the front line
    guardian:       0.05,  // targeting: screens the backline
  };

  // Speed is weighted ×0.5: in the battle engine it only decides strike
  // order within a phase, which is worth far less than a point of attack
  // or 10 hp. At full weight the fastest roster (Dark Elves, speed 4-9
  // on everything) systematically overpaid ~5-10 PWR per model while the
  // slowest (dwarfs, speed 1-2) underpaid — measured as a persistent
  // dwarf-top / Dark-Elves-bottom skew in the balance suite (2026-07-27).
  function getUnitPower(def) {
    if (!def) return 0;
    const s    = def.combatStats || {};
    const base = (s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0) * 0.5;
    const tax  = (def.traits || []).reduce((sum, t) => sum + (PWR_TRAIT_TAXES[t] || 0), 0);
    return base * (1 + tax);
  }

  // Progression tier for card-frame tinting, keyed to PWR bands (2026-07-27):
  //   early  PWR < 63   (basic + line troops)          → bronze frame (no class)
  //   mid    PWR 63-89  (line cav/ranged, mid elites)  → blue
  //   end    PWR >= 90  (top elites, monsters, dragons) → violet
  // PWR is the single power metric now (armyWeight retired), so tier tracks
  // combat value: a low-gated but powerful unit (Great Cannon) reads high, a
  // deep-gated but modest one (Swordmasters) reads mid. Single source of truth
  // for every unit-card UI (tech tree, battle sim, city/map/lord views).
  function getUnitTier(def) {
    const pwr = Math.round(getUnitPower(def));
    if (pwr >= 90) return 'end';
    if (pwr >= 63) return 'mid';
    return 'early';
  }

  // units: [{unitId, count}], unitDefs: the UNIT_DEFS map (passed in so
  // this module stays environment-agnostic). Unknown unitIds count as 0.
  function getArmyPower(units, unitDefs) {
    return (units || []).reduce((sum, u) => {
      const def = unitDefs?.[u.unitId];
      return def ? sum + getUnitPower(def) * (u.count || 0) : sum;
    }, 0);
  }

  // Army PWR if `addCount` more of `unitId` were added. With linear
  // stacking this is just a flat delta, kept as a helper so the recruit
  // gate and the client pre-check share one definition.
  function getProjectedArmyPower(units, unitDefs, unitId, addCount) {
    return getArmyPower(units, unitDefs) + getUnitPower(unitDefs?.[unitId]) * (addCount || 0);
  }

  // ── Unit gold pricing (2026-07-27) ────────────────────────────
  // Gold tracks PWR: cost = PWR × 3.5 × tier premium, rounded to 5.
  // Before this, gold-per-PWR ranged 2.9 (chaff) to 141 (dragons) — a
  // 48× gap that made everything above tier 1 a prestige trap, since
  // the PWR cap is the only army constraint. The premium keeps elites
  // a deliberate 1.5–3× "quality tax" instead.
  // UNIT_DEFS keeps explicit goldCost numbers (data stays data);
  // test-economy.js asserts every unit matches this formula.
  //
  // 3.5 → 12.0 on 2026-07-30. Units are the only gold sink that repeats by
  // itself — you re-buy after every combat loss — so they carry the recurring
  // half of gold demand. At 3.5 a full army for a maxed lord cost ~5.2k, less
  // than a single day of that lord's raid income, so losing a battle cost
  // nothing. Effective gold-per-PWR after the premium: 12 infantry/ranged,
  // 18 cavalry/elite/flying/mercenary, 24 artillery/monster, 36 legendary.
  const GOLD_PER_PWR      = 12.0;
  const GOLD_TIER_PREMIUM = {
    infantry: 1.0, ranged: 1.0,
    cavalry: 1.5, elite: 1.5, flying: 1.5, mercenary: 1.5,
    artillery: 2.0, monster: 2.0,
    legendary: 3.0,
  };

  function getUnitGoldCost(def) {
    if (!def) return 0;
    let premium = GOLD_TIER_PREMIUM[def.category] ?? 1.0;
    // Elite-grade infantry (Black Orcs) price as elites, not line troops.
    if (def.category === 'infantry' && (def.tags || []).includes('elite')) premium = 1.5;
    return Math.max(5, Math.round(getUnitPower(def) * GOLD_PER_PWR * premium / 5) * 5);
  }

  // ── March food cost (the OGame deuterium role) ────────────────
  // Moving between tiles burns food, paid once when the march is ordered.
  // Any action on the CURRENT tile (search, scout, raid, attack in place)
  // is free — only crossing tiles costs food.
  //
  //   cost/tile = 50 (the lord) + 45 per army model, CAPPED at 500/tile
  //   cost      = distance × min(500, 50 + 45 × models) × (1 + march_food_cost)
  //
  // The cap (hit at 10 models) is deliberate: big armies pay a fixed
  // supply-train rate instead of scaling forever. Calibrated 2026-07-26:
  // lone lord 50/tile, 10 models × 3 tiles = 1500, 30 models × 10 = 5000.
  // Cartography research discounts via the march_food_cost key.
  function getMarchFoodCost(distance, armyUnits, researchEffects) {
    if (!distance || distance <= 0) return 0;
    const models = (armyUnits || []).reduce((s, u) => s + (u.count || 0), 0);
    const mult   = Math.max(0.2, 1 + ((researchEffects || {}).march_food_cost || 0));
    return Math.floor(distance * Math.min(500, 50 + 45 * models) * mult);
  }

  // ── Population growth (pop/hour) ──────────────────────────────

  function getPopGrowthRate(stats, foodRate) {
    let pct = 0;

    if      (stats.happiness >= 70) pct += 0.30;
    else if (stats.happiness >= 50) pct += 0.15;
    else if (stats.happiness >= 35) pct += 0.05;
    else if (stats.happiness <  20) pct -= 0.20;
    else                             pct -= 0.08;

    // Order matters: the harshest bracket must be checked first — with
    // `< 25` before `< 10`, the `< 10` branch was unreachable and
    // catastrophic hygiene was under-penalized (found 2026-07-27).
    if      (stats.hygiene >= 60) pct += 0.15;
    else if (stats.hygiene <  10) pct -= 0.25;
    else if (stats.hygiene <  25) pct -= 0.10;

    if ((foodRate || 0) > 0) pct += 0.08;
    else                     pct -= 0.05;

    // Count stats in Warning or Critical (normalized value < 45)
    const warnings = Object.keys(stats).filter(k => {
      const val = GOOD_HIGH.has(k) ? stats[k] : (100 - stats[k]);
      return val < 45;
    }).length;
    if (warnings >= 3) pct -= 0.10;
    if (warnings >= 5) pct -= 0.20;

    pct = Math.max(-0.50, Math.min(0.55, pct));
    return Math.round(pct * 1130);
  }

  // ── City level & building slots ───────────────────────────────

  const SLOT_TABLE = [
    { minPop:      0, level: 1, maxSlots:  30 },
    { minPop:  10000, level: 2, maxSlots:  50 },
    { minPop:  25000, level: 3, maxSlots:  75 },
    { minPop:  50000, level: 4, maxSlots: 100 },
    { minPop: 100000, level: 5, maxSlots: 150 },
    // Tier 6 added 2026-07-30 with the cap raise: at 150 slots a city that
    // pushed producers deep had no room left for the apex tier, which would
    // have capped resource demand exactly where the new long-tail sinks live.
    { minPop: 200000, level: 6, maxSlots: 200 },
  ];

  function _slotRow(population) {
    const pop = population || 1000;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    return row;
  }

  function getCityLevel(population) {
    return _slotRow(population).level;
  }

  function getSlotInfo(buildings, population) {
    const row = _slotRow(population);
    const usedSlots = Object.values(buildings || {}).reduce((s, v) => s + v, 0);
    return { level: row.level, maxSlots: row.maxSlots, usedSlots };
  }

  // Degrades buildings randomly when usedSlots > maxSlots (after a
  // population decline drops a tier). Mutates city.buildings.
  function degradeExcessBuildings(city) {
    const { usedSlots, maxSlots } = getSlotInfo(city.buildings, city.population);
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

  return {
    RESOURCE_KEYS, STAT_BASE, SLOT_TABLE,
    getRates, getStats, getGoldRate, getMarchFoodCost, getPopGrowthRate,
    getTravelTime, TRAVEL_SECS_PER_TILE,
    getResearchEffects, getBlessingEffects, getBuildTime, getRecruitTime, getCityBuildDivisor, getUnitTraining,
    getVeterancyPct, getGarrisonVeterancyPct,
    getRaidHourlyRewards, RAID_BASE, RAID_PER_LEVEL,
    getUnitPower, getUnitTier, getArmyPower, getProjectedArmyPower, getUnitGoldCost,
    getCityLevel, getSlotInfo, degradeExcessBuildings,
  };
})();
