// =============================================
//  world.js — World grid and city placement
//
//  The world is a flat square grid of SIZE × SIZE tiles.
//  Each tile is identified by "x,y" and holds at most one city id.
// =============================================

const TERRAIN_TYPES = {
  forest:   { id: 'forest',   name: 'Forest',   icon: '🌲', desc: 'Dense ancient woodland',      canvasBg: '#0d1a08', canvasBorder: '#1a3010', image: 'assets/terrain/woods.jpg',    searchHint: 'Rich in timber and game. Outlaw camps are common among the trees.'              },
  plains:   { id: 'plains',   name: 'Plains',   icon: '🌿', desc: 'Fertile open flatlands',       canvasBg: '#161a08', canvasBorder: '#24280a', image: 'assets/terrain/plains.jpg',  searchHint: 'Open roads attract merchants. Good hunting grounds and occasional lost treasure.' },
  hills:    { id: 'hills',    name: 'Hills',    icon: '🪨', desc: 'Rolling rocky hills',           canvasBg: '#18140e', canvasBorder: '#28200e', image: null,                         searchHint: 'Stone and iron veins run through the rock. Outlaws use the ridges as hideouts.' },
  marsh:    { id: 'marsh',    name: 'Swamp',    icon: '💧', desc: 'Murky boggy wetlands',          canvasBg: '#0a1416', canvasBorder: '#0f2024', image: 'assets/terrain/swamp.jpg',   searchHint: 'Rare bog crystals form in the depths. Timber is plentiful but the land is hostile.' },
  mountain: { id: 'mountain', name: 'Mountain', icon: '⛰',  desc: 'Impassable rocky peaks',       canvasBg: '#141418', canvasBorder: '#20202a', image: 'assets/terrain/montain.webp',searchHint: 'Mountains hide iron mines, stone quarries, ancient ruins and powerful relics.'    },
  desert:   { id: 'desert',   name: 'Desert',   icon: '🏜', desc: 'Arid and hostile wasteland',   canvasBg: '#1a1608', canvasBorder: '#2a2210', image: null,                         searchHint: 'Buried ruins and lost treasures lie beneath the sands. Few things survive here.' },
};

// Resource production multipliers per terrain. 1.0 = no change.
var TERRAIN_RESOURCE_MODS = {
  forest:   { wood:  1.25 },
  plains:   { food:  1.25 },
  hills:    { stone: 1.15, iron: 1.10 },
  mountain: { stone: 1.30, iron: 1.25 },
  marsh:    { food:  0.95, wood: 0.95, stone: 0.95, iron: 0.95 },
  desert:   { food:  0.70, wood: 0.75 },
};

// Flat city-stat bonuses/penalties per terrain.
// { stat: string, value: number } — same shape as building effects.
var TERRAIN_STAT_MODS = {
  marsh:    [{ stat: 'hygiene',  value: -15 }, { stat: 'security', value: 15 }],
  mountain: [{ stat: 'security', value: 10  }],
  desert:   [{ stat: 'happiness', value: -5 }],
};

const WorldService = (() => {
  const WORLD_KEY = 'world';
  const SIZE      = 20;

  // ── Private ──────────────────────────────────────────────────

  function _getWorld() {
    return StorageService.get(WORLD_KEY) || _createEmpty();
  }

  function _saveWorld(world) {
    StorageService.set(WORLD_KEY, world);
  }

  function _createEmpty() {
    return { size: SIZE, tiles: {} }; // tiles: { "x,y": cityId }
  }

  function _key(x, y) {
    return `${x},${y}`;
  }

  // ── Public ───────────────────────────────────────────────────

  function getSize() { return SIZE; }

  function getTile(x, y) {
    // Player's own cities are always authoritative (updated after every action)
    const cities = StorageService.get('cities') || {};
    const own = Object.values(cities).find(c => c.x === x && c.y === y);
    if (own) return own.id;
    // Fall back to shared world_state (contains other players' cities)
    return _getWorld().tiles[_key(x, y)] || null;
  }

  function isOccupied(x, y) {
    return getTile(x, y) !== null;
  }

  function isInBounds(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  // Place a city on a tile. Returns false if already occupied or out of bounds.
  function placeCity(x, y, cityId) {
    if (!isInBounds(x, y)) return false;
    const world = _getWorld();
    if (world.tiles[_key(x, y)]) return false;
    world.tiles[_key(x, y)] = cityId;
    _saveWorld(world);
    return true;
  }

  // Returns all occupied tiles as an array of { x, y, cityId }.
  // Merges player's own cities (authoritative) with shared world_state (other players).
  function getOccupiedTiles() {
    const cities  = StorageService.get('cities') || {};
    const ownList = Object.values(cities).map(c => ({ x: c.x, y: c.y, cityId: c.id }));
    const ownSet  = new Set(ownList.map(t => `${t.x},${t.y}`));

    const worldTiles = _getWorld().tiles;
    const otherList  = Object.entries(worldTiles)
      .filter(([key]) => !ownSet.has(key))
      .map(([key, cityId]) => {
        const [wx, wy] = key.split(',').map(Number);
        return { x: wx, y: wy, cityId };
      });

    return [...ownList, ...otherList];
  }

  // Deterministic terrain from tile coordinates — no storage needed.
  function getTerrain(x, y) {
    const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
    const keys = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
    return TERRAIN_TYPES[keys[h % keys.length]];
  }

  return { getSize, getTile, isOccupied, isInBounds, placeCity, getOccupiedTiles, getTerrain };
})();
