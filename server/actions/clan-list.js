// =============================================
//  actions/clan-list.js — POST /api/clan/list
//
//  Body: {}
//
//  Returns every clan (id, name, tag, leader, full member list, pending
//  applications, and any wars it's involved in) — the client uses this
//  both to browse/join clans and to find its own clan's full roster (by
//  matching player.clanId against the returned ids). The 'clans' table is
//  small enough at this scale that returning everything in one call is
//  simpler than separate "my clan" / "my wars" endpoints.
// =============================================

import { loadAndCatchUp } from '../action-base.js';

const MAX_MEMBERS = 5;

export async function handleClanList(req, res) {
  // Reuses the same auth+catch-up path as every other action for
  // consistency, even though clan browsing doesn't need the player's own
  // lords/cities/armies — keeping one auth pattern beats a second one.
  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin } = ctx;

  const [{ data: clans, error: clanErr }, { data: wars, error: warErr }] = await Promise.all([
    admin.from('clans').select('*').order('created_at', { ascending: true }),
    admin.from('clan_wars').select('*').order('created_at', { ascending: false }),
  ]);
  if (clanErr) return res.status(500).json({ ok: false, error: 'Failed to load clans' });
  if (warErr)  return res.status(500).json({ ok: false, error: 'Failed to load clan wars' });

  const nameByClanId = {};
  const tagByClanId  = {};
  (clans || []).forEach(c => { nameByClanId[c.id] = c.name; tagByClanId[c.id] = c.tag; });

  const shaped = (clans || []).map(c => {
    const myWars = (wars || [])
      .filter(w => w.clan_a_id === c.id || w.clan_b_id === c.id)
      .map(w => {
        const isA = w.clan_a_id === c.id;
        const opponentId = isA ? w.clan_b_id : w.clan_a_id;
        return {
          id: w.id,
          opponentClanId: opponentId,
          opponentName: nameByClanId[opponentId] || 'Unknown Clan',
          opponentTag: tagByClanId[opponentId] || '???',
          myScore: isA ? Number(w.score_a) : Number(w.score_b),
          opponentScore: isA ? Number(w.score_b) : Number(w.score_a),
          endsAt: w.ends_at,
          status: w.status,
          winnerClanId: w.winner_clan_id,
          isWinner: w.winner_clan_id ? w.winner_clan_id === c.id : null,
        };
      });

    return {
      id: c.id, name: c.name, tag: c.tag, leaderId: c.leader_id,
      members: c.members || [], memberCount: (c.members || []).length, maxMembers: MAX_MEMBERS,
      pending: c.pending || [],
      wars: myWars,
    };
  });

  return res.json({ ok: true, clans: shaped });
}
