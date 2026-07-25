// =============================================
//  actions/clan-leave.js — POST /api/clan/leave
//
//  Body: {} (acts on the caller's own membership)
//
//  Leaves the caller's current clan. If the leader leaves and other members
//  remain, leadership passes to the next member in the (join-order) members
//  array. If the leader was the last member, the clan is disbanded entirely.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleClanLeave(req, res) {
  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  if (!player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are not in a clan.' });
  }

  const { data: clan, error: loadErr } = await admin.from('clans').select('*').eq('id', player.clanId).maybeSingle();
  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load clan' });

  if (clan) {
    const remaining = (clan.members || []).filter(m => m.playerId !== playerId);
    if (remaining.length === 0) {
      const { error: deleteErr } = await admin.from('clans').delete().eq('id', clan.id);
      if (deleteErr) return res.status(500).json({ ok: false, error: 'Failed to disband clan: ' + deleteErr.message });
    } else {
      const wasLeader = clan.leader_id === playerId;
      const update = { members: remaining };
      if (wasLeader) update.leader_id = remaining[0].playerId;
      const { error: updateErr } = await admin.from('clans').update(update).eq('id', clan.id);
      if (updateErr) return res.status(500).json({ ok: false, error: 'Failed to leave clan: ' + updateErr.message });
    }
  }
  // If the clan row is already gone (e.g. stale player.clanId pointing at a
  // clan that no longer exists), just fall through and clear the pointer —
  // nothing left to update on the clan side.

  player.clanId = null;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, player });
}
