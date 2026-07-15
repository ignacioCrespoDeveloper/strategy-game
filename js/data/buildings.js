// =============================================
//  buildings.js — Building catalog
//
//  Fields:
//    category      → 'infrastructure' | 'economy' | 'military' | 'landmarks'
//    isLandmark    → true for unique per-city landmark buildings
//    requires      → { buildingId: minLevel }  (hard prereqs, also checked by ConstructionService)
//    unlockRequires→ [{ type, ...args }]  (additional unlock conditions, checked by BuildingUnlockService)
//    cost(level)   → { food, wood, stone, iron }
//    buildTime(level) → seconds
//    production(level)→ { food, wood, stone, iron } per hour
//    effects(level)→ [{ stat, value }] cumulative city-stat modifiers at level N
//    storageBonus(level) → flat storage capacity added (optional)
// =============================================

const _scale = (base, factor, level) => Math.floor(base * Math.pow(factor, level - 1));

var BUILDING_DEFS = {

  // ── INFRASTRUCTURE ──────────────────────────────────────────────

  town_hall: {
    id:          'town_hall',
    name:        'Town Hall',
    icon:        '🏛',
    category:    'infrastructure',
    description: 'The administrative heart of your city. Higher levels unlock more buildings and increase city capacity.',
    maxLevel:    20,
    requires:    {},
    cost:        level => ({
      wood:  _scale(200, 1.5, level),
      stone: _scale(150, 1.5, level),
      iron:  _scale(50,  1.5, level),
      food:  0,
    }),
    buildTime:   level => _scale(120, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'hygiene',    value:  6 * level },
      { stat: 'corruption', value: -4 * level },
      { stat: 'culture',    value:  3 * level },
      { stat: 'stability',  value:  3 * level },
    ],
  },

  aqueduct: {
    id:          'aqueduct',
    name:        'Aqueduct',
    icon:        '🌊',
    category:    'infrastructure',
    description: 'Channels fresh water into the city, dramatically improving hygiene and enabling population growth.',
    maxLevel:    10,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(60,  1.4, level),
      stone: _scale(180, 1.4, level),
      iron:  _scale(40,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(150, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'hygiene',    value: 8 * level },
      { stat: 'happiness',  value: 2 * level },
    ],
  },

  sewers: {
    id:          'sewers',
    name:        'Sewers',
    icon:        '🔩',
    category:    'infrastructure',
    description: 'An underground waste disposal network. Expensive to construct but dramatically reduces disease risk.',
    maxLevel:    5,
    requires:    { aqueduct: 2 },
    cost:        level => ({
      wood:  _scale(120, 1.6, level),
      stone: _scale(300, 1.6, level),
      iron:  _scale(120, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(600, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'hygiene', value: 14 * level },
    ],
  },

  library: {
    id:          'library',
    name:        'Library',
    icon:        '📚',
    category:    'infrastructure',
    description: 'Preserves knowledge and educates citizens. Foundation for future research and technological advancement.',
    maxLevel:    10,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(180, 1.4, level),
      stone: _scale(150, 1.4, level),
      iron:  _scale(40,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(200, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'culture',   value: 8 * level },
      { stat: 'stability', value: 2 * level },
    ],
  },

  courthouse: {
    id:          'courthouse',
    name:        'Courthouse',
    icon:        '⚖',
    category:    'infrastructure',
    description: 'Enforces law and prosecutes corruption. Stabilizes the city and keeps officials in check.',
    maxLevel:    10,
    requires:    { town_hall: 4 },
    cost:        level => ({
      wood:  _scale(150, 1.5, level),
      stone: _scale(250, 1.5, level),
      iron:  _scale(100, 1.5, level),
      food:  0,
    }),
    buildTime:   level => _scale(300, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'corruption', value: -5 * level },
      { stat: 'stability',  value:  4 * level },
    ],
  },

  temple: {
    id:          'temple',
    name:        'Temple',
    icon:        '⛪',
    category:    'infrastructure',
    description: 'A place of worship that strengthens faith, reduces corruption, and lifts the spirits of the people.',
    maxLevel:    10,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(150, 1.45, level),
      stone: _scale(120, 1.45, level),
      iron:  _scale(30,  1.45, level),
      food:  0,
    }),
    buildTime:   level => _scale(100, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'religion',   value: 12 * level },
      { stat: 'happiness',  value:  5 * level },
      { stat: 'corruption', value: -3 * level },
      { stat: 'hygiene',    value:  2 * level },
    ],
  },

  // ── ECONOMY ─────────────────────────────────────────────────────

  farm: {
    id:          'farm',
    name:        'Farm',
    icon:        '🌾',
    category:    'economy',
    description: 'Produces food to sustain your population and army. Food security is the foundation of a prosperous city.',
    maxLevel:    20,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(80,  1.4, level),
      stone: _scale(40,  1.4, level),
      iron:  0,
      food:  0,
    }),
    buildTime:   level => _scale(60, 1.5, level),
    production:  level => ({ food: _scale(30, 1.3, level) }),
    effects:     level => [
      { stat: 'happiness',    value:  4 * level },
      { stat: 'unemployment', value: -5 * level },
    ],
  },

  granary: {
    id:          'granary',
    name:        'Granary',
    icon:        '🏺',
    category:    'economy',
    description: 'Stores and processes food reserves. Improves food security, population happiness, and city stability.',
    maxLevel:    10,
    requires:    { farm: 1 },
    cost:        level => ({
      wood:  _scale(120, 1.4, level),
      stone: _scale(80,  1.4, level),
      iron:  _scale(20,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  level => ({ food: _scale(15, 1.25, level) }),
    effects:     level => [
      { stat: 'happiness',  value: 3 * level },
      { stat: 'stability',  value: 4 * level },
    ],
  },

  lumber_mill: {
    id:          'lumber_mill',
    name:        'Lumber Mill',
    icon:        '🪵',
    category:    'economy',
    description: 'Cuts and processes timber from the surrounding forest. Necessary for all major construction projects.',
    maxLevel:    20,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(60,  1.4, level),
      stone: _scale(50,  1.4, level),
      iron:  _scale(20,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(60, 1.5, level),
    production:  level => ({ wood: _scale(25, 1.3, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
      { stat: 'hygiene',      value: -2 * level },
    ],
  },

  stone_quarry: {
    id:          'stone_quarry',
    name:        'Stone Quarry',
    icon:        '⛏',
    category:    'economy',
    description: 'Extracts stone from nearby rock formations. Essential for upgrading city infrastructure.',
    maxLevel:    20,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(100, 1.4, level),
      stone: _scale(30,  1.4, level),
      iron:  _scale(15,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(60, 1.5, level),
    production:  level => ({ stone: _scale(20, 1.3, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
      { stat: 'happiness',    value: -1 * level },
    ],
  },

  iron_mine: {
    id:          'iron_mine',
    name:        'Iron Mine',
    icon:        '⚒',
    category:    'economy',
    description: 'Digs deep to extract iron ore for tools and weapons. Dangerous and polluting, but indispensable.',
    maxLevel:    20,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(120, 1.4, level),
      stone: _scale(80,  1.4, level),
      iron:  _scale(10,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  level => ({ iron: _scale(15, 1.3, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
      { stat: 'hygiene',      value: -5 * level },
      { stat: 'happiness',    value: -2 * level },
    ],
  },

  warehouse: {
    id:          'warehouse',
    name:        'Warehouse',
    icon:        '🏚',
    category:    'economy',
    description: 'Increases the maximum amount of resources your city can store.',
    maxLevel:    20,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(150, 1.4, level),
      stone: _scale(100, 1.4, level),
      iron:  _scale(30,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  () => ({}),
    storageBonus: level => level * 2000,
    effects:     level => [
      { stat: 'unemployment', value: -2 * level },
    ],
  },

  blacksmith: {
    id:          'blacksmith',
    name:        'Blacksmith',
    icon:        '🔨',
    category:    'economy',
    description: 'Smelts and works iron into refined materials. Supplements mine output and employs skilled craftsmen.',
    maxLevel:    10,
    requires:    { iron_mine: 1 },
    cost:        level => ({
      wood:  _scale(100, 1.4, level),
      stone: _scale(120, 1.4, level),
      iron:  _scale(60,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(120, 1.5, level),
    production:  level => ({ iron: _scale(12, 1.25, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
    ],
  },

  tavern: {
    id:          'tavern',
    name:        'Tavern',
    icon:        '🍺',
    category:    'economy',
    description: 'A gathering place for citizens. Raises spirits and fosters culture, but attracts shady dealings.',
    maxLevel:    10,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(150, 1.4, level),
      stone: _scale(80,  1.4, level),
      iron:  _scale(20,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'happiness',    value:  5 * level },
      { stat: 'culture',      value:  3 * level },
      { stat: 'unemployment', value: -3 * level },
      { stat: 'corruption',   value:  2 * level },
    ],
  },

  marketplace: {
    id:          'marketplace',
    name:        'Marketplace',
    icon:        '🏪',
    category:    'economy',
    description: 'Enables trade between cities and boosts overall prosperity. Corruption follows commerce.',
    maxLevel:    20,
    requires:    { town_hall: 3, warehouse: 2 },
    cost:        level => ({
      wood:  _scale(250, 1.4, level),
      stone: _scale(200, 1.4, level),
      iron:  _scale(100, 1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(240, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'unemployment', value: -5 * level },
      { stat: 'corruption',   value:  6 * level },
      { stat: 'happiness',    value:  4 * level },
      { stat: 'culture',      value:  4 * level },
    ],
  },

  // ── MILITARY ─────────────────────────────────────────────────────

  barracks: {
    id:          'barracks',
    name:        'Barracks',
    icon:        '⚔',
    category:    'military',
    description: 'Trains soldiers to defend and expand your realm. Military culture reduces civil harmony.',
    maxLevel:    20,
    requires:    { town_hall: 3, iron_mine: 1 },
    cost:        level => ({
      wood:  _scale(200, 1.4, level),
      stone: _scale(150, 1.4, level),
      iron:  _scale(80,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'unemployment', value: -6 * level },
      { stat: 'happiness',    value: -3 * level },
      { stat: 'religion',     value: -2 * level },
      { stat: 'security',     value:  5 * level },
    ],
  },

  watchtower: {
    id:          'watchtower',
    name:        'Watchtower',
    icon:        '🗼',
    category:    'military',
    description: 'Surveys surrounding territory and deters threats. Guards the city from raids and provides strategic vision.',
    maxLevel:    10,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(100, 1.4, level),
      stone: _scale(150, 1.4, level),
      iron:  _scale(50,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(120, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value: 10 * level },
      { stat: 'stability', value:  2 * level },
    ],
  },

  archery_range: {
    id:          'archery_range',
    name:        'Archery Range',
    icon:        '🏹',
    category:    'military',
    description: 'Trains ranged units. Provides a steady stream of disciplined skirmishers and crossbow warriors.',
    maxLevel:    10,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(150, 1.4, level),
      stone: _scale(100, 1.4, level),
      iron:  _scale(60,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(150, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',     value:  3 * level },
      { stat: 'unemployment', value: -4 * level },
    ],
  },

  stables: {
    id:          'stables',
    name:        'Stables',
    icon:        '🐎',
    category:    'military',
    description: 'Breeds and trains war horses and cavalry mounts. Unlocks fast-moving military units.',
    maxLevel:    10,
    requires:       { town_hall: 5, barracks: 2 },
    unlockRequires: [{ type: 'city_tier', minTier: 2 }],
    cost:        level => ({
      wood:  _scale(200, 1.4, level),
      stone: _scale(120, 1.4, level),
      iron:  _scale(80,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',     value:  4 * level },
      { stat: 'unemployment', value: -3 * level },
    ],
  },

  monster_pit: {
    id:          'monster_pit',
    name:        'Monster Pit',
    icon:        '🦎',
    category:    'military',
    description: 'A reinforced pit where Dark Elf beastmasters tame and train war monsters. Only the most disciplined handlers survive.',
    maxLevel:    5,
    requires:    { town_hall: 7, barracks: 3 },
    unlockRequires: [{ type: 'race', id: 'dark_elf' }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(400, 1.6, level),
      stone: _scale(300, 1.6, level),
      iron:  _scale(200, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(600, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  8 * level },
      { stat: 'happiness', value: -5 * level },
    ],
  },

  guard_post: {
    id:          'guard_post',
    name:        'Guard Post',
    icon:        '🛡',
    category:    'military',
    description: 'Barracks for city militia. Provides a standing garrison of City Guards and Militia Archers to defend the city walls.',
    maxLevel:    5,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(80,  1.4, level),
      stone: _scale(120, 1.4, level),
      iron:  _scale(40,  1.4, level),
      food:  0,
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',     value:  4 * level },
      { stat: 'unemployment', value: -3 * level },
    ],
    garrisonRoster: level => {
      const guards  = [1, 2, 3, 4, 5][level - 1] ?? 1;
      const archers = level >= 3 ? level - 2 : 0;
      const roster  = [{ unitId: 'city_guard', count: guards }];
      if (archers > 0) roster.push({ unitId: 'militia_archer', count: archers });
      return roster;
    },
  },

  fortress: {
    id:          'fortress',
    name:        'Fortress',
    icon:        '🏯',
    category:    'military',
    description: 'A hardened stone fortress garrisoned by professional soldiers. Provides elite Garrison Soldiers and dramatically boosts city security.',
    maxLevel:    3,
    requires:       { guard_post: 3, barracks: 2 },
    unlockRequires: [{ type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(300, 1.6, level),
      stone: _scale(600, 1.6, level),
      iron:  _scale(250, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(600, 1.7, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  8 * level },
      { stat: 'stability', value:  4 * level },
      { stat: 'happiness', value: -2 * level },
    ],
    garrisonRoster: level => {
      const soldiers = level * 2;
      const archers  = level >= 2 ? (level - 1) * 2 : 0;
      const roster   = [{ unitId: 'garrison_soldier', count: soldiers }];
      if (archers > 0) roster.push({ unitId: 'militia_archer', count: archers });
      return roster;
    },
  },

  gunpowder_workshop: {
    id:          'gunpowder_workshop',
    name:        'Gunpowder Workshop',
    icon:        '🔫',
    category:    'military',
    description: 'Imperial engineers produce blackpowder weapons and train Handgunners. The acrid smell of sulphur never quite leaves the district.',
    maxLevel:    5,
    requires:    { town_hall: 5, barracks: 2 },
    unlockRequires: [{ type: 'race', id: 'human' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(150, 1.4, level),
      stone: _scale(200, 1.4, level),
      iron:  _scale(120, 1.5, level),
      food:  0,
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  3 * level },
      { stat: 'culture',   value:  2 * level },
      { stat: 'happiness', value: -1 * level },
    ],
  },

  engineering_guild: {
    id:          'engineering_guild',
    name:        'Engineering Guild',
    icon:        '⚙',
    category:    'military',
    description: 'Where Imperial masterminds design war machines and steam-powered behemoths. Only the wealthiest cities can afford its ambitions.',
    maxLevel:    3,
    requires:    { town_hall: 7, barracks: 3, gunpowder_workshop: 2 },
    unlockRequires: [{ type: 'race', id: 'human' }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(400, 1.8, level),
      stone: _scale(500, 1.8, level),
      iron:  _scale(300, 1.8, level),
      food:  0,
    }),
    buildTime:   level => _scale(480, 1.8, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  6 * level },
      { stat: 'culture',   value:  4 * level },
      { stat: 'stability', value:  3 * level },
    ],
  },

  engineering_workshop: {
    id:          'engineering_workshop',
    name:        'Engineering Workshop',
    icon:        '🔧',
    category:    'military',
    description: 'Dwarf master engineers perfect their craft here — from reliable Thunderer rifles to the terrifying war machines of the hold.',
    maxLevel:    5,
    requires:    { town_hall: 5, barracks: 2 },
    unlockRequires: [{ type: 'race', id: 'dwarf' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(100, 1.4, level),
      stone: _scale(250, 1.5, level),
      iron:  _scale(180, 1.5, level),
      food:  0,
    }),
    buildTime:   level => _scale(200, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  4 * level },
      { stat: 'culture',   value:  3 * level },
      { stat: 'stability', value:  2 * level },
    ],
  },

  slayer_lodge: {
    id:          'slayer_lodge',
    name:        'Slayer Lodge',
    icon:        '🪓',
    category:    'military',
    description: 'A grim hall where oath-sworn Dwarfs train to seek a glorious death in battle. Its presence unnerves citizens — and terrifies enemies.',
    maxLevel:    3,
    requires:    { town_hall: 5, barracks: 3 },
    unlockRequires: [{ type: 'race', id: 'dwarf' }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(200, 1.6, level),
      stone: _scale(300, 1.6, level),
      iron:  _scale(150, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(360, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',    value:  5 * level },
      { stat: 'stability',   value:  3 * level },
      { stat: 'happiness',   value: -2 * level },
    ],
  },

  eagle_tower: {
    id:          'eagle_tower',
    name:        'Eagle Tower',
    icon:        '🦅',
    category:    'military',
    description: 'A high spire where trained Giant Eagles roost and Elven crews operate Eagle Claw bolt throwers. A potent symbol of High Elf military power.',
    maxLevel:    3,
    requires:    { town_hall: 5, archery_range: 2, barracks: 2 },
    unlockRequires: [{ type: 'race', id: 'high_elf' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(300, 1.7, level),
      stone: _scale(500, 1.7, level),
      iron:  _scale(200, 1.7, level),
      food:  0,
    }),
    buildTime:   level => _scale(600, 1.7, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  8 * level },
      { stat: 'culture',   value:  4 * level },
    ],
  },

  goblin_camp: {
    id:          'goblin_camp',
    name:        'Goblin Camp',
    icon:        '👺',
    category:    'military',
    description: 'A chaotic sprawl of tents, bones, and crude bows where Goblin archers bicker, brawl, and occasionally practice shooting.',
    maxLevel:    3,
    requires:    { barracks: 1 },
    unlockRequires: [{ type: 'race', id: 'orc' }, { type: 'city_tier', minTier: 2 }],
    cost:        level => ({
      wood:  _scale(80,  1.5, level),
      stone: _scale(40,  1.5, level),
      iron:  _scale(20,  1.5, level),
      food:  0,
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  3 * level },
      { stat: 'happiness', value: -2 * level },
    ],
  },

  boar_pens: {
    id:          'boar_pens',
    name:        'Boar Pens',
    icon:        '🐗',
    category:    'military',
    description: 'Reinforced pens where war boars are bred, fed, and broken for battle. The smell alone discourages enemy scouts.',
    maxLevel:    3,
    requires:    { town_hall: 5, barracks: 2 },
    unlockRequires: [{ type: 'race', id: 'orc' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(200, 1.6, level),
      stone: _scale(150, 1.6, level),
      iron:  _scale(100, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(360, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  5 * level },
    ],
  },

  monster_den: {
    id:          'monster_den',
    name:        'Monster Den',
    icon:        '👹',
    category:    'military',
    description: 'A pit dug deep enough to hold things that should not be held. Troll handlers and Spider riders train here, if they survive.',
    maxLevel:    5,
    requires:    { town_hall: 7, barracks: 3 },
    unlockRequires: [{ type: 'race', id: 'orc' }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(400, 1.7, level),
      stone: _scale(350, 1.7, level),
      iron:  _scale(150, 1.7, level),
      food:  0,
    }),
    buildTime:   level => _scale(720, 1.7, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  10 * level },
      { stat: 'happiness', value:  -5 * level },
    ],
  },

  siege_workshop: {
    id:          'siege_workshop',
    name:        'Siege Workshop',
    icon:        '🪨',
    category:    'military',
    description: 'Where Orc Meks and Goblin tinkerers build rock lobbers and other contraptions that may or may not work as intended.',
    maxLevel:    3,
    requires:    { town_hall: 5, barracks: 2 },
    unlockRequires: [{ type: 'race', id: 'orc' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(300, 1.6, level),
      stone: _scale(200, 1.6, level),
      iron:  _scale(250, 1.6, level),
      food:  0,
    }),
    buildTime:   level => _scale(480, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  6 * level },
    ],
  },

  dragon_lair: {
    id:          'dragon_lair',
    name:        'Dragon Lair',
    icon:        '🐲',
    category:    'military',
    description: 'A vast cavern carved to house a living dragon. Only the most ancient and powerful elven civilisations can claim such a bond.',
    maxLevel:    3,
    requires:    { town_hall: 9, barracks: 5 },
    unlockRequires: [{ type: 'race', ids: ['dark_elf', 'high_elf'] }, { type: 'city_tier', minTier: 5 }],
    cost:        level => ({
      wood:  _scale(1000, 2.0, level),
      stone: _scale(2000, 2.0, level),
      iron:  _scale(1500, 2.0, level),
      food:  0,
    }),
    buildTime:   level => _scale(7200, 2.0, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  15 * level },
      { stat: 'happiness', value:  -8 * level },
    ],
  },

  // ── LANDMARKS ────────────────────────────────────────────────────
  // isLandmark: true → only ONE may exist per city.
  // unlockRequires: enforces race and population conditions.

  imperial_palace: {
    id:          'imperial_palace',
    name:        'Imperial Palace',
    icon:        '🏰',
    category:    'landmarks',
    isLandmark:  true,
    description: 'A monument to Human ambition and order. The seat of Imperial governance — its towers inspire awe and its presence draws citizens from across the realm.',
    maxLevel:    5,
    requires:    { town_hall: 8 },
    unlockRequires: [
      { type: 'race',         id:    'human' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1500, 1.8, level),
      stone: _scale(2500, 1.8, level),
      iron:  _scale(800,  1.8, level),
      food:  0,
    }),
    buildTime:   level => _scale(7200, 1.8, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'happiness',  value:  8 * level },
      { stat: 'stability',  value: 10 * level },
      { stat: 'culture',    value:  6 * level },
      { stat: 'corruption', value: -5 * level },
    ],
  },

  sacred_grove: {
    id:          'sacred_grove',
    name:        'Sacred Grove',
    icon:        '🌳',
    category:    'landmarks',
    isLandmark:  true,
    description: 'An ancient forest sanctuary tended by Elven druids for millennia. The trees here sing, the water runs pure, and the city grows as naturally as the forest itself.',
    maxLevel:    5,
    requires:    { town_hall: 6 },
    unlockRequires: [
      { type: 'race',         id: 'high_elf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(2000, 1.7, level),
      stone: _scale(800,  1.7, level),
      iron:  _scale(300,  1.7, level),
      food:  0,
    }),
    buildTime:   level => _scale(5400, 1.7, level),
    production:  level => ({ food: 40 * level }),
    effects:     level => [
      { stat: 'culture',   value: 10 * level },
      { stat: 'happiness', value:  7 * level },
      { stat: 'hygiene',   value:  6 * level },
      { stat: 'religion',  value:  5 * level },
    ],
  },

  grand_forge: {
    id:          'grand_forge',
    name:        'Grand Forge',
    icon:        '🔥',
    category:    'landmarks',
    isLandmark:  true,
    description: 'The pinnacle of Dwarven engineering — a massive forge complex where master craftsmen work the finest iron the world has ever seen. Its fires never go cold.',
    maxLevel:    5,
    requires:    { town_hall: 6, iron_mine: 3 },
    unlockRequires: [
      { type: 'race',         id: 'dwarf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(600,  1.8, level),
      stone: _scale(2000, 1.8, level),
      iron:  _scale(1500, 1.8, level),
      food:  0,
    }),
    buildTime:   level => _scale(5400, 1.8, level),
    production:  level => ({ iron: 80 * level }),
    effects:     level => [
      { stat: 'unemployment', value: -8  * level },
      { stat: 'stability',    value:  8  * level },
      { stat: 'hygiene',      value: -4  * level },
    ],
  },

  great_war_camp: {
    id:          'great_war_camp',
    name:        'Great War Camp',
    icon:        '🪓',
    category:    'landmarks',
    isLandmark:  true,
    description: 'The beating heart of Orcish military might. Thousands of warriors train here day and night, and the drums of war echo through the city day and night.',
    maxLevel:    5,
    requires:    { town_hall: 5, barracks: 3 },
    unlockRequires: [
      { type: 'race',         id: 'orc' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1200, 1.7, level),
      stone: _scale(800,  1.7, level),
      iron:  _scale(1000, 1.7, level),
      food:  0,
    }),
    buildTime:   level => _scale(4800, 1.7, level),
    production:  level => ({ food: 60 * level }),
    effects:     level => [
      { stat: 'unemployment', value: -15 * level },
      { stat: 'security',     value:  10 * level },
      { stat: 'stability',    value:   5 * level },
      { stat: 'happiness',    value:  -3 * level },
    ],
  },

  slave_market: {
    id:          'slave_market',
    name:        'Slave Market',
    icon:        '⛓',
    category:    'landmarks',
    isLandmark:  true,
    description: 'The dark engine of Dark Elf prosperity. Slave labor drives production to extraordinary heights — but at a heavy cost to happiness and already-rampant corruption.',
    maxLevel:    5,
    requires:    { town_hall: 5, marketplace: 2 },
    unlockRequires: [
      { type: 'race',         id: 'dark_elf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(800,  1.7, level),
      stone: _scale(600,  1.7, level),
      iron:  _scale(800,  1.7, level),
      food:  0,
    }),
    buildTime:   level => _scale(4200, 1.7, level),
    production:  level => ({ food: 30 * level, iron: 30 * level }),
    effects:     level => [
      { stat: 'unemployment', value: -12 * level },
      { stat: 'corruption',   value:   8 * level },
      { stat: 'happiness',    value:  -5 * level },
      { stat: 'stability',    value:  -4 * level },
    ],
  },

  blood_citadel: {
    id:          'blood_citadel',
    name:        'Blood Citadel',
    icon:        '🩸',
    category:    'landmarks',
    isLandmark:  true,
    description: 'An obsidian fortress steeped in ancient sorcery. The Vampire lord rules from here with absolute authority. Citizens do not love the Citadel — they fear it. And fear is a form of stability.',
    maxLevel:    5,
    requires:    { town_hall: 6 },
    unlockRequires: [
      { type: 'race',         id: 'vampire' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(400,  1.8, level),
      stone: _scale(2500, 1.8, level),
      iron:  _scale(1200, 1.8, level),
      food:  0,
    }),
    buildTime:   level => _scale(6000, 1.8, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'stability',  value:  12 * level },
      { stat: 'security',   value:   8 * level },
      { stat: 'religion',   value:  -8 * level },
      { stat: 'happiness',  value:  -5 * level },
      { stat: 'corruption', value:  -4 * level },
    ],
  },
};
