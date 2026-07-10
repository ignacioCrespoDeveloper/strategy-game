// =============================================
//  city.js — City domain service
//
//  A city belongs to a lord and sits on a world tile.
//  Resources and buildings are stored per city.
// =============================================

const CityService = (() => {
  const CITIES_KEY = 'cities'; // { [id]: CityRecord }

  function _getAll() {
    return StorageService.get(CITIES_KEY) || {};
  }

  function _saveAll(cities) {
    StorageService.set(CITIES_KEY, cities);
  }

  function _generateId() {
    return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // Found a new city on a tile.
  // Returns { ok, city, error }.
  function found(lordId, name, x, y) {
    const n = (name || '').trim();
    if (n.length < 2)  return { ok: false, error: 'City name must be at least 2 characters.' };
    if (n.length > 30) return { ok: false, error: 'City name cannot exceed 30 characters.' };

    const lord = LordService.getById(lordId);
    if (lord && lord.cityIds && lord.cityIds.length > 0) {
      return { ok: false, error: 'You already have a city.' };
    }

    if (!WorldService.isInBounds(x, y))  return { ok: false, error: 'Tile is out of bounds.' };
    if (WorldService.isOccupied(x, y))   return { ok: false, error: 'This tile is already occupied.' };

    const cities = _getAll();
    const id     = _generateId();
    const now    = TimeService.now();

    const city = {
      id,
      lordId,
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
    LordService.addCity(lordId, id);
    LordService.setPosition(lordId, x, y);

    return { ok: true, city };
  }

  function getById(cityId) {
    return _getAll()[cityId] || null;
  }

  function getAll() {
    return Object.values(_getAll());
  }

  function getLordCities(lordId) {
    return Object.values(_getAll()).filter(c => c.lordId === lordId);
  }

  // Persist changes to a city (call after mutating resource/queue fields).
  function save(city) {
    const cities = _getAll();
    cities[city.id] = city;
    _saveAll(cities);
  }

  return { found, getById, getAll, getLordCities, save };
})();
