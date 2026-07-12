// =============================================
//  city.js — City domain service
//
//  A city belongs to a player and sits on a world tile.
//  Resources and buildings are stored per city.
// =============================================

const CityService = (() => {
  const CITIES_KEY = 'cities'; // { [id]: CityRecord }

  function _getAll() {
    const cities = StorageService.get(CITIES_KEY) || {};
    // Migrate legacy: city.lordId → city.playerId
    let dirty = false;
    Object.values(cities).forEach(city => {
      if (city.lordId && !city.playerId) {
        const lord = LordService.getById(city.lordId);
        if (lord && lord.playerId) { city.playerId = lord.playerId; dirty = true; }
        delete city.lordId;
      }
    });
    if (dirty) StorageService.set(CITIES_KEY, cities);
    return cities;
  }

  function _saveAll(cities) {
    StorageService.set(CITIES_KEY, cities);
  }

  function _generateId() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // Found a new city on a tile.
  // Returns { ok, city, error }.
  function found(playerId, name, x, y) {
    const n = (name || '').trim();
    if (n.length < 2)  return { ok: false, error: 'City name must be at least 2 characters.' };
    if (n.length > 30) return { ok: false, error: 'City name cannot exceed 30 characters.' };

    if (!WorldService.isInBounds(x, y))  return { ok: false, error: 'Tile is out of bounds.' };
    if (WorldService.isOccupied(x, y))   return { ok: false, error: 'This tile is already occupied.' };

    const cities = _getAll();
    const id     = _generateId();
    const now    = TimeService.now();

    const city = {
      id,
      playerId,
      name:     n,
      x,
      y,
      population:           100,
      buildings:            { town_hall: 1 },
      resources:            { food: 5000, wood: 5000, stone: 5000, iron: 5000 },
      lastResourceUpdate:   now,
      lastPopulationUpdate: now,
      constructionQueue:    [],
      activeModifiers:      [],
      eventCooldowns:       {},
      landmark:             null,
    };

    cities[id] = city;
    _saveAll(cities);
    WorldService.placeCity(x, y, id);

    return { ok: true, city };
  }

  function getById(cityId) {
    return _getAll()[cityId] || null;
  }

  function getAll() {
    return Object.values(_getAll());
  }

  function getPlayerCities(playerId) {
    return Object.values(_getAll()).filter(c => c.playerId === playerId);
  }

  // Persist changes to a city (call after mutating resource/queue fields).
  function save(city) {
    const cities = _getAll();
    cities[city.id] = city;
    _saveAll(cities);
  }

  // Returns the garrison roster derived from all buildings with garrisonRoster().
  // Shape: [{ unitId, count }], total count capped at 10.
  function getGarrison(city) {
    const totals = {};
    Object.entries(city.buildings || {}).forEach(([bId, level]) => {
      const def = BUILDING_DEFS[bId];
      if (!def?.garrisonRoster) return;
      def.garrisonRoster(level).forEach(({ unitId, count }) => {
        totals[unitId] = (totals[unitId] || 0) + count;
      });
    });
    const roster = Object.entries(totals).map(([unitId, count]) => ({ unitId, count }));
    const total  = roster.reduce((s, r) => s + r.count, 0);
    if (total > 10) {
      const scale = 10 / total;
      roster.forEach(r => { r.count = Math.max(1, Math.floor(r.count * scale)); });
    }
    return roster;
  }

  return { found, getById, getAll, getPlayerCities, save, getGarrison };
})();
