// =============================================
//  production.js — Timestamp-based resource production
//
//  No timers. No polling.
//  Call tick(city, lord) on every city open to accumulate resources,
//  gold income, upkeep deductions, and freePopulation growth.
//
//  Gold income per city:  pop × 0.10 × (happiness/100), +8%/marketplace level
//  Upkeep (global):       deducted once per player per tick via lastUpkeepAt stamp
//                         = Σ lord upkeep (5+level/h) + Σ unit upkeep (1%goldCost/h)
//  freePopulation growth: +5/day per city (≈0.2083/h), capped at 20
// =============================================

const ProductionService = (() => {

  // Base resource rates (food/wood/stone/iron) per hour for a city.
  function getRates(city, lord) {
    const totals = { food: 0, wood: 0, stone: 0, iron: 0 };
    const race   = lord ? (RACES[lord.race] || null) : null;

    Object.entries(city.buildings).forEach(([id, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def  = BUILDING_DEFS[id];
      if (!def) return;
      const prod = def.production(lvl);
      Object.entries(prod).forEach(([res, amt]) => {
        totals[res] = (totals[res] || 0) + amt;
      });
    });

    if (race) {
      const b = race.bonuses;
      totals.food  = Math.floor(totals.food  * (1 + (b.food_production  || 0)));
      totals.wood  = Math.floor(totals.wood  * (1 + (b.wood_production  || 0)));
      totals.stone = Math.floor(totals.stone * (1 + (b.stone_production || 0)));
      totals.iron  = Math.floor(totals.iron  * (1 + (b.iron_production  || 0)));
    }

    return totals;
  }

  // Gold income per hour from a single city.
  // formula: pop × 0.10 × (happiness/100), marketplace +8%/level
  function getGoldRate(city) {
    const stats     = CityStatsService.getStats(city);
    const happiness = Math.max(0, stats.happiness || 0);
    const pop       = city.population || 1000;
    let rate        = pop * 0.10 * (happiness / 100);
    const mkLevel   = city.buildings.marketplace || 0;
    if (mkLevel > 0) rate *= (1 + 0.08 * mkLevel);
    return Math.floor(rate);
  }

  // Total upkeep per hour for all lords and armies of a player.
  function _calcUpkeepPerHour(playerId) {
    let total = 0;
    LordService.getByPlayer(playerId).forEach(lord => {
      total += LordService.getUpkeepPerHour(lord);
      const army = ArmyService.get(lord.id);
      army.units.forEach(stack => {
        const def = UNIT_DEFS[stack.unitId];
        if (def) total += (def.upkeep || 0) * stack.count;
      });
    });
    return total;
  }

  // Apply accumulated production since lastResourceUpdate.
  // Also handles gold income and (once per player per tick) upkeep + freePopulation.
  function tick(city, lord) {
    const now     = TimeService.now();
    const elapsed = TimeService.hoursElapsed(city.lastResourceUpdate || now);

    if (elapsed <= 0) return;

    // ── Resource production ──────────────────────────────────────
    const rates = getRates(city, lord);
    Object.entries(rates).forEach(([res, perHour]) => {
      if (perHour <= 0) return;
      city.resources[res] = (city.resources[res] || 0) + perHour * elapsed;
    });

    // ── Population tick ──────────────────────────────────────────
    CityStatsService.tickPopulation(city, lord, rates, elapsed);

    // ── freePopulation growth: +5/day ≈ 0.2083/h, cap 20 ────────
    const popGrowthPerHour = 5 / 24;
    const currentFree      = city.freePopulation ?? 3;
    city.freePopulation    = Math.min(20, currentFree + popGrowthPerHour * elapsed);

    // ── Gold income + upkeep (deduct upkeep once per player) ─────
    const playerId  = city.playerId;
    const player    = PlayerService.getById(playerId);
    if (player) {
      const goldIncome   = getGoldRate(city) * elapsed;

      // Only deduct upkeep once per player tick cycle (use lastUpkeepAt flag).
      const lastUpkeep    = player.lastUpkeepAt || (now - elapsed * 3600000);
      const upkeepElapsed = TimeService.hoursElapsed(lastUpkeep);
      const upkeepCost    = upkeepElapsed > 0
        ? _calcUpkeepPerHour(playerId) * upkeepElapsed
        : 0;

      const newCoins = Math.max(0, (player.coins || 0) + goldIncome - upkeepCost);
      PlayerService.update(playerId, {
        coins:        Math.floor(newCoins),
        lastUpkeepAt: upkeepElapsed > 0 ? now : player.lastUpkeepAt,
      });
    }

    city.lastResourceUpdate = now;
    CityService.save(city);
  }

  return { getRates, getGoldRate, tick };
})();
