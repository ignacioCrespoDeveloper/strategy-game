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
import { BUILDING_DEFS }             from '../engine-loader.js';

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

  const currentLevel = city.buildings?.[buildingId] || 0;

  if ((city.constructionQueue || []).length > 0) {
    return res.status(400).json({ ok: false, error: 'Construction queue is full' });
  }

  if (currentLevel >= def.maxLevel) {
    return res.status(400).json({ ok: false, error: 'Already at max level' });
  }

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

  const cost = def.cost(currentLevel + 1);
  player.resources = player.resources || { food: 0, wood: 0, stone: 0, iron: 0 };
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0 && Math.floor(player.resources[rKey] || 0) < amt) {
      return res.status(400).json({ ok: false, error: `Not enough ${rKey} (need ${amt}, have ${Math.floor(player.resources[rKey] || 0)})` });
    }
  }

  // Apply — deduct from empire-wide pool
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0) player.resources[rKey] = (player.resources[rKey] || 0) - amt;
  }
  const buildTime = def.buildTime(currentLevel + 1);
  const now = Date.now();
  city.constructionQueue = [{
    buildingId,
    targetLevel: currentLevel + 1,
    startedAt:   now,
    finishAt:    now + buildTime * 1000,
  }];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, city, player });
}
