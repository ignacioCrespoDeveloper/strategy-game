// =============================================
//  data.js — static game data definitions
// =============================================

const TERRAIN_DEF = {
  plains:   { color: '#2e4a22', border: '#3a6028', label: 'Plains',   move: 1 },
  forest:   { color: '#183018', border: '#20401e', label: 'Forest',   move: 2 },
  mountain: { color: '#4a3e2e', border: '#665540', label: 'Mountain', move: 3 },
  water:    { color: '#0e2840', border: '#1a3a58', label: 'Water',    move: 99 },
  desert:   { color: '#5a4a20', border: '#7a6428', label: 'Desert',   move: 2 },
};

const RESOURCE_DEF = {
  gold: { icon: '💰', color: '#f0c040', label: 'Gold Mine',      income: 2 },
  iron: { icon: '⚙️', color: '#90a8b8', label: 'Iron Deposit',   income: 1 },
  food: { icon: '🌾', color: '#88cc44', label: 'Fertile Fields', income: 2 },
  wood: { icon: '🌲', color: '#b87830', label: 'Lumber Camp',    income: 1 },
};

// Unit types: name, icon, hp, atk, def, moves, sight, cost (resources), maintenance (per turn), abilities[]
const UNIT_TYPES = {
  warrior: {
    name: 'Warrior', icon: '⚔️',
    hp: 100, atk: 40, def: 30, moves: 2, sight: 2,
    cost: { gold: 30, food: 10 },
    maintenance: { gold: 2, food: 1 },
    abilities: ['Melee', 'Fortify'],
    desc: 'Reliable frontline fighter.',
    trainTime: 1,
  },
  archer: {
    name: 'Archer', icon: '🏹',
    hp: 70, atk: 50, def: 15, moves: 2, sight: 3,
    cost: { gold: 40, wood: 10 },
    maintenance: { gold: 3, food: 1 },
    abilities: ['Ranged', 'High Ground'],
    desc: 'Ranged unit, good sight range.',
    trainTime: 1,
  },
  scout: {
    name: 'Scout', icon: '🐎',
    hp: 60, atk: 20, def: 10, moves: 4, sight: 4,
    cost: { gold: 20, food: 20 },
    maintenance: { gold: 1, food: 2 },
    abilities: ['Fast', 'Recon'],
    desc: 'Fast explorer, low combat power.',
    trainTime: 1,
  },
  knight: {
    name: 'Knight', icon: '🛡️',
    hp: 140, atk: 55, def: 60, moves: 3, sight: 2,
    cost: { gold: 80, iron: 30 },
    maintenance: { gold: 5, iron: 1 },
    abilities: ['Heavy', 'Charge', 'Fortify'],
    desc: 'Heavily armoured elite cavalry.',
    trainTime: 2,
  },
  catapult: {
    name: 'Catapult', icon: '💥',
    hp: 50, atk: 80, def: 5, moves: 1, sight: 3,
    cost: { gold: 60, wood: 40, iron: 10 },
    maintenance: { gold: 4, wood: 1 },
    abilities: ['Siege', 'Slow'],
    desc: 'Devastating vs cities and walls.',
    trainTime: 2,
  },
};

// Building types: name, icon, category, desc, cost[], effect[], maxLevel
// requires: { buildingKey: minLevel } — must be met before constructing
const BUILDING_TYPES = {

  // ── MILITARY ────────────────────────────────
  barracks: {
    name: 'Barracks', icon: '🏛️', category: 'military',
    desc: 'Recruits and trains military units for your armies.',
    cost:   [{ gold:50,  wood:20 }, { gold:120, iron:20 }, { gold:250, iron:50 }],
    effect: ['Trains Warriors & Scouts', 'Trains Archers', 'Trains Knights & Catapults'],
    maxLevel: 3,
  },
  walls: {
    name: 'Walls', icon: '🧱', category: 'military',
    desc: 'Stone ramparts that slow enemy units and protect the city.',
    cost:   [{ gold:80,  iron:20 }, { gold:180, iron:50  }, { gold:350, iron:100 }],
    effect: ['+20 City HP', '+50 City HP, enemy -1 Speed', '+100 City HP, siege penalty'],
    maxLevel: 3,
  },

  // ── ECONOMY ─────────────────────────────────
  market: {
    name: 'Market', icon: '🏪', category: 'economy',
    desc: 'Generates gold through commerce and taxation.',
    cost:   [{ gold:40,  wood:15 }, { gold:100           }, { gold:220           }],
    effect: ['+2 💰/turn', '+4 💰/turn', '+6 💰/turn'],
    maxLevel: 3,
  },
  port: {
    name: 'Port', icon: '⚓', category: 'economy',
    desc: 'Coastal trade route that greatly multiplies gold income.',
    requires: { market: 1 },
    cost:   [{ gold:150, wood:50 }, { gold:300, wood:100 }],
    effect: ['+5 💰/turn', '+10 💰/turn'],
    maxLevel: 2,
  },

  // ── FOOD ────────────────────────────────────
  farm: {
    name: 'Farm', icon: '🌱', category: 'food',
    desc: 'Cultivates fertile land for a steady food supply.',
    cost:   [{ gold:30,  wood:20 }, { gold:70,  food:10  }, { gold:140, food:20  }],
    effect: ['+2 🌾/turn', '+4 🌾/turn', '+6 🌾/turn'],
    maxLevel: 3,
  },
  granary: {
    name: 'Granary', icon: '🌾', category: 'food',
    desc: 'Stores surplus grain and feeds larger standing armies.',
    requires: { farm: 2 },
    cost:   [{ gold:90,  food:30 }, { gold:200, food:60  }],
    effect: ['+3 🌾/turn', '+5 🌾/turn'],
    maxLevel: 2,
  },

  // ── INDUSTRY ────────────────────────────────
  forge: {
    name: 'Forge', icon: '🔨', category: 'industry',
    desc: 'Smelts iron for weapons and armour, boosting combat power.',
    cost:   [{ gold:60,  iron:20 }, { gold:140, iron:40  }, { gold:280, iron:80  }],
    effect: ['+1 ⚙️/turn, units +5 ATK', '+2 ⚙️/turn, units +10 ATK', '+3 ⚙️/turn, units +15 ATK'],
    maxLevel: 3,
  },

  // ── CULTURE ─────────────────────────────────
  temple: {
    name: 'Temple', icon: '⛩️', category: 'culture',
    desc: 'Divine favour brings prosperity and strengthens your soldiers.',
    cost:   [{ gold:70,  wood:30 }, { gold:160, iron:20  }, { gold:320, iron:50  }],
    effect: ['+1 💰/t, +1 🌾/t', '+2 💰/t, +2 🌾/t, units +5 DEF', '+3 💰/t, +3 🌾/t, units +10 DEF'],
    maxLevel: 3,
  },
};

