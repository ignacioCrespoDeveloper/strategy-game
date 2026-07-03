// =============================================
//  map.js — map state: resources, zones, income
// =============================================

const GameMap = (() => {
  const resourceMap       = {};
  const capturedResources = {};

  function init() {
    RESOURCE_SPAWNS.forEach(({ c, r, type }) => {
      resourceMap[hexKey(c, r)] = type;
      capturedResources[hexKey(c, r)] = null;
    });
  }

  function getResource(c, r)   { return resourceMap[hexKey(c, r)] || null; }
  function getCapturedBy(c, r) { return capturedResources[hexKey(c, r)] || null; }

  function processCapture(c, r, owner) {
    const k = hexKey(c, r);
    if (!resourceMap[k]) return null;
    if (capturedResources[k] === owner) return null;
    capturedResources[k] = owner;
    return { type: resourceMap[k] };
  }

  // Control zones: hexes within 1 step of each owner's units + city influence radius
  function getZones(units, cities) {
    const zones = { player: new Set(), enemy: new Set() };

    units.forEach(u => {
      const side = zones[u.owner];
      if (!side) return;
      side.add(hexKey(u.c, u.r));
      neighbors(u.c, u.r).forEach(n => side.add(hexKey(n.c, n.r)));
    });

    if (cities) {
      cities.forEach(ci => {
        const side = zones[ci.owner];
        if (!side) return;
        const typeData  = CITY_TYPES[ci.type || 'aldea'];
        const range     = typeData.influence;
        const visited   = new Set();
        const queue     = [{ c: ci.c, r: ci.r, dist: 0 }];
        visited.add(hexKey(ci.c, ci.r));
        while (queue.length) {
          const { c, r, dist } = queue.shift();
          side.add(hexKey(c, r));
          if (dist < range) {
            neighbors(c, r).forEach(n => {
              const k = hexKey(n.c, n.r);
              if (!visited.has(k)) { visited.add(k); queue.push({ c: n.c, r: n.r, dist: dist + 1 }); }
            });
          }
        }
      });
    }

    return zones;
  }

  // Sum all resource/gold bonuses from a city's buildings (tree-aware)
  function _buildingBonuses(city) {
    const b    = { gold: 0, iron: 0, food: 0, wood: 0 };
    const dt   = city.developmentType || 'standard';
    const tree = (typeof BUILDING_TREES !== 'undefined' && BUILDING_TREES[dt]) || BUILDING_TYPES;
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def   = tree[key];
      const bonus = def && def.bonus && def.bonus[lvl - 1];
      if (!bonus) return;
      if (bonus.gold) b.gold += bonus.gold;
      if (bonus.iron) b.iron += bonus.iron;
      if (bonus.food) b.food += bonus.food;
      if (bonus.wood) b.wood += bonus.wood;
    });
    return b;
  }

  function collectIncome(units, cities, resources) {
    // Captured resource nodes
    Object.entries(capturedResources).forEach(([k, owner]) => {
      if (owner === 'player') {
        const type = resourceMap[k];
        resources[type] = (resources[type] || 0) + RESOURCE_DEF[type].income;
      }
    });

    // Player city income (infected cities produce no standard income)
    cities.filter(ci => ci.owner === 'player').forEach(ci => {
      if (ci.developmentType === 'infected') return; // plague cities produce no gold/food
      const typeData = CITY_TYPES[ci.type || 'aldea'];
      Object.entries(typeData.income).forEach(([res, amt]) => {
        resources[res] = (resources[res] || 0) + amt;
      });
      const b = _buildingBonuses(ci);
      resources.gold = (resources.gold || 0) + b.gold;
      resources.iron = (resources.iron || 0) + b.iron;
      resources.food = (resources.food || 0) + b.food;
      resources.wood = (resources.wood || 0) + b.wood;
    });
  }

  // Heal units within 2 hexes of a friendly city
  function healUnits(units, cities) {
    const msgs = [];
    units.forEach(u => {
      if (u.hp >= u.maxHp) return;
      const nearCity = cities.find(ci =>
        ci.owner === u.owner &&
        Math.max(Math.abs(ci.c - u.c), Math.abs(ci.r - u.r)) <= 2
      );
      if (!nearCity) return;
      const amount = Math.min(10, u.maxHp - u.hp);
      u.hp += amount;
      if (u.owner === 'player') msgs.push(`${UNIT_TYPES[u.type].name} recupera ${amount} HP cerca de ${nearCity.name}`);
    });
    return msgs;
  }

  function deductMaintenance(units, resources) {
    const msgs = [];
    units.filter(u => u.owner === 'player').forEach(u => {
      const maint = UNIT_TYPES[u.type].maintenance;
      let ok = true;
      Object.entries(maint).forEach(([res, cost]) => { if ((resources[res] || 0) < cost) ok = false; });
      if (ok) {
        Object.entries(maint).forEach(([res, cost]) => { resources[res] -= cost; });
      } else {
        u.hp = Math.max(1, u.hp - 10);
        msgs.push(`${UNIT_TYPES[u.type].name} está hambrienta! (-10 HP)`);
      }
    });
    return msgs;
  }

  function getTotalMaintenance(units) {
    const totals = {};
    units.filter(u => u.owner === 'player').forEach(u => {
      Object.entries(UNIT_TYPES[u.type].maintenance).forEach(([res, cost]) => {
        totals[res] = (totals[res] || 0) + cost;
      });
    });
    return totals;
  }

  // Preview income for HUD without modifying resources
  function calcIncome(cities) {
    const totals = {};
    Object.keys(RESOURCE_DEF).forEach(t => totals[t] = 0);

    Object.entries(capturedResources).forEach(([k, owner]) => {
      if (owner === 'player') {
        const type = resourceMap[k];
        totals[type] = (totals[type] || 0) + RESOURCE_DEF[type].income;
      }
    });

    cities.filter(ci => ci.owner === 'player').forEach(ci => {
      const typeData = CITY_TYPES[ci.type || 'aldea'];
      Object.entries(typeData.income).forEach(([res, amt]) => {
        totals[res] = (totals[res] || 0) + amt;
      });
      const b = _buildingBonuses(ci);
      totals.gold += b.gold;
      totals.iron += b.iron;
      totals.food += b.food;
      totals.wood += b.wood;
    });

    return totals;
  }

  function isWater(c, r) {
    return TERRAIN_MAP[r]?.[c] === 'water';
  }

  function getCityIncome(city) {
    const typeData = CITY_TYPES[city.type || 'aldea'];
    const inc = Object.assign({}, typeData.income);
    const b   = _buildingBonuses(city);
    Object.entries(b).forEach(([k, v]) => { if (v) inc[k] = (inc[k] || 0) + v; });
    return inc;
  }

  function getPlayerNodes() {
    const nodes = [];
    Object.entries(capturedResources).forEach(([k, owner]) => {
      if (owner === 'player') {
        const type = resourceMap[k];
        nodes.push({ type, income: RESOURCE_DEF[type].income, icon: RESOURCE_DEF[type].icon });
      }
    });
    return nodes;
  }

  return {
    init, getResource, getCapturedBy, processCapture,
    getZones, collectIncome, healUnits, deductMaintenance,
    getTotalMaintenance, calcIncome, isWater, getCityIncome, getPlayerNodes,
  };
})();
