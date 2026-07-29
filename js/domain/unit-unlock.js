// =============================================
//  unit-unlock.js — Generic unit recruitment gate
//
//  The sibling of building-unlock.js: one place that answers
//  "can this lord train this unit in this city, and if not, why".
//  Same { locked, reasons[] } contract, same phrasing grammar.
//
//  ISOMORPHIC — this file runs in the browser AND in Node via
//  server/engine-loader.js, because server/actions/recruit.js is
//  the authoritative gate. Keep it that way:
//    • take `buildings` (a plain { id: level } map), never a city object
//    • never touch CityStatsService / CityService / TimeService —
//      those are browser-only and would break the server load
//
//  Gates, in the order they are reported:
//    1. race       — the unit belongs to another race's roster
//    2. trainable  — mercenaries and garrison units have no roster entry
//    3. building   — UNIT_ROSTER's training building + minimum level
//    4. lord level — legendary units need a lord of level 12
//
//  To add a gate: push a reason + a blockedBy key below. Nothing else
//  changes — the recruit UI, the Tech Tree and the server all read this.
// =============================================

// `var`, not `const` — engine-loader.js runs this in a vm context and only
// var-declarations become context properties (see its header comment).
var UnitUnlockService = (() => {

  const LEGENDARY_LORD_LEVEL = 12;

  function _raceName(raceId) {
    if (typeof RACES !== 'undefined' && RACES[raceId]?.name) return RACES[raceId].name;
    return raceId;
  }


  // Returns { locked: bool, reasons: string[], blockedBy: string[] }
  // reasons   — human-readable lock messages (without the 🔒 prefix — UI adds it)
  // blockedBy — stable keys for the gates that failed, in the same order:
  //             'race' | 'trainable' | 'building' | 'lord_level'
  //             Callers that need to branch on WHY read this rather than
  //             string-matching the reason text.
  //
  // ctx:
  //   race      → the recruiting lord's race id ('human', 'dark_elf', …)
  //   buildings → the training city's { buildingId: level } map
  //   lordLevel → optional; when omitted the legendary rule is skipped
  //               (callers that only ask "does this city unlock it" pass nothing)
  function check(unitId, ctx = {}) {
    const reasons   = [];
    const blockedBy = [];
    const def       = UNIT_DEFS[unitId];
    if (!def) return { locked: true, reasons: ['Unknown unit'], blockedBy: ['unknown'] };

    const buildings = ctx.buildings || {};

    // 1. Race — a roster unit can only be trained by its own race's lord.
    if (def.race && def.race !== ctx.race) {
      return {
        locked:    true,
        reasons:   [`${def.name} is a ${_raceName(def.race)} unit`],
        blockedBy: ['race'],
      };
    }

    // 2. Trainable — mercenaries (race: null) and garrison units have no
    //    UNIT_ROSTER entry. They are earned or spawned, never recruited;
    //    several cost 0 gold AND 0 time, so this check is load-bearing.
    const training = EconomyCore.getUnitTraining(ctx.race, unitId);
    if (!training) {
      return {
        locked:    true,
        reasons:   [`${def.name} cannot be trained in a city`],
        blockedBy: ['trainable'],
      };
    }

    // 3. Training building at the roster's minimum level.
    if ((buildings[training.buildingId] || 0) < training.minLevel) {
      const bName = (typeof BUILDING_DEFS !== 'undefined' && BUILDING_DEFS[training.buildingId]?.name)
        || training.buildingId;
      reasons.push(`Requires ${bName} Level ${training.minLevel}`);
      blockedBy.push('building');
    }

    // 4. Legendary units need a seasoned lord to command them.
    if (def.category === 'legendary' && ctx.lordLevel != null && ctx.lordLevel < LEGENDARY_LORD_LEVEL) {
      reasons.push(`Requires a lord of level ${LEGENDARY_LORD_LEVEL} or higher`);
      blockedBy.push('lord_level');
    }

    return { locked: reasons.length > 0, reasons, blockedBy };
  }

  return { check, LEGENDARY_LORD_LEVEL };
})();
