// =============================================
//  production.js — Timestamp-based resource production
//
//  No timers. No polling.
//  Call tick(city, lord) on every city open to accumulate resources,
//  gold income, upkeep deductions, and freePopulation growth.
//
//  Gold income per city:  pop × 0.10 × (happiness/100), +8%/marketplace level
//  Upkeep (global):       deducted once per player per tick via lastUpkeepAt stamp
//                         = Σ lord upkeep (5+level/h) + Σ unit upkeep (def.upkeep/h)
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
        if (totals[res] !== undefined) totals[res] = (totals[res] || 0) + amt;
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
  // Base: pop × 0.10 × (happiness/100)  — population tax
  // Marketplace multiplier: +8% per level
  function getGoldRate(city) {
    const stats     = CityStatsService.getStats(city);
    const happiness = Math.max(0, stats.happiness || 0);
    const pop       = city.population || 1000;
    let rate        = pop * 0.10 * (happiness / 100);
    const mkLevel   = city.buildings.marketplace || 0;
    if (mkLevel > 0) rate *= (1 + 0.08 * mkLevel);
    return Math.floor(rate);
  }

  // Total army+lord upkeep per hour for a player.
  function getUpkeepPerHour(playerId) {
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

  // Net gold rate for a player across all cities (income - upkeep).
  function getNetGoldRate(playerId) {
    const income = CityService.getPlayerCities(playerId)
      .reduce((s, city) => s + getGoldRate(city), 0);
    return income - getUpkeepPerHour(playerId);
  }

  // Apply accumulated production since lastResourceUpdate.
  // Resources accumulate into player.resources (empire-wide pool).
  // Also handles gold income and (once per player per tick) upkeep + freePopulation.
  function tick(city, lord) {
    const now     = TimeService.now();
    const elapsed = TimeService.hoursElapsed(city.lastResourceUpdate || now);

    if (elapsed <= 0) return;

    const playerId = city.playerId;
    const player   = PlayerService.getById(playerId);

    if (player) {
      // One-time migration: seed player.resources from existing city stockpiles
      if (!player.resources) {
        player.resources = { food: 0, wood: 0, stone: 0, iron: 0 };
        CityService.getPlayerCities(playerId).forEach(c => {
          ['food','wood','stone','iron'].forEach(k => {
            player.resources[k] = (player.resources[k] || 0) + Math.floor(c.resources?.[k] || 0);
          });
        });
      }

      // ── Resource production → empire pool ─────────────────────
      const rates = getRates(city, lord);
      Object.entries(rates).forEach(([res, perHour]) => {
        if (perHour <= 0) return;
        player.resources[res] = (player.resources[res] || 0) + perHour * elapsed;
      });

      // ── Population tick ───────────────────────────────────────
      CityStatsService.tickPopulation(city, lord, rates, elapsed);

      // ── freePopulation growth: +5/day ≈ 0.2083/h, cap 20 ─────
      const popGrowthPerHour = 5 / 24;
      city.freePopulation    = Math.min(20, (city.freePopulation ?? 3) + popGrowthPerHour * elapsed);

      // ── Gold income + upkeep (deducted once per player) ───────
      const goldIncome = getGoldRate(city) * elapsed;

      const lastUpkeep    = player.lastUpkeepAt || (now - elapsed * 3600000);
      const upkeepElapsed = TimeService.hoursElapsed(lastUpkeep);
      const upkeepCost    = upkeepElapsed > 0
        ? getUpkeepPerHour(playerId) * upkeepElapsed
        : 0;

      const newCoins = Math.max(0, (player.coins || 0) + goldIncome - upkeepCost);
      PlayerService.update(playerId, {
        resources:    player.resources,
        coins:        Math.floor(newCoins),
        lastUpkeepAt: upkeepElapsed > 0 ? now : player.lastUpkeepAt,
      });
    }

    city.lastResourceUpdate = now;
    CityService.save(city);
  }

  return { getRates, getGoldRate, getUpkeepPerHour, getNetGoldRate, tick };
})();
