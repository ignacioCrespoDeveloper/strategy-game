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

// Exported so scripts/economy-projection.js reads the REAL expansion curve
// instead of keeping its own copy. js/domain/city.js mirrors these for the
// client; that pair is the remaining duplication.
// Raised 5 → 7 on 2026-07-30 alongside MAX_LORDS, same reasoning: give the
// endgame somewhere to spend. Keep the ×2 curve (city 7 = 256k).
export const MAX_CITIES = 7;
// Mirrors the client's WorldService WIDTH/HEIGHT (js/domain/world.js).
const MAP_WIDTH   = 20;
const MAP_HEIGHT  = 10;

// First city is free; subsequent cities cost 8k, 16k, 32k, 64k.
export function cityFoundCost(existingCount) {
  if (existingCount === 0) return 0;
  return 8000 * Math.pow(2, existingCount - 1);
}
const _foundCost = cityFoundCost;

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
    return res.status(400).json({ ok: false, error: `Founding costs ${cost.toLocaleString()} gold. Not enough coins.` });
  }

  if (cost > 0) player.coins = (player.coins || 0) - cost;

  const now     = Date.now();
  const id      = _generateId();
  const isFirst = playerCities.length === 0;


  // Seed starting resources on first city — always grant the starter kit
  // (catch-up may have already initialized resources to all-zero for new players,
  //  so we can't rely on !player.resources to detect a brand-new account)
  if (isFirst) {
    player.resources = { food: 5000, wood: 5000, stone: 4000 };
  } else {
    player.resources = player.resources || { food: 0, wood: 0, stone: 0 };
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
    // Seeded with a Town Hall: every producer requires town_hall >= 1, so an
    // empty city had zero production AND zero build-time divisor until the
    // player manually built one. Matches the legacy client path (js/domain/city.js).
    buildings: { town_hall: 1 },
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
    // Cities are always visible map-wide by name + owner (garrison stays
    // hidden until scouted) — carry that metadata directly on the tile
    // entry since a regular client's RLS can't look up another player's
    // 'cities' row on demand. See js/ui/map-view.js / js/domain/world.js.
    worldState.tiles[`${x},${y}`] = { cityId: id, name: n, ownerId: playerId, ownerUsername: player.username || 'Player' };
    await admin.from('world_state').upsert(
      { key: 'world', value: worldState, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  } catch (e) {
    console.warn('[city-found] world_state update failed:', e.message);
  }

  return res.json({ ok: true, city, player });
}
