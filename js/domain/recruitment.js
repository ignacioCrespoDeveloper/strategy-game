// =============================================
//  recruitment.js — Military recruitment service
//
//  City-based recruitment: units are trained at a city over time.
//  On completion, units are added to the lord's army via ArmyService.
//
//  Mercenary recruitment: instant — handled directly in the UI,
//  not via this service's queue (no city required).
//
//  Queue shape on city.recruitmentQueue:
//    [{ unitId, count, lordId, startedAt, finishAt }]
//
//  Only one batch trains at a time (same pattern as constructionQueue).
// =============================================

const RecruitmentService = (() => {

  // Migration guard — add recruitmentQueue to cities that predate this system.
  function _migrateCity(city) {
    if (!city.recruitmentQueue) {
      city.recruitmentQueue = [];
      CityService.save(city);
    }
  }

  // Returns units available for recruitment from `city`, given `lord`'s race.
  // Each entry: { unitId, building, minLevel }
  function getAvailableFromCity(lord, city) {
    const raceRoster = UNIT_ROSTER[lord.race];
    if (!raceRoster) return [];

    const seen      = new Set();
    const available = [];

    Object.entries(raceRoster).forEach(([buildingId, levelMap]) => {
      const bldLevel = city.buildings[buildingId] || 0;
      if (bldLevel === 0) return;

      // Sort level thresholds ascending so unlocks appear in order
      Object.keys(levelMap)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach(minLevel => {
          if (bldLevel >= minLevel) {
            levelMap[minLevel].forEach(unitId => {
              if (!seen.has(unitId)) {
                seen.add(unitId);
                available.push({ unitId, building: buildingId, minLevel });
              }
            });
          }
        });
    });

    return available;
  }

  // Returns active, negotiated discovery records that offer mercenary units.
  function getAvailableFromDiscoveries(playerId) {
    return DiscoveryService.getActive(playerId)
      .filter(r => r.negotiated && r.mercenaryUnits && r.mercenaryUnits.length > 0);
  }

  // Enqueue a unit training batch at a city. Deducts gold immediately.
  // Returns { ok, error? }.
  function enqueue(lord, city, unitId, count) {
    _migrateCity(city);

    if (city.recruitmentQueue.length > 0) {
      return { ok: false, error: 'Already training. Wait for the current batch to finish.' };
    }

    const def = UNIT_DEFS[unitId];
    if (!def) return { ok: false, error: 'Unknown unit.' };

    const ARMY_LIMIT  = 10;
    const currentSize = ArmyService.totalUnits(lord.id);
    if (currentSize + count > ARMY_LIMIT) {
      return { ok: false, error: `Army is full (${currentSize}/${ARMY_LIMIT}). Dismiss units first.` };
    }

    const totalCost = def.goldCost * count;
    const player    = PlayerService.getById(lord.playerId);
    if ((player.coins || 0) < totalCost) {
      return { ok: false, error: `Need ${totalCost}💰, have ${player.coins || 0}💰.` };
    }

    PlayerService.update(lord.playerId, { coins: player.coins - totalCost });

    const now      = TimeService.now();
    const duration = def.recruitTime * count * 1000;
    city.recruitmentQueue = [{
      unitId, count, lordId: lord.id,
      startedAt: now,
      finishAt:  now + duration,
    }];
    CityService.save(city);
    return { ok: true };
  }

  // Complete any finished batches. Adds units to the lord's army.
  // Returns completed job records (may be empty).
  function tick(city) {
    _migrateCity(city);
    if (city.recruitmentQueue.length === 0) return [];

    const now       = TimeService.now();
    const completed = [];

    city.recruitmentQueue = city.recruitmentQueue.filter(item => {
      if (now >= item.finishAt) {
        ArmyService.addUnits(item.lordId, item.unitId, item.count);
        completed.push({ ...item });
        return false;
      }
      return true;
    });

    if (completed.length > 0) CityService.save(city);
    return completed;
  }

  function timeRemaining(city) {
    if (!city.recruitmentQueue || city.recruitmentQueue.length === 0) return 0;
    return Math.max(0, TimeService.secondsUntil(city.recruitmentQueue[0].finishAt));
  }

  function progress(city) {
    if (!city.recruitmentQueue || city.recruitmentQueue.length === 0) return 0;
    const item    = city.recruitmentQueue[0];
    const total   = item.finishAt - item.startedAt;
    const elapsed = TimeService.now() - item.startedAt;
    return total > 0 ? Math.min(1, elapsed / total) : 0;
  }

  return {
    getAvailableFromCity, getAvailableFromDiscoveries,
    enqueue, tick, timeRemaining, progress,
  };
})();
