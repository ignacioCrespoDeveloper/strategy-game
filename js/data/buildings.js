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
//    cost(level)   → { wood, stone, food } — ALWAYS in that key order, which is
//                    EconomyCore.RESOURCE_KEYS. Cost panels render the literal's
//                    own key order, so a food-first def prints food first.
//    buildTime(level) → seconds
//    production(level)→ { wood, stone, food } per hour, same order rule (final rate =
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
    // FACTOR 1.6 → 1.5 (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 3b). The mill
    // and the farm both compound at 1.5; the quarry alone was at 1.6, so its
    // payback diverged from the other two forever rather than by a fixed
    // margin — measured at L20 it took 118 days to repay against the mill's
    // 24. A scarcity ordering is a design choice; a different exponent is not.
    cost:        level => ({
      wood:  _scale(48, 1.5, level),
      stone: _scale(24, 1.5, level),
    }),
    buildTime:   level => _ogTime(48, 24, 1.5, level),
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
    // COST BASE 300 → 60 (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 3b).
    // The farm charged 4× the Lumber Mill's base (300 vs 75) for a third of
    // its output (10 vs 30) — 12× worse per unit produced before any curve
    // applied, which made it a dead building past about L8 and left food the
    // resource you simply stopped producing. Rebased to 60 (45 wood + 15
    // stone), giving a cost:production ratio of 6.0 against the mill's 2.5 and
    // the quarry's 3.5: food stays the dearest of the three, which matches its
    // demand, but by 2.4× rather than 12×.
    cost:        level => ({
      wood:  _scale(45, 1.5, level),
      stone: _scale(15, 1.5, level),
    }),
    buildTime:   level => _ogTime(45, 15, 1.5, level),
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
    description: 'Channels fresh water into the city. Clean water keeps a crowded city healthy — the larger your population grows, the more it needs.',
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
    // Base ×2 and factor 1.5 → 1.7 on 2026-07-30. The Town Hall gates city tier
    // AND all construction speed, so it must stay cheap at Lv1 while mattering
    // at Lv10 — hence a curve change rather than a big base change.
    //   Lv1 4,400 · Lv2 7,480 · Lv5 36,749 · Lv10 521,797 (cum ~1.26M)
    // ⚠ OPENING CHECK: cities are seeded at town_hall 1, so the first cost a
    // player meets is Lv1→2 = W2,295/S1,785/F3,400, which must stay inside the
    // W5,000/S4,000/F5,000 starter kit. The seeded Farm 1 makes 11 food/hour
    // from minute one (it is part of the founding loadout since 2026-08-03), so
    // that is the only inflow backing a raise here. Re-verify after any change
    // here or to the starter kit / founding loadout in
    // server/actions/city-found.js.
    cost:        level => ({
      wood:  _scale(1350, 1.7, level),
      stone: _scale(1050, 1.7, level),
      food:  _scale(2000, 1.7, level),
    }),
    buildTime:   level => _scale(120, 1.6, level),
    production:  () => ({}),
    // OGame Robotics Factory: Lv1 = ÷2, Lv5 = ÷6, Lv10 = ÷11.
    // Was 2**level (Lv10 = ÷1024), which collapsed almost every build to the
    // max(5, …) floor in getBuildTime — a Fortress Lv10 finished in 69s and
    // construction time stopped existing as a cost. Linear matches the
    // canonical spec in economy-core.js (getCityBuildDivisor).
    buildTimeDivisor: level => 1 + level,
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
      wood:  _scale(800, 1.5, level),
      stone: _scale(680, 1.5, level),
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
      wood:  _scale(800, 1.5, level),
      stone: _scale(1200, 1.5, level),
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
      wood:  _scale(660, 1.5, level),
      stone: _scale(540, 1.5, level),
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
      wood:  _scale(640, 1.5, level),
      stone: _scale(360, 1.5, level),
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
    // Does NOT open the Merchant — that is its own tab and needs no building
    // (2026-08-04). The Marketplace's job is the tax bonus in
    // EconomyCore.getGoldRate, so the description must not promise trading.
    description: 'Stalls, scales and coin-changers crowd the square. Every level swells the taxes this city collects — and the corruption that follows commerce.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    cost:        level => ({
      wood:  _scale(1200, 1.5, level),
      stone: _scale(1000, 1.5, level),
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
  //
  //  THE VETERANCY THREE — Barracks / Archery Range / Stables.
  //
  //  These are not ordinary buildings: EconomyCore.getVeterancyPct gives every
  //  unit +2% attack and +2% defense per level of its TRAINING building, SUMMED
  //  ACROSS EVERY CITY the player holds and applied retroactively. They are
  //  already documented there as "the OGame Weapons/Armour techs", and that is
  //  exactly what they are — an uncapped empire-wide percentage on combat power.
  //
  //  Until 2026-08-03 they were priced like ordinary buildings (~800–960 base
  //  on ×1.5), which is the one curve an unbounded percentage must never have:
  //  seven cities at Barracks 10 bought +140% attack for ~460k resources. They
  //  now carry OGame's OWN research prices for those techs, verbatim, on
  //  OGame's ×2 factor (metal→wood, crystal→stone, deuterium→food):
  //
  //    Barracks      = Weapons Technology     800 M / 200 C        ×2
  //    Archery Range = Armour Technology    1,000 M                ×2
  //    Stables       = Shielding Technology   200 M / 600 C / 100 D ×2
  //
  //  The per-building assignment is by resource SHAPE, not by flavour — the
  //  three OGame techs happen to give three distinct profiles (mixed, pure
  //  metal, stone-with-a-food-tail), and spreading them across the three
  //  buildings stops a military push from draining one stockpile. Barracks
  //  takes the mixed one because it is the prerequisite for the other two and
  //  levels deepest (unit gates run to Lv12 in js/data/units.js).
  //
  //  Cheaper than before at Lv1 (1,000 vs 1,720 for the Barracks), then far
  //  dearer: Lv10 goes 66k → 512k, Lv12 goes 148k → 2.05M. That is the point.
  //  BUILD TIME is deliberately left on its old ×1.5 curve — the ask was about
  //  price, and time is already divided by the Town Hall. Cost is the limiter.

  barracks: {
    id:          'barracks',
    name:        'Barracks',
    icon:        gi('crossed-swords'),
    image:       'assets/buildings/barracks.png',
    category:    'military',
    description: 'Trains soldiers to defend and expand your realm. Military culture reduces civil harmony.',
    maxLevel:    Infinity,
    requires:    { town_hall: 3 },
    // OGame Weapons Technology: 800 metal / 200 crystal, ×2.
    cost:        level => ({
      wood:  _scale(800, 2, level),
      stone: _scale(200, 2, level),
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'unemployment', value: -6 * level },
      { stat: 'happiness',    value: -3 * level },
      { stat: 'religion',     value: -2 * level },
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
    // OGame Armour Technology: 1,000 metal, ×2. The single-resource column is
    // the original's, and it reads right for a range: timber butts and galleries.
    cost:        level => ({
      wood:  _scale(1000, 2, level),
    }),
    buildTime:   level => _scale(150, 1.5, level),
    production:  () => ({}),
    effects:     level => [
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
    // OGame Shielding Technology: 200 metal / 600 crystal / 100 deuterium, ×2.
    // The food column is the deuterium one and lands well here — stone stalls
    // and standing fodder are what a cavalry stable actually costs.
    cost:        level => ({
      wood:  _scale(200, 2, level),
      stone: _scale(600, 2, level),
      food:  _scale(100, 2, level),
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
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
      wood:  _scale(400, 1.5, level),
      stone: _scale(560, 1.5, level),
    }),
    buildTime:   level => _scale(90, 1.5, level),
    production:  () => ({}),
    effects:     level => [
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
    description: 'A hardened stone fortress garrisoned by professional soldiers. Provides elite Garrison Soldiers and dramatically boosts city stability.',
    maxLevel:    Infinity,
    requires:       { guard_post: 3, barracks: 2 },
    unlockRequires: [{ type: 'city_tier', minTier: 3 }],
    // BASE ÷10 (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 4). L1 cost 3,200,000
    // resources behind prerequisites (Guard Post 3 + Barracks 2) that cost
    // ~8,900 combined — a 360× jump across one gate. The practical effect was
    // that city defence had no middle: either the Guard Post, cheap and
    // scaling, or nothing. At 320,000 the ×1.6 curve still carries it to a
    // real endgame cost while giving the tier an actual entry price.
    cost:        level => ({
      wood:  _scale(120000, 1.6, level),
      stone: _scale(200000, 1.6, level),
    }),
    buildTime:   level => _scale(600, 1.7, level),
    production:  () => ({}),
    effects:     level => [
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
      wood:  _scale(800000, 1.6, level),
      stone: _scale(1100000, 1.6, level),
    }),
    buildTime:   level => _scale(360, 1.6, level),
    production:  () => ({}),
    effects:     level => [
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
    description: 'A reinforced pit where beastmasters tame and train war monsters — Dark Elven hydra handlers and Orc troll wranglers alike. Only the most disciplined survive.',
    maxLevel:    Infinity,
    requires:    { barracks: 8 },
    unlockRequires: [{ type: 'race', ids: ['dark_elf', 'orc'] }, { type: 'city_tier', minTier: 4 }],
    cost:        level => ({
      wood:  _scale(1300000, 1.6, level),
      stone: _scale(1040000, 1.6, level),
    }),
    buildTime:   level => _scale(600, 1.6, level),
    production:  () => ({}),
    effects:     level => [
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
      wood:  _scale(840, 1.5, level),
      stone: _scale(1040, 1.5, level),
    }),
    buildTime:   level => _scale(180, 1.5, level),
    production:  () => ({}),
    effects:     level => [
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
      wood:  _scale(760, 1.5, level),
      stone: _scale(1360, 1.5, level),
    }),
    buildTime:   level => _scale(200, 1.5, level),
    production:  () => ({}),
    effects:     level => [
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
    description: 'A high spire where trained Giant Eagles roost and Elven crews operate Eagle Claw bolt throwers. A potent symbol of High Elven military power.',
    maxLevel:    Infinity,
    requires:    { archery_range: 6 },
    unlockRequires: [{ type: 'race', id: 'high_elf' }, { type: 'city_tier', minTier: 3 }],
    cost:        level => ({
      wood:  _scale(1000000, 1.7, level),
      stone: _scale(1500000, 1.7, level),
    }),
    buildTime:   level => _scale(600, 1.7, level),
    production:  () => ({}),
    effects:     level => [
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
    // FACTOR 2.0 → 1.7 (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 4). At ×2.0
    // the practical ceiling was L2–L3 forever: L10 cost 6.14 BILLION resources
    // — 14.6 years of endgame income — and a single level took 1,024 hours to
    // build, so `maxLevel: Infinity` was a fiction. ×1.7 matches the other
    // landmarks and leaves a tail a player can actually climb.
    cost:        level => ({
      wood:  _scale(2400000, 1.7, level),
      stone: _scale(3600000, 1.7, level),
    }),
    buildTime:   level => _scale(7200, 1.7, level),
    production:  () => ({}),
    effects:     level => [
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
      wood:  _scale(1900000, 1.8, level),
      stone: _scale(2900000, 1.8, level),
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
      wood:  _scale(2120000, 1.7, level),
      stone: _scale(940000, 1.7, level),
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
      wood:  _scale(1400000, 1.8, level),
      stone: _scale(2600000, 1.8, level),
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
      wood:  _scale(1740000, 1.7, level),
      stone: _scale(1360000, 1.7, level),
    }),
    buildTime:   level => _scale(4800, 1.7, level),
    production:  level => ({ food: 60 * level }),
    effects:     level => [
      { stat: 'unemployment', value: -15 * level },
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
    description: 'The dark engine of Dark Elven prosperity. Slave labor drives production to extraordinary heights — but at a heavy cost to happiness and already-rampant corruption.',
    maxLevel:    Infinity,
    requires:    { town_hall: 5, marketplace: 2 },
    unlockRequires: [
      { type: 'race',         id: 'dark_elf' },
      { type: 'landmark_none' },
      { type: 'city_tier',    minTier: 4 },
    ],
    cost:        level => ({
      wood:  _scale(1180000, 1.7, level),
      stone: _scale(980000, 1.7, level),
    }),
    buildTime:   level => _scale(4200, 1.7, level),
    production:  level => ({ wood: 30 * level, food: 30 * level }),
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
      wood:  _scale(1000000, 1.8, level),
      stone: _scale(3000000, 1.8, level),
    }),
    buildTime:   level => _scale(6000, 1.8, level),
    production:  () => ({}),
    effects:     level => [
      { stat: 'stability',  value:  12 * level },
      { stat: 'religion',   value:  -8 * level },
      { stat: 'happiness',  value:  -5 * level },
      { stat: 'corruption', value:  -4 * level },
    ],
  },
};
