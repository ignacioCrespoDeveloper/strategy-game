// =============================================
//  construction.js — Timestamp-based build queue
//
//  No timers. No polling.
//  On every open, call tick(city) to complete any finished buildings.
//
//  Up to 5 upgrades can be queued at once; they build sequentially (job N
//  starts the moment job N-1 finishes). The authoritative enqueue path is
//  server/actions/build.js via ServerActions.build() — this module only
//  completes finished jobs locally and reports queue timing to the UI.
// =============================================

const ConstructionService = (() => {

  // Complete any finished buildings and update the city.
  // Returns an array of completed building names (may be empty).
  function tick(city) {
    const now       = TimeService.now();
    const completed = [];

    city.constructionQueue = city.constructionQueue.filter(item => {
      if (now >= item.finishAt) {
        city.buildings[item.buildingId] = item.targetLevel;
        const def = BUILDING_DEFS[item.buildingId];
        if (def?.isLandmark) city.landmark = item.buildingId;
        completed.push(def?.name || item.buildingId);
        return false;
      }
      return true;
    });

    if (completed.length > 0) {
      CityService.save(city);
    }

    return completed;
  }

  // Returns seconds remaining for the active build job, or 0 if queue is empty.
  function timeRemaining(city) {
    if (city.constructionQueue.length === 0) return 0;
    return Math.max(0, TimeService.secondsUntil(city.constructionQueue[0].finishAt));
  }

  // Progress 0–1 for the active job.
  function progress(city) {
    if (city.constructionQueue.length === 0) return 0;
    const item     = city.constructionQueue[0];
    const total    = item.finishAt - item.startedAt;
    const elapsed  = TimeService.now() - item.startedAt;
    return Math.min(1, elapsed / total);
  }

  return { tick, timeRemaining, progress };
})();
