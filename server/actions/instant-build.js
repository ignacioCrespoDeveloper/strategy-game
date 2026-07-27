// =============================================
//  actions/instant-build.js — POST /api/city/instant-build
//
//  Body: { cityId }
//
//  Spends credits to instantly complete the FIRST item in a city's
//  construction queue. Cost = ceil(secsLeft / 60), minimum 1 credit.
//
//  Any remaining queued upgrades are resequenced to start back-to-back from
//  now, rather than waiting on the now-moot original finish time of the
//  batch that was just skipped ahead (mirrors instant-recruit.js).
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleInstantBuild(req, res) {
  const { cityId } = req.body || {};
  if (!cityId) {
    return res.status(400).json({ ok: false, error: 'Missing cityId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const city = cities[cityId];
  if (!city)                      return res.status(404).json({ ok: false, error: 'City not found' });
  if (city.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your city' });

  const queue = city.constructionQueue || [];
  if (queue.length === 0) {
    return res.status(400).json({ ok: false, error: 'No building in queue' });
  }

  const item     = queue[0];
  const now      = Date.now();
  const secsLeft = Math.max(0, Math.ceil((item.finishAt - now) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Need ${cost} credits (have ${player.credits || 0})` });
  }

  player.credits = (player.credits || 0) - cost;

  // Apply the building upgrade directly
  city.buildings = city.buildings || {};
  city.buildings[item.buildingId] = item.targetLevel;

  // Resequence whatever's left so each remaining upgrade starts right after
  // the one ahead of it, instead of waiting on the skipped item's
  // now-irrelevant original finish time.
  const remaining = queue.slice(1);
  let cursor = now;
  city.constructionQueue = remaining.map(q => {
    const dur       = q.finishAt - q.startedAt;
    const startedAt = cursor;
    const finishAt  = startedAt + dur;
    cursor = finishAt;
    return { ...q, startedAt, finishAt };
  });

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Every remaining item's original dispatch-trigger row is now stale (its
  // finishAt shifted earlier) — register a fresh one for each so the
  // dispatcher still wakes up on time even if the player goes fully offline.
  if (city.constructionQueue.length > 0) {
    const evts = city.constructionQueue.map(q => ({
      player_id: playerId,
      type:      'build',
      fire_at:   q.finishAt,
      payload:   { cityId, buildingId: q.buildingId, targetLevel: q.targetLevel },
    }));
    const { error: evtErr } = await admin.from('pending_events').insert(evts);
    if (evtErr) console.warn('[instant-build] pending_events insert failed:', evtErr.message);
  }

  return res.json({ ok: true, city, player });
}
