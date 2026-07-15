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
//
//  Guards enforced at enqueue():
//    1. Gold cost (from player.coins)
//    2. Resource cost (from city.resources: iron/wood/food per unit × count)
//    3. Population cost (from city.freePopulation; 0 for mercenaries)
//    4. Army slot limit (max 10 units)
//    5. Army weight limit (sum of armyWeight ≤ lord command capacity)
//    6. Legendary gate: armyWeight 12 requires lord level ≥ 12
// =============================================

const RecruitmentService = (() => {

  function _migrateCity(city) {
    if (!city.recruitmentQueue) {
      city.recruitmentQueue = [];
      CityService.save(city);
    }
  }

  // Returns units available for recruitment from `city`, given `lord`'s race.
  function getAvailableFromCity(lord, city) {
    const raceRoster = UNIT_ROSTER[lord.race];
    if (!raceRoster) return [];

    const seen      = new Set();
    const available = [];

    Object.entries(raceRoster).forEach(([buildingId, levelMap]) => {
      const bldLevel = city.buildings[buildingId] || 0;
      if (bldLevel === 0) return;

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

  function getAvailableFromDiscoveries(playerId) {
    return DiscoveryService.getActive(playerId)
      .filter(r => CAMP_DEFS[r.definitionId]?.mercenaryRoster?.length > 0);
  }

  // Current total armyWeight for a lord's army.
  function _totalWeight(lordId) {
    const army = ArmyService.get(lordId);
    return army.units.reduce((sum, stack) => {
      const def = UNIT_DEFS[stack.unitId];
      return sum + (def?.armyWeight || 1) * stack.count;
    }, 0);
  }

  // Enqueue a unit training batch at a city. Deducts gold + resources immediately.
  // Returns { ok, error? }.
  function enqueue(lord, city, unitId, count) {
    _migrateCity(city);

    if (city.recruitmentQueue.length > 0) {
      return { ok: false, error: 'Already training. Wait for the current batch to finish.' };
    }

    const def = UNIT_DEFS[unitId];
    if (!def) return { ok: false, error: 'Unknown unit.' };

    // ── Slot limit ────────────────────────────────────────────────
    const ARMY_LIMIT  = 10;
    const currentSize = ArmyService.totalUnits(lord.id);
    if (currentSize + count > ARMY_LIMIT) {
      return { ok: false, error: `Army is full (${currentSize}/${ARMY_LIMIT}). Dismiss units first.` };
    }

    // ── Legendary gate: lord must be level ≥ 12 ──────────────────
    if ((def.armyWeight || 1) >= 12 && (lord.level || 1) < 12) {
      return { ok: false, error: `Only a lord of level 12 or higher can command a ${def.name}.` };
    }

    // ── Army weight limit ─────────────────────────────────────────
    const capacity    = LordService.getCommandCapacity(lord);
    const usedWeight  = _totalWeight(lord.id);
    const addedWeight = (def.armyWeight || 1) * count;
    if (usedWeight + addedWeight > capacity) {
      return {
        ok: false,
        error: `Not enough command capacity. Used ${usedWeight}/${capacity} pts. ${def.name} costs ${def.armyWeight || 1} pts each.`,
      };
    }

    // ── Gold cost ─────────────────────────────────────────────────
    const totalGold = def.goldCost * count;
    const player    = PlayerService.getById(lord.playerId);
    if ((player.coins || 0) < totalGold) {
      return { ok: false, error: `Need ${totalGold}💰, have ${player.coins || 0}💰.` };
    }

    // ── Resource cost (empire-wide pool) ─────────────────────────
    const rc = def.resourceCost || {};
    const empireRes = player.resources || {};
    const resShortages = [];
    Object.entries(rc).forEach(([res, perUnit]) => {
      const needed  = perUnit * count;
      const have    = Math.floor(empireRes[res] || 0);
      if (have < needed) resShortages.push(`${needed} ${res} (have ${have})`);
    });
    if (resShortages.length > 0) {
      return { ok: false, error: `Not enough resources: ${resShortages.join(', ')}.` };
    }

    // ── Population cost (skip for mercenaries: race null) ─────────
    const popCost = (def.populationCost || 0) * count;
    if (popCost > 0 && def.race !== null) {
      const freePop = Math.floor(city.freePopulation ?? 0);
      if (freePop < popCost) {
        return {
          ok: false,
          error: `Not enough free population (need ${popCost}, have ${freePop}). Hire mercenaries instead — they require no population.`,
        };
      }
    }

    // ── Deduct gold ───────────────────────────────────────────────
    PlayerService.update(lord.playerId, { coins: player.coins - totalGold });

    // ── Deduct resources from empire pool ────────────────────────
    Object.entries(rc).forEach(([res, perUnit]) => {
      player.resources[res] = (player.resources[res] || 0) - perUnit * count;
    });
    PlayerService.update(player.id, { resources: player.resources });

    // ── Deduct population ─────────────────────────────────────────
    if (popCost > 0 && def.race !== null) {
      city.freePopulation = Math.max(0, (city.freePopulation ?? 0) - popCost);
    }

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
