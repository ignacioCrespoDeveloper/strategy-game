// =============================================
//  construction.js — Timestamp-based build queue
//
//  No timers. No polling.
//  On every open, call tick(city) to complete any finished buildings.
// =============================================

const ConstructionService = (() => {

  // Start building/upgrading a building in a city.
  // Returns { ok, error }.
  function enqueue(city, buildingId, resources) {
    const def = BUILDING_DEFS[buildingId];
    if (!def) return { ok: false, error: 'Unknown building.' };

    if (city.constructionQueue.length > 0) {
      return { ok: false, error: 'Already building something. Wait for it to finish.' };
    }

    const currentLevel = city.buildings[buildingId] || 0;
    if (currentLevel >= def.maxLevel) {
      return { ok: false, error: `${def.name} is already at max level.` };
    }

    // Check prerequisites
    for (const [reqId, reqLevel] of Object.entries(def.requires)) {
      if ((city.buildings[reqId] || 0) < reqLevel) {
        const reqDef = BUILDING_DEFS[reqId];
        return { ok: false, error: `Requires ${reqDef?.name || reqId} level ${reqLevel}.` };
      }
    }

    // Landmark constraint: a city can only have ONE landmark
    if (def.isLandmark && city.landmark && city.landmark !== buildingId) {
      const existing = BUILDING_DEFS[city.landmark];
      return { ok: false, error: `This city already has a Landmark: ${existing?.name || city.landmark}.` };
    }

    const targetLevel = currentLevel + 1;
    const cost        = def.cost(targetLevel);

    // Check affordability
    for (const [res, amount] of Object.entries(cost)) {
      if (amount > 0 && (resources[res] || 0) < amount) {
        return { ok: false, error: 'Not enough resources.' };
      }
    }

    // Deduct cost
    for (const [res, amount] of Object.entries(cost)) {
      if (amount > 0) resources[res] -= amount;
    }

    const now      = TimeService.now();
    const duration = def.buildTime(targetLevel) * 1000; // ms

    city.constructionQueue.push({
      buildingId,
      targetLevel,
      startedAt: now,
      finishAt:  now + duration,
    });

    CityService.save(city);
    return { ok: true };
  }

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

  // Returns true if the city can afford a building right now.
  function canAfford(city, buildingId, resources) {
    const def = BUILDING_DEFS[buildingId];
    if (!def) return false;
    const targetLevel = (city.buildings[buildingId] || 0) + 1;
    if (targetLevel > def.maxLevel) return false;
    const cost = def.cost(targetLevel);
    return Object.entries(cost).every(([res, amt]) => amt <= 0 || Math.floor(resources[res] || 0) >= amt);
  }

  return { enqueue, tick, timeRemaining, progress, canAfford };
})();
