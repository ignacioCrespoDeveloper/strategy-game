// =============================================
//  actions/cancel-action.js — POST /api/lord/cancel-action
//
//  Body: { lordId }
//
//  Cancels a lord's in-progress action queue (an outgoing attack, a plain
//  march, a search or a scout). No refund — the march-supplies (food) spent
//  ordering a move/attack are forfeit, so a feint costs you something. The
//  lord stays where it is: position only ever updates when a move COMPLETES,
//  and a cancelled one never will.
//
//  loadAndCatchUp runs first, so if the action had ALREADY completed on the
//  server (dispatcher/offline catch-up), the queue is empty here and there is
//  nothing left to cancel — reported as a soft error.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleCancelAction(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  if (!(lord.actionQueue || []).length) {
    return res.status(400).json({ ok: false, error: 'That action already resolved — nothing to cancel.' });
  }

  lord.actionQueue         = [];
  // Clear any deferred-resolution flags defensively (normally unset while an
  // action is still in progress — they're only stamped on completion).
  lord.pendingPvpAttack    = null;
  lord.pendingArrivalCheck = null;
  lord.pendingScoutResolve = null;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord });
}
