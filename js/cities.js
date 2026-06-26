// =============================================
//  cities.js — city state, buildings, training
// =============================================

const Cities = (() => {
  let list = [];

  function init() {
    list = CITY_SPAWNS.map(s => ({
      c:         s.c,
      r:         s.r,
      name:      s.name,
      owner:     s.owner,
      hp:        100,
      maxHp:     100,
      buildings: Object.keys(BUILDING_TYPES).map(() => 0),  // level per building
      queue:     [],   // { type:'unit'|'building', key, turnsLeft }
    }));
  }

  function getAll()    { return list; }
  function getAt(c, r) { return list.find(ci => ci.c === c && ci.r === r) || null; }

  // Attempt to construct/upgrade a building
  function buildBuilding(city, buildingKey, resources) {
    const bKeys      = Object.keys(BUILDING_TYPES);
    const bIdx       = bKeys.indexOf(buildingKey);
    const def        = BUILDING_TYPES[buildingKey];
    const currentLvl = city.buildings[bIdx];

    if (currentLvl >= def.maxLevel) return { ok: false, msg: 'Already at max level.' };

    // Check prerequisites
    if (def.requires) {
      for (const [reqKey, reqLvl] of Object.entries(def.requires)) {
        const reqIdx = bKeys.indexOf(reqKey);
        if (city.buildings[reqIdx] < reqLvl) {
          return { ok: false, msg: `Requires ${BUILDING_TYPES[reqKey].name} Lv${reqLvl}.` };
        }
      }
    }

    const cost = def.cost[currentLvl];
    if (!canAfford(cost, resources)) return { ok: false, msg: 'Not enough resources.' };

    deduct(cost, resources);
    city.buildings[bIdx] = currentLvl + 1;
    return { ok: true, msg: `${def.name} upgraded to level ${city.buildings[bIdx]}!` };
  }

  // Attempt to train a unit
  function trainUnit(city, unitType, resources) {
    const def  = UNIT_TYPES[unitType];
    if (!def) return { ok: false, msg: 'Unknown unit type.' };

    // Check barracks level
    const barrIdx = Object.keys(BUILDING_TYPES).indexOf('barracks');
    const barrLvl = city.buildings[barrIdx];
    const unlocked = BARRACKS_UNLOCK[barrLvl] || [];
    if (!unlocked.includes(unitType)) return { ok: false, msg: 'Upgrade Barracks to train this unit.' };

    if (!canAfford(def.cost, resources)) return { ok: false, msg: 'Not enough resources.' };

    deduct(def.cost, resources);
    city.queue.push({ type: 'unit', key: unitType, turnsLeft: def.trainTime });
    return { ok: true, msg: `Training ${def.name}… (${def.trainTime} turn${def.trainTime > 1 ? 's' : ''})` };
  }

  // Process queues at end-of-turn, returns array of spawned units
  function processTurnEnd() {
    const spawns = [];
    list.forEach(city => {
      city.queue = city.queue.filter(item => {
        item.turnsLeft--;
        if (item.turnsLeft <= 0) {
          if (item.type === 'unit') {
            spawns.push({ type: item.key, c: city.c, r: city.r, owner: city.owner });
          }
          return false;
        }
        return true;
      });
    });
    return spawns;
  }

  function canAfford(cost, resources) {
    return Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
  }

  function deduct(cost, resources) {
    Object.entries(cost).forEach(([k, v]) => { resources[k] = (resources[k] || 0) - v; });
  }

  // Capture a city when a unit walks onto it; returns {name, prev} or null
  function captureAt(c, r, newOwner) {
    const city = getAt(c, r);
    if (!city || city.owner === newOwner) return null;
    const prev  = city.owner;
    city.owner  = newOwner;
    city.hp     = city.maxHp;
    city.queue  = [];  // cancel enemy training queue on capture
    return { name: city.name, prev };
  }

  function getBuildingLevel(city, key) {
    const idx = Object.keys(BUILDING_TYPES).indexOf(key);
    return city.buildings[idx];
  }

  return {
    init, getAll, getAt,
    buildBuilding, trainUnit,
    processTurnEnd, captureAt, getBuildingLevel,
  };
})();
