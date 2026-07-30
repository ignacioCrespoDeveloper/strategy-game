// =============================================
//  actions/cancel-recruit.js — POST /api/city/cancel-recruit
//
//  Body: { cityId, queueIndex }
//
//  Cancels a queued (or in-progress) recruitment batch and FULLY refunds its
//  gold cost (goldCost × count — exactly what recruit.js charged). Remaining
//  batches resequence to chain back-to-back (mirrors instant-recruit.js), and
//  fresh dispatch events are registered for the shifted tail.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { UNIT_DEFS } from '../engine-loader.js';

export async function handleCancelRecruit(req, res) {
  const { cityId, queueIndex } = req.body || {};
  if (!cityId || queueIndex == null) {
    return res.status(400).json({ ok: false, error: 'Missing cityId or queueIndex' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const city = cities[cityId];
  if (!city)                      return res.status(404).json({ ok: false, error: 'City not found' });
  if (city.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your city' });

  const queue = city.recruitmentQueue || [];
  const idx   = Number(queueIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) {
    return res.status(400).json({ ok: false, error: 'Invalid queue index' });
  }

  // 75% refund (was 100% until 2026-07-30). A full refund with no time penalty
  // let a player park gold in a recruit queue and pull it back out for free,
  // which is not a cost at all — the 25% cancellation fee is the friction.
  const CANCEL_RECRUIT_REFUND = 0.75;

  const item   = queue[idx];
  const def    = UNIT_DEFS[item.unitId];
  const refund = Math.floor((def?.goldCost || 0) * (item.count || 0) * CANCEL_RECRUIT_REFUND);
  if (refund > 0) player.coins = (player.coins || 0) + refund;

  // Remove it; resequence everything from idx onward to chain after whatever
  // now precedes it (or start now if the front batch was cancelled).
  const newQueue = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  let cursor = idx > 0 ? newQueue[idx - 1].finishAt : Date.now();
  for (let i = idx; i < newQueue.length; i++) {
    const dur = newQueue[i].finishAt - newQueue[i].startedAt;
    newQueue[i] = { ...newQueue[i], startedAt: cursor, finishAt: cursor + dur };
    cursor = newQueue[i].finishAt;
  }
  city.recruitmentQueue = newQueue;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  const tail = newQueue.slice(idx);
  if (tail.length > 0) {
    const evts = tail.map(q => ({
      player_id: playerId,
      type:      'recruit',
      fire_at:   q.finishAt,
      payload:   { cityId, unitId: q.unitId, count: q.count, lordId: q.lordId },
    }));
    const { error: evtErr } = await admin.from('pending_events').insert(evts);
    if (evtErr) console.warn('[cancel-recruit] pending_events insert failed:', evtErr.message);
  }

  return res.json({ ok: true, city, player, refund });
}
