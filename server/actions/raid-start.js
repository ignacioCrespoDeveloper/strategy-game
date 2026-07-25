// =============================================
//  actions/raid-start.js — POST /api/lord/raid-start
//
//  Body: { lordId, durationSecs }
//
//  Starts the Raiding stance server-side — real economic value, so unlike
//  ambush/raid (which stay client-only stance changes) this can't be
//  trusted to the client. See js/data/stances.js's 'raiding' entry for the
//  full mechanic writeup.
//
//  Validates the lord is free, has an army, and is standing on a tile with
//  NO city (own or enemy) — raiding only works on neutral/wild ground.
// =============================================

import { loadAndCatchUp, saveState }        from '../action-base.js';
import { STANCE_DEFS }                       from '../engine-loader.js';
import { _armyTotal, _findCityAtTile }       from '../combat-resolver.js';

export async function handleRaidStart(req, res) {
  const { lordId, durationSecs } = req.body || {};
  if (!lordId || !durationSecs) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or durationSecs' });
  }

  const def = STANCE_DEFS.raiding;
  if (!def || !def.durations.includes(durationSecs)) {
    return res.status(400).json({ ok: false, error: 'Invalid raid duration.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });
  if (lord.x == null || lord.y == null) {
    return res.status(400).json({ ok: false, error: 'Lord has no position — found a city first.' });
  }
  if (lord.downtimeUntil && Date.now() < lord.downtimeUntil) {
    return res.status(400).json({ ok: false, error: 'Lord is incapacitated.' });
  }
  if (lord.actionQueue?.length > 0) {
    return res.status(400).json({ ok: false, error: 'An action is already in progress.' });
  }
  if (lord.stance?.id && lord.stance.id !== 'idle' && Date.now() < lord.stance.finishAt) {
    return res.status(400).json({ ok: false, error: `Already in ${STANCE_DEFS[lord.stance.id]?.name || lord.stance.id} stance.` });
  }

  const armyUnits = (armies[lordId]?.units) || [];
  if (_armyTotal(armyUnits) <= 0) {
    return res.status(400).json({ ok: false, error: 'Raiding requires an army — a lone lord has nothing to pillage with.' });
  }

  const cityHere = await _findCityAtTile(admin, lord.x, lord.y, null);
  if (cityHere) {
    return res.status(400).json({ ok: false, error: 'Cannot raid on a city tile — raiding only works on neutral/wild ground.' });
  }

  const now = Date.now();
  lord.stance = { id: 'raiding', startedAt: now, finishAt: now + durationSecs * 1000 };
  lords[lordId] = lord;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
