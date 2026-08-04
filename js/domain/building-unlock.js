// =============================================
//  building-unlock.js — Generic building unlock checker
//
//  Checks all unlock conditions for a building given the city and lord.
//  To add a new unlock type: add a case to the forEach below. Nothing else changes.
//
//  Supported types:
//    { type: 'race',         id: 'human' }          → lord's race must match
//    { type: 'population',   min: 500 }             → city population threshold
//    { type: 'landmark_none' }                      → city has no other landmark
//    { type: 'city_tier',    minTier: 3 }           → city tier (peak population)
//    { type: 'tech',         id, label }            → future technology (always locked for now)
//    { type: 'event',        label }                → future event trigger (always locked for now)
//
//  THIS IS THE GATE FOR CLIENT AND SERVER (2026-08-03), the same arrangement
//  js/domain/unit-unlock.js has for recruiting. Until then it ran only in the
//  browser: POST /api/city/build validated `maxLevel`, `requires`, the landmark
//  rule and cost, and NOTHING else — so a hand-rolled request could raise a
//  Dragon Lair as a dwarf, put a tier-5 building in a tier-1 city, and build
//  past the slot cap without limit. Exactly the shape of the recruitment-gate
//  exploit found on 2026-07-29.
//
//  It therefore has to run in the server's isolated VM context, which loads
//  economy-core.js but not the client-only CityStatsService singleton — so slot
//  and tier reads go straight to EconomyCore rather than through that wrapper.
// =============================================

// `var`, not `const` — every module the server's VM context loads must declare
// with `var` to become a property of that context. A top-level `const` is
// reachable from later scripts in a browser but invisible to
// server/engine-loader.js, which is how this file silently exported nothing on
// its first server-side run. Same declaration style as EconomyCore,
// MarketCore and UnitUnlockService.
var BuildingUnlockService = (() => {

  // Returns { locked: bool, reasons: string[] }
  // reasons contains human-readable lock messages (without the 🔒 prefix — UI adds it).
  function check(city, lord, def) {
    const reasons = [];

    // Slots and tier both read PEAK population — city tier is a ratchet since
    // 2026-08-03 (see cityPeakPopulation in economy-core.js), so a city that
    // shrinks keeps everything it has unlocked.
    const peakPop = EconomyCore.cityPeakPopulation(city);

    // Building slot limit check
    const currentLvl = (city.buildings || {})[def.id] || 0;
    const atMax      = currentLvl >= def.maxLevel;
    if (!atMax) {
      const { usedSlots, maxSlots } = EconomyCore.getSlotInfo(city.buildings, peakPop);
      if (usedSlots >= maxSlots) {
        reasons.push(`No building slots (${usedSlots}/${maxSlots}) — grow population to unlock more`);
      }
    }

    // Hard building prerequisites (from def.requires — same as ConstructionService checks)
    Object.entries(def.requires || {}).forEach(([reqId, reqLvl]) => {
      if (((city.buildings || {})[reqId] || 0) < reqLvl) {
        const rName = BUILDING_DEFS[reqId]?.name || reqId;
        reasons.push(`Requires ${rName} Level ${reqLvl}`);
      }
    });

    // Additional unlock conditions (def.unlockRequires)
    (def.unlockRequires || []).forEach(req => {
      switch (req.type) {

        case 'race': {
          const allowed = req.ids || [req.id];
          if (!allowed.includes(lord?.race)) {
            const names = allowed.map(r => RACES[r]?.name || r).join(' or ');
            reasons.push(`Requires Race: ${names}`);
          }
          break;
        }

        case 'population': {
          if ((city.population || 0) < req.min) {
            reasons.push(`Requires Population ${req.min.toLocaleString()}`);
          }
          break;
        }

        case 'landmark_none': {
          if (city.landmark && city.landmark !== def.id) {
            const lName = BUILDING_DEFS[city.landmark]?.name || city.landmark;
            reasons.push(`City already has a Landmark: ${lName}`);
          }
          break;
        }

        case 'city_tier': {
          const level = EconomyCore.getCityLevel(peakPop);
          if (level < req.minTier) {
            // Read the threshold off SLOT_TABLE rather than a hand-copied
            // array: the old TIER_POPS literal here silently stopped at tier 5
            // and would have printed "0+ population" for the tier 6 added on
            // 2026-07-30.
            const row     = (EconomyCore.SLOT_TABLE || []).find(r => r.level === req.minTier);
            const needPop = (row?.minPop || 0).toLocaleString();
            reasons.push(`Requires City Tier ${req.minTier} (${needPop}+ population)`);
          }
          break;
        }

        case 'tech': {
          // Technology system not implemented yet — always locked
          reasons.push(`Requires Technology: ${req.label || req.id}`);
          break;
        }

        case 'event': {
          // Event unlock not implemented yet — always locked
          reasons.push(`Requires: ${req.label || req.id}`);
          break;
        }
      }
    });

    return { locked: reasons.length > 0, reasons };
  }

  return { check };
})();
