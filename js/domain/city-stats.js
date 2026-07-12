// =============================================
//  city-stats.js — Derived city statistics
//
//  All six social stats (happiness, corruption, etc.) are derived, never stored.
//  Every building (and future: events, traits, technologies) contributes modifiers.
//  This module is the single source of truth for city health.
// =============================================

const CityStatsService = (() => {

  // Base values before any modifiers
  const BASE = {
    corruption:   10,
    happiness:    50,
    hygiene:      20,
    unemployment: 30,
    religion:     40,
    culture:      20,
    stability:    50,
    security:     20,
  };

  const META = {
    happiness:    { label: 'Happiness',    icon: '😊', goodHigh: true,  desc: 'Growth · Tax income'          },
    corruption:   { label: 'Corruption',   icon: '⚖',  goodHigh: false, desc: 'Tax loss · Happiness'         },
    hygiene:      { label: 'Hygiene',      icon: '💧', goodHigh: true,  desc: 'Disease risk · Growth'        },
    unemployment: { label: 'Unemployment', icon: '⚠',  goodHigh: false, desc: 'Stability · Happiness'        },
    religion:     { label: 'Religion',     icon: '✝',  goodHigh: true,  desc: 'Stability · Corruption'       },
    culture:      { label: 'Culture',      icon: '🎭', goodHigh: true,  desc: 'Immigration · Happiness'      },
    stability:    { label: 'Stability',    icon: '🏛',  goodHigh: true,  desc: 'Unrest resistance · Events'   },
    security:     { label: 'Security',     icon: '🛡',  goodHigh: true,  desc: 'Crime · Future military bonus' },
  };

  // ── Modifier collection ───────────────────────────────────────

  function getModifiers(city) {
    const mods = [];
    const now  = TimeService.now();

    // Building effects
    Object.entries(city.buildings || {}).forEach(([id, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = BUILDING_DEFS[id];
      if (!def || !def.effects) return;
      def.effects(lvl).forEach(e => mods.push({ ...e, source: `building:${id}` }));
    });

    // Active event modifiers (skip expired)
    (city.activeModifiers || []).forEach(m => {
      if (!m.expiresAt || now < m.expiresAt) mods.push(m);
    });

    return mods;
  }

  // ── Stat computation ──────────────────────────────────────────

  function getStats(city) {
    const mods  = getModifiers(city);
    const stats = { ...BASE };

    mods.forEach(({ stat, value }) => {
      if (stats[stat] !== undefined) stats[stat] += value;
    });

    _clamp(stats);

    // Cross-stat influences (intentionally simple arithmetic)
    if (stats.corruption > 20)    stats.happiness  -= Math.floor((stats.corruption  - 20) * 0.4);
    if (stats.culture    > 50)    stats.happiness  += Math.floor((stats.culture     - 50) * 0.2);
    if (stats.religion   > 60)    stats.corruption -= Math.floor((stats.religion    - 60) * 0.2);
    if (stats.unemployment > 20)  stats.happiness  -= Math.floor((stats.unemployment - 20) * 0.3);

    _clamp(stats);
    return stats;
  }

  function _clamp(stats) {
    Object.keys(stats).forEach(k => {
      stats[k] = Math.max(0, Math.min(100, Math.round(stats[k])));
    });
  }

  // ── City status ───────────────────────────────────────────────

  function getCityStatus(stats) {
    const score =
      (stats.happiness    - 50) * 0.35 +
      (50 - stats.corruption)   * 0.25 +
      (50 - stats.unemployment) * 0.15 +
      (stats.hygiene      - 50) * 0.10 +
      (stats.stability    - 50) * 0.15;

    if (score >= 25)  return { id: 'prosperous', label: 'Prosperous' };
    if (score >= 12)  return { id: 'growing',    label: 'Growing'    };
    if (score >= 0)   return { id: 'stable',     label: 'Stable'     };
    if (score >= -12) return { id: 'unrest',     label: 'Unrest'     };
    if (score >= -25) return { id: 'rioting',    label: 'Rioting'    };
    return                   { id: 'critical',   label: 'Critical'   };
  }

  // ── Stat health label ─────────────────────────────────────────

  function getStatHealth(statId, value) {
    const meta = META[statId];
    if (!meta) return { label: 'Unknown', cssClass: 'sh-stable' };
    const normalized = meta.goodHigh ? value : (100 - value);
    if (normalized >= 70) return { label: 'Excellent', cssClass: 'sh-excellent' };
    if (normalized >= 45) return { label: 'Stable',    cssClass: 'sh-stable'    };
    if (normalized >= 20) return { label: 'Warning',   cssClass: 'sh-warning'   };
    return                       { label: 'Critical',  cssClass: 'sh-critical'  };
  }

  // ── Population growth rate (pop/hour) ─────────────────────────

  function getPopulationGrowthRate(city, stats, productionRates) {
    let rate = 0;
    const food = productionRates.food || 0;

    if      (food > 0)                            rate += 2;
    else if (food === 0 && (city.population || 100) > 100) rate -= 1;

    if      (stats.happiness >= 70) rate += 2;
    else if (stats.happiness >= 50) rate += 1;
    else if (stats.happiness < 20)  rate -= 3;
    else if (stats.happiness < 35)  rate -= 1;

    if      (stats.hygiene >= 60) rate += 1;
    else if (stats.hygiene <  25) rate -= 1;
    else if (stats.hygiene <  10) rate -= 3;

    return Math.max(-8, Math.min(8, rate));
  }

  // ── Population tick ───────────────────────────────────────────
  // Called from ProductionService.tick(). Mutates city.population. Does NOT save.

  function tickPopulation(city, lord, productionRates, elapsed) {
    const stats = getStats(city);
    const rate  = getPopulationGrowthRate(city, stats, productionRates);
    if (rate !== 0) {
      city.population = Math.max(1, Math.round((city.population || 100) + rate * elapsed));
    }
    city.lastPopulationUpdate = TimeService.now();
  }

  // ── City level & building slots ───────────────────────────────

  const SLOT_TABLE = [
    { minPop:     0, level: 1, maxSlots:  30 },
    { minPop:   500, level: 2, maxSlots:  50 },
    { minPop:  2000, level: 3, maxSlots:  80 },
    { minPop:  5000, level: 4, maxSlots: 120 },
    { minPop: 15000, level: 5, maxSlots: 180 },
  ];

  function getCityLevel(city) {
    const pop = city.population || 100;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    return row.level;
  }

  function getSlotInfo(city) {
    const pop  = city.population || 100;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    const usedSlots = Object.values(city.buildings || {}).reduce((s, v) => s + v, 0);
    return { level: row.level, maxSlots: row.maxSlots, usedSlots };
  }

  return { META, getModifiers, getStats, getCityStatus, getStatHealth, getPopulationGrowthRate, tickPopulation, getCityLevel, getSlotInfo };
})();
