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
//
//  Also returns `wars`: every clan_wars row in the game, named absolutely
//  (clanA/clanB) rather than relative to one clan — used for an "all wars"
//  browse view, since each clan's own `wars[]` above is expressed as
//  "me vs opponent" and can't drive a global list on its own.
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
          // Rounded — older wars accrued before scores were rounded at the
          // write site can still carry long decimals in the DB; rounding
          // on this read path fixes their display immediately too.
          myScore: Math.round(isA ? Number(w.score_a) : Number(w.score_b)),
          opponentScore: Math.round(isA ? Number(w.score_b) : Number(w.score_a)),
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

  // Flat, clan-relative-free view of every war in the game (both sides named
  // absolutely as A/B) — the per-clan `wars` above only ever expresses a war
  // from that one clan's "me vs opponent" perspective, which is fine for My
  // Clan but can't drive a global "browse every war" list.
  const globalWars = (wars || []).map(w => ({
    id: w.id,
    clanAId: w.clan_a_id, clanAName: nameByClanId[w.clan_a_id] || 'Unknown Clan', clanATag: tagByClanId[w.clan_a_id] || '???',
    clanBId: w.clan_b_id, clanBName: nameByClanId[w.clan_b_id] || 'Unknown Clan', clanBTag: tagByClanId[w.clan_b_id] || '???',
    scoreA: Math.round(Number(w.score_a)), scoreB: Math.round(Number(w.score_b)),
    endsAt: w.ends_at, status: w.status, winnerClanId: w.winner_clan_id,
  }));

  return res.json({ ok: true, clans: shaped, wars: globalWars });
}
