// =============================================
//  buildings.js — Building catalog
//
//  Fields:
//    category      → 'resources' | 'infrastructure' | 'military' | 'landmarks'
//                    (the city view shows landmarks inside the Infrastructure tab)
//    image         → optional art (assets/buildings/…) shown in the city grid
//                    tile and detail panel; falls back to the emoji icon
//    isLandmark    → true for unique per-city landmark buildings
//    requires      → { buildingId: minLevel }  (hard prereqs, also checked by ConstructionService)
//    unlockRequires→ [{ type, ...args }]  (additional unlock conditions, checked by BuildingUnlockService)
//    cost(level)   → { food, wood, stone }
//    buildTime(level) → seconds
//    production(level)→ { food, wood, stone } per hour (final rate =
//                    production × race bonus × terrain multiplier)
//    effects(level)→ [{ stat, value }] cumulative city-stat modifiers at level N.
//                    Resource buildings all drain hygiene; the Aqueduct is
//                    the counterweight (hygiene +8/level).
//    buildTimeDivisor(level) → optional OGame-style build-time DIVISOR for
//                    THIS city (Town Hall: 1 + level, i.e. Lv1 halves build
//                    times — the Robotics Factory formula). Divisors from
//                    multiple buildings multiply (a future nanite-style
//                    building would add 2^level). Race bonuses and
//                    Engineering Tomes apply as % on top
//                    (EconomyCore.getBuildTime).
//
//  Resource buildings follow OGame's economy curves
//  (metal→wood, crystal→stone, deuterium→food):
//    production = base · L · 1.1^L      cost = base · factor^(L-1)
//    buildTime  = (wood + stone cost) · 1.44 s   (OGame: hours = cost/2500)
// =============================================

const _scale = (base, factor, level) => Math.floor(base * Math.pow(factor, level - 1));

// OGame production/energy curve: base · level · 1.1^level
const _og = (base, level) => Math.floor(base * level * Math.pow(1.1, level));

// OGame build time for resource buildings: (wood+stone at this level) / 2500 hours
const _ogTime = (baseWood, baseStone, factor, level) =>
  Math.max(15, Math.round((baseWood + baseStone) * Math.pow(factor, level - 1) * 1.44));