// Which barracks level unlocks which units
const BARRACKS_UNLOCK = {
  1: ['warrior', 'scout'],
  2: ['warrior', 'scout', 'archer'],
  3: ['warrior', 'scout', 'archer', 'knight', 'catapult'],
};

// Compact terrain map builder
const _T = s => s.split(' ').map(c => ({ p:'plains', f:'forest', m:'mountain', w:'water', d:'desert' }[c]));

// Terrain map: 18 rows × 24 cols — continent surrounded by ocean
const TERRAIN_MAP = [
  _T('w w w w w w w w w w w w w w w w w w w w w w w w'), // 0
  _T('w w w w w p p p p p p p p w w w w w w w w w w w'), // 1
  _T('w w w w p p f f p p p p p p p w w w w w w w w w'), // 2
  _T('w w w p p f f f p m m p p p p p p w w w w w w w'), // 3
  _T('w w p p f f p p p m m m p p p p p p w w w w w w'), // 4
  _T('w w p p p p p p p p m p p p p f f p p p w w w w'), // 5
  _T('w p p p p p p d d p p p p p f f f p p p p w w w'), // 6
  _T('w p p p d d d d p p p p p f f p p p p p p p w w'), // 7
  _T('w w p p d d p p p p p p p p p p p p p p m p w w'), // 8
  _T('w w p p p p p p p p p p p p p p p m m p p p w w'), // 9
  _T('w w w p p p p p p p p p p p p p m m p p p p w w'), // 10
  _T('w w w p p p p p p p p f f p p p m p p p p w w w'), // 11
  _T('w w w w p p p p p p f f f p p p p p p p w w w w'), // 12
  _T('w w w w p p p p p f f p p p p p p p w w w w w w'), // 13
  _T('w w w w w p p p p p p p p p p p w w w w w w w w'), // 14
  _T('w w w w w w p p p p p p p w w w w w w w w w w w'), // 15
  _T('w w w w w w w p p p p w w w w w w w w w w w w w'), // 16
  _T('w w w w w w w w w w w w w w w w w w w w w w w w'), // 17
];

const RESOURCE_SPAWNS = [
  { c:6,  r:3,  type:'wood' },   // NW forest
  { c:13, r:7,  type:'wood' },   // center forest
  { c:15, r:6,  type:'wood' },   // NE forest
  { c:10, r:13, type:'wood' },   // south forest
  { c:4,  r:5,  type:'gold' },   // NW plains
  { c:12, r:10, type:'gold' },   // center plains
  { c:8,  r:12, type:'gold' },   // south plains
  { c:17, r:5,  type:'gold' },   // NE plains
  { c:8,  r:5,  type:'food' },   // center-left
  { c:13, r:8,  type:'food' },   // center
  { c:5,  r:13, type:'food' },   // south
  { c:10, r:9,  type:'food' },   // center
  { c:9,  r:4,  type:'iron' },   // NW mountains
  { c:10, r:5,  type:'iron' },   // mountain pass
  { c:17, r:9,  type:'iron' },   // E mountains
  { c:20, r:8,  type:'iron' },   // far-east mountains
];

const CITY_SPAWNS = [
  { c:5,  r:2,  name:'Dawnfort',   owner:'player'  },
  { c:19, r:9,  name:'Ashrock',    owner:'enemy'   },
  { c:11, r:7,  name:'Ironhold',   owner:'neutral' },
  { c:15, r:4,  name:'Silvergate', owner:'neutral' },
];

const INITIAL_UNITS = [
  { type:'warrior', c:5,  r:2,  owner:'player' },
  { type:'scout',   c:6,  r:4,  owner:'player' },
  { type:'warrior', c:19, r:9,  owner:'enemy'  },
  { type:'warrior', c:18, r:8,  owner:'enemy'  },
];

const COLS = 24;
const ROWS = 18;
