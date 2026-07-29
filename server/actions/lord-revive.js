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
  const { lordId, clientDowntimeUntil } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  // Captured lords aren't diamond-revivable — only a free release from the
  // captor or a gold ransom (POST /api/lord/release, POST /api/lord/ransom)
  // frees them. Gated on capturedByPlayerId (server-set, authoritative),
  // never on downtimeReason — a player's own client can already claim
  // downtimeReason for their own PvE loss (see pve-result.js), so it can't
  // be trusted for anything that matters.
  if (lord.capturedByPlayerId) {
    return res.status(400).json({ ok: false, error: 'This lord is captured — pay the ransom or wait to be released.' });
  }

  const now = Date.now();

  // Use server's downtimeUntil if available. Fall back to clientDowntimeUntil when
  // a battle didn't commit the fallen state to Supabase (e.g. a race condition
  // or transient write failure). Validate the client value is in a plausible range
  // (must be in the future and within 2 hours from now) to prevent trivially cheap revives.
  const MAX_DOWNTIME_MS = 2 * 60 * 60 * 1000;
  const effectiveDowntime = lord.downtimeUntil ||
    (clientDowntimeUntil > now && clientDowntimeUntil <= now + MAX_DOWNTIME_MS
      ? clientDowntimeUntil
      : null);

  if (!effectiveDowntime || now >= effectiveDowntime) {
    return res.status(400).json({ ok: false, error: 'Lord is not incapacitated' });
  }

  const remSecs = Math.ceil((effectiveDowntime - now) / 1000);
  const cost    = Math.max(1, Math.ceil(remSecs / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Not enough credits (need ${cost})` });
  }

  player.credits    = (player.credits || 0) - cost;
  lord.downtimeUntil  = null;
  lord.downtimeReason = null;
  lord.currentHp      = 1;
  lord.hpRegenAt      = now;

  const saveError = await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });
  if (saveError) {
    return res.status(500).json({ ok: false, error: 'Failed to save revival — please try again' });
  }

  return res.json({ ok: true, lord, player });
}
