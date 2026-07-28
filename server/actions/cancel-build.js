// =============================================
//  actions/cancel-build.js — POST /api/city/cancel-build
//
//  Body: { cityId, queueIndex }
//
//  Cancels a queued (or in-progress) construction upgrade and FULLY refunds
//  its resource cost to the empire pool. Remaining queue items resequence to
//  chain back-to-back (mirrors instant-build.js), and fresh dispatch events
//  are registered for the shifted tail so offline completion stays on time.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { BUILDING_DEFS } from '../engine-loader.js';

export async function handleCancelBuild(req, res) {
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

  const queue = city.constructionQueue || [];
  const idx   = Number(queueIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= queue.length) {
    return res.status(400).json({ ok: false, error: 'Invalid queue index' });
  }

  const item = queue[idx];
  const def  = BUILDING_DEFS[item.buildingId];

  // Full resource refund of what was paid to enqueue this upgrade.
  const refund = def ? def.cost(item.targetLevel) : {};
  player.resources = player.resources || { food: 0, wood: 0, stone: 0 };
  for (const [rKey, amt] of Object.entries(refund)) {
    if (amt > 0) player.resources[rKey] = (player.resources[rKey] || 0) + amt;
  }

  // Remove it; resequence everything from idx onward to chain after whatever
  // now precedes it (or start now if the front item was cancelled).
  const newQueue = [...queue.slice(0, idx), ...queue.slice(idx + 1)];
  let cursor = idx > 0 ? newQueue[idx - 1].finishAt : Date.now();
  for (let i = idx; i < newQueue.length; i++) {
    const dur = newQueue[i].finishAt - newQueue[i].startedAt;
    newQueue[i] = { ...newQueue[i], startedAt: cursor, finishAt: cursor + dur };
    cursor = newQueue[i].finishAt;
  }
  city.constructionQueue = newQueue;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Re-register dispatch events for the shifted tail (items from idx onward,
  // whose finishAt changed) so offline completion fires at the updated times.
  const tail = newQueue.slice(idx);
  if (tail.length > 0) {
    const evts = tail.map(q => ({
      player_id: playerId,
      type:      'build',
      fire_at:   q.finishAt,
      payload:   { cityId, buildingId: q.buildingId, targetLevel: q.targetLevel },
    }));
    const { error: evtErr } = await admin.from('pending_events').insert(evts);
    if (evtErr) console.warn('[cancel-build] pending_events insert failed:', evtErr.message);
  }

  return res.json({ ok: true, city, player, refund });
}
