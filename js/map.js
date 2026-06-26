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

  function isWater(c, r) {
    return TERRAIN_MAP[r]?.[c] === 'water';
  }

  return { init, getResource, getZones, collectIncome, isWater };
})();
