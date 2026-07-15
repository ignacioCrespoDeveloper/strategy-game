// =============================================
//  actions/instant-build.js — POST /api/city/instant-build
//
//  Body: { cityId }
//
//  Spends credits to instantly complete the first item
//  in a city's construction queue. Cost = ceil(secsLeft / 60),
//  minimum 1 credit.
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

  if (!city.constructionQueue || city.constructionQueue.length === 0) {
    return res.status(400).json({ ok: false, error: 'No building in queue' });
  }

  const item     = city.constructionQueue[0];
  const now      = Date.now();
  const secsLeft = Math.max(0, Math.ceil((item.finishAt - now) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Need ${cost} 💎 credits (have ${player.credits || 0})` });
  }

  player.credits = (player.credits || 0) - cost;

  // Apply the building upgrade directly
  city.buildings               = city.buildings || {};
  city.buildings[item.buildingId] = item.targetLevel;
  city.constructionQueue       = [];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, city, player });
}
