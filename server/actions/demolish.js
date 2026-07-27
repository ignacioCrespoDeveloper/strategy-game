// =============================================
//  actions/demolish.js — POST /api/city/demolish
//
//  Body: { cityId, buildingId }
//
//  Tears down one level of a building (OGame-style).
//  Instant, no refund. Town Hall cannot be torn down,
//  and a building with a queued upgrade must finish
//  (or be left alone) first.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { BUILDING_DEFS }             from '../engine-loader.js';

export async function handleDemolish(req, res) {
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

  if (buildingId === 'town_hall') {
    return res.status(400).json({ ok: false, error: 'The Town Hall cannot be torn down.' });
  }

  const currentLevel = city.buildings?.[buildingId] || 0;
  if (currentLevel <= 0) {
    return res.status(400).json({ ok: false, error: 'Nothing to tear down.' });
  }

  const queuedForThis = (city.constructionQueue || []).some(q => q.buildingId === buildingId);
  if (queuedForThis) {
    return res.status(400).json({ ok: false, error: 'Cannot tear down a building with a queued upgrade.' });
  }

  city.buildings[buildingId] = currentLevel - 1;
  if (city.buildings[buildingId] <= 0) {
    delete city.buildings[buildingId];
    if (def.isLandmark && city.landmark === buildingId) city.landmark = null;
  }

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, city, player });
}
