// =============================================
//  actions/army-disband.js — POST /api/army/disband
//
//  Body: { lordId, unitId, modelIdx }
//
//  Removes 1 model from the stack. If modelIdx === 0
//  (the front / damaged model), clears currentHp so the
//  next model in line starts fresh.
//
//  Refunds the model's gold cost scaled by its remaining
//  HP, capped at 90% for a fresh model: a full-HP model
//  refunds 90% of its price, a model at 10% HP refunds 9%
//  (0.9 × 0.10). Disbanding always costs you at least 10% —
//  soldiers aren't a savings account. Only the front model
//  can be damaged.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS } from '../engine-loader.js';

// Best-case refund fraction of a unit's gold cost (at full HP). Tunable.
// 0.9 → 0.6 on 2026-07-30. At 90% (and 100% on the cancel paths) unit churn was
// nearly free, so an army could be liquidated and rebuilt at will — which
// defeats the point of making units the recurring gold sink.
const DISBAND_REFUND_MAX = 0.6;

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

  // HP-proportional refund — read the fraction BEFORE clearing HP tracking.
  // Only the front model (modelIdx 0) can be damaged; everything behind it
  // is fresh and refunds full price. goldCost-0 units refund nothing.
  const def   = UNIT_DEFS[unitId];
  const maxHp = def?.combatStats?.hp || 0;
  const hpFrac = (modelIdx === 0 && stack.currentHp != null && maxHp > 0)
    ? Math.min(1, Math.max(0, stack.currentHp / maxHp))
    : 1;
  const refund = Math.floor((def?.goldCost || 0) * DISBAND_REFUND_MAX * hpFrac);

  stack.count -= 1;
  // If the front (damaged) model was removed, clear the HP tracking so
  // the next model shows as fresh.
  if (modelIdx === 0) stack.currentHp = null;
  army.units = army.units.filter(u => u.count > 0);

  player.coins = (player.coins || 0) + refund;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, army, player, refund });
}
