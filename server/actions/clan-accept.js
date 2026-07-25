// =============================================
//  actions/clan-accept.js — POST /api/clan/accept
//
//  Body: { targetPlayerId }
//
//  Leader-only: accepts a pending applicant into the clan. Requires a
//  direct cross-player write (setting the ACCEPTED player's own
//  player.clanId, not the leader's) — same admin/service-role pattern as
//  clan-kick.js's cross-player write.
// =============================================

import { loadAndCatchUp } from '../action-base.js';

const MAX_MEMBERS = 5;

export async function handleClanAccept(req, res) {
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
    return res.status(403).json({ ok: false, error: 'Only the clan leader can accept applications.' });
  }

  const members = clan.members || [];
  const pending = clan.pending || [];
  if (members.length >= MAX_MEMBERS) {
    return res.status(400).json({ ok: false, error: `Clan is already full (${MAX_MEMBERS}/${MAX_MEMBERS}).` });
  }
  const applicant = pending.find(p => p.playerId === targetPlayerId);
  if (!applicant) {
    return res.status(400).json({ ok: false, error: 'That player has no pending application.' });
  }

  const updatedMembers = [...members, { playerId: applicant.playerId, username: applicant.username }];
  const updatedPending = pending.filter(p => p.playerId !== targetPlayerId);
  const { error: updateErr } = await admin.from('clans')
    .update({ members: updatedMembers, pending: updatedPending }).eq('id', clan.id);
  if (updateErr) return res.status(500).json({ ok: false, error: 'Failed to accept applicant: ' + updateErr.message });

  // Cross-player write: set the ACCEPTED player's own clanId.
  const { data: targetRows } = await admin.from('storage').select('value').eq('player_id', targetPlayerId).eq('key', 'players').maybeSingle();
  const targetPlayers = targetRows?.value || {};
  if (targetPlayers[targetPlayerId]) {
    targetPlayers[targetPlayerId].clanId = clan.id;
    await admin.from('storage').upsert(
      { player_id: targetPlayerId, key: 'players', value: targetPlayers },
      { onConflict: 'player_id,key' },
    );
  }

  return res.json({ ok: true, clan: { ...clan, members: updatedMembers, pending: updatedPending } });
}
