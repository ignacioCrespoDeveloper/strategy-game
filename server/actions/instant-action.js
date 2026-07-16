// =============================================
//  actions/instant-action.js — POST /api/lord/instant-action
//
//  Body: { lordId }
//
//  Spends credits server-side to instantly complete the lord's
//  current queued action. Cost = ceil(secsLeft / 60), min 1 credit.
//  Mirrors the pattern of instant-build.js but for lord actions.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleInstantAction(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) {
    return res.status(400).json({ ok: false, error: 'Missing lordId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  if (!lord.actionQueue || lord.actionQueue.length === 0) {
    return res.status(400).json({ ok: false, error: 'No action in progress' });
  }

  const action = lord.actionQueue[0];
  if (action.intent === 'attack') {
    return res.status(400).json({ ok: false, error: 'Cannot skip a PvP attack in progress' });
  }

  const now      = Date.now();
  const secsLeft = Math.max(0, Math.ceil((action.finishAt - now) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Need ${cost} 💎 credits (have ${player.credits || 0})` });
  }

  player.credits = (player.credits || 0) - cost;

  // Complete the action: dequeue it and apply side-effects (move updates position)
  const completed = lord.actionQueue.shift();
  if (completed.actionId === 'move_lord' && completed.destX != null) {
    lord.x = completed.destX;
    lord.y = completed.destY;
  }
  lords[lordId] = lord;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player, completedAction: completed });
}
