// =============================================
//  actions/army-transfer.js — POST /api/army/transfer
//
//  Body: { lordAId, lordBId, toB: [{unitId, count, damaged?}],
//                            toA: [{unitId, count, damaged?}] }
//
//  Exchanges troops between two of the player's own lords in one
//  atomic move. Both lords must be standing on the SAME tile —
//  troop hand-offs follow the same "you must be there" grammar as
//  recruiting, so armies never teleport and march time/food still
//  matter. Both directions are validated and applied together so
//  a swap can never half-complete.
//
//  Blocked while either lord is incapacitated, mid-action, or in
//  a stance that restricts actions — downtime and stances keep
//  their teeth; a downed lord's army is stuck with them.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS, TALENT_POOL, STANCE_DEFS, EconomyCore } from '../engine-loader.js';
import { applyExchange } from '../army-transfer-core.js';

// Mirrors recruit.js's _armyPowerCap — PWR is the single army-size metric.
function _armyPowerCap(lord) {
  const bonus = TALENT_POOL?.[lord.talentId]?.effects?.armyPowerCapBonus || 0;
  return 200 + (lord.level || 1) * 80 + bonus;
}

function _isDown(lord) {
  return !!(lord.downtimeUntil && Date.now() < lord.downtimeUntil);
}

function _isActionStanced(lord) {
  if (!lord.stance?.id || lord.stance.id === 'idle') return false;
  if (!lord.stance.finishAt || Date.now() >= lord.stance.finishAt) return false;
  return !!STANCE_DEFS[lord.stance.id]?.restrictions?.includes('action');
}

// Units already bought and queued for this lord across ALL cities — they
// WILL land in the army when training finishes (catch-up adds them without
// re-checking the cap), so the transfer cap check must count them too.
function _queuedUnits(cities, lordId) {
  const queued = [];
  Object.values(cities || {}).forEach(city => {
    (city.recruitmentQueue || []).forEach(item => {
      if (item.lordId === lordId) queued.push({ unitId: item.unitId, count: item.count });
    });
  });
  return queued;
}

function _projectedPower(units, queued) {
  return EconomyCore.getArmyPower([...(units || []), ...queued], UNIT_DEFS);
}

function _sanitizeMoves(moves) {
  if (moves == null) return [];
  if (!Array.isArray(moves)) return null;
  const clean = [];
  for (const m of moves) {
    if (!m || typeof m.unitId !== 'string') return null;
    if (!Number.isInteger(m.count) || m.count < 1 || m.count > 10000) return null;
    clean.push({ unitId: m.unitId, count: m.count, damaged: !!m.damaged });
  }
  return clean;
}

export async function handleArmyTransfer(req, res) {
  const { lordAId, lordBId } = req.body || {};
  const toB = _sanitizeMoves(req.body?.toB);
  const toA = _sanitizeMoves(req.body?.toA);

  if (!lordAId || !lordBId)  return res.status(400).json({ ok: false, error: 'Missing lordAId or lordBId' });
  if (lordAId === lordBId)   return res.status(400).json({ ok: false, error: 'Cannot transfer to the same lord.' });
  if (toB == null || toA == null) return res.status(400).json({ ok: false, error: 'Malformed transfer list.' });
  if (toB.length === 0 && toA.length === 0) {
    return res.status(400).json({ ok: false, error: 'Nothing to transfer.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lordA = lords[lordAId];
  const lordB = lords[lordBId];
  if (!lordA || !lordB) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lordA.playerId !== playerId || lordB.playerId !== playerId) {
    return res.status(403).json({ ok: false, error: 'Not your lord' });
  }

  if (lordA.x == null || lordB.x == null || lordA.x !== lordB.x || lordA.y !== lordB.y) {
    return res.status(400).json({ ok: false, error: 'Both lords must be standing on the same tile to exchange troops.' });
  }

  for (const lord of [lordA, lordB]) {
    if (_isDown(lord)) {
      return res.status(400).json({ ok: false, error: `${lord.name} is incapacitated — their army cannot be touched.` });
    }
    if ((lord.actionQueue || []).length > 0) {
      return res.status(400).json({ ok: false, error: `${lord.name} is busy — wait for their current action to finish.` });
    }
    if (_isActionStanced(lord)) {
      return res.status(400).json({ ok: false, error: `${lord.name} cannot exchange troops while in ${STANCE_DEFS[lord.stance.id]?.name || 'a'} stance.` });
    }
  }

  // Legendary units answer only to a seasoned commander — same gate as recruit.
  for (const [moves, receiver] of [[toB, lordB], [toA, lordA]]) {
    for (const m of moves) {
      const def = UNIT_DEFS[m.unitId];
      if (!def) return res.status(400).json({ ok: false, error: `Unknown unit: ${m.unitId}` });
      if (def.category === 'legendary' && (receiver.level || 1) < 12) {
        return res.status(400).json({ ok: false, error: `Only a lord of level 12 or higher can command a ${def.name}.` });
      }
    }
  }

  const armyA = armies[lordAId] || { lordId: lordAId, units: [] };
  const armyB = armies[lordBId] || { lordId: lordBId, units: [] };

  const result = applyExchange(armyA.units, armyB.units, toB, toA);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

  // PWR cap per receiving lord, counting units still in training queues.
  // A transfer that leaves a lord over cap is only allowed when it IMPROVES
  // their situation (projected ≤ what they already had) — so players can
  // always dig an over-cap lord out, but never make one worse.
  const checks = [
    { lord: lordA, before: armyA.units, after: result.unitsA },
    { lord: lordB, before: armyB.units, after: result.unitsB },
  ];
  for (const { lord, before, after } of checks) {
    const queued    = _queuedUnits(cities, lord.id);
    const cap       = _armyPowerCap(lord);
    const projected = _projectedPower(after, queued);
    if (projected > cap && projected > _projectedPower(before, queued)) {
      return res.status(400).json({
        ok: false,
        error: `${lord.name} cannot hold that much: ${Math.round(projected)}/${cap} PWR (including units still training).`,
      });
    }
  }

  armyA.units = result.unitsA;
  armyB.units = result.unitsB;
  armies[lordAId] = armyA;
  armies[lordBId] = armyB;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, armyA, armyB });
}