var BUILDING_DEFS = {

  // ── RESOURCES (OGame mines + energy plant) ──────────────────────

  lumber_mill: {
    id:          'lumber_mill',
    name:        'Lumber Mill',
    icon:        gi('wood-pile'),
    image:       'assets/buildings/lumbermill.webp',
    category:    'resources',
    description: 'Cuts and processes timber from the surrounding forest. Necessary for all major construction projects.',
    maxLevel:    Infinity,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(60, 1.5, level),
      stone: _scale(15, 1.5, level),
    }),
    buildTime:   level => _ogTime(60, 15, 1.5, level),
    production:  level => ({ wood: _og(30, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
      { stat: 'hygiene',      value: -2 * level },
    ],
  },

  stone_quarry: {
    id:          'stone_quarry',
    name:        'Stone Quarry',
    icon:        gi('war-pick'),
    image:       'assets/buildings/stone.jpg',
    category:    'resources',
    description: 'Extracts stone from nearby rock formations. Essential for upgrading city infrastructure.',
    maxLevel:    Infinity,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(48, 1.6, level),
      stone: _scale(24, 1.6, level),
    }),
    buildTime:   level => _ogTime(48, 24, 1.6, level),
    production:  level => ({ stone: _og(20, level) }),
    effects:     level => [
      { stat: 'unemployment', value: -4 * level },
      { stat: 'happiness',    value: -1 * level },
      { stat: 'hygiene',      value: -2 * level },
    ],
  },

  farm: {
    id:          'farm',
    name:        'Farm',
    icon:        gi('wheat'),
    image:       'assets/buildings/farm.webp',
    category:    'resources',
    description: 'Produces food to sustain your population and army. Food security is the foundation of a prosperous city.',
    maxLevel:    Infinity,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(225, 1.5, level),
      stone: _scale(75,  1.5, level),
    }),
    buildTime:   level => _ogTime(225, 75, 1.5, level),
    production:  level => ({ food: _og(10, level) }),
    effects:     level => [
      { stat: 'happiness',    value:  4 * level },
      { stat: 'unemployment', value: -5 * level },
      { stat: 'hygiene',      value: -2 * level },
    ],
  },

  aqueduct: {
    id:          'aqueduct',
    name:        'Aqueduct',
    icon:        gi('aqueduct'),
    image:       'assets/buildings/aqueduct.jpg',
    category:    'resources',
    description: 'Channels fresh water into the city. Water is the lifeblood of every mill, quarry and farm — a thirsty city works at a fraction of its potential.',
    maxLevel:    Infinity,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(75, 1.5, level),
      stone: _scale(30, 1.5, level),
    }),
    buildTime:   level => _ogTime(75, 30, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'hygiene',    value: 8 * level },
      { stat: 'happiness',  value: 2 * level },
    ],
  },

  // ── INFRASTRUCTURE ──────────────────────────────────────────────

  town_hall: {
    id:          'town_hall',
    name:        'Town Hall',
    icon:        gi('capitol'),
    image:       'assets/buildings/townhall.png',
    category:    'infrastructure',
    description: 'The administrative heart of your city. Higher levels unlock more buildings, increase city capacity, and speed up all construction in this city.',
    maxLevel:    Infinity,
    requires:    {},
    cost:        level => ({
      food:  _scale(1000, 1.5, level),
      wood:  _scale(675,  1.5, level),
      stone: _scale(525,  1.5, level),
    }),
    buildTime:   level => _scale(120, 1.6, level),
    production:  () => ({}),
    buildTimeDivisor: level => 2 ** level, // OGame Nanite Factory: Lv1 = ÷2, Lv5 = ÷32, Lv10 = ÷1024
    effects:     level => [
      { stat: 'hygiene',    value:  6 * level },
      { stat: 'corruption', value: -4 * level },
      { stat: 'culture',    value:  3 * level },
      { stat: 'stability',  value:  3 * level },
    ],
  },

  library: {
    id:          'library',
    name:        'Library',
    icon:        gi('book-pile'),
    image:       'assets/buildings/library.jpg',
    category:    'infrastructure',
    description: 'Preserves knowledge and educates citizens. Foundation for future research and technological advancement.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(200, 1.4, level),
      stone: _scale(170, 1.4, level),
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
    icon:        gi('scales'),
    image:       'assets/buildings/courthouse.webp',
    category:    'infrastructure',
    description: 'Enforces law and prosecutes corruption. Stabilizes the city and keeps officials in check.',
    maxLevel:    Infinity,
    requires:    { town_hall: 4 },
    cost:        level => ({
      wood:  _scale(200, 1.5, level),
      stone: _scale(300, 1.5, level),
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
    icon:        gi('church'),
    image:       'assets/buildings/temple.webp',
    category:    'infrastructure',
    description: 'A place of worship that strengthens faith, reduces corruption, and lifts the spirits of the people.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(165, 1.45, level),
      stone: _scale(135, 1.45, level),
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

  tavern: {
    id:          'tavern',
    name:        'Tavern',
    icon:        gi('tavern-sign'),
    image:       'assets/buildings/tavern.jpg',
    category:    'infrastructure',
    description: 'A gathering place for citizens. Raises spirits and fosters culture, but attracts shady dealings.',
    maxLevel:    Infinity,
    requires:    { town_hall: 2 },
    cost:        level => ({
      wood:  _scale(160, 1.4, level),
      stone: _scale(90,  1.4, level),
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
    icon:        gi('shop'),
    image:       'assets/buildings/marketplace.png',
    category:    'infrastructure',
    description: 'Enables trade between cities and boosts overall prosperity. Corruption follows commerce.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(300, 1.4, level),
      stone: _scale(250, 1.4, level),
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
    icon:        gi('crossed-swords'),
    image:       'assets/buildings/barracks.png',
    category:    'military',
    description: 'Trains soldiers to defend and expand your realm. Military culture reduces civil harmony.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(240, 1.4, level),
      stone: _scale(190, 1.4, level),
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

  archery_range: {
    id:          'archery_range',
    name:        'Archery Range',
    icon:        gi('high-shot'),
    image:       'assets/buildings/archeryrange.png',
    category:    'military',
    description: 'Trains ranged units. Provides a steady stream of disciplined skirmishers and crossbow warriors.',
    maxLevel:    Infinity,
    requires:    { barracks: 3 },
    cost:        level => ({
      wood:  _scale(180, 1.4, level),
      stone: _scale(130, 1.4, level),
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
    icon:        gi('horse-head'),
    image:       'assets/buildings/stable.png',
    category:    'military',
    description: 'Breeds and trains war horses and cavalry mounts. Unlocks fast-moving military units.',
    maxLevel:    Infinity,
    requires:       { barracks: 5 },
    unlockRequires: [{ type: 'city_tier', minTier: 2 }],
    cost:        level => ({
      wood:  _scale(240, 1.4, level),
      stone: _scale(160, 1.4, level),
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',     value:  4 * level },
      { stat: 'unemployment', value: -3 * level },
    ],
  },

  guard_post: {
    id:          'guard_post',
    name:        'Guard Post',
    icon:        gi('round-shield'),
    image:       'assets/buildings/guardpost.webp',
    category:    'military',
    description: 'Barracks for city militia. Provides a standing garrison of City Guards and Militia Archers to defend the city walls.',
    maxLevel:    Infinity,
    requires:    { town_hall: 1 },
    cost:        level => ({
      wood:  _scale(100, 1.4, level),
      stone: _scale(140, 1.4, level),
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',     value:  4 * level },
      { stat: 'unemployment', value: -3 * level },
    ],
    garrisonRoster: level => {
      // Was a fixed [1,2,3,4,5] lookup that silently fell back to 1 guard
      // forever past level 5 — now that building levels are uncapped, this
      // needs to keep scaling instead of flatlining. `level` reproduces the
      // exact same 1/2/3/4/5 progression through the old array's range and
      // continues naturally beyond it.
      const guards  = level;
      const archers = level >= 3 ? level - 2 : 0;
      const roster  = [{ unitId: 'city_guard', count: guards }];
      if (archers > 0) roster.push({ unitId: 'militia_archer', count: archers });
      return roster;
    },
  },

  fortress: {
    id:          'fortress',
    name:        'Fortress',
    icon:        gi('guarded-tower'),
    image:       'assets/buildings/fortress.png',
    category:    'military',
    description: 'A hardened stone fortress garrisoned by professional soldiers. Provides elite Garrison Soldiers and dramatically boosts city security.',
    maxLevel:    Infinity,
    requires:       { guard_post: 3, barracks: 2 },
    unlockRequires: [{ type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(425, 1.6, level),
      stone: _scale(725, 1.6, level),
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

  slayer_lodge: {
    id:          'slayer_lodge',
    name:        'Slayer Lodge',
    image:       'assets/buildings/slayerlodge.webp',
    icon:        gi('battle-axe'),
    category:    'military',
    description: 'A grim hall where oath-sworn Dwarfs train to seek a glorious death in battle. Its presence unnerves citizens — and terrifies enemies.',
    maxLevel:    Infinity,
    requires:    { barracks: 6 },
    unlockRequires: [{ type: 'race', id: 'dwarf' }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(275, 1.6, level),
      stone: _scale(375, 1.6, level),
    }),
    buildTime:   level => _scale(360, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',    value:  5 * level },
      { stat: 'stability',   value:  3 * level },
      { stat: 'happiness',   value: -2 * level },
    ],
  },

  monster_pit: {
    id:          'monster_pit',
    name:        'Monster Pit',
    image:       'assets/buildings/monsterpit.png',
    icon:        gi('lizardman'),
    category:    'military',
    description: 'A reinforced pit where beastmasters tame and train war monsters — Dark Elf hydra handlers and Orc troll wranglers alike. Only the most disciplined survive.',
    maxLevel:    Infinity,
    requires:    { barracks: 8 },
    unlockRequires: [{ type: 'race', ids: ['dark_elf', 'orc'] }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(500, 1.6, level),
      stone: _scale(400, 1.6, level),
    }),
    buildTime:   level => _scale(600, 1.6, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  8 * level },
      { stat: 'happiness', value: -5 * level },
    ],
  },

  gunpowder_workshop: {
    id:          'gunpowder_workshop',
    name:        'Gunpowder Workshop',
    image:       'assets/buildings/gunpowder.webp',
    icon:        gi('musket'),
    category:    'military',
    description: 'Imperial engineers produce blackpowder weapons and train Handgunners. The acrid smell of sulphur never quite leaves the district.',
    maxLevel:    Infinity,
    requires:    { archery_range: 3 },
    unlockRequires: [{ type: 'race', id: 'human' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(210, 1.4, level),
      stone: _scale(260, 1.4, level),
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  3 * level },
      { stat: 'culture',   value:  2 * level },
      { stat: 'happiness', value: -1 * level },
    ],
  },

  engineering_workshop: {
    id:          'engineering_workshop',
    name:        'Engineering Workshop',
    image:       'assets/buildings/engineeringworkshop.webp',
    icon:        gi('auto-repair'),
    category:    'military',
    description: 'Master engineers perfect their craft here — Dwarf rifles and cannon, Imperial steam tanks, and the Orc Meks\' rock lobbers all roll off the same floor.',
    maxLevel:    Infinity,
    requires:    { archery_range: 5 },
    unlockRequires: [{ type: 'race', ids: ['dwarf', 'human', 'orc'] }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(190, 1.4, level),
      stone: _scale(340, 1.5, level),
    }),
    buildTime:   level => _scale(200, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  4 * level },
      { stat: 'culture',   value:  3 * level },
      { stat: 'stability', value:  2 * level },
    ],
  },

  eagle_tower: {
    id:          'eagle_tower',
    name:        'Eagle Tower',
    image:       'assets/buildings/eagletower.webp',
    icon:        gi('eagle-emblem'),
    category:    'military',
    description: 'A high spire where trained Giant Eagles roost and Elven crews operate Eagle Claw bolt throwers. A potent symbol of High Elf military power.',
    maxLevel:    Infinity,
    requires:    { archery_range: 6 },
    unlockRequires: [{ type: 'race', id: 'high_elf' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(400, 1.7, level),
      stone: _scale(600, 1.7, level),
    }),
    buildTime:   level => _scale(600, 1.7, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'security',  value:  8 * level },
      { stat: 'culture',   value:  4 * level },
    ],
  },

  dragon_lair: {
    id:          'dragon_lair',
    name:        'Dragon Lair',
    image:       'assets/buildings/dragonlair.png',
    icon:        gi('dragon-head'),
    category:    'military',
    description: 'A vast cavern carved to house a living dragon. Only the most ancient and powerful elven civilisations can claim such a bond.',
    maxLevel:    Infinity,
    requires:    { barracks: 12 },
    unlockRequires: [{ type: 'race', ids: ['dark_elf', 'high_elf'] }, { type: 'city_tier', minTier: 5 }],
    cost:        level => ({
      wood:  _scale(1750, 2.0, level),
      stone: _scale(2750, 2.0, level),
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
    image:       'assets/buildings/imperialpalace.webp',
    icon:        gi('castle'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'A monument to Human ambition and order. The seat of Imperial governance — its towers inspire awe and its presence draws citizens from across the realm.',
    maxLevel:    Infinity,
    requires:    { town_hall: 8 },
    unlockRequires: [
      { type: 'race',         id:    'human' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1900, 1.8, level),
      stone: _scale(2900, 1.8, level),
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
    image:       'assets/buildings/sacredgrove.webp',
    icon:        gi('holy-oak'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'An ancient forest sanctuary tended by Elven druids for millennia. The trees here sing, the water runs pure, and the city grows as naturally as the forest itself.',
    maxLevel:    Infinity,
    requires:    { town_hall: 6 },
    unlockRequires: [
      { type: 'race',         id: 'high_elf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(2150, 1.7, level),
      stone: _scale(950,  1.7, level),
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
    image:       'assets/buildings/grandforge.webp',
    icon:        gi('flame'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'The pinnacle of Dwarven engineering — a massive forge complex where master craftsmen cut and dress the finest stone the world has ever seen. Its fires never go cold.',
    maxLevel:    Infinity,
    requires:    { town_hall: 6, stone_quarry: 3 },
    unlockRequires: [
      { type: 'race',         id: 'dwarf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1350, 1.8, level),
      stone: _scale(2750, 1.8, level),
    }),
    buildTime:   level => _scale(5400, 1.8, level),
    production:  level => ({ stone: 80 * level }),
    effects:     level => [
      { stat: 'unemployment', value: -8  * level },
      { stat: 'stability',    value:  8  * level },
      { stat: 'hygiene',      value: -4  * level },
    ],
  },

  great_war_camp: {
    id:          'great_war_camp',
    name:        'Great War Camp',
    image:       'assets/buildings/warcamp.webp',
    icon:        gi('battle-axe'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'The beating heart of Orcish military might. Thousands of warriors train here day and night, and the drums of war echo through the city day and night.',
    maxLevel:    Infinity,
    requires:    { town_hall: 5, barracks: 3 },
    unlockRequires: [
      { type: 'race',         id: 'orc' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1700, 1.7, level),
      stone: _scale(1300, 1.7, level),
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
    image:       'assets/buildings/slavemarket.webp',
    icon:        gi('manacles'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'The dark engine of Dark Elf prosperity. Slave labor drives production to extraordinary heights — but at a heavy cost to happiness and already-rampant corruption.',
    maxLevel:    Infinity,
    requires:    { town_hall: 5, marketplace: 2 },
    unlockRequires: [
      { type: 'race',         id: 'dark_elf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1200, 1.7, level),
      stone: _scale(1000, 1.7, level),
    }),
    buildTime:   level => _scale(4200, 1.7, level),
    production:  level => ({ food: 30 * level, wood: 30 * level }),
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
    icon:        gi('bleeding-wound'),
    category:    'landmarks',
    isLandmark:  true,
    description: 'An obsidian fortress steeped in ancient sorcery. The Vampire lord rules from here with absolute authority. Citizens do not love the Citadel — they fear it. And fear is a form of stability.',
    maxLevel:    Infinity,
    requires:    { town_hall: 6 },
    unlockRequires: [
      { type: 'race',         id: 'vampire' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1000, 1.8, level),
      stone: _scale(3100, 1.8, level),
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
