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
//    { type: 'tech',         id, label }            → future technology (always locked for now)
//    { type: 'event',        label }                → future event trigger (always locked for now)
// =============================================

const BuildingUnlockService = (() => {

  // Returns { locked: bool, reasons: string[] }
  // reasons contains human-readable lock messages (without the 🔒 prefix — UI adds it).
  function check(city, lord, def) {
    const reasons = [];

    // Hard building prerequisites (from def.requires — same as ConstructionService checks)
    Object.entries(def.requires || {}).forEach(([reqId, reqLvl]) => {
      if ((city.buildings[reqId] || 0) < reqLvl) {
        const rName = BUILDING_DEFS[reqId]?.name || reqId;
        reasons.push(`Requires ${rName} Level ${reqLvl}`);
      }
    });

    // Additional unlock conditions (def.unlockRequires)
    (def.unlockRequires || []).forEach(req => {
      switch (req.type) {

        case 'race': {
          if (lord?.race !== req.id) {
            const raceName = RACES[req.id]?.name || req.id;
            reasons.push(`Requires Race: ${raceName}`);
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
