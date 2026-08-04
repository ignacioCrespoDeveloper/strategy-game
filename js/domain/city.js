// =============================================
//  city.js — City domain service
//
//  A city belongs to a player and sits on a world tile.
//  Buildings are stored per city; resources live in the
//  empire-wide player.resources pool.
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

  // ⚠ MIRROR of server/actions/city-found.js (cityFoundCost). The server is
  // authoritative; this copy exists only so the client can preview cost and
  // disable the button. Change both together.
  //
  // The flat MAX_CITIES = 7 that used to sit here is GONE (2026-08-03) — the
  // cap is bought from the Library now and lives in ONE place,
  // EconomyCore.getCitySlots, which both sides call. It is not mirrored here
  // because a mirror is exactly how map-view.js ended up enforcing 5 while the
  // server enforced 7.
  function getCitySlots(playerId) {
    const player = PlayerService.getById(playerId);
    return EconomyCore.getCitySlots(EconomyCore.getResearchEffects(player?.research));
  }

  // Cost to found city N (1-indexed). First city is always free.
  // 2nd: 8k, 3rd: 16k, 4th: 32k, 5th: 64k, 6th: 128k, 7th: 256k (×2 each time).
  function getFoundCost(existingCount) {
    if (existingCount === 0) return 0;
    return 8000 * Math.pow(2, existingCount - 1);
  }

  // Found a new city on a tile.
  // Returns { ok, city, error }.
  function found(playerId, name, x, y) {
    const n = (name || '').trim();
    if (n.length < 2)  return { ok: false, error: 'City name must be at least 2 characters.' };
    if (n.length > 30) return { ok: false, error: 'City name cannot exceed 30 characters.' };

    const existing = getPlayerCities(playerId);
    const slots    = getCitySlots(playerId);
    if (existing.length >= slots) {
      return { ok: false, error: `You may hold ${slots} ${slots === 1 ? 'city' : 'cities'}. Research Frontier Charters in the Library to claim another.` };
    }

    if (!WorldService.isInBounds(x, y))  return { ok: false, error: 'Tile is out of bounds.' };
    if (WorldService.isOccupied(x, y))   return { ok: false, error: 'This tile is already occupied.' };

    const cost = getFoundCost(existing.length);
    if (cost > 0) {
      const spend = PlayerService.spendCoins(playerId, cost);
      if (!spend.ok) return { ok: false, error: `Founding costs ${cost.toLocaleString()} gold. ${spend.error}` };
    }

    const cities = _getAll();
    const id     = _generateId();
    const now    = TimeService.now();

    const city = {
      id,
      playerId,
      name:     n,
      x,
      y,
      population:           1000,
      freePopulation:       3,
      // Town Hall only — see the long note in server/actions/city-found.js,
      // which is the authoritative founding path; this pair must agree.
      buildings:            { town_hall: 1 },
      lastResourceUpdate:   now,
      lastPopulationUpdate: now,
      constructionQueue:    [],
      // Applied city items: [{ itemId, startedAt, expiresAt }] — js/data/items.js.
      // Replaced activeModifiers + eventCooldowns, which belonged to the city
      // event system deleted 2026-08-04.
      activeItems:          [],
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

  return { found, getFoundCost, getCitySlots, getById, getAll, getPlayerCities, save, getGarrison };
})();
