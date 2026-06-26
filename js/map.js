// =============================================
//  map.js — map state: resources, zones
// =============================================

const GameMap = (() => {
  const resourceMap       = {};   // hexKey → resource type
  const capturedResources = {};   // hexKey → 'player' | 'enemy' | null

  function init() {
    RESOURCE_SPAWNS.forEach(({ c, r, type }) => {
      resourceMap[hexKey(c, r)] = type;
      capturedResources[hexKey(c, r)] = null;
    });
  }

  function getResource(c, r)   { return resourceMap[hexKey(c, r)] || null; }
  function getCapturedBy(c, r) { return capturedResources[hexKey(c, r)] || null; }

  // Capture a resource node; returns {type} if ownership changed, null otherwise
  function processCapture(c, r, owner) {
    const k = hexKey(c, r);
    if (!resourceMap[k]) return null;
    if (capturedResources[k] === owner) return null;
    capturedResources[k] = owner;
    return { type: resourceMap[k] };
  }

  // Control zones: all hexes within 1 step of each owner's units
  function getZones(units) {
    const zones = { player: new Set(), enemy: new Set() };
    units.forEach(u => {
      const side = zones[u.owner];
      if (!side) return;
      side.add(hexKey(u.c, u.r));
      neighbors(u.c, u.r).forEach(n => side.add(hexKey(n.c, n.r)));
    });
    return zones;
  }

  // Collect resources for player based on captured nodes and city buildings
  function collectIncome(units, cities, resources) {
    // Captured resource nodes
    Object.entries(capturedResources).forEach(([k, owner]) => {
      if (owner === 'player') {
        const type = resourceMap[k];
        resources[type] = (resources[type] || 0) + RESOURCE_DEF[type].income;
      }
    });

    // City building bonuses
    cities.filter(ci => ci.owner === 'player').forEach(ci => {
      ci.buildings.forEach((lvl, bIdx) => {
        if (lvl === 0) return;
        const key = Object.keys(BUILDING_TYPES)[bIdx];
        if (key === 'market') resources.gold  += lvl * 2;
        if (key === 'farm')   resources.food  += lvl * 2;
        if (key === 'forge')  resources.iron  += lvl;
      });
    });
  }

  // Heal units within 2 hexes of a friendly city (10 HP/turn)
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

  // Deduct maintenance for all player units. Units with unpaid upkeep lose HP.
  function deductMaintenance(units, resources) {
    const playerUnits = units.filter(u => u.owner === 'player');
    const msgs = [];

    playerUnits.forEach(u => {
      const maint = UNIT_TYPES[u.type].maintenance;
      let canAfford = true;
      Object.entries(maint).forEach(([res, cost]) => {
        if ((resources[res] || 0) < cost) canAfford = false;
      });

      if (canAfford) {
        Object.entries(maint).forEach(([res, cost]) => {
          resources[res] -= cost;
        });
      } else {
        // Unit suffers attrition — loses 10 HP
        u.hp = Math.max(1, u.hp - 10);
        msgs.push(`${UNIT_TYPES[u.type].name} is starving! (-10 HP)`);
      }
    });

    return msgs;
  }

  // Calculate total maintenance cost for all player units
  function getTotalMaintenance(units) {
    const totals = {};
    units.filter(u => u.owner === 'player').forEach(u => {
      const maint = UNIT_TYPES[u.type].maintenance;
      Object.entries(maint).forEach(([res, cost]) => {
        totals[res] = (totals[res] || 0) + cost;
      });
    });
    return totals;
  }

  function isWater(c, r) {
    return TERRAIN_MAP[r]?.[c] === 'water';
  }

  return { init, getResource, getCapturedBy, processCapture, getZones, collectIncome, healUnits, deductMaintenance, getTotalMaintenance, isWater };
})();
