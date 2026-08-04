// =============================================
//  actions/build.js — POST /api/city/build
//
//  Body: { cityId, buildingId }
//
//  Validates and enqueues a building construction
//  server-side, then persists and returns the
//  updated city so the client can hydrate.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { BUILDING_DEFS, RACES, EconomyCore, BuildingUnlockService } from '../engine-loader.js';

export async function handleBuild(req, res) {
  const { cityId, buildingId } = req.body || {};
  if (!cityId || !buildingId) {
    return res.status(400).json({ ok: false, error: 'Missing cityId or buildingId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const city = cities[cityId];
  if (!city) return res.status(404).json({ ok: false, error: 'City not found' });
  if (city.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your city' });

  const def = BUILDING_DEFS[buildingId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown building' });

  const MAX_QUEUE = 5;
  const queue     = city.constructionQueue || [];
  if (queue.length >= MAX_QUEUE) {
    return res.status(400).json({ ok: false, error: `Construction queue is full (max ${MAX_QUEUE}).` });
  }

  // If this same building already has upgrade(s) queued, the next one picks
  // up from whatever level it WILL be once those finish — not its current
  // real level — otherwise queuing "upgrade Barracks" twice in a row would
  // both target the same next level instead of stacking level+1, level+2.
  const currentLevel  = city.buildings?.[buildingId] || 0;
  const queuedForThis = queue.filter(q => q.buildingId === buildingId).length;
  const effectiveLevel = currentLevel + queuedForThis;

  if (effectiveLevel >= def.maxLevel) {
    return res.status(400).json({ ok: false, error: 'Already at (or queued to reach) max level' });
  }

  // Prerequisites are checked against the REAL current state only, not
  // anything still queued — a requirement must already be built, not
  // "queued to be built soon".
  if (def.requires) {
    for (const [reqId, reqLevel] of Object.entries(def.requires)) {
      if ((city.buildings?.[reqId] || 0) < reqLevel) {
        return res.status(400).json({ ok: false, error: `Requires ${reqId} level ${reqLevel}` });
      }
    }
  }

  if (def.isLandmark) {
    const hasLandmark = Object.entries(city.buildings || {}).some(
      ([id, lvl]) => lvl > 0 && BUILDING_DEFS[id]?.isLandmark,
    );
    if (hasLandmark) {
      return res.status(400).json({ ok: false, error: 'City already has a landmark' });
    }
  }

  // THE UNLOCK GATE (2026-08-03). Everything above is a hand-rolled check that
  // happens to duplicate part of BuildingUnlockService; everything the service
  // knows that ISN'T above was simply unenforced until now — building SLOTS,
  // the `city_tier` gate and the `race` gate. A crafted POST could therefore
  // raise a Dragon Lair as a dwarf, drop a tier-5 building into a tier-1 city,
  // and build past maxSlots forever. Same class as the recruitment-gate
  // exploit of 2026-07-29, and closed the same way: ONE gate, run by the
  // client's build UI, the tech tree AND the server, so the client can never
  // offer what the server would reject.
  //
  // The lord that owns the city determines the race gate. Cities carry no race
  // of their own, and every UI caller passes the same lord — the player's, from
  // player.lordId — so this reads the identical state the button did.
  const raceLord = lords[player.lordId] || Object.values(lords).find(l => l.playerId === playerId) || null;
  const gate = BuildingUnlockService.check(city, raceLord, def);
  if (gate.locked) {
    return res.status(400).json({ ok: false, error: gate.reasons[0] });
  }

  const targetLevel = effectiveLevel + 1;
  const cost = def.cost(targetLevel);
  player.resources = player.resources || { wood: 0, stone: 0, food: 0 };
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0 && Math.floor(player.resources[rKey] || 0) < amt) {
      return res.status(400).json({ ok: false, error: `Not enough ${rKey} (need ${amt}, have ${Math.floor(player.resources[rKey] || 0)})` });
    }
  }

  // Apply — deduct from empire-wide pool
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0) player.resources[rKey] = (player.resources[rKey] || 0) - amt;
  }

  // Batches run sequentially — a newly-queued upgrade starts once whichever
  // is ahead of it finishes, not immediately, unless the queue is empty.
  // Build time applies race construction_speed + Engineering Tomes research
  // + this city's Town Hall (constructionSpeed building field).
  const buildTime = EconomyCore.getBuildTime(
    def, targetLevel,
    RACES[player.race]?.bonuses,
    EconomyCore.getResearchEffects(player.research),
    city.buildings,
  );
  const now        = Date.now();
  const lastFinish = queue.length > 0 ? queue[queue.length - 1].finishAt : now;
  const startedAt  = Math.max(now, lastFinish);
  const newItem    = { buildingId, targetLevel, startedAt, finishAt: startedAt + buildTime * 1000 };
  city.constructionQueue = [...queue, newItem];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'build',
    fire_at:   newItem.finishAt,
    payload:   { cityId, buildingId: newItem.buildingId, targetLevel: newItem.targetLevel },
  });
  if (evtErr) console.warn('[build] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, city, player });
}
