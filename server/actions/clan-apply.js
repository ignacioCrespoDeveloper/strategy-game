// =============================================
//  actions/clan-apply.js — POST /api/clan/apply
//
//  Body: { clanId }
//
//  Applies to join a clan — no longer instant (replaces the old clan-join.js).
//  The leader must accept via /api/clan/accept before membership actually
//  happens; /api/clan/reject lets them decline instead. One clan per
//  player and one pending application at a time, same "pick one" ethos as
//  clan membership itself.
// =============================================

import { loadAndCatchUp } from '../action-base.js';

const MAX_MEMBERS = 5;

export async function handleClanApply(req, res) {
  const { clanId } = req.body || {};
  if (!clanId) return res.status(400).json({ ok: false, error: 'Missing clanId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, player } = ctx;

  if (player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are already in a clan — leave it first.' });
  }

  const { data: clan, error: loadErr } = await admin.from('clans').select('*').eq('id', clanId).maybeSingle();
  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load clan' });
  if (!clan)   return res.status(404).json({ ok: false, error: 'Clan not found' });

  const members = clan.members || [];
  const pending = clan.pending || [];
  if (members.length >= MAX_MEMBERS) {
    return res.status(400).json({ ok: false, error: `${clan.name} is full (${MAX_MEMBERS}/${MAX_MEMBERS}).` });
  }
  if (members.some(m => m.playerId === playerId)) {
    return res.status(400).json({ ok: false, error: 'You are already a member of this clan.' });
  }
  if (pending.some(p => p.playerId === playerId)) {
    return res.status(400).json({ ok: false, error: 'You already have a pending application to this clan.' });
  }

  // A player can only have ONE pending application at a time — check every
  // clan's pending list, not just this one, so they can't spam-apply
  // everywhere and get double-accepted.
  const { data: allClans, error: allErr } = await admin.from('clans').select('id, pending');
  if (allErr) return res.status(500).json({ ok: false, error: 'Failed to check existing applications' });
  const alreadyApplied = (allClans || []).some(c => (c.pending || []).some(p => p.playerId === playerId));
  if (alreadyApplied) {
    return res.status(400).json({ ok: false, error: 'You already have a pending application to another clan — withdraw it first.' });
  }

  const updatedPending = [...pending, { playerId, username: player.username, appliedAt: Date.now() }];
  const { error: updateErr } = await admin.from('clans').update({ pending: updatedPending }).eq('id', clanId);
  if (updateErr) return res.status(500).json({ ok: false, error: 'Failed to apply: ' + updateErr.message });

  // No player.clanId change yet — that only happens once accepted.
  return res.json({ ok: true, clan: { ...clan, pending: updatedPending } });
}
