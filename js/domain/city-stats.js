// =============================================
//  city-stats.js — Derived city statistics
//
//  All eight social stats (happiness, corruption, etc.) are derived, never stored.
//  The stat math lives in EconomyCore (economy-core.js) — this service
//  collects the city context (event modifiers, terrain) and adds the
//  UI-facing helpers (labels, trends, status).
// =============================================

const CityStatsService = (() => {

  const META = {
    happiness:    { label: 'Happiness',    icon: gi('cheerful'), goodHigh: true,  desc: 'Growth · Tax income'          },
    corruption:   { label: 'Corruption',   icon: gi('scales'),  goodHigh: false, desc: 'Tax loss · Happiness'         },
    hygiene:      { label: 'Hygiene',      icon: gi('water-drop'), goodHigh: true,  desc: 'Disease risk · Growth'        },
    unemployment: { label: 'Unemployment', icon: gi('hazard-sign'),  goodHigh: false, desc: 'Stability · Happiness'        },
    religion:     { label: 'Religion',     icon: gi('crucifix'),  goodHigh: true,  desc: 'Stability · Corruption'       },
    culture:      { label: 'Culture',      icon: gi('drama-masks'), goodHigh: true,  desc: 'Immigration · Happiness'      },
    stability:    { label: 'Stability',    icon: gi('capitol'),  goodHigh: true,  desc: 'Unrest resistance · Events'   },
    security:     { label: 'Security',     icon: gi('round-shield'),  goodHigh: true,  desc: 'Crime · Future military bonus' },
  };

  // ── Modifier collection (UI listing + stat computation) ──────

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

  // Non-building extra effects for EconomyCore: active events + terrain.
  function _extraEffects(city) {
    const now    = TimeService.now();
    const extras = [];

    (city.activeModifiers || []).forEach(m => {
      if (!m.expiresAt || now < m.expiresAt) extras.push(m);
    });

    const terrain     = WorldService.getTerrain(city.x, city.y);
    const terrainStat = TERRAIN_STAT_MODS[terrain?.id] || [];
    terrainStat.forEach(e => extras.push(e));

    return extras;
  }

  // ── Stat computation ──────────────────────────────────────────

  function getStats(city) {
    return EconomyCore.getStats(city.buildings, city.population, _extraEffects(city));
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

  // ── Population growth rate (pop/hour) ─────────────────────────

  function getPopulationGrowthRate(city, stats, productionRates) {
    return EconomyCore.getPopGrowthRate(stats, (productionRates && productionRates.food) || 0);
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

  function degradeExcessBuildings(city) {
    return EconomyCore.degradeExcessBuildings(city);
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

  function getCityLevel(city) {
    return EconomyCore.getCityLevel(city.population);
  }

  function getSlotInfo(city) {
    return EconomyCore.getSlotInfo(city.buildings, city.population);
  }

  return { META, getModifiers, getStats, getCityStatus, getStatHealth, getPopulationGrowthRate, getStatTrends, tickPopulation, degradeExcessBuildings, getCityLevel, getSlotInfo };
})();
