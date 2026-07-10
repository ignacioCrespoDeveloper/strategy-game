// =============================================
//  production.js — Timestamp-based resource production
//
//  No timers. No polling.
//  Call tick(city) on every city open to add the resources
//  that accumulated since the last update.
// =============================================

const ProductionService = (() => {

  // Calculate the base production rates (per hour) for a city,
  // applying race bonuses from the lord.
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

    // Apply race production bonuses
    if (race) {
      const b = race.bonuses;
      totals.food  = Math.floor(totals.food  * (1 + (b.food_production  || 0)));
      totals.wood  = Math.floor(totals.wood  * (1 + (b.wood_production  || 0)));
      totals.stone = Math.floor(totals.stone * (1 + (b.stone_production || 0)));
      totals.iron  = Math.floor(totals.iron  * (1 + (b.iron_production  || 0)));
    }

    return totals;
  }

  // Apply accumulated production since lastResourceUpdate.
  // Mutates city.resources and city.lastResourceUpdate, then saves.
  function tick(city, lord) {
    const now     = TimeService.now();
    const elapsed = TimeService.hoursElapsed(city.lastResourceUpdate || now);

    if (elapsed <= 0) return;

    const rates = getRates(city, lord);

    Object.entries(rates).forEach(([res, perHour]) => {
      if (perHour <= 0) return;
      city.resources[res] = (city.resources[res] || 0) + perHour * elapsed;
    });

    CityStatsService.tickPopulation(city, lord, rates, elapsed);

    city.lastResourceUpdate = now;
    CityService.save(city);
  }

  return { getRates, tick };
})();
