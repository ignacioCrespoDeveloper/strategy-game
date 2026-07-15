// =============================================
//  actions/lord-revive.js — POST /api/lord/revive
//
//  Body: { lordId }
//
//  Validates the player has enough credits, deducts them,
//  clears downtimeUntil, and sets currentHp = 1.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleLordRevive(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const now = Date.now();
  if (!lord.downtimeUntil || now >= lord.downtimeUntil) {
    return res.status(400).json({ ok: false, error: 'Lord is not incapacitated' });
  }

  const remSecs = Math.ceil((lord.downtimeUntil - now) / 1000);
  const cost    = Math.max(1, Math.ceil(remSecs / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Not enough diamonds (need ${cost}💎)` });
  }

  player.credits    = (player.credits || 0) - cost;
  lord.downtimeUntil  = null;
  lord.downtimeReason = null;
  lord.currentHp      = 1;
  lord.hpRegenAt      = now;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
