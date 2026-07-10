// =============================================
//  discoveries.js — Discovery catalog
//
//  Each definition is data-only.
//  DiscoveryService owns all logic (rolling, storing, expiring).
//
//  Fields:
//    id               → unique string key
//    name             → display name
//    description      → flavour text shown in popup
//    icon             → emoji
//    category         → 'nothing' | 'resource' | 'combat' | 'event' | 'trade' | 'quest' | 'legendary'
//    baseWeight       → probability weight before terrain modifiers
//    baseDuration     → seconds the discovery remains active (0 = not stored)
//    terrainMultipliers → { terrainId: multiplier }
//                         values > 1 = more likely on this terrain
//                         0          = impossible on this terrain
//                         omit terrain = defaults to 1.0
//
//  Extend this file to add new discoveries.
//  Do NOT add game logic here.
// =============================================

const DISCOVERY_DEFS = {

  // ── Nothing ───────────────────────────────────────────────────

  nothing_found: {
    id:          'nothing_found',
    name:        'Nothing Found',
    description: 'You comb the area with care but find nothing of interest.',
    icon:        '🌫',
    category:    'nothing',
    baseWeight:  40,
    baseDuration: 0,
    terrainMultipliers: {
      forest: 0.5, plains: 0.7, hills: 0.9, marsh: 1.2, mountain: 1.3, desert: 2.5,
    },
  },

  // ── Resource ──────────────────────────────────────────────────

  timber_cache: {
    id:          'timber_cache',
    name:        'Timber Cache',
    description: 'A stack of felled logs left by loggers who never returned. Quality wood, ready for the taking.',
    icon:        '🪵',
    category:    'resource',
    baseWeight:  15,
    baseDuration: 3 * 24 * 3600,
    terrainMultipliers: {
      forest: 3.0, plains: 0.8, hills: 0.5, marsh: 1.5, mountain: 0.2, desert: 0.0,
    },
  },

  abandoned_mine: {
    id:          'abandoned_mine',
    name:        'Abandoned Mine',
    description: 'An old mine shaft sealed by a cave-in. Its veins still run rich with iron ore.',
    icon:        '⛏',
    category:    'resource',
    baseWeight:  10,
    baseDuration: 7 * 24 * 3600,
    terrainMultipliers: {
      mountain: 3.0, hills: 2.0, desert: 1.2, plains: 0.4, forest: 0.3, marsh: 0.1,
    },
  },

  stone_deposit: {
    id:          'stone_deposit',
    name:        'Stone Deposit',
    description: 'A rich vein of quality building stone breaks the surface here, ready to be quarried.',
    icon:        '🪨',
    category:    'resource',
    baseWeight:  12,
    baseDuration: 5 * 24 * 3600,
    terrainMultipliers: {
      mountain: 3.0, hills: 2.5, desert: 1.0, plains: 0.3, forest: 0.2, marsh: 0.1,
    },
  },

  wild_game: {
    id:          'wild_game',
    name:        'Wild Game',
    description: 'Rich hunting grounds. Your hunters could fill the city larders from this land.',
    icon:        '🦌',
    category:    'resource',
    baseWeight:  12,
    baseDuration: 4 * 24 * 3600,
    terrainMultipliers: {
      forest: 3.0, plains: 1.5, hills: 1.0, marsh: 0.8, mountain: 0.3, desert: 0.0,
    },
  },

  lost_treasure: {
    id:          'lost_treasure',
    name:        'Lost Treasure',
    description: 'A buried chest, heavy with coins and gemstones. Someone hid this long ago and never came back.',
    icon:        '💰',
    category:    'resource',
    baseWeight:  5,
    baseDuration: 2 * 24 * 3600,
    terrainMultipliers: {
      desert: 2.0, forest: 1.5, plains: 1.2, hills: 1.0, mountain: 0.8, marsh: 0.5,
    },
  },

  // ── Combat ────────────────────────────────────────────────────

  bandit_camp: {
    id:          'bandit_camp',
    name:        'Bandit Camp',
    description: 'A gang of outlaws has made camp here. Dangerous — but they carry loot worth fighting for.',
    icon:        '🏕',
    category:    'combat',
    baseWeight:  10,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      forest: 2.5, hills: 1.8, plains: 1.2, marsh: 0.6, mountain: 0.5, desert: 0.8,
    },
  },

  // ── Event ─────────────────────────────────────────────────────

  ancient_ruins: {
    id:          'ancient_ruins',
    name:        'Ancient Ruins',
    description: 'Crumbling stone walls hint at a civilization long forgotten. Scholars would pay dearly for access.',
    icon:        '🏛',
    category:    'event',
    baseWeight:  8,
    baseDuration: 14 * 24 * 3600,
    terrainMultipliers: {
      desert: 2.5, mountain: 2.0, hills: 1.5, forest: 0.8, plains: 0.6, marsh: 0.4,
    },
  },

  // ── Trade ─────────────────────────────────────────────────────

  merchant_caravan: {
    id:          'merchant_caravan',
    name:        'Merchant Caravan',
    description: 'A traveling trader rests here with exotic wares and willing ears.',
    icon:        '🐪',
    category:    'trade',
    baseWeight:  8,
    baseDuration: 12 * 3600,
    terrainMultipliers: {
      plains: 2.5, hills: 1.0, forest: 0.5, mountain: 0.2, marsh: 0.2, desert: 0.4,
    },
  },

  // ── Legendary ─────────────────────────────────────────────────

  ancient_relic: {
    id:          'ancient_relic',
    name:        'Ancient Relic',
    description: 'An artifact of unknown origin, humming with faint arcane energy. Extremely rare.',
    icon:        '🔮',
    category:    'legendary',
    baseWeight:  2,
    baseDuration: 30 * 24 * 3600,
    terrainMultipliers: {
      mountain: 2.5, desert: 2.0, hills: 1.5, marsh: 1.2, forest: 0.8, plains: 0.5,
    },
  },

  bog_crystal: {
    id:          'bog_crystal',
    name:        'Bog Crystal',
    description: 'Strange luminescent crystals, formed over centuries in the murky depths. None have seen their like before.',
    icon:        '💠',
    category:    'legendary',
    baseWeight:  3,
    baseDuration: 21 * 24 * 3600,
    terrainMultipliers: {
      marsh: 4.0, forest: 0.4, plains: 0.0, hills: 0.0, mountain: 0.0, desert: 0.0,
    },
  },
};

// ── Category display metadata ──────────────────────────────────

const DISCOVERY_CATEGORY_META = {
  nothing:   { label: 'Nothing',   icon: '🌫', cssClass: 'dc-nothing'   },
  resource:  { label: 'Resource',  icon: '💎', cssClass: 'dc-resource'  },
  combat:    { label: 'Combat',    icon: '⚔',  cssClass: 'dc-combat'    },
  event:     { label: 'Event',     icon: '📜', cssClass: 'dc-event'     },
  trade:     { label: 'Trade',     icon: '🤝', cssClass: 'dc-trade'     },
  quest:     { label: 'Quest',     icon: '⚡', cssClass: 'dc-quest'     },
  legendary: { label: 'Legendary', icon: '⭐', cssClass: 'dc-legendary' },
};
