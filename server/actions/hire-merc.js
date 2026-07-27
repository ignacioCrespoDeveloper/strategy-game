// =============================================
//  actions/hire-merc.js — POST /api/lord/hire-merc
//
//  Body: { lordId, unitId }
//
//  Hires a mercenary unit instantly server-side.
//  Deducts gold from player, adds unit to lord's army.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS, TALENT_POOL, EconomyCore } from '../engine-loader.js';

// Mirrors server/actions/recruit.js — Army capacity is gated by Army Power
// alone; EconomyCore.getArmyPower is the single source of truth (linear
// per-model cost + combat-trait tax).
function _armyPower(army) {
  return EconomyCore.getArmyPower(army?.units, UNIT_DEFS);
}

function _projectedArmyPower(army, unitId) {
  return EconomyCore.getProjectedArmyPower(army?.units, UNIT_DEFS, unitId, 1);
}

function _armyPowerCap(lord) {
  const bonus = TALENT_POOL?.[lord.talentId]?.effects?.armyPowerCapBonus || 0;
  return 200 + (lord.level || 1) * 80 + bonus;
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

  const cap            = _armyPowerCap(lord);
  const usedPower      = _armyPower(army);
  const projectedPower = _projectedArmyPower(army, unitId);
  if (projectedPower > cap) {
    return res.status(400).json({
      ok: false,
      error: `Not enough army power capacity. Used ${Math.round(usedPower)}/${cap} PWR.`,
    });
  }

  if ((player.coins || 0) < def.goldCost) {
    return res.status(400).json({ ok: false, error: `Need ${def.goldCost} gold, have ${player.coins || 0}.` });
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
