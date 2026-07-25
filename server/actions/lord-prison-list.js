// =============================================
//  actions/lord-prison-list.js — POST /api/lord/prison-list
//
//  Body: (none)
//
//  Returns every lord the caller currently holds captive. No denormalized
//  per-player list is kept — capturedByPlayerId on the lord itself is the
//  only source of truth, so this does the same kind of unfiltered
//  cross-player scan server/combat-resolver.js's scanPresence/_gatherTileIntel
//  already do routinely (fetch every player's 'lords' blob, filter in JS),
//  rather than a second, driftable source of truth.
//
//  Response: { ok, prisoners: [{ lordId, lordName, level, ownerId, ownerUsername, capturedAt }] }
// =============================================

import { loadAndCatchUp } from '../action-base.js';

export async function handleLordPrisonList(req, res) {
  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId } = ctx;

  const { data: lordRows, error: loadErr } = await admin
    .from('storage')
    .select('player_id, value')
    .eq('key', 'lords');

  if (loadErr) return res.status(500).json({ ok: false, error: 'Failed to load prison list' });

  const prisoners = [];
  for (const row of (lordRows || [])) {
    Object.values(row.value || {}).forEach(l => {
      if (l.capturedByPlayerId === playerId) {
        prisoners.push({
          lordId:        l.id,
          lordName:      l.name,
          level:         l.level || 1,
          ownerId:       row.player_id,
          ownerUsername: null, // filled in below, once owner ids are known
          capturedAt:    l.capturedAt || null,
        });
      }
    });
  }

  if (prisoners.length > 0) {
    const ownerIds = [...new Set(prisoners.map(p => p.ownerId))];
    const { data: playerRows } = await admin
      .from('storage')
      .select('player_id, value')
      .eq('key', 'players')
      .in('player_id', ownerIds);
    const usernameByPlayer = {};
    (playerRows || []).forEach(r => {
      usernameByPlayer[r.player_id] = (r.value || {})[r.player_id]?.username || 'Unknown';
    });
    prisoners.forEach(p => { p.ownerUsername = usernameByPlayer[p.ownerId] || 'Unknown'; });
  }

  return res.json({ ok: true, prisoners });
}
