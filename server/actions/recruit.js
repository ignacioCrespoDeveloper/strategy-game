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
import { UNIT_DEFS, EconomyCore, UnitUnlockService, getLordMountEffects, lordTalentEffects, lordArmyPowerCapBase } from '../engine-loader.js';
import { lordBusyReason } from '../lord-busy.js';

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

// Talent and apex-mount cap bonuses stack. Must stay identical to
// LordService.getArmyPowerCap (js/domain/lord.js) and _armyPowerCap in
// server/tick/catch-up.js — if this one is lower the client offers recruits
// the server then refuses; if it is higher the cap leaks. The base term is
// lordArmyPowerCapBase (frozen at level 10) so that freeze is defined once.
function _armyPowerCap(lord) {
  const talent = lordTalentEffects(lord).armyPowerCapBonus || 0;
  const mount  = getLordMountEffects(lord).armyPowerCapBonus || 0;
  return lordArmyPowerCapBase(lord.level) + talent + mount;
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

  // A lord already out on an order cannot raise troops. Recruiting is bound to
  // the lord (the batch carries lordId and lands in THEIR army when it
  // finishes), so without this a lord could march on an enemy city and queue
  // reinforcements the whole way there. Same rule as the raiding stance's
  // long-declared 'recruit' restriction — this is what finally reads it.
  const busy = lordBusyReason(lord);
  if (busy) {
    return res.status(400).json({ ok: false, error: `${busy} — troops must be raised before the lord sets out.` });
  }

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

  // THE recruitment gate — race, trainability, training-building level and
  // the legendary lord rule, all from the one evaluator the client filters
  // with. This is authoritative: the client merely hides what this would
  // reject. Before it existed, handleRecruit checked only gold and the PWR
  // cap, so any unit could be trained in any city by any race.
  const gate = UnitUnlockService.check(unitId, {
    race:      lord.race,
    buildings: city.buildings || {},
    lordLevel: lord.level || 1,
  });
  if (gate.locked) {
    return res.status(400).json({ ok: false, error: gate.reasons.join(' ') });
  }

  const army = armies[lordId] || { units: [] };

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

  const cap            = _armyPowerCap(lord);
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
  // Merged across every talent the lord holds — two recruit-time talents would
  // compound (×0.7 × ×0.7), never add. See TALENT_MULT_KEYS in lord-classes.js.
  const recruitMult  = lordTalentEffects(lord).recruitTimeMult ?? 1;
  // Recruit time: base × recruit_speed modifiers ÷ hangar divisor (every
  // level of THIS city's training building above the unit's unlock level),
  // then the lord's talent mult.
  const training     = EconomyCore.getUnitTraining(lord.race, unitId);
  // recruit_speed comes from BOTH the Library's books and an active God of
  // War blessing — they stack. getRecruitTime reads a single flat-key object,
  // so sum the two here. (js/ui/lord-screen.js mirrors this for display.)
  const researchFx   = EconomyCore.getResearchEffects(player.research);
  const blessingFx   = EconomyCore.getBlessingEffects(player.activeBlessing, now);
  const recruitFx    = {
    ...researchFx,
    recruit_speed: (researchFx.recruit_speed || 0) + (blessingFx.recruit_speed || 0),
  };
  const baseSecs     = EconomyCore.getRecruitTime(
    def, count,
    recruitFx,
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
