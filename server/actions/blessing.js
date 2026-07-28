// =============================================
//  actions/blessing.js — Temple blessings (consecration)
//
//  POST /api/blessing/consecrate  { blessingId }
//
//  Blessings are EMPIRE-WIDE and single-slot (one active at a time),
//  unlocked by owning a Temple (level >= BLESSING_MIN_TEMPLE) in any city.
//  Consecrating pays a GOLD offering and (re)starts the active blessing
//  for a duration scaled by the player's highest Temple level. Switching is
//  allowed anytime — consecrating simply replaces whatever is active (and
//  pays the offering again). Expiry is handled in
//  server/tick/catch-up.js (blessing expiry section).
//
//  State: player.activeBlessing = { id, startedAt, finishAt } | null
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { BLESSING_DEFS, BLESSING_MIN_TEMPLE, blessingDuration, blessingCost } from '../engine-loader.js';

function _maxTempleLevel(cities, playerId) {
  return Object.values(cities)
    .filter(c => c?.playerId === playerId)
    .reduce((max, c) => Math.max(max, c.buildings?.temple || 0), 0);
}

export async function handleBlessingConsecrate(req, res) {
  const { blessingId } = req.body || {};
  if (!blessingId) return res.status(400).json({ ok: false, error: 'Missing blessingId' });

  const def = BLESSING_DEFS[blessingId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown blessing' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const templeLevel = _maxTempleLevel(cities, playerId);
  if (templeLevel < BLESSING_MIN_TEMPLE) {
    return res.status(400).json({ ok: false, error: `Requires a Temple (level ${BLESSING_MIN_TEMPLE}+) to consecrate a blessing.` });
  }

  // Gold offering scales with the highest Temple level (same curve as duration).
  const cost = blessingCost(templeLevel);
  if (Math.floor(player.coins || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Consecration costs ${cost.toLocaleString()} gold (have ${Math.floor(player.coins || 0)}).` });
  }
  player.coins = (player.coins || 0) - cost;

  const now  = Date.now();
  const secs = blessingDuration(templeLevel);
  player.activeBlessing = { id: blessingId, startedAt: now, finishAt: now + secs * 1000 };

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Schedule a server-side expiry tick so the blessing lapses (and the client
  // can be toasted) even if the player is offline when it ends — parity with
  // the research completion event. Not load-bearing (getBlessingEffects already
  // ignores an expired blessing by finishAt), just tidy + timely.
  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'blessing',
    fire_at:   player.activeBlessing.finishAt,
    payload:   { blessingId },
  });
  if (evtErr) console.warn('[blessing] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, player });
}
