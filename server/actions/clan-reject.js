// =============================================
//  actions/clan-reject.js — POST /api/clan/reject
//
//  Body: { targetPlayerId }
//
//  Leader-only: declines a pending applicant. Just removes them from the
//  pending list — they never had player.clanId set, so there's nothing to
//  clear on their side.
// =============================================

import { loadAndCatchUp } from '../action-base.js';

export async function handleClanReject(req, res) {
  const { targetPlayerId } = req.body || {};
  if (!targetPlayerId) return res.status(400).json({ ok: false, error: 'Missing targetPlayerId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, player } = ctx;

  if (!player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are not in a clan.' });
  }

  const { data: clan, error: loadErr } = await admin.from('clans').select('*').eq('id', player.clanId).maybeSingle();
  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load clan' });
  if (!clan)   return res.status(404).json({ ok: false, error: 'Clan not found' });
  if (clan.leader_id !== playerId) {
    return res.status(403).json({ ok: false, error: 'Only the clan leader can reject applications.' });
  }

  const pending = clan.pending || [];
  if (!pending.some(p => p.playerId === targetPlayerId)) {
    return res.status(400).json({ ok: false, error: 'That player has no pending application.' });
  }

  const updatedPending = pending.filter(p => p.playerId !== targetPlayerId);
  const { error: updateErr } = await admin.from('clans').update({ pending: updatedPending }).eq('id', clan.id);
  if (updateErr) return res.status(500).json({ ok: false, error: 'Failed to reject applicant: ' + updateErr.message });

  return res.json({ ok: true, clan: { ...clan, pending: updatedPending } });
}
