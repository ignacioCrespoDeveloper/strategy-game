// =============================================
//  actions/clan-create.js — POST /api/clan/create
//
//  Body: { name, tag }
//
//  Creates a new clan with the caller as leader + sole member. One clan
//  per player, enforced here (not just client-side) since clan membership
//  lives in its own dedicated 'clans' table (see supabase/migrations/
//  clans.sql) rather than the per-player 'storage' table everything else
//  in this game uses — a clan is the first entity genuinely shared across
//  several players' accounts at once, so it can't fit the "one row per
//  player_id" pattern the rest of the game relies on.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

const MAX_MEMBERS = 5;

function _generateClanId() {
  return 'clan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export async function handleClanCreate(req, res) {
  const { name, tag } = req.body || {};
  if (!name || !tag) {
    return res.status(400).json({ ok: false, error: 'Missing name or tag' });
  }

  const n = name.trim();
  const t = tag.trim().toUpperCase();
  if (n.length < 2)  return res.status(400).json({ ok: false, error: 'Clan name must be at least 2 characters.' });
  if (n.length > 30) return res.status(400).json({ ok: false, error: 'Clan name cannot exceed 30 characters.' });
  if (!/^[A-Z0-9]{2,5}$/.test(t)) {
    return res.status(400).json({ ok: false, error: 'Tag must be 2-5 letters/numbers.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  if (player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are already in a clan — leave it first.' });
  }

  // Fetch all clans and compare in JS rather than building a filter string
  // out of user-supplied text (postgrest .or()/.ilike() patterns are easy to
  // break or abuse with commas/parens/wildcards in an untrusted name) — the
  // clan roster is small enough that this is cheap either way.
  const { data: existing, error: checkErr } = await admin.from('clans').select('id, name, tag');
  if (checkErr) return res.status(500).json({ ok: false, error: 'Failed to check clan uniqueness' });
  if ((existing || []).some(c => c.name.toLowerCase() === n.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'That clan name is already taken.' });
  }
  if ((existing || []).some(c => c.tag.toLowerCase() === t.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'That clan tag is already taken.' });
  }

  const clan = {
    id: _generateClanId(),
    name: n,
    tag: t,
    leader_id: playerId,
    members: [{ playerId, username: player.username }],
    created_at: new Date().toISOString(),
  };

  const { error: insertErr } = await admin.from('clans').insert(clan);
  if (insertErr) return res.status(500).json({ ok: false, error: 'Failed to create clan: ' + insertErr.message });

  player.clanId = clan.id;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, player, clan: { ...clan, memberCount: 1, maxMembers: MAX_MEMBERS } });
}
