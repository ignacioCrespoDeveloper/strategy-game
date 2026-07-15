// =============================================
//  actions/city-found.js — POST /api/city/found
//
//  Body: { name, x, y }
//
//  Founds a new city server-side. Validates tile
//  availability, deducts gold for cities after the
//  first, and positions the player's first lord there.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

const MAX_CITIES  = 5;
const MAP_WIDTH   = 100;
const MAP_HEIGHT  = 100;

function _foundCost(existingCount) {
  if (existingCount === 0) return 0;
  return 5000 * Math.pow(2, existingCount - 1);
}

function _generateId() {
  return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export async function handleCityFound(req, res) {
  const { name, x, y } = req.body || {};
  if (!name || x == null || y == null) {
    return res.status(400).json({ ok: false, error: 'Missing name, x, or y' });
  }

  const n = name.trim();
  if (n.length < 2)  return res.status(400).json({ ok: false, error: 'City name must be at least 2 characters.' });
  if (n.length > 30) return res.status(400).json({ ok: false, error: 'City name cannot exceed 30 characters.' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  // Bounds check
  if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
    return res.status(400).json({ ok: false, error: 'Tile is out of bounds.' });
  }

  // Occupancy check (any city on this tile)
  const occupied = Object.values(cities).some(c => c.x === x && c.y === y);
  if (occupied) return res.status(400).json({ ok: false, error: 'This tile is already occupied.' });

  const playerCities = Object.values(cities).filter(c => c.playerId === playerId);
  if (playerCities.length >= MAX_CITIES) {
    return res.status(400).json({ ok: false, error: `Maximum of ${MAX_CITIES} cities reached.` });
  }

  const cost = _foundCost(playerCities.length);
  if (cost > 0 && (player.coins || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Founding costs ${cost.toLocaleString()} 💰 gold. Not enough coins.` });
  }

  if (cost > 0) player.coins = (player.coins || 0) - cost;

  const now     = Date.now();
  const id      = _generateId();
  const isFirst = playerCities.length === 0;


  // Seed starting resources on first city — always grant the starter kit
  // (catch-up may have already initialized resources to all-zero for new players,
  //  so we can't rely on !player.resources to detect a brand-new account)
  if (isFirst) {
    player.resources = { food: 5000, wood: 5000, stone: 4000, iron: 1000 };
  } else {
    player.resources = player.resources || { food: 0, wood: 0, stone: 0, iron: 0 };
  }

  const city = {
    id,
    playerId,
    name: n,
    x, y,
    foundedAt: now,
    population: 1000,
    freePopulation: 3,
    happiness: 75,
    buildings: {},
    constructionQueue: [],
    recruitmentQueue: [],
    lastResourceUpdate:   now,
    lastPopulationUpdate: now,
  };

  cities[id] = city;

  // Set first lord's position to this city's tile
  if (player.lordId && lords[player.lordId]) {
    const mainLord = lords[player.lordId];
    if (mainLord.x == null) {
      mainLord.x = x;
      mainLord.y = y;
    }
  }

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Update shared world_state so all players see this city on the map
  try {
    const { data: worldRows } = await admin
      .from('world_state').select('key, value').eq('key', 'world');
    const worldState = worldRows?.[0]?.value || { size: 20, tiles: {} };
    worldState.tiles[`${x},${y}`] = id;
    await admin.from('world_state').upsert(
      { key: 'world', value: worldState, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (e) {
    console.warn('[city-found] world_state update failed:', e.message);
  }

  return res.json({ ok: true, city, player });
}
