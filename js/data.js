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

// Unit types: name, icon, hp, atk, def, moves, sight, cost (resources), abilities[]
const UNIT_TYPES = {
  warrior: {
    name: 'Warrior', icon: '⚔️',
    hp: 100, atk: 40, def: 30, moves: 2, sight: 2,
    cost: { gold: 30, food: 10 },
    abilities: ['Melee', 'Fortify'],
    desc: 'Reliable frontline fighter.',
    trainTime: 1,
  },
  archer: {
    name: 'Archer', icon: '🏹',
    hp: 70, atk: 50, def: 15, moves: 2, sight: 3,
    cost: { gold: 40, wood: 10 },
    abilities: ['Ranged', 'High Ground'],
    desc: 'Ranged unit, good sight range.',
    trainTime: 1,
  },
  scout: {
    name: 'Scout', icon: '🐎',
    hp: 60, atk: 20, def: 10, moves: 4, sight: 4,
    cost: { gold: 20, food: 20 },
    abilities: ['Fast', 'Recon'],
    desc: 'Fast explorer, low combat power.',
    trainTime: 1,
  },
  knight: {
    name: 'Knight', icon: '🛡️',
    hp: 140, atk: 55, def: 60, moves: 3, sight: 2,
    cost: { gold: 80, iron: 30 },
    abilities: ['Heavy', 'Charge', 'Fortify'],
    desc: 'Heavily armoured elite cavalry.',
    trainTime: 2,
  },
  catapult: {
    name: 'Catapult', icon: '💥',
    hp: 50, atk: 80, def: 5, moves: 1, sight: 3,
    cost: { gold: 60, wood: 40, iron: 10 },
    abilities: ['Siege', 'Slow'],
    desc: 'Devastating vs cities and walls.',
    trainTime: 2,
  },
};

// Building types: name, icon, desc, cost, effect, maxLevel
const BUILDING_TYPES = {
  barracks: {
    name: 'Barracks', icon: '🏛️',
    desc: 'Train military units.',
    cost: [{ gold: 50, wood: 20 }, { gold: 100, iron: 30 }, { gold: 200, iron: 60 }],
    effect: ['Unlocks Warrior, Scout', 'Unlocks Archer', 'Unlocks Knight, Catapult'],
    maxLevel: 3,
  },
  market: {
    name: 'Market', icon: '🏪',
    desc: 'Increases gold income per turn.',
    cost: [{ gold: 40, wood: 10 }, { gold: 90, gold2: 0 }, { gold: 180 }],
    effect: ['+2 Gold/turn', '+4 Gold/turn', '+6 Gold/turn'],
    maxLevel: 3,
  },
  farm: {
    name: 'Farm', icon: '🌱',
    desc: 'Increases food production.',
    cost: [{ gold: 30, wood: 20 }, { gold: 70, food: 10 }, { gold: 140, food: 20 }],
    effect: ['+2 Food/turn', '+4 Food/turn', '+6 Food/turn'],
    maxLevel: 3,
  },
  forge: {
    name: 'Forge', icon: '🔨',
    desc: 'Produces iron, improves unit stats.',
    cost: [{ gold: 60, iron: 20 }, { gold: 130, iron: 40 }, { gold: 260, iron: 80 }],
    effect: ['+1 Iron/turn, units +5 atk', '+2 Iron/turn, units +10 atk', '+3 Iron/turn, units +15 atk'],
    maxLevel: 3,
  },
  walls: {
    name: 'Walls', icon: '🧱',
    desc: 'Fortifies city, slows enemy capture.',
    cost: [{ gold: 80, stone: 0, iron: 20 }, { gold: 160, iron: 40 }, { gold: 300, iron: 80 }],
    effect: ['+20 City HP', '+40 City HP', '+60 City HP'],
    maxLevel: 3,
  },
};

// Which buildings unlock which units
const BARRACKS_UNLOCK = {
  1: ['warrior', 'scout'],
  2: ['warrior', 'scout', 'archer'],
  3: ['warrior', 'scout', 'archer', 'knight', 'catapult'],
};

// Terrain map: 8 rows × 11 cols
const TERRAIN_MAP = [
  ['plains','plains','forest','forest','mountain','mountain','plains','plains','water','water','plains'],
  ['plains','forest','forest','plains','mountain','plains','plains','water','water','plains','plains'],
  ['plains','plains','plains','plains','plains','plains','plains','plains','plains','plains','mountain'],
  ['plains','desert','desert','plains','plains','forest','forest','plains','plains','mountain','mountain'],
  ['plains','desert','plains','plains','forest','forest','plains','plains','water','water','plains'],
  ['plains','plains','plains','plains','plains','plains','plains','plains','water','plains','plains'],
  ['mountain','mountain','plains','plains','plains','desert','desert','plains','plains','plains','plains'],
  ['mountain','plains','plains','plains','plains','desert','plains','plains','plains','plains','plains'],
];

const RESOURCE_SPAWNS = [
  { c:2, r:1, type:'wood'  },
  { c:3, r:0, type:'wood'  },
  { c:1, r:3, type:'gold'  },
  { c:4, r:4, type:'food'  },
  { c:5, r:5, type:'food'  },
  { c:6, r:2, type:'iron'  },
  { c:7, r:1, type:'iron'  },
  { c:9, r:3, type:'gold'  },
  { c:8, r:6, type:'wood'  },
  { c:1, r:6, type:'food'  },
  { c:5, r:2, type:'gold'  },
  { c:3, r:5, type:'iron'  },
];

const CITY_SPAWNS = [
  { c:5, r:3, name:'Ironhold',   owner:'neutral' },
  { c:1, r:1, name:'Dawnfort',   owner:'player'  },
  { c:9, r:6, name:'Ashrock',    owner:'enemy'   },
  { c:8, r:2, name:'Silvergate', owner:'neutral' },
];

const INITIAL_UNITS = [
  { type:'warrior', c:1, r:1, owner:'player' },
  { type:'scout',   c:2, r:2, owner:'player' },
  { type:'warrior', c:9, r:5, owner:'enemy'  },
  { type:'warrior', c:8, r:7, owner:'enemy'  },
];

const COLS = 11;
const ROWS = 8;
