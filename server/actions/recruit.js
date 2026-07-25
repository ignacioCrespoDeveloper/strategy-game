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

// Dampened the same way combat stacks are (js/domain/battle-engine.js
// _stackDamageMult, count^0.8) — otherwise the PWR cap overvalues numerous
// cheap units relative to what they actually contribute in a fight, letting
// players buy more real combat strength than intended by spreading it thin.
function _armyPower(army) {
  return (army?.units || []).reduce((sum, stack) => {
    const def = UNIT_DEFS[stack.unitId];
    return sum + (def ? _unitPower(def) * Math.pow(stack.count, 0.8) : 0);
  }, 0);
}

// Army power if `addCount` more of `unitId` were added. Recomputes that
// stack's whole dampened total rather than adding a flat per-unit delta —
// dampening is non-linear, so the marginal power of models #16-20 in an
// existing 15-stack is less than models #1-5 of a fresh stack.
function _projectedArmyPower(army, unitId, addCount) {
  const def = UNIT_DEFS[unitId];
  if (!def) return _armyPower(army);
  const existing   = (army?.units || []).find(u => u.unitId === unitId);
  const otherPower = (army?.units || [])
    .filter(u => u.unitId !== unitId)
    .reduce((sum, stack) => {
      const d = UNIT_DEFS[stack.unitId];
      return d ? sum + _unitPower(d) * Math.pow(stack.count, 0.8) : sum;
    }, 0);
  const newCount = (existing?.count || 0) + addCount;
  return otherPower + _unitPower(def) * Math.pow(newCount, 0.8);
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

  const MAX_QUEUE = 5;
  const queue     = city.recruitmentQueue || [];
  if (queue.length >= MAX_QUEUE) {
    return res.status(400).json({ ok: false, error: `Recruitment queue is full (max ${MAX_QUEUE}).` });
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

  // Power cap check must also account for units still sitting in the queue
  // (not yet added to the army) — otherwise stacking several batches in a
  // row could sneak well past the cap, since each individual check would
  // only ever see the CURRENT (unchanged-until-completion) army state.
  const virtualArmy = { units: (army.units || []).map(u => ({ ...u })) };
  queue.forEach(item => {
    const existing = virtualArmy.units.find(u => u.unitId === item.unitId);
    if (existing) existing.count += item.count;
    else virtualArmy.units.push({ unitId: item.unitId, count: item.count });
  });

  const cap            = _armyPowerCap(lord, TALENT_POOL);
  const usedPower      = _armyPower(virtualArmy);
  const projectedPower = _projectedArmyPower(virtualArmy, unitId, count);
  if (projectedPower > cap) {
    return res.status(400).json({
      ok: false,
      error: `Not enough army power capacity. Used ${Math.round(usedPower)}/${cap} PWR (including queued orders).`,
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

  // Apply
  player.coins = (player.coins || 0) - totalGold;
  for (const [rKey, perUnit] of Object.entries(rc)) {
    player.resources[rKey] = (player.resources[rKey] || 0) - perUnit * count;
  }

  // Batches run sequentially — a newly-queued order starts once whichever
  // batch is ahead of it finishes, not immediately, unless the queue is
  // empty (then it starts now, same as before this was a multi-slot queue).
  const now          = Date.now();
  const recruitMult  = TALENT_POOL?.[lord.talentId]?.effects?.recruitTimeMult ?? 1;
  const duration     = Math.round(def.recruitTime * count * 1000 * recruitMult);
  const lastFinish   = queue.length > 0 ? queue[queue.length - 1].finishAt : now;
  const startedAt    = Math.max(now, lastFinish);
  const newItem      = { unitId, count, lordId, startedAt, finishAt: startedAt + duration };
  city.recruitmentQueue = [...queue, newItem];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'recruit',
    fire_at:   newItem.finishAt,
    payload:   { cityId, unitId: newItem.unitId, count: newItem.count, lordId: newItem.lordId },
  });
  if (evtErr) console.warn('[recruit] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, city, player });
}
