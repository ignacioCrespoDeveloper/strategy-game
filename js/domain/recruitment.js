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
//  Up to 5 batches can be queued at once; they train sequentially (batch N
//  starts the moment batch N-1 finishes). The authoritative enqueue path
//  (costs, Army Power cap) is server/actions/recruit.js via
//  ServerActions.recruit() — this module only completes finished batches
//  locally and lists what a city can train.
// =============================================

const RecruitmentService = (() => {

  function _migrateCity(city) {
    if (!city.recruitmentQueue) {
      city.recruitmentQueue = [];
      CityService.save(city);
    }
  }

  // Returns units available for recruitment from `city`, given `lord`'s race.
  //
  // The filter is UnitUnlockService.check — the SAME evaluator
  // server/actions/recruit.js enforces with, so this list can never offer a
  // unit the server would reject (it used to compare building levels inline,
  // while the server checked nothing at all).
  function getAvailableFromCity(lord, city) {
    const raceRoster = UNIT_ROSTER[lord.race];
    if (!raceRoster) return [];

    const seen      = new Set();
    const available = [];

    Object.entries(raceRoster).forEach(([buildingId, levelMap]) => {
      Object.keys(levelMap)
        .map(Number)
        .sort((a, b) => a - b)
        .forEach(minLevel => {
          levelMap[minLevel].forEach(unitId => {
            if (seen.has(unitId)) return;
            seen.add(unitId);
            const { locked } = UnitUnlockService.check(unitId, {
              race:      lord.race,
              buildings: city.buildings || {},
              lordLevel: lord.level,
            });
            if (!locked) available.push({ unitId, building: buildingId, minLevel });
          });
        });
    });

    return available;
  }

  // getAvailableFromDiscoveries() lived here — it listed the mercenaries a
  // player could hire from an active bandit-camp discovery. Camps no longer
  // exist (combat finds resolve immediately as ambushes), and mercenaries now
  // JOIN via the expedition Recruits outcome rather than being bought, so
  // there is nothing for it to return. Removed 2026-07-29.

  // Complete any finished batches. Adds units to the lord's army.
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
    getAvailableFromCity,
    tick, timeRemaining, progress,
  };
})();
