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
import { UNIT_DEFS, TALENT_POOL, EconomyCore } from '../engine-loader.js';

// Army capacity is gated by Army Power alone — EconomyCore.getArmyPower is
// the single source of truth (linear per-model cost + combat-trait tax).
// There is deliberately no separate unit-count/weight-based "command
// capacity" or stack-count "slot limit" any more — those were a second,
// differently-scaled mechanic the UI could never keep in sync with.
function _armyPower(army) {
  return EconomyCore.getArmyPower(army?.units, UNIT_DEFS);
}

function _projectedArmyPower(army, unitId, addCount) {
  return EconomyCore.getProjectedArmyPower(army?.units, UNIT_DEFS, unitId, addCount);
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

  if (def.category === 'legendary' && (lord.level || 1) < 12) {
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

  // Units cost ONLY gold (resources are for buildings/research/marching).
  const totalGold = def.goldCost * count;
  if ((player.coins || 0) < totalGold) {
    return res.status(400).json({
      ok: false,
      error: `Need ${totalGold} gold, have ${player.coins || 0}.`,
    });
  }

  // Apply
  player.coins = (player.coins || 0) - totalGold;

  // Batches run sequentially — a newly-queued order starts once whichever
  // batch is ahead of it finishes, not immediately, unless the queue is
  // empty (then it starts now, same as before this was a multi-slot queue).
  const now          = Date.now();
  const recruitMult  = TALENT_POOL?.[lord.talentId]?.effects?.recruitTimeMult ?? 1;
  // Recruit time: base × Drill Manuals research ÷ hangar divisor (every
  // level of THIS city's training building above the unit's unlock level),
  // then the lord's talent mult.
  const training     = EconomyCore.getUnitTraining(lord.race, unitId);
  const baseSecs     = EconomyCore.getRecruitTime(
    def, count,
    EconomyCore.getResearchEffects(player.research),
    training ? (city.buildings?.[training.buildingId] || 0) : 0,
    training ? training.minLevel : 0,
  );
  const duration     = Math.round(baseSecs * 1000 * recruitMult);
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
