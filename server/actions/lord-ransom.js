// =============================================
//  actions/lord-ransom.js — POST /api/lord/ransom
//
//  Body: { lordId }
//
//  Pays the fixed, level-scaled gold ransom (lordRansomCost) to free the
//  caller's own captured lord immediately. The gold goes to whichever
//  player captured them (server/combat-resolver.js's capturedByPlayerId),
//  not diamonds, not negotiable — see server/actions/lord-revive.js, which
//  explicitly refuses to diamond-revive a captured lord.
//
//  Caller is the lord's OWNER, who already legitimately owns the row being
//  mutated — loadAndCatchUp/saveState handle that half entirely. Only
//  crediting the captor's gold needs an extra direct cross-player query,
//  mirroring the read/write shape server/combat-resolver.js already uses
//  for its own multi-player writes (raw admin.from('storage') calls, since
//  action-base.js's helpers only ever touch the calling player's own rows).
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { lordRansomCost } from '../engine-loader.js';

export async function handleLordRansom(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });
  if (!lord.capturedByPlayerId) return res.status(400).json({ ok: false, error: 'This lord is not captured' });

  const captorId = lord.capturedByPlayerId;
  const cost     = lordRansomCost(lord.level);

  if ((player.coins || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Not enough gold (need ${cost}💰)` });
  }

  player.coins             = (player.coins || 0) - cost;
  lord.capturedByPlayerId  = null;
  lord.capturedByUsername  = null;
  lord.capturedAt          = null;
  lord.downtimeUntil       = null;
  lord.downtimeReason      = null;
  lord.currentHp           = 1;
  lord.hpRegenAt           = Date.now();

  const saveError = await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });
  if (saveError) {
    return res.status(500).json({ ok: false, error: 'Failed to pay ransom — please try again' });
  }

  // Best-effort payout to the captor — the owner's own ransom (their lord,
  // their gold, their request) has already succeeded and been saved above
  // regardless of what happens here, matching this codebase's existing
  // no-cross-write-transaction tolerance (see combat-resolver.js's own
  // multi-defender writes, which aren't atomic with each other either).
  try {
    const { data: rows, error: loadErr } = await admin
      .from('storage')
      .select('key, value')
      .eq('player_id', captorId)
      .in('key', ['players']);
    if (!loadErr && rows?.length) {
      const captorPlayers = rows[0].value || {};
      const captorPlayer  = captorPlayers[captorId];
      if (captorPlayer) {
        captorPlayer.coins = (captorPlayer.coins || 0) + cost;
        captorPlayers[captorId] = captorPlayer;
        await admin.from('storage').upsert(
          { player_id: captorId, key: 'players', value: captorPlayers },
          { onConflict: 'player_id,key' },
        );
      }
    }
  } catch (err) {
    console.warn('[lord-ransom] captor payout failed:', err.message);
  }

  return res.json({ ok: true, lord, player });
}
