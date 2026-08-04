// =============================================
//  city-stats.js — Derived city statistics
//
//  All eight social stats (happiness, corruption, etc.) are derived, never stored.
//  The stat math lives in EconomyCore (economy-core.js) — this service
//  collects the city context (event modifiers, terrain) and adds the
//  UI-facing helpers (labels, trends, status).
//
//  getGrowthReport is THE entry point for anything that prints a city's status
//  badge or population arrow. Call it instead of assembling the badge from
//  EconomyCore.getCityStatus by hand — it is what makes the badge food-aware.
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
  };

  // ── Modifier collection (UI listing + stat computation) ──────

  // City events used to contribute timed `city.activeModifiers` to both
  // functions below. That system was deleted 2026-08-04 and replaced by city
  // items (js/data/items.js), which act on PRODUCTION rather than on stats and
  // are read through EconomyCore.getCityItemEffects — so stats now come from
  // buildings and terrain alone, and there is no live writer of activeModifiers
  // left anywhere. If a timed STAT effect is ever wanted again, give items a
  // stat-shaped effect key rather than reviving this rail.

  function getModifiers(city) {
    const mods = [];

    // Building effects
    Object.entries(city.buildings || {}).forEach(([id, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = BUILDING_DEFS[id];
      if (!def || !def.effects) return;
      def.effects(lvl).forEach(e => mods.push({ ...e, source: `building:${id}` }));
    });

    return mods;
  }

  // Non-building extra effects for EconomyCore: terrain stat mods.
  function _extraEffects(city) {
    const terrain = WorldService.getTerrain(city.x, city.y);
    return [...(TERRAIN_STAT_MODS[terrain?.id] || [])];
  }

  // ── Stat computation ──────────────────────────────────────────

  function getStats(city) {
    return EconomyCore.getStats(city.buildings, city.population, _extraEffects(city));
  }

  // ── City status ───────────────────────────────────────────────
  // The scoring itself lives in EconomyCore — it drives population growth,
  // so the server needs it too.

  const STATUS_STATS  = EconomyCore.STATUS_STATS;
  const DEFENSE_STATS = EconomyCore.DEFENSE_STATS;

  // ── Growth report (THE call every screen should use) ──────────
  // Four screens print a city's badge and growth arrow — city view's left
  // panel, its overview tab, the home city card and the map info panel — and
  // each used to assemble it by hand from getStats + getRates + getCityStatus.
  // Only city view remembered that a famine overrides the badge, so the home
  // screen and the map cheerfully labelled a shrinking city "Stable".
  //
  // One function now owns the whole story: the rate, the label the player
  // reads, and the arrow. A famine REPLACES the badge rather than sitting
  // beside it — the badge must never promise growth over a falling population.
  // This superseded the old getCityStatus wrapper and getStatusGrowthEffect,
  // both of which were deleted with it: `perDay` is here, and `foodDrag` is now
  // just `!fed` (a fed city's growth always equals its tier rate exactly).
  function getGrowthReport(city, stats, productionRates) {
    const growth = getPopulationGrowthRate(city, stats, productionRates);
    const status = EconomyCore.getCityStatus(stats);
    const fed    = _isFed(city, productionRates);
    const perDay = Math.round(growth * 24);

    return {
      growth,
      perDay,
      status,
      fed,
      // Badge presentation. `id` drives the cvl-* colour classes, so famine
      // needs its own (css/app.css) rather than borrowing a tier's.
      badgeId:    fed ? status.id : 'famine',
      badgeLabel: fed ? status.label : 'Famine',
      sign:       growth > 0 ? '▲' : '▼',
      cssClass:   growth > 0 ? 'pop-growing' : 'pop-declining',
      perDayText: `${perDay > 0 ? '+' : ''}${perDay.toLocaleString()} / day`,
      title: fed
        ? `${status.label} status sets this city's growth: ${growth > 0 ? '+' : ''}${growth}/hr`
        : `No food — this city is starving and losing population at ${growth}/hr. `
          + `Build a Farm here, or stock the empire larder.`,
    };
  }

  // A city is fed by the EMPIRE pool, not only by its own farms — the same
  // rule the server tick applies (see EconomyCore.isCityFed).
  function _isFed(city, productionRates) {
    const player = PlayerService.getById(city.playerId);
    return EconomyCore.isCityFed(
      (productionRates && productionRates.food) || 0,
      (player && player.resources && player.resources.food) || 0
    );
  }

  // ── Stat health label ─────────────────────────────────────────
  // Thin label/colour mapping over EconomyCore.getStatTier, which is the
  // same banding the status gates use — the badge cannot disagree with the
  // rows because both read one function.

  const HEALTH_LABELS = {
    excellent: { label: 'Excellent', cssClass: 'sh-excellent' },
    stable:    { label: 'Stable',    cssClass: 'sh-stable'    },
    warning:   { label: 'Warning',   cssClass: 'sh-warning'   },
    critical:  { label: 'Critical',  cssClass: 'sh-critical'  },
  };

  function getStatHealth(statId, value) {
    if (!META[statId]) return { label: 'Unknown', cssClass: 'sh-stable' };
    return HEALTH_LABELS[EconomyCore.getStatTier(statId, value)];
  }

  // ── Population growth rate (pop/hour) ─────────────────────────

  function getPopulationGrowthRate(city, stats, productionRates) {
    const player = PlayerService.getById(city.playerId);
    // Famine reads the empire larder, not just this city's farms — mirrors the
    // server tick (catch-up.js) and EconomyCore.isCityFed.
    let rate = EconomyCore.getPopGrowthRate(
      stats,
      (productionRates && productionRates.food) || 0,
      player?.resources?.food || 0
    );
    // God of Fertility blessing boosts positive growth only — a blessing
    // should never deepen a decline. Mirrors the server catch-up guard.
    if (rate > 0) {
      const fx = EconomyCore.getBlessingEffects(player?.activeBlessing, TimeService.now());
      if (fx.pop_growth_bonus) rate = Math.round(rate * (1 + fx.pop_growth_bonus));
    }
    return rate;
  }

  // ── Stat trend indicators ─────────────────────────────────────
  // Returns { statId: '▲'|'▼'|'─' } based on how stats shift with population growth.
  // A stat may hold steady ('─'); the POPULATION never does, so there is no
  // longer an all-flat early return here for growth === 0 — that case cannot
  // happen (see EconomyCore.getPopGrowthRate).

  function getStatTrends(city, stats, growth) {
    const futureCity  = { ...city, population: Math.max(1, (city.population || 1000) + growth) };
    const futureStats = getStats(futureCity);
    return Object.fromEntries(
      Object.keys(META).map(k => {
        const delta = (futureStats[k] ?? 0) - (stats[k] ?? 0);
        return [k, delta > 0 ? '▲' : delta < 0 ? '▼' : '─'];
      })
    );
  }

  // ── Population tick ───────────────────────────────────────────
  // Called from ProductionService.tick(). Mutates city.population. Does NOT save.

  function tickPopulation(city, lord, productionRates, elapsed) {
    const stats = getStats(city);
    const rate  = getPopulationGrowthRate(city, stats, productionRates);
    city.population = Math.max(1, Math.round((city.population || 1000) + rate * elapsed));
    // Tier ratchet — see cityPeakPopulation in economy-core.js. This replaced
    // degradeExcessBuildings, which used to run here and destroy buildings at
    // random whenever a shrinking city fell below a slot threshold.
    EconomyCore.updatePeakPopulation(city);
    city.lastPopulationUpdate = TimeService.now();
  }

  // ── City level & building slots ───────────────────────────────
  // Both read the PEAK population, never the current one: tier and slots only
  // ever go up. A city that shrinks keeps its slots and its buildings.

  function getCityLevel(city) {
    return EconomyCore.getCityLevel(EconomyCore.cityPeakPopulation(city));
  }

  function getSlotInfo(city) {
    return EconomyCore.getSlotInfo(city.buildings, EconomyCore.cityPeakPopulation(city));
  }

  return { META, STATUS_STATS, DEFENSE_STATS, getModifiers, getStats, getGrowthReport, getStatHealth, getPopulationGrowthRate, getStatTrends, tickPopulation, getCityLevel, getSlotInfo };
})();
