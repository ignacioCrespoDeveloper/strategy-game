// =============================================
//  actions/lord-release.js — POST /api/lord/release
//
//  Body: { lordId, ownerId }
//
//  Lets the capturing player voluntarily free a lord they hold, for free.
//  Caller is the CAPTOR, but the data being mutated (the lord's own
//  capturedByPlayerId field) lives in the OWNER's 'lords' blob — a
//  different player_id row that loadAndCatchUp/saveState can't reach (they
//  only ever touch the calling player's own rows). `ownerId` is a lookup
//  hint carried by the prison-list response, not an authorization claim —
//  the real check is re-verifying capturedByPlayerId === the caller's own
//  id after loading the owner's row, right before writing.
// =============================================

import { loadAndCatchUp } from '../action-base.js';

export async function handleLordRelease(req, res) {
  const { lordId, ownerId } = req.body || {};
  if (!lordId || !ownerId) return res.status(400).json({ ok: false, error: 'Missing lordId or ownerId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId } = ctx;

  const { data: rows, error: loadErr } = await admin
    .from('storage')
    .select('key, value')
    .eq('player_id', ownerId)
    .in('key', ['lords']);

  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load lord' });

  const ownerLords = rows?.[0]?.value || {};
  const lord        = ownerLords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });

  // Authorization: only the actual captor can release — re-checked here,
  // right before the write, to narrow (not fully eliminate) the race
  // against a simultaneous ransom payment. Not a client-trusted field.
  if (lord.capturedByPlayerId !== playerId) {
    return res.status(403).json({ ok: false, error: 'You do not hold this lord captive' });
  }

  lord.capturedByPlayerId = null;
  lord.capturedByUsername = null;
  lord.capturedAt         = null;
  lord.downtimeUntil      = null;
  lord.downtimeReason     = null;
  lord.currentHp          = 1;
  lord.hpRegenAt          = Date.now();
  ownerLords[lordId]      = lord;

  const { error: saveErr } = await admin
    .from('storage')
    .upsert({ player_id: ownerId, key: 'lords', value: ownerLords }, { onConflict: 'player_id,key' });

  if (saveErr) return res.status(500).json({ ok: false, error: 'Failed to release lord — please try again' });

  return res.json({ ok: true });
}
