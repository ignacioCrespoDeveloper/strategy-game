// =============================================
//  map.js — map state: resources, zones
// =============================================

const GameMap = (() => {
  const resourceMap = {};   // hexKey → resource type

  function init() {
    RESOURCE_SPAWNS.forEach(({ c, r, type }) => {
      resourceMap[hexKey(c, r)] = type;
    });
  }

  function getResource(c, r) { return resourceMap[hexKey(c, r)] || null; }

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

  // Collect resources for player based on control zones
  function collectIncome(units, cities, resources) {
    const { player } = getZones(units);

    // Hex resources
    Object.entries(resourceMap).forEach(([k, type]) => {
      if (player.has(k)) {
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

  return { init, getResource, getZones, collectIncome, deductMaintenance, getTotalMaintenance, isWater };
})();
