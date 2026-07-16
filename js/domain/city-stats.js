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
    corruption:   0,
    happiness:    50,
    hygiene:      50,
    unemployment: 15,
    religion:     50,
    culture:      50,
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

    // Terrain stat effects (permanent, structural — not shown as temporary events)
    const terrain     = WorldService.getTerrain(city.x, city.y);
    const terrainStat = TERRAIN_STAT_MODS[terrain?.id] || [];
    terrainStat.forEach(({ stat, value }) => {
      if (stats[stat] !== undefined) stats[stat] += value;
    });

    // Population pressure — larger populations demand more services
    const pop = city.population || 1000;
    if (pop > 1000) {
      stats.hygiene      -= Math.floor((pop - 1000) / 2000);
      stats.unemployment += Math.floor((pop - 1000) / 5000);
    }

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

  function getCityStatus(stats, growth = 0) {
    let score =
      (stats.happiness - 50) * 0.55 +
      (stats.hygiene   - 50) * 0.25 +
      (stats.stability - 50) * 0.20;

    // Growth rate nudges status: a booming city trends toward Prosperous,
    // a declining one toward Critical — even before stats fully respond.
    if      (growth >  200) score += 8;
    else if (growth >    0) score += 3;
    else if (growth < -200) score -= 8;
    else if (growth <    0) score -= 3;

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

  // ── Population growth rate (pop/hour) — percentage of current pop ──

  function getPopulationGrowthRate(city, stats, productionRates) {
    let pct = 0;

    if      (stats.happiness >= 70) pct += 0.30;
    else if (stats.happiness >= 50) pct += 0.15;
    else if (stats.happiness >= 35) pct += 0.05;
    else if (stats.happiness <  20) pct -= 0.20;
    else                             pct -= 0.08;

    if      (stats.hygiene >= 60) pct += 0.15;
    else if (stats.hygiene <  25) pct -= 0.10;
    else if (stats.hygiene <  10) pct -= 0.25;

    const food = (productionRates && productionRates.food) || 0;
    if (food > 0)  pct += 0.08;
    else           pct -= 0.05;

    const warningCount = Object.keys(stats).filter(k => {
      const h = getStatHealth(k, stats[k]);
      return h.label === 'Warning' || h.label === 'Critical';
    }).length;
    if (warningCount >= 3) pct -= 0.10;
    if (warningCount >= 5) pct -= 0.20;

    pct = Math.max(-0.50, Math.min(0.55, pct));
    return Math.round(pct * 1130);
  }

  // ── Stat trend indicators ─────────────────────────────────────
  // Returns { statId: '▲'|'▼'|'─' } based on how stats shift with population growth.

  function getStatTrends(city, stats, growth) {
    if (growth === 0) {
      return Object.fromEntries(Object.keys(META).map(k => [k, '─']));
    }
    const futureCity  = { ...city, population: Math.max(1, (city.population || 1000) + growth) };
    const futureStats = getStats(futureCity);
    return Object.fromEntries(
      Object.keys(META).map(k => {
        const delta = (futureStats[k] ?? 0) - (stats[k] ?? 0);
        return [k, delta > 0 ? '▲' : delta < 0 ? '▼' : '─'];
      })
    );
  }

  // ── Building degradation when tier drops ─────────────────────
  // If usedSlots > maxSlots (can only happen after population decline drops a tier),
  // randomly degrade buildings until slots fit.

  function degradeExcessBuildings(city) {
    const { usedSlots, maxSlots } = getSlotInfo(city);
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

  // ── Population tick ───────────────────────────────────────────
  // Called from ProductionService.tick(). Mutates city.population. Does NOT save.

  function tickPopulation(city, lord, productionRates, elapsed) {
    const stats = getStats(city);
    const rate  = getPopulationGrowthRate(city, stats, productionRates);
    if (rate !== 0) {
      city.population = Math.max(1, Math.round((city.population || 1000) + rate * elapsed));
    }
    degradeExcessBuildings(city);
    city.lastPopulationUpdate = TimeService.now();
  }

  // ── City level & building slots ───────────────────────────────

  const SLOT_TABLE = [
    { minPop:      0, level: 1, maxSlots:  60 },
    { minPop:  10000, level: 2, maxSlots: 100 },
    { minPop:  25000, level: 3, maxSlots: 150 },
    { minPop:  50000, level: 4, maxSlots: 220 },
    { minPop: 100000, level: 5, maxSlots: 320 },
  ];

  function getCityLevel(city) {
    const pop = city.population || 1000;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    return row.level;
  }

  function getSlotInfo(city) {
    const pop  = city.population || 1000;
    let row = SLOT_TABLE[0];
    for (const entry of SLOT_TABLE) {
      if (pop >= entry.minPop) row = entry;
    }
    const usedSlots = Object.values(city.buildings || {}).reduce((s, v) => s + v, 0);
    return { level: row.level, maxSlots: row.maxSlots, usedSlots };
  }

  return { META, getModifiers, getStats, getCityStatus, getStatHealth, getPopulationGrowthRate, getStatTrends, tickPopulation, degradeExcessBuildings, getCityLevel, getSlotInfo };
})();
