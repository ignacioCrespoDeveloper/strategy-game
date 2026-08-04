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

  // THE CANONICAL RESOURCE ORDER — wood → stone → food, matching the HUD
  // (gold, when a bundle carries it, always comes first).
  //
  // This is a DISPLAY contract, not just an iteration list. Every panel that
  // prints a cost, a production line or a loot bundle must walk these keys
  // rather than the key order of whatever object it was handed: costs are plain
  // literals, so `Object.entries(cost)` renders them in declaration order, and
  // the Town Hall declared `{ food, wood, stone }` while the other 25 buildings
  // declared `{ wood, stone, … }`. One building disagreeing with the rest is
  // all it takes for the panel to look broken (Nacho, 2026-08-04).
  const RESOURCE_KEYS = ['wood', 'stone', 'food'];

  // Global tuning dials — see js/data/tuning.js, which is THE file to edit to
  // make the game faster or slower. Read through a local shim so economy-core
  // still works if tuning.js is missing (a stale cached index.html), in which
  // case every dial reads 1.0 and nothing changes.
  function _tune(key) {
    return (typeof tune === 'function') ? tune(key) : 1.0;
  }

  // SECURITY IS GONE (2026-08-04, Nacho's call). It was a display-only stat:
  // fifteen emitters fed it — thirteen buildings and two terrains — and NOTHING
  // read it back. It sat outside STATUS_STATS, so it could not move the badge or
  // population growth, and the server never looked at it; its own tooltip said
  // "Future military bonus", a bonus that was never built. The City Defenses
  // axis is Stability alone for now.
  //
  // Deleting the key here is also the backstop for any emitter missed: getStats
  // only applies an effect when `stats[stat] !== undefined`, so a stray
  // `{ stat: 'security' }` is silently dropped rather than resurrecting the stat.
  const STAT_BASE = {
    corruption:   0,
    happiness:    50,
    hygiene:      50,
    unemployment: 15,
    religion:     50,
    culture:      50,
    stability:    50,
  };

  // Stats where a HIGH value is good (used for warning counting).
  const GOOD_HIGH = new Set(['happiness', 'hygiene', 'religion', 'culture', 'stability']);

  // ── Resource rates (per hour) ─────────────────────────────────
  // Plain building output × race bonus × terrain multiplier.
  // raceBonuses:  { wood_production, stone_production, food_production } (race.bonuses or {})
  //               — the caller SUMS race + research + blessing into these keys.
  // terrainMods:  { wood, stone, food } multipliers (TERRAIN_RESOURCE_MODS[terrainId] or {})
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
    const totals = { wood: 0, stone: 0, food: 0 };
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

  // CORRUPTION SKIMS CITY GOLD (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 4).
  //
  // Corruption fed nothing but the status score, and the status score cannot
  // feel it: corruption bases at 0, clamps at 0, and getStatTier normalises it
  // as `100 − value`, so anything under 30 reads Excellent. Measured on a
  // 100k-pop city — Courthouse level 8 moved corruption 12 → 0 and changed the
  // city's status not at all: **98,513 resources for an identical city.** The
  // Courthouse was the only building whose sole job was corruption, so the
  // Courthouse was the building with no job.
  //
  // It now takes a straight cut of city tax, which is exactly what corruption
  // means. That gives the Marketplace's +6 corruption/level a real price
  // against its +8% gold/level, gives the Courthouse (−5/level) and the Temple
  // (−3/level) something to buy back, and makes the choice legible: a big
  // market town needs a courthouse or it leaks.
  //
  // Capped at half the city's take at corruption 100 — a ruinous city should
  // still pay something, and a 100% skim would make one stat able to zero an
  // entire income channel.
  const CORRUPTION_GOLD_SKIM_MAX = 0.5;

  // The Marketplace's entire economic job, in one number: +8% of this city's
  // tax per level. Exported because the city view prints it on the building's
  // detail panel — since the Merchant moved out to its own tab (2026-08-04)
  // this bonus IS the Marketplace, so the panel must not quote a second copy
  // of the figure that could drift from the one actually applied here.
  const MARKETPLACE_GOLD_PCT = 0.08;

  function getGoldRate(buildings, population, happiness, corruption) {
    const pop  = population || 1000;
    let   rate = pop * 0.004 * (Math.max(0, happiness || 0) / 100);
    const mkLevel = (buildings || {}).marketplace || 0;
    if (mkLevel > 0) rate *= (1 + MARKETPLACE_GOLD_PCT * mkLevel);
    // Absent argument → no skim, so any caller not yet passing stats behaves
    // exactly as before rather than silently losing income.
    const corr = Math.max(0, Math.min(100, corruption || 0));
    rate *= (1 - CORRUPTION_GOLD_SKIM_MAX * (corr / 100));
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

  // ── City item effects ─────────────────────────────────────────
  // The flat-key production bonus of every item currently applied to ONE city
  // ({ wood_production, stone_production, food_production }), summed. Items are
  // the only PER-CITY entry in that grammar — race, research and blessings are
  // empire-wide — so this is added to those three by the caller, exactly like
  // getBlessingEffects is. See js/data/items.js.
  //
  // `city.activeItems` = [{ itemId, startedAt, expiresAt }], unlimited entries;
  // two of the same item stack as two entries. The summed result rides the same
  // PRODUCTION_BONUS_MAX clamp inside getRates as everything else.
  //
  // TWO MODES, and picking the wrong one silently robs the player:
  //   · getCityItemEffects(city, now)        → INSTANTANEOUS. What is active
  //     right now. This is the display answer (HUD, city view, production.js).
  //   · getCityItemEffects(city, now, since) → TIME-WEIGHTED over [since, now].
  //     Each item contributes its bonus scaled by the fraction of the window it
  //     was actually live for. This is the answer server/tick/catch-up.js needs,
  //     because catch-up credits a whole offline window in ONE lump at ONE rate:
  //     with the instantaneous form, a 24h item applied before a 48h absence
  //     would have expired by the time catch-up looked and would pay NOTHING,
  //     even though it ran its full course. (The Temple blessing path still has
  //     that shortcut — it is bounded by a Temple-level cap of a few hours, so
  //     the error is small; items are measured in days and it is not.)
  function getCityItemEffects(city, now, since) {
    const out = {};
    if (typeof ITEM_DEFS === 'undefined') return out;
    const list = (city && city.activeItems) || [];
    if (list.length === 0) return out;

    const nowMs    = now || 0;
    const weighted = since != null && since < nowMs;
    const span     = weighted ? (nowMs - since) : 0;

    for (const entry of list) {
      const def = entry && ITEM_DEFS[entry.itemId];
      if (!def) continue;

      let weight;
      if (!weighted) {
        weight = (entry.expiresAt && nowMs >= entry.expiresAt) ? 0 : 1;
      } else {
        // An item applied mid-window starts counting when it was applied, and
        // stops at its expiry — never before `since`, never after `now`.
        const from = Math.max(since, entry.startedAt || since);
        const to   = Math.min(nowMs, entry.expiresAt || nowMs);
        weight     = to > from ? (to - from) / span : 0;
      }
      if (weight <= 0) continue;

      for (const [key, value] of Object.entries(def.effects || {})) {
        out[key] = (out[key] || 0) + value * weight;
      }
    }
    return out;
  }

  // Drop items whose expiry has passed. Returns true if anything was removed,
  // so the caller knows the city needs saving. ALWAYS call this AFTER crediting
  // production for the window — pruning first throws away the hours the item
  // was legitimately live for.
  function pruneExpiredItems(city, now) {
    const list = (city && city.activeItems) || [];
    if (list.length === 0) return false;
    const live = list.filter(e => !e || !e.expiresAt || now < e.expiresAt);
    if (live.length === list.length) return false;
    city.activeItems = live;
    return true;
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

  // The `buildTime` tuning dial multiplies on top of everything else (1/3 =
  // three times faster). It sits INSIDE the max(5, …) floor with the rest, so
  // dial × race/tome % × Town Hall divisor can compound freely without ever
  // producing a sub-5-second build.
  function getBuildTime(def, level, raceBonuses, researchEffects, cityBuildings) {
    const mult = Math.max(0.2,
      1 + ((raceBonuses || {}).construction_speed || 0)
        + ((researchEffects || {}).construction_speed || 0));
    return Math.max(5, Math.round(
      def.buildTime(level) * mult * _tune('buildTime') / getCityBuildDivisor(cityBuildings)));
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

  // ── Expansion slots (the OGame Astrophysics / Computer Tech role) ──
  //
  // How many cities a player may found and how many lords they may recruit.
  // Until 2026-08-03 both were the flat constant 7, hand-copied into the
  // server action, the client mirror AND (wrongly, as 5) into map-view.js.
  // They are now bought from the Library — Frontier Charters and Codes of
  // Command in js/data/research.js — and this is THE formula, so the found
  // button, the recruit modal and the server gate can never disagree again.
  //
  // The +1 is the founding city / founding lord, which no research buys: a
  // player always has one of each, exactly as an OGame account always has a
  // homeworld before Astrophysics exists.
  //
  // NO CEILING (Nacho's call, 2026-08-03) — the old flat 7 is gone in both
  // directions. The limiters are the doubling gold price on the city/lord
  // itself and the research curve underneath it. Math.floor guards a corrupt
  // or hand-edited save from buying half a slot; Math.max(0, …) stops a
  // negative key from taking the founding one away.
  function getCitySlots(researchEffects) {
    return 1 + Math.floor(Math.max(0, (researchEffects || {}).city_slots || 0));
  }

  function getLordSlots(researchEffects) {
    return 1 + Math.floor(Math.max(0, (researchEffects || {}).lord_slots || 0));
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
  //
  // opts.researchEffects is EconomyCore.getResearchEffects(player.research) —
  // Cartography's `travel_speed` key lives here (2026-08-03). It is OPTIONAL
  // on purpose: every caller that previews a march for a specific player
  // passes it, and the handful that ask a generic "how long is a tile"
  // question (scripts/economy-projection.js) legitimately do not. Omitting it
  // yields the un-researched time, never a crash.
  const TRAVEL_SECS_PER_TILE = 20;
  const TRAVEL_REF_SPEED     = 5;

  // The attack-intent floor, exported because it is a RULE and not a display
  // detail: server/actions/lord-action.js enforces it and the attack-confirm
  // screen has to preview the same number. It was hardcoded 60 in the server
  // and simply absent from the preview, so an adjacent-tile strike by a fast
  // lord advertised ~10s and was queued at 60 — a five-fold lie on the one
  // screen where timing is the whole decision.
  const ATTACK_MIN_SECS = 60;

  function getTravelTime(distance, speed, opts) {
    const minSecs = Math.max(0, opts?.minSecs || 0);
    const dist    = Math.max(0, distance || 0);
    if (dist <= 0) return minSecs;
    const spd = Math.max(1, speed || TRAVEL_REF_SPEED);
    // Cartography = the OGame Hyperspace Drive: the bonus is ADDITIVE on base
    // speed, so it DIVIDES the march rather than multiplying it down. +30% at
    // L1 is time ÷ 1.3, not time × 0.7. Negative values are ignored (no book
    // slows you down, and a corrupt save should not be able to invent one).
    // Floored at 0.2 — a hard ×5 ceiling, reached at L14 — matching
    // getBuildTime / getRecruitTime / getMarchFoodCost.
    const spdResearch = Math.max(0, (opts?.researchEffects || {}).travel_speed || 0);
    const mult        = Math.max(0.2, 1 / (1 + spdResearch));
    return Math.max(minSecs, Math.round(
      dist * TRAVEL_SECS_PER_TILE * (TRAVEL_REF_SPEED / spd) * _tune('travelTime') * mult,
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

  // FROZEN AT LORD_POWER_LEVEL_CAP (2026-08-03). lordPowerLevel(), not the raw
  // level: raising LORD_MAX_LEVEL to 20 against this linear rate would have
  // taken a maxed lord from 490 to 940 gold/hour and doubled every resource,
  // silently rewriting an endgame curve that was measured and signed off at
  // level 10. Levels 11–20 buy stats and talents, not income — see the two-
  // halves block in js/data/lord-classes.js. Called directly rather than
  // through a `typeof` guard on purpose: a missing dependency must break
  // loudly here, not quietly restore the doubling.
  function getRaidHourlyRewards(lordLevel) {
    const lvl  = lordPowerLevel(lordLevel);
    const gold = Math.round((RAID_BASE.gold + lvl * RAID_PER_LEVEL.gold) * _tune('raidGold'));
    const res  = Math.round((RAID_BASE.res  + lvl * RAID_PER_LEVEL.res)  * _tune('raidResources'));
    return { gold, wood: res, stone: res, food: res };
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
  //   cost/tile = 50 (the lord) + 45 per army model
  //   cost      = distance × (50 + 45 × models) × (1 + march_food_cost)
  //
  // THE CAP IS GONE (2026-08-03, Nacho's call). Until then this was capped at
  // 500/tile, which is reached at exactly 10 models — so every army from 10
  // models to a full endgame host paid the identical bill. A 40-model army and
  // a 10-model army both cost 2,500 food to march five tiles, which meant the
  // per-unit supply cost the formula appears to charge simply stopped existing
  // right where armies start getting big. Marching a host is now genuinely
  // more expensive than marching a raiding party: 40 models over 5 tiles goes
  // 2,500 → 9,250.
  //
  // This deliberately pushes the same direction as the Tanda 3 armour fix —
  // both make an oversized single stack cost what it is worth. Watch them
  // together when that lands.
  //
  // Calibrated 2026-07-26 and unchanged otherwise: lone lord 50/tile,
  // 10 models × 3 tiles = 1,500. Cartography research discounts via the
  // march_food_cost key, floored at ×0.2 so no stack of discounts makes
  // marching free.
  function getMarchFoodCost(distance, armyUnits, researchEffects) {
    if (!distance || distance <= 0) return 0;
    const models = (armyUnits || []).reduce((s, u) => s + (u.count || 0), 0);
    const mult   = Math.max(0.2, 1 + ((researchEffects || {}).march_food_cost || 0));
    return Math.floor(distance * (50 + 45 * models) * mult);
  }

  // ── City status ───────────────────────────────────────────────
  // Lives here, not in city-stats.js, because it now DRIVES population
  // growth — and the authoritative pop tick runs on the server, which loads
  // this file and not the UI layer (server/engine-loader.js).
  //
  // The badge summarises the six "City Status" stats ONLY. Stability is the
  // "City Defenses" axis — a well-garrisoned fortress is not a prosperous city
  // and a rich one is not automatically safe, so the two panels stay
  // independent (design call, 2026-08-03). Security was the second defence row
  // until 2026-08-04; see STAT_BASE for why it went.
  const STATUS_STATS  = ['happiness', 'corruption', 'hygiene', 'unemployment', 'religion', 'culture'];
  const DEFENSE_STATS = ['stability'];

  // Weights sum to 1.00, so the raw score spans ±50 and the tier cutoffs
  // below keep their old meaning. Happiness and hygiene carry the most
  // because the player fights for them every level (pop pressure eats
  // hygiene, cross-stat penalties eat happiness). Corruption and
  // unemployment are weighted lightest on purpose: corruption BASES at 0
  // and only a few buildings raise it, so most cities bank a free
  // "Excellent" there and it should not buy a third of the threshold.
  const STATUS_WEIGHTS = {
    happiness:    0.30,
    hygiene:      0.20,
    religion:     0.15,
    culture:      0.15,
    corruption:   0.10,
    unemployment: 0.10,
  };

  // Best → worst. Index order is load-bearing: the gates cap by index.
  const STATUS_TIERS = [
    { id: 'prosperous', label: 'Prosperous' },
    { id: 'growing',    label: 'Growing'    },
    { id: 'stable',     label: 'Stable'     },
    { id: 'unrest',     label: 'Unrest'     },
    { id: 'rioting',    label: 'Rioting'    },
    { id: 'critical',   label: 'Critical'   },
  ];

  // Status → population growth, in pop/hour. The status does not MULTIPLY
  // growth, it IS the growth: each tier has a designed 24h yield, so the
  // badge the player reads is a number they can plan a day around.
  //
  // Targets set by Nacho 2026-08-03: Stable ≈ 2,000/day, Growing ≈ 3,000,
  // Prosperous ≈ 4,000. The decline side mirrors the growth side, with
  // Critical the exact negative of Prosperous.
  //
  // A multiplier could NOT hit those targets: a Stable city also scores a
  // much lower base than a Growing one, so scaling would have needed
  // Stable's multiplier to exceed Prosperous's — inverting the ladder.
  const STATUS_POP_RATE = {
    prosperous:  167,   // ≈ +4,008 / 24h
    growing:     125,   // ≈ +3,000 / 24h
    stable:       83,   // ≈ +1,992 / 24h
    unrest:      -42,   // ≈ −1,008 / 24h
    rioting:     -83,   // ≈ −1,992 / 24h
    critical:   -167,   // ≈ −4,008 / 24h
  };

  // Food is the one growth input the status score cannot see — it weighs
  // civic stats, not the larder — so it stays an explicit term. Costs a
  // city ~3,000 pop/day against its tier.
  const NO_FOOD_POP_PENALTY = 125;

  // A famine can never leave population flat or rising (Nacho's call,
  // 2026-08-03: no city state may hold population still). The bare
  // subtraction did both — Growing (125 − 125) landed on EXACTLY 0, the one
  // number the design forbids, and Prosperous (167 − 125) stayed at +42, so
  // the best cities grew straight through a famine.
  //
  // Clamping at the Rioting rate makes starvation always a decline, while
  // keeping the subtraction means a bad status still starves FASTER than a
  // good one (Unrest → −167, Critical → −292).
  const STARVATION_POP_RATE = -83;   // ≈ −1,992 / 24h

  // Resources are an EMPIRE-WIDE pool (see production.js), so "this city has
  // no farm" is not the same as "this city has no food". A city is fed when it
  // produces food itself OR the realm still has food banked — its neighbours
  // supply it, exactly as they supply its wood and stone.
  //
  // Keying the penalty on per-city production alone starved every city at
  // birth: a new city is founded with a Town Hall and nothing else, so it read
  // 0 food/h and shrank at −42/h from its first minute while the badge still
  // said "Stable". A brand-new city is now Stable AND growing, which is the
  // whole point of the tier.
  function isCityFed(cityFoodRate, empireFoodStock) {
    return (cityFoodRate || 0) > 0 || (empireFoodStock || 0) > 0;
  }

  // 'excellent' | 'stable' | 'warning' | 'critical' — the same four bands the
  // city panel prints on every stat row. The UI's label/colour mapping wraps
  // this so the badge can never disagree with the rows above it.
  function getStatTier(statId, value) {
    const normalized = GOOD_HIGH.has(statId) ? value : (100 - value);
    if (normalized >= 70) return 'excellent';
    if (normalized >= 45) return 'stable';
    if (normalized >= 20) return 'warning';
    return 'critical';
  }

  // Pure function of the six status stats. It deliberately takes no growth
  // argument: growth is now an OUTPUT of the status, and the old ±8 nudge
  // both closed that loop and double-counted happiness/hygiene, which are
  // already scored below and already drive the growth brackets.
  function getCityStatus(stats) {
    let score = 0;
    for (const key of STATUS_STATS) {
      const raw        = stats[key] ?? 50;
      const normalized = GOOD_HIGH.has(key) ? raw : (100 - raw);
      score += (normalized - 50) * STATUS_WEIGHTS[key];
    }

    let idx =
      score >=  25 ? 0 :
      score >=  12 ? 1 :
      score >=   0 ? 2 :
      score >= -12 ? 3 :
      score >= -25 ? 4 : 5;

    let excellent = 0, warning = 0, critical = 0;
    for (const key of STATUS_STATS) {
      const tier = getStatTier(key, stats[key] ?? 50);
      if      (tier === 'excellent') excellent++;
      else if (tier === 'warning')   warning++;
      else if (tier === 'critical')  critical++;
    }

    // Ceilings: a good-looking score cannot outrun the rows.
    if (excellent < 5 || warning > 0 || critical > 0) idx = Math.max(idx, 1);
    if (excellent < 3 || warning > 1 || critical > 0) idx = Math.max(idx, 2);

    // Floors, symmetric with the ceilings: the two alarm tiers are reserved
    // for cities that actually have Critical rows, so "everything is merely
    // Warning" reads as Unrest rather than Rioting.
    if (critical > 0)  idx = Math.max(idx, 3); else idx = Math.min(idx, 3);
    if (critical >= 3) idx = Math.max(idx, 4); else idx = Math.min(idx, 4);

    return STATUS_TIERS[idx];
  }

  // ── Population growth (pop/hour) ──────────────────────────────

  // Replaced the old `pct × 1130` bracket stack (happiness/hygiene/food/
  // warning tiers) on 2026-08-03. That system had two faults the status
  // ladder fixes: it SATURATED — happiness ≥70 + hygiene ≥60 + food already
  // reached 0.53 of its 0.55 ceiling, so a good city and an excellent one
  // grew at the same speed — and it re-scored the very stats the status
  // already weighs, counting happiness and hygiene twice.
  //
  // Extreme stats still bite, through the status gates rather than through
  // their own brackets: hygiene 8 is a Critical row, and a Critical row
  // forces the badge to Unrest or below.
  //
  // NEVER RETURNS 0. Every STATUS_POP_RATE entry is non-zero and the famine
  // branch is clamped negative, so no combination of status and larder can
  // hold a city's population still — see isCityFed / STARVATION_POP_RATE.
  // scripts/test-economy.js asserts this over the full matrix.
  function getPopGrowthRate(stats, cityFoodRate, empireFoodStock) {
    const rate = STATUS_POP_RATE[getCityStatus(stats).id] ?? 0;
    if (isCityFed(cityFoodRate, empireFoodStock)) return Math.round(rate);
    return Math.round(Math.min(STARVATION_POP_RATE, rate - NO_FOOD_POP_PENALTY));
  }

  // ── City level & building slots ───────────────────────────────

  // Slot counts raised across the board 2026-08-04 (Nacho's call). The old
  // ladder (30/50/75/100/150 + a tier 6 at 200) started too tight — a tier-1
  // city spent its 30 slots on producers and had nothing left to experiment
  // with — and needed a sixth tier at 200k population to reach the room the
  // apex buildings want. The new curve front-loads that room instead: tier 1
  // opens at 50, the biggest single jump is 1→2, and the 200-slot ceiling now
  // arrives at tier 5 / 100k pop. TIER 6 IS GONE — with tier 5 already at 200
  // it granted nothing, and no building gates on it (buildings.js tops out at
  // `minTier: 5`), so removing the row changes no unlock.
  const SLOT_TABLE = [
    { minPop:      0, level: 1, maxSlots:  50 },
    { minPop:  10000, level: 2, maxSlots: 100 },
    { minPop:  25000, level: 3, maxSlots: 125 },
    { minPop:  50000, level: 4, maxSlots: 150 },
    { minPop: 100000, level: 5, maxSlots: 200 },
  ];

  function _slotRow(population) {
    const pop = population || 1000;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    return row;
  }

  // CITY TIER ONLY EVER GOES UP (Nacho's call, 2026-08-03).
  //
  // Tier used to be a live read of current population, so a city that shrank —
  // a famine, a bad status streak, a raid — dropped a tier, lost slots, and
  // `degradeExcessBuildings` then DESTROYED BUILDINGS AT RANDOM to fit. Days of
  // investment could evaporate from a dip the player might not even have seen
  // coming, and the new status ladder makes shrinking cities a normal part of
  // play rather than an edge case.
  //
  // Tier is now derived from `peakPopulation` — the highest the city has ever
  // reached — so it is a ratchet. Losing population still costs you everything
  // population buys (gold, growth, the status badge); it no longer confiscates
  // what you built. `degradeExcessBuildings` is gone entirely: with a ratchet,
  // usedSlots can never exceed maxSlots in the first place.
  //
  // Absent on cities saved before this change, which is why the fallback is
  // the live population — an existing city keeps exactly the tier it has now
  // and starts ratcheting from there. Nothing to migrate.
  function cityPeakPopulation(city) {
    return Math.max(city?.peakPopulation || 0, city?.population || 0, 1000);
  }

  // Records a new high-water mark. Called from the population tick; returns
  // true when the peak actually moved, so the caller can persist.
  function updatePeakPopulation(city) {
    const peak = cityPeakPopulation(city);
    if (peak > (city.peakPopulation || 0)) { city.peakPopulation = peak; return true; }
    return false;
  }

  function getCityLevel(population) {
    return _slotRow(population).level;
  }

  function getSlotInfo(buildings, population) {
    const row = _slotRow(population);
    const usedSlots = Object.values(buildings || {}).reduce((s, v) => s + v, 0);
    return { level: row.level, maxSlots: row.maxSlots, usedSlots };
  }

  return {
    RESOURCE_KEYS, STAT_BASE, SLOT_TABLE,
    STATUS_STATS, DEFENSE_STATS, STATUS_POP_RATE, NO_FOOD_POP_PENALTY, STARVATION_POP_RATE,
    isCityFed, getCityStatus, getStatTier,
    getRates, getStats, getGoldRate, CORRUPTION_GOLD_SKIM_MAX, MARKETPLACE_GOLD_PCT,
    getMarchFoodCost, getPopGrowthRate,
    getTravelTime, TRAVEL_SECS_PER_TILE, ATTACK_MIN_SECS,
    getCitySlots, getLordSlots,
    getResearchEffects, getBlessingEffects, getCityItemEffects, pruneExpiredItems,
    getBuildTime, getRecruitTime, getCityBuildDivisor, getUnitTraining,
    getVeterancyPct, getGarrisonVeterancyPct,
    getRaidHourlyRewards, RAID_BASE, RAID_PER_LEVEL,
    getUnitPower, getUnitTier, getArmyPower, getProjectedArmyPower, getUnitGoldCost,
    getCityLevel, getSlotInfo, cityPeakPopulation, updatePeakPopulation,
  };
})();
