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
    return _getWorld().tiles[_key(x, y)] || null; // null = empty
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
  function getOccupiedTiles() {
    const world = _getWorld();
    return Object.entries(world.tiles).map(([key, cityId]) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, cityId };
    });
  }

  // Deterministic terrain from tile coordinates — no storage needed.
  function getTerrain(x, y) {
    const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
    const keys = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
    return TERRAIN_TYPES[keys[h % keys.length]];
  }

  return { getSize, getTile, isOccupied, isInBounds, placeCity, getOccupiedTiles, getTerrain };
})();
