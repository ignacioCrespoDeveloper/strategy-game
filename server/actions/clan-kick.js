// =============================================
//  actions/clan-kick.js — POST /api/clan/kick
//
//  Body: { targetPlayerId }
//
//  Leader-only: removes another member from the clan. Requires a direct
//  cross-player write (clearing the KICKED player's own player.clanId, not
//  the caller's) — same admin/service-role pattern already used elsewhere
//  in this codebase for cross-player writes (e.g. combat-resolver.js
//  updating a defender's state after a battle).
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleClanKick(req, res) {
  const { targetPlayerId } = req.body || {};
  if (!targetPlayerId) return res.status(400).json({ ok: false, error: 'Missing targetPlayerId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  if (!player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are not in a clan.' });
  }
  if (targetPlayerId === playerId) {
    return res.status(400).json({ ok: false, error: 'Use Leave instead of kicking yourself.' });
  }

  const { data: clan, error: loadErr } = await admin.from('clans').select('*').eq('id', player.clanId).maybeSingle();
  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load clan' });
  if (!clan)   return res.status(404).json({ ok: false, error: 'Clan not found' });
  if (clan.leader_id !== playerId) {
    return res.status(403).json({ ok: false, error: 'Only the clan leader can kick members.' });
  }

  const members = clan.members || [];
  if (!members.some(m => m.playerId === targetPlayerId)) {
    return res.status(400).json({ ok: false, error: 'That player is not a member of this clan.' });
  }

  const updatedMembers = members.filter(m => m.playerId !== targetPlayerId);
  const { error: updateErr } = await admin.from('clans').update({ members: updatedMembers }).eq('id', clan.id);
  if (updateErr) return res.status(500).json({ ok: false, error: 'Failed to kick member: ' + updateErr.message });

  // Clear the KICKED player's own clanId — a direct cross-player row write.
  const { data: targetRows } = await admin.from('storage').select('value').eq('player_id', targetPlayerId).eq('key', 'players').maybeSingle();
  const targetPlayers = targetRows?.value || {};
  if (targetPlayers[targetPlayerId]) {
    targetPlayers[targetPlayerId].clanId = null;
    await admin.from('storage').upsert(
      { player_id: targetPlayerId, key: 'players', value: targetPlayers },
      { onConflict: 'player_id,key' },
    );
  }

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, clan: { ...clan, members: updatedMembers } });
}
