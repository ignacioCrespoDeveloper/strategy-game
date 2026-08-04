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
import { EconomyCore }               from '../engine-loader.js';

// The flat MAX_CITIES = 7 is GONE (2026-08-03). How many cities a player may
// hold is now bought from the Library — the Frontier Charters book, OGame's
// Astrophysics — and computed by EconomyCore.getCitySlots, which the client
// mirror (js/domain/city.js) and the map's found button both call too. There
// is no ceiling: the doubling gold price below and the ×1.75 research curve
// are the limiters.
//
// Research unlocks the SLOT; this gold price still buys the city, exactly as
// OGame's Astrophysics unlocks a colony slot you then pay a colony ship for.
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
  const citySlots    = EconomyCore.getCitySlots(EconomyCore.getResearchEffects(player.research));
  if (playerCities.length >= citySlots) {
    // Name the book in the error — "maximum reached" with no way forward was
    // fine when the cap was a constant and is actively misleading now that it
    // is purchasable.
    return res.status(400).json({
      ok: false,
      error: `You may hold ${citySlots} ${citySlots === 1 ? 'city' : 'cities'}. Research Frontier Charters in the Library to claim another.`,
    });
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
    player.resources = { wood: 5000, stone: 4000, food: 5000 };
  } else {
    player.resources = player.resources || { wood: 0, stone: 0, food: 0 };
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
    // Seeded with a Town Hall AND NOTHING ELSE: every producer requires
    // town_hall >= 1, so a truly empty city has zero production AND zero
    // build-time divisor until the player manually builds one — it cannot even
    // start. The Town Hall is the one building that has to be here.
    //
    // The free Farm that shipped alongside it on 2026-08-03 was REMOVED on
    // 2026-08-04 (Nacho's call): the first food building is a real decision and
    // handing it over made the opening moves identical for everyone. The famine
    // risk that originally justified it is already gone — a new city eats from
    // the empire larder (EconomyCore.isCityFed), not from its own fields, so a
    // Farm-less city no longer starves under a badge that reads "Stable".
    //
    // Mirrored in the legacy client path (js/domain/city.js) — the two must agree.
    buildings: { town_hall: 1 },
    constructionQueue: [],
    recruitmentQueue: [],
    // Applied city items — see js/data/items.js. Mirrored in js/domain/city.js.
    activeItems: [],
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
