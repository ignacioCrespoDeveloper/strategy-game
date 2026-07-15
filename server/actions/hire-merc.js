// =============================================
//  actions/hire-merc.js — POST /api/lord/hire-merc
//
//  Body: { lordId, unitId }
//
//  Hires a mercenary unit instantly server-side.
//  Deducts gold from player, adds unit to lord's army.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS }                 from '../engine-loader.js';

const ARMY_LIMIT = 10;

function _commandCapacity(lord) {
  return 6 + 2 * (lord.level || 1);
}

function _totalWeight(army) {
  return (army?.units || []).reduce((sum, stack) => {
    const def = UNIT_DEFS[stack.unitId];
    return sum + (def?.armyWeight || 1) * stack.count;
  }, 0);
}

export async function handleHireMerc(req, res) {
  const { lordId, unitId } = req.body || {};
  if (!lordId || !unitId) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or unitId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const def = UNIT_DEFS[unitId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown unit.' });
  if (def.race !== null) return res.status(400).json({ ok: false, error: 'Not a mercenary unit.' });

  const army = armies[lordId] || { lordId, units: [] };

  if (army.units.length >= ARMY_LIMIT) {
    return res.status(400).json({ ok: false, error: `Army is full (${army.units.length}/${ARMY_LIMIT}).` });
  }

  const capacity    = _commandCapacity(lord);
  const usedWeight  = _totalWeight(army);
  const addedWeight = def.armyWeight || 1;
  if (usedWeight + addedWeight > capacity) {
    return res.status(400).json({
      ok: false,
      error: `Not enough command capacity. Used ${usedWeight}/${capacity} pts.`,
    });
  }

  if ((player.coins || 0) < def.goldCost) {
    return res.status(400).json({ ok: false, error: `Need ${def.goldCost}💰, have ${player.coins || 0}💰.` });
  }

  // Apply
  player.coins = (player.coins || 0) - def.goldCost;

  const existing = army.units.find(s => s.unitId === unitId);
  if (existing) {
    existing.count += 1;
  } else {
    army.units.push({ unitId, count: 1 });
  }
  armies[lordId] = army;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, player, army });
}
