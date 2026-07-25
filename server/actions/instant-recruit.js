// =============================================
//  actions/instant-recruit.js — POST /api/city/instant-recruit
//
//  Body: { cityId }
//
//  Spends credits to instantly complete the FIRST item in a city's
//  recruitment queue. Cost = ceil(secsLeft / 60), minimum 1 credit — same
//  formula as instant-build.js's construction equivalent.
//
//  Previously "finish now" was purely client-side (set a local finishAt in
//  the past, tick it, save) — it displayed as complete but was never
//  actually applied server-side, so the next full sync/refresh reverted it
//  back to "still training". This endpoint is the real, authoritative fix.
//
//  Any remaining queued batches are resequenced to start back-to-back from
//  now, rather than waiting on the now-moot original finish time of the
//  batch that was just skipped ahead.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleInstantRecruit(req, res) {
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

  const queue = city.recruitmentQueue || [];
  if (queue.length === 0) {
    return res.status(400).json({ ok: false, error: 'No unit in training' });
  }

  const item     = queue[0];
  const now      = Date.now();
  const secsLeft = Math.max(0, Math.ceil((item.finishAt - now) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Need ${cost} 💎 credits (have ${player.credits || 0})` });
  }

  player.credits = (player.credits || 0) - cost;

  // Apply the completed batch directly to the army.
  if (item.lordId) {
    const army     = armies[item.lordId] || { lordId: item.lordId, units: [] };
    const existing = army.units.find(u => u.unitId === item.unitId);
    if (existing) existing.count += item.count;
    else army.units.push({ unitId: item.unitId, count: item.count });
    armies[item.lordId] = army;
  }

  // Resequence whatever's left so each remaining batch starts right after
  // the one ahead of it, instead of waiting on the skipped batch's
  // now-irrelevant original finish time.
  const remaining = queue.slice(1);
  let cursor = now;
  city.recruitmentQueue = remaining.map(q => {
    const dur       = q.finishAt - q.startedAt;
    const startedAt = cursor;
    const finishAt  = startedAt + dur;
    cursor = finishAt;
    return { ...q, startedAt, finishAt };
  });

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Every remaining item's original dispatch-trigger row is now stale (its
  // finishAt shifted earlier when the queue resequenced) — register a fresh
  // one for each so the dispatcher still wakes up on time for all of them,
  // not just the new front item. Without this, a player who instant-finishes
  // then goes fully offline would have later queue items complete late
  // (whenever their now-incorrect stale event eventually fires) instead of
  // at their real, resequenced finish time.
  if (city.recruitmentQueue.length > 0) {
    const evts = city.recruitmentQueue.map(q => ({
      player_id: playerId,
      type:      'recruit',
      fire_at:   q.finishAt,
      payload:   { cityId, unitId: q.unitId, count: q.count, lordId: q.lordId },
    }));
    const { error: evtErr } = await admin.from('pending_events').insert(evts);
    if (evtErr) console.warn('[instant-recruit] pending_events insert failed:', evtErr.message);
  }

  return res.json({
    ok: true,
    city,
    army:   item.lordId ? armies[item.lordId] : null,
    player,
  });
}
