// =============================================
//  actions/recruit.js — POST /api/city/recruit
//
//  Body: { lordId, cityId, unitId, count }
//
//  Validates and enqueues a unit recruitment batch
//  server-side, then persists and returns the
//  updated state so the client can hydrate.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS }                 from '../engine-loader.js';

const ARMY_LIMIT = 10;

function _totalUnits(army) {
  return (army?.units || []).length;
}

function _totalWeight(army) {
  return (army?.units || []).reduce((sum, stack) => {
    const def = UNIT_DEFS[stack.unitId];
    return sum + (def?.armyWeight || 1) * stack.count;
  }, 0);
}

function _commandCapacity(lord) {
  return 6 + 2 * (lord.level || 1);
}

export async function handleRecruit(req, res) {
  const { lordId, cityId, unitId, count = 1 } = req.body || {};
  if (!lordId || !cityId || !unitId) {
    return res.status(400).json({ ok: false, error: 'Missing lordId, cityId, or unitId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const city = cities[cityId];
  if (!city) return res.status(404).json({ ok: false, error: 'City not found' });
  if (city.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your city' });

  if ((city.recruitmentQueue || []).length > 0) {
    return res.status(400).json({ ok: false, error: 'Already training. Wait for the current batch to finish.' });
  }

  const def = UNIT_DEFS[unitId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown unit.' });

  const army        = armies[lordId] || { units: [] };
  const currentSize = _totalUnits(army);
  if (currentSize + count > ARMY_LIMIT) {
    return res.status(400).json({
      ok: false,
      error: `Army is full (${currentSize}/${ARMY_LIMIT}). Dismiss units first.`,
    });
  }

  if ((def.armyWeight || 1) >= 12 && (lord.level || 1) < 12) {
    return res.status(400).json({
      ok: false,
      error: `Only a lord of level 12 or higher can command a ${def.name}.`,
    });
  }

  const capacity    = _commandCapacity(lord);
  const usedWeight  = _totalWeight(army);
  const addedWeight = (def.armyWeight || 1) * count;
  if (usedWeight + addedWeight > capacity) {
    return res.status(400).json({
      ok: false,
      error: `Not enough command capacity. Used ${usedWeight}/${capacity} pts. ${def.name} costs ${def.armyWeight || 1} pts each.`,
    });
  }

  const totalGold = def.goldCost * count;
  if ((player.coins || 0) < totalGold) {
    return res.status(400).json({
      ok: false,
      error: `Need ${totalGold}💰, have ${player.coins || 0}💰.`,
    });
  }

  const rc = def.resourceCost || {};
  const resShortages = [];
  for (const [res, perUnit] of Object.entries(rc)) {
    const needed = perUnit * count;
    const have   = Math.floor(city.resources?.[res] || 0);
    if (have < needed) resShortages.push(`${needed} ${res} (have ${have})`);
  }
  if (resShortages.length > 0) {
    return res.status(400).json({ ok: false, error: `Not enough resources: ${resShortages.join(', ')}.` });
  }

  const popCost = (def.populationCost || 0) * count;
  if (popCost > 0 && def.race !== null) {
    const freePop = Math.floor(city.freePopulation ?? 0);
    if (freePop < popCost) {
      return res.status(400).json({
        ok: false,
        error: `Not enough free population (need ${popCost}, have ${freePop}). Hire mercenaries instead.`,
      });
    }
  }

  // Apply
  player.coins = (player.coins || 0) - totalGold;
  for (const [res, perUnit] of Object.entries(rc)) {
    city.resources[res] = (city.resources[res] || 0) - perUnit * count;
  }
  if (popCost > 0 && def.race !== null) {
    city.freePopulation = Math.max(0, (city.freePopulation ?? 0) - popCost);
  }

  const now      = Date.now();
  const duration = def.recruitTime * count * 1000;
  city.recruitmentQueue = [{
    unitId, count, lordId,
    startedAt: now,
    finishAt:  now + duration,
  }];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, city, player });
}
