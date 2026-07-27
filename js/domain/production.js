// =============================================
//  production.js — Timestamp-based resource production
//
//  No timers. No polling.
//  Call tick(city, lord) on every city open to accumulate resources,
//  gold income, upkeep deductions, and freePopulation growth.
//
//  All economy math lives in EconomyCore (economy-core.js) —
//  this service only wires city/lord/terrain context into it.
//
//  Gold income per city:  pop × 0.004 × (happiness/100), +8%/marketplace level
//  NO upkeep of any kind — armies are constrained by the PWR cap only.
//  freePopulation growth: +5/day per city (≈0.2083/h), capped at 20
// =============================================

const ProductionService = (() => {

  // Resource rates (food/wood/stone) per hour for a city:
  // building output × (race + Library research) bonuses × terrain multipliers.
  function getRates(city, lord) {
    const race     = lord ? (RACES[lord.race] || null) : null;
    const terrain  = WorldService.getTerrain(city.x, city.y);
    const player   = PlayerService.getById(city.playerId);
    const research = EconomyCore.getResearchEffects(player?.research);
    const bonuses  = {};
    ['food', 'wood', 'stone'].forEach(r => {
      bonuses[r + '_production'] = (race?.bonuses?.[r + '_production'] || 0) + (research[r + '_production'] || 0);
    });
    return EconomyCore.getRates(
      city.buildings,
      bonuses,
      TERRAIN_RESOURCE_MODS[terrain?.id] || null
    );
  }

  // Gold income per hour from a single city.
  function getGoldRate(city) {
    const stats = CityStatsService.getStats(city);
    return EconomyCore.getGoldRate(city.buildings, city.population, stats.happiness);
  }

  // Total gold rate for a player across all cities. (Upkeep was removed
  // entirely in the 2026-07-27 review — armies are constrained by the PWR
  // cap, not by maintenance costs — so "net" now equals plain income.)
  function getNetGoldRate(playerId) {
    return CityService.getPlayerCities(playerId)
      .reduce((s, city) => s + getGoldRate(city), 0);
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
      if (!player.resources) player.resources = { food: 0, wood: 0, stone: 0 };
      delete player.resources.iron; // legacy resource, removed in the OGame overhaul

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

      // ── Gold income ───────────────────────────────────────────
      const goldIncome = getGoldRate(city) * elapsed;
      PlayerService.update(playerId, {
        resources: player.resources,
        coins:     Math.floor((player.coins || 0) + goldIncome),
      });
    }

    city.lastResourceUpdate = now;
    CityService.save(city);
  }

  return { getRates, getGoldRate, getNetGoldRate, tick };
})();
