// =============================================
//  actions/army-disband.js — POST /api/army/disband
//
//  Body: { lordId, unitId, modelIdx }
//
//  Removes 1 model from the stack. If modelIdx === 0
//  (the front / damaged model), clears currentHp so the
//  next model in line starts fresh.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleArmyDisband(req, res) {
  const { lordId, unitId, modelIdx = 0 } = req.body || {};
  if (!lordId || !unitId) return res.status(400).json({ ok: false, error: 'Missing lordId or unitId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const army = armies[lordId];
  if (!army) return res.status(404).json({ ok: false, error: 'Army not found' });

  const stack = army.units.find(u => u.unitId === unitId);
  if (!stack || stack.count < 1) {
    return res.status(400).json({ ok: false, error: 'Unit not found in army' });
  }

  stack.count -= 1;
  // If the front (damaged) model was removed, clear the HP tracking so
  // the next model shows as fresh.
  if (modelIdx === 0) stack.currentHp = null;
  army.units = army.units.filter(u => u.count > 0);

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, army });
}
