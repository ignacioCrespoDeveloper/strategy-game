// =============================================
//  actions/raid-cancel.js — POST /api/lord/raid-cancel
//
//  Body: { lordId }
//
//  Cancels an active Raiding stance early — forfeits everything accrued so
//  far. Rewards are only ever computed and paid out at completion (natural,
//  in catch-up.js, or instant via raid-instant.js) — never incrementally —
//  so simply clearing the stance already forfeits them; there is nothing to
//  claw back. Free — no credit cost, unlike raid-instant.js.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleRaidCancel(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  if (lord.stance?.id !== 'raiding') {
    return res.status(400).json({ ok: false, error: 'Lord is not currently raiding' });
  }

  lord.stance = { id: 'idle', startedAt: null, finishAt: null };
  lords[lordId] = lord;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
