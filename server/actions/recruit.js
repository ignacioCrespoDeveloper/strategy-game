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
import { UNIT_DEFS, TALENT_POOL }   from '../engine-loader.js';

// Army capacity is gated by Army Power alone — the same combat-strength
// score (atk×3 + def×2 + hp/10 + speed, summed per model) shown to the
// player everywhere else as "PWR". There is deliberately no separate
// unit-count/weight-based "command capacity" or stack-count "slot limit"
// any more — those were a second, differently-scaled mechanic the UI could
// never keep in sync with, which is exactly what caused the confusion this
// replaces. Mirrors js/domain/lord.js's getArmyPowerCap()/_armyPower().
function _unitPower(def) {
  const s = def?.combatStats || {};
  return (s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0);
}

function _armyPower(army) {
  return (army?.units || []).reduce((sum, stack) => {
    const def = UNIT_DEFS[stack.unitId];
    return sum + (def ? _unitPower(def) : 0) * stack.count;
  }, 0);
}

function _armyPowerCap(lord, talentPool) {
  const bonus = talentPool?.[lord.talentId]?.effects?.armyPowerCapBonus || 0;
  return 200 + (lord.level || 1) * 80 + bonus;
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

  const army = armies[lordId] || { units: [] };

  if ((def.armyWeight || 1) >= 12 && (lord.level || 1) < 12) {
    return res.status(400).json({
      ok: false,
      error: `Only a lord of level 12 or higher can command a ${def.name}.`,
    });
  }

  const cap        = _armyPowerCap(lord, TALENT_POOL);
  const usedPower  = _armyPower(army);
  const addedPower = _unitPower(def) * count;
  if (usedPower + addedPower > cap) {
    return res.status(400).json({
      ok: false,
      error: `Not enough army power capacity. Used ${usedPower}/${cap} PWR. ${def.name} costs ${_unitPower(def)} PWR each.`,
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
  player.resources = player.resources || { food: 0, wood: 0, stone: 0, iron: 0 };
  const resShortages = [];
  for (const [rKey, perUnit] of Object.entries(rc)) {
    const needed = perUnit * count;
    const have   = Math.floor(player.resources[rKey] || 0);
    if (have < needed) resShortages.push(`${needed} ${rKey} (have ${have})`);
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
  for (const [rKey, perUnit] of Object.entries(rc)) {
    player.resources[rKey] = (player.resources[rKey] || 0) - perUnit * count;
  }
  if (popCost > 0 && def.race !== null) {
    city.freePopulation = Math.max(0, (city.freePopulation ?? 0) - popCost);
  }

  const now          = Date.now();
  const recruitMult  = TALENT_POOL?.[lord.talentId]?.effects?.recruitTimeMult ?? 1;
  const duration     = Math.round(def.recruitTime * count * 1000 * recruitMult);
  city.recruitmentQueue = [{
    unitId, count, lordId,
    startedAt: now,
    finishAt:  now + duration,
  }];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  const queueItem = city.recruitmentQueue[0];
  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'recruit',
    fire_at:   queueItem.finishAt,
    payload:   { cityId, unitId: queueItem.unitId, count: queueItem.count, lordId: queueItem.lordId },
  });
  if (evtErr) console.warn('[recruit] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, city, player });
}
