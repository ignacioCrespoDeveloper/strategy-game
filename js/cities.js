// =============================================
//  cities.js — city state, buildings, training
// =============================================

const Cities = (() => {
  let list = [];

  const POP_BASE_GROWTH = 3;

  function init() {
    list = CITY_SPAWNS.map(s => ({
      c:                    s.c,
      r:                    s.r,
      name:                 s.name,
      owner:                s.owner,
      factionId:            null,
      type:                 'aldea',
      pop:                  50,
      hp:                   100,
      maxHp:                100,
      buildings:            { town_hall: 1 },
      queue:                [],
      developmentType:      'standard',
      infectionStage:       null,
      infectionTurnsAtStage: 0,
    }));
  }

  // Returns the building catalog for this city's developmentType.
  function _getTree(city) {
    const dt = city.developmentType || 'standard';
    return (typeof BUILDING_TREES !== 'undefined' && BUILDING_TREES[dt]) || BUILDING_TYPES;
  }

  // Looks up a building definition in the city's own tree.
  function _treeLookup(city, key) {
    return _getTree(city)[key] || null;
  }

  // Public: returns the full building catalog available to this city.
  function getAvailableBuildings(city) { return _getTree(city); }

  // Public: looks up a building def in the city's tree (used by ui.js).
  function getBuildingDef(city, key)   { return _treeLookup(city, key); }

  function getAll()    { return list; }
  function getAt(c, r) { return list.find(ci => ci.c === c && ci.r === r) || null; }

  function setOwner(c, r, owner) {
    const city = getAt(c, r);
    if (city) city.owner = owner;
  }

  function setFaction(c, r, factionId) {
    const city = getAt(c, r);
    if (city) city.factionId = factionId;
  }

  // Returns a Set of terrain types (including 'coast') within city's influence radius
  function getTerrainInRadius(city) {
    const typeData = CITY_TYPES[city.type || 'aldea'];
    const radius   = typeData.influence;
    const types    = new Set();
    const visited  = new Set();
    const queue    = [{ c: city.c, r: city.r, dist: 0 }];
    visited.add(hexKey(city.c, city.r));

    while (queue.length) {
      const { c, r, dist } = queue.shift();
      const t = TERRAIN_MAP[r]?.[c];
      if (t) types.add(t);
      // Coastal: non-water hex that borders water
      if (t && t !== 'water') {
        if (neighbors(c, r).some(n => TERRAIN_MAP[n.r]?.[n.c] === 'water')) {
          types.add('coast');
        }
      }
      if (dist < radius) {
        neighbors(c, r).forEach(n => {
          const k = hexKey(n.c, n.r);
          if (!visited.has(k)) { visited.add(k); queue.push({ c: n.c, r: n.r, dist: dist + 1 }); }
        });
      }
    }
    return types;
  }

  // Recalculate maxHp from city type base + all building hpBonus values
  function recalcMaxHp(city) {
    const typeData = CITY_TYPES[city.type || 'aldea'];
    let maxHp = typeData.hp;
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def   = _treeLookup(city, key);
      const bonus = def?.hpBonus?.[lvl - 1] || 0;
      maxHp += bonus;
    });
    city.maxHp = maxHp;
    city.hp    = Math.min(city.hp, city.maxHp);
  }

  // Food produced by this city per turn (from type income + buildings)
  function getCityFoodProduction(city) {
    const typeData = CITY_TYPES[city.type || 'aldea'];
    if (city.developmentType === 'infected') return 0; // Infected cities produce no food
    let food = typeData.income.food || 0;
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = _treeLookup(city, key);
      food += def?.bonus?.[lvl - 1]?.food || 0;
    });
    return food;
  }

  // Food consumed per turn = 1 per 100 population
  function getCityFoodConsumption(city) {
    return Math.floor((city.pop || 0) / 100);
  }

  // Net food balance (positive = surplus, negative = famine)
  function getCityFoodBalance(city) {
    return getCityFoodProduction(city) - getCityFoodConsumption(city);
  }

  // Population growth this turn (base 3 + building bonuses - famine)
  function getCityPopGrowth(city) {
    if (city.developmentType === 'infected') return -5; // Population decays under infection
    let growth = POP_BASE_GROWTH;
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = _treeLookup(city, key);
      growth += def?.bonus?.[lvl - 1]?.pop || 0;
    });
    if (getCityFoodBalance(city) < 0) growth -= 10;  // famine
    return growth;
  }

  // Auto-upgrade city type based on population. Returns new type if changed, null otherwise.
  function checkPopLevel(city) {
    const levels  = POP_LEVELS.slice().reverse();
    for (const { type, minPop } of levels) {
      if ((city.pop || 0) >= minPop) {
        if (city.type !== type) {
          city.type = type;
          recalcMaxHp(city);
          return type;
        }
        break;
      }
    }
    return null;
  }

  // Units trainable in this city (aggregated from all military buildings)
  function getTrainableUnits(city) {
    const trainable = new Set();
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = _treeLookup(city, key);
      if (!def?.trains) return;
      for (let l = 1; l <= lvl; l++) {
        (def.trains[l] || []).forEach(u => trainable.add(u));
      }
    });
    return [...trainable];
  }

  function canAfford(cost, resources) {
    return Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
  }

  function deduct(cost, resources) {
    Object.entries(cost).forEach(([k, v]) => { resources[k] = (resources[k] || 0) - v; });
  }

  // Build or upgrade a building.
  // Buildings with upgradesFrom REPLACE their parent (same slot, no slot cost).
  // Upgrading an existing building to next level also costs no new slot.
  function buildBuilding(city, buildingKey, resources) {
    const def = _treeLookup(city, buildingKey);
    if (!def) return { ok: false, msg: 'Edificio desconocido.' };
    if (def.fixed) return { ok: false, msg: 'Este edificio es inamovible.' };

    const currentLvl = city.buildings[buildingKey] || 0;
    if (currentLvl >= def.maxLevel) return { ok: false, msg: 'Ya está al nivel máximo.' };

    const typeData = CITY_TYPES[city.type || 'aldea'];

    // Upgrade-in-place: replaces parent building → no new slot needed
    let parentKey = null;
    if (def.upgradesFrom && currentLvl === 0) {
      const parentLvl = city.buildings[def.upgradesFrom] || 0;
      if (parentLvl === 0) {
        const parentName = _treeLookup(city, def.upgradesFrom)?.name || def.upgradesFrom;
        return { ok: false, msg: `Requiere ${parentName}.` };
      }
      parentKey = def.upgradesFrom;
    }

    // Slot check: only when adding a brand-new root building
    if (!parentKey && currentLvl === 0) {
      const builtSlots   = Object.values(city.buildings).filter(lvl => lvl > 0).length;
      const queuedSlots  = city.queue.filter(q => q.type === 'building' && !q.parentKey).length;
      const usedSlots    = builtSlots + queuedSlots;
      if (usedSlots >= typeData.slots) {
        return { ok: false, msg: `Slots llenos (${usedSlots}/${typeData.slots}). Crece la ciudad para más slots.` };
      }
    }

    // Terrain requirement (only on initial construction)
    if (def.terrainReq && currentLvl === 0 && !parentKey) {
      const terrain = getTerrainInRadius(city);
      if (!terrain.has(def.terrainReq)) {
        const names = { plains: 'llanura', forest: 'bosque', mountain: 'montaña', coast: 'costa' };
        return { ok: false, msg: `Requiere ${names[def.terrainReq] || def.terrainReq} en radio de influencia.` };
      }
    }

    // Population requirement
    if (def.popReq && (city.pop || 0) < def.popReq) {
      return { ok: false, msg: `Requiere ${def.popReq} hab. (actual: ${Math.floor(city.pop || 0)}).` };
    }

    const cost = def.cost[currentLvl];
    if (!cost) return { ok: false, msg: 'Sin costo definido para este nivel.' };
    if (!canAfford(cost, resources)) return { ok: false, msg: 'Recursos insuficientes.' };

    // Only 1 building under construction at a time
    const buildingInQueue = city.queue.some(q => q.type === 'building');
    if (buildingInQueue) return { ok: false, msg: 'Ya hay un edificio en construcción en esta ciudad.' };

    deduct(cost, resources);

    const buildTime = def.buildTime || 1;
    city.queue.push({ type: 'building', key: buildingKey, turnsLeft: buildTime, parentKey: parentKey || null, newLevel: currentLvl + 1 });

    const timeStr = buildTime === 1 ? '1 turno' : `${buildTime} turnos`;
    const newLvl  = currentLvl + 1;
    const lvlStr  = newLvl > 1 ? ` Lv${['I','II','III','IV','V'][newLvl - 1] || newLvl}` : '';
    return { ok: true, msg: `${def.name}${lvlStr} en construcción — ${timeStr}.` };
  }

  function trainUnit(city, unitType, resources) {
    const def = UNIT_TYPES[unitType];
    if (!def) return { ok: false, msg: 'Tipo de unidad desconocido.' };

    const trainable = getTrainableUnits(city);
    if (!trainable.includes(unitType)) {
      return { ok: false, msg: 'Construye un cuartel adecuado para esta unidad.' };
    }

    if (!canAfford(def.cost, resources)) return { ok: false, msg: 'Recursos insuficientes.' };

    deduct(def.cost, resources);
    city.queue.push({ type: 'unit', key: unitType, turnsLeft: def.trainTime });
    return { ok: true, msg: `Entrenando ${def.name}... (${def.trainTime} turno${def.trainTime > 1 ? 's' : ''})` };
  }

  // End-of-turn processing: advance queues + grow population
  function processTurnEnd() {
    const spawns = [];

    const infectionEvents = [];

    list.forEach(city => {
      // Advance queue
      city.queue = city.queue.filter(item => {
        item.turnsLeft--;
        if (item.turnsLeft <= 0) {
          if (item.type === 'unit') {
            spawns.push({ type: item.key, c: city.c, r: city.r, owner: city.owner });
          } else if (item.type === 'building') {
            if (item.parentKey) delete city.buildings[item.parentKey];
            city.buildings[item.key] = item.newLevel;
            recalcMaxHp(city);
          }
          return false;
        }
        return true;
      });

      // Population growth/decay
      const growth = getCityPopGrowth(city);
      city.pop     = Math.max(0, (city.pop || 0) + growth);
      if (city.developmentType !== 'infected') checkPopLevel(city);

      // Infection stage progression for player-owned infected cities
      if (city.owner === 'player' && city.infectionStage) {
        const newStage = processInfection(city);
        if (newStage) infectionEvents.push({ name: city.name, stage: newStage });
      }
    });

    return { spawns, infectionEvents };
  }

  function captureAt(c, r, newOwner) {
    const city = getAt(c, r);
    if (!city || city.owner === newOwner) return null;
    const prev = city.owner;
    city.owner = newOwner;
    city.hp    = Math.floor(city.maxHp * 0.5);
    city.queue = [];
    return { name: city.name, prev };
  }

  function getBuildingLevel(city, key) { return city.buildings[key] || 0; }

  function getGarrisonTypes(city) {
    const tier = CITY_TYPES[city.type || 'aldea']?.tier ?? 0;
    const bases = [
      ['militia', 'militia'],
      ['militia', 'militia', 'militia'],
      ['militia', 'militia', 'warrior'],
      ['warrior', 'warrior', 'militia', 'militia'],
    ];
    const types = [...(bases[Math.min(tier, 3)] || bases[0])];
    if ((city.buildings.barracks || 0) >= 1) {
      const idx = types.indexOf('militia');
      if (idx >= 0) types[idx] = 'warrior';
    }
    if ((city.buildings.archery_range || 0) >= 1) types.push('archer');
    return types;
  }

  function getTotalBuildingMaintenance(city) {
    const total = {};
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = _treeLookup(city, key);
      Object.entries(def?.maintenance || {}).forEach(([k, v]) => {
        if (v > 0) total[k] = (total[k] || 0) + v;
      });
    });
    return total;
  }

  function setDevelopmentType(c, r, type) {
    const city = getAt(c, r);
    if (city) city.developmentType = type;
  }

  // Infects a city: transfers ownership, installs Infection Pit, begins Stage 1.
  function infectCity(c, r) {
    const city = getAt(c, r);
    if (!city || city.owner === 'player') return null;
    const prev = city.owner;
    city.owner                = 'player';
    city.developmentType      = 'infected';
    city.infectionStage       = 1;
    city.infectionTurnsAtStage = 0;
    city.hp                   = Math.floor(city.maxHp * 0.3);
    city.queue                = [];
    city.buildings            = { infection_pit: 1 };
    return { name: city.name, prev };
  }

  // Loots a city: returns resources, damages pop, does NOT change ownership.
  function lootCity(c, r) {
    const city = getAt(c, r);
    if (!city) return null;
    const loot = {
      gold: Math.max(5, Math.floor((city.pop || 0) / 10)),
      food: Math.max(5, Math.floor((city.pop || 0) / 20)),
    };
    city.pop = Math.max(10, Math.floor((city.pop || 0) * 0.6));
    city.hp  = Math.floor(city.maxHp * 0.25);
    return loot;
  }

  // Advances the infection stage of a single city.
  // Returns the new stage number if it advanced, otherwise null.
  const INFECTION_THRESHOLDS = [null, 3, 5]; // turns needed at each stage before advancing
  function processInfection(city) {
    if (!city.infectionStage || city.infectionStage >= 3) return null;
    city.infectionTurnsAtStage = (city.infectionTurnsAtStage || 0) + 1;
    if (city.infectionTurnsAtStage >= INFECTION_THRESHOLDS[city.infectionStage]) {
      city.infectionStage++;
      city.infectionTurnsAtStage = 0;
      return city.infectionStage;
    }
    return null;
  }

  function getTotalBuildingMaintenanceForCities(cities) {
    const total = {};
    (cities || []).forEach(city => {
      Object.entries(getTotalBuildingMaintenance(city)).forEach(([k, v]) => {
        total[k] = (total[k] || 0) + v;
      });
    });
    return total;
  }

  return {
    init, getAll, getAt, setOwner, setFaction,
    buildBuilding, trainUnit,
    processTurnEnd, captureAt, getBuildingLevel,
    getTrainableUnits, getTerrainInRadius, getGarrisonTypes,
    getCityFoodBalance, getCityFoodProduction, getCityFoodConsumption, getCityPopGrowth,
    recalcMaxHp, getTotalBuildingMaintenance, getTotalBuildingMaintenanceForCities,
    setDevelopmentType, infectCity, lootCity, processInfection,
    getAvailableBuildings, getBuildingDef,
  };
})();
