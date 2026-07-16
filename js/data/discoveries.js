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

var DISCOVERY_DEFS = {

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

  // ── Resource — Tier 1 (common, modest yield) ──────────────────

  iron_vein: {
    id:          'iron_vein',
    name:        'Iron Vein',
    tier:        1,
    intelType:   'resources',
    description: 'A surface iron vein, easy to chip away and carry back to the city.',
    icon:        '🔩',
    category:    'resource',
    baseWeight:  18,
    baseDuration: 1 * 24 * 3600,
    terrainMultipliers: {
      hills: 3.0, mountain: 2.0, desert: 0.8, plains: 0.5, forest: 0.3, marsh: 0.1,
    },
  },

  cliff_face: {
    id:          'cliff_face',
    name:        'Cliff Face',
    tier:        1,
    intelType:   'resources',
    description: 'A rocky outcrop with loose, workable stone — easy pickings for a labour party.',
    icon:        '🗿',
    category:    'resource',
    baseWeight:  18,
    baseDuration: 2 * 24 * 3600,
    terrainMultipliers: {
      mountain: 3.0, hills: 2.5, desert: 1.0, plains: 0.3, forest: 0.2, marsh: 0.1,
    },
  },

  fertile_fields: {
    id:          'fertile_fields',
    name:        'Fertile Fields',
    tier:        1,
    intelType:   'resources',
    description: 'Abandoned farmland, still rich with soil. A quick harvest would fill many baskets.',
    icon:        '🌾',
    category:    'resource',
    baseWeight:  20,
    baseDuration: 1 * 24 * 3600,
    terrainMultipliers: {
      plains: 4.0, hills: 1.0, forest: 0.5, marsh: 0.5, mountain: 0.1, desert: 0.0,
    },
  },

  river_crossing: {
    id:          'river_crossing',
    name:        'River Crossing',
    tier:        1,
    intelType:   'resources',
    description: 'A ford where fish congregate and fresh water flows freely. Good for a quick supply run.',
    icon:        '🎣',
    category:    'resource',
    baseWeight:  16,
    baseDuration: 2 * 24 * 3600,
    terrainMultipliers: {
      marsh: 3.0, plains: 2.0, forest: 2.0, hills: 1.0, mountain: 0.5, desert: 0.0,
    },
  },

  coin_cache: {
    id:          'coin_cache',
    name:        'Coin Cache',
    tier:        1,
    intelType:   'resources',
    description: 'A small pouch of coins hidden beneath a stone. Better than nothing.',
    icon:        '🪙',
    category:    'resource',
    baseWeight:  10,
    baseDuration: 1 * 24 * 3600,
    terrainMultipliers: {
      plains: 1.5, forest: 1.3, hills: 1.2, desert: 1.5, mountain: 1.0, marsh: 0.8,
    },
  },

  // ── Resource — Tier 2 (standard) ──────────────────────────────

  timber_cache: {
    id:          'timber_cache',
    name:        'Timber Cache',
    tier:        2,
    intelType:   'resources',
    description: 'A stack of felled logs left by loggers who never returned. Quality wood, ready for the taking.',
    icon:        '🪵',
    category:    'resource',
    baseWeight:  15,
    baseDuration: 3 * 24 * 3600,
    terrainMultipliers: {
      forest: 3.0, marsh: 1.5, plains: 0.8, hills: 0.5, mountain: 0.2, desert: 0.0,
    },
  },

  abandoned_mine: {
    id:          'abandoned_mine',
    name:        'Abandoned Mine',
    tier:        2,
    intelType:   'resources',
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
    tier:        2,
    intelType:   'resources',
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
    tier:        2,
    intelType:   'resources',
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
    tier:        2,
    intelType:   'resources',
    description: 'A buried chest, heavy with coins and gemstones. Someone hid this long ago and never came back.',
    icon:        '💰',
    category:    'resource',
    baseWeight:  5,
    baseDuration: 2 * 24 * 3600,
    terrainMultipliers: {
      desert: 2.0, forest: 1.5, plains: 1.2, hills: 1.0, mountain: 0.8, marsh: 0.5,
    },
  },

  // ── Resource — Tier 3 (rare, large yield) ─────────────────────

  ancient_forest: {
    id:          'ancient_forest',
    name:        'Ancient Forest',
    tier:        3,
    intelType:   'resources',
    description: 'A grove of primordial trees, untouched for centuries. Their timber alone could supply a city for months.',
    icon:        '🌲',
    category:    'resource',
    baseWeight:  4,
    baseDuration: 10 * 24 * 3600,
    terrainMultipliers: {
      forest: 5.0, marsh: 1.5, hills: 0.5, plains: 0.2, mountain: 0.1, desert: 0.0,
    },
  },

  deep_ore_shaft: {
    id:          'deep_ore_shaft',
    name:        'Deep Ore Shaft',
    tier:        3,
    intelType:   'resources',
    description: 'A massive natural iron deposit, rich enough to arm a dozen armies. The ore practically falls from the walls.',
    icon:        '⚙',
    category:    'resource',
    baseWeight:  3,
    baseDuration: 14 * 24 * 3600,
    terrainMultipliers: {
      mountain: 4.0, hills: 2.5, desert: 0.8, plains: 0.2, forest: 0.1, marsh: 0.0,
    },
  },

  marble_quarry: {
    id:          'marble_quarry',
    name:        'Marble Quarry',
    tier:        3,
    intelType:   'resources',
    description: 'An entire mountainside of premium marble. Whoever controls this site can build in a style that endures.',
    icon:        '🏛',
    category:    'resource',
    baseWeight:  3,
    baseDuration: 14 * 24 * 3600,
    terrainMultipliers: {
      mountain: 4.0, hills: 2.0, desert: 1.0, plains: 0.2, forest: 0.1, marsh: 0.0,
    },
  },

  bountiful_hunt: {
    id:          'bountiful_hunt',
    name:        'Bountiful Hunting Ground',
    tier:        3,
    intelType:   'resources',
    description: 'An exceptional stretch of wilderness teeming with prey. Your hunters could feed an entire army from this land.',
    icon:        '🦬',
    category:    'resource',
    baseWeight:  4,
    baseDuration: 7 * 24 * 3600,
    terrainMultipliers: {
      forest: 4.0, plains: 2.5, hills: 1.5, marsh: 1.0, mountain: 0.3, desert: 0.0,
    },
  },

  buried_vault: {
    id:          'buried_vault',
    name:        'Buried Vault',
    tier:        3,
    intelType:   'resources',
    description: 'A sealed underground chamber stuffed with the wealth of some long-dead lord. The dust of ages guards it still.',
    icon:        '🏺',
    category:    'resource',
    baseWeight:  2,
    baseDuration: 7 * 24 * 3600,
    terrainMultipliers: {
      desert: 3.0, mountain: 2.0, hills: 1.5, plains: 1.0, forest: 1.0, marsh: 0.5,
    },
  },

  // ── Combat ────────────────────────────────────────────────────

  bandit_camp: {
    id:          'bandit_camp',
    name:        'Bandit Camp',
    intelType:   'bandit_camp',
    description: 'A gang of outlaws has made camp here. Dangerous — but they carry loot worth fighting for.',
    icon:        '🏕',
    category:    'combat',
    baseWeight:  7,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      forest: 2.5, hills: 1.8, plains: 1.2, marsh: 0.6, mountain: 0.5, desert: 0.8,
    },
  },

  goblin_camp: {
    id:          'goblin_camp',
    name:        'Goblin Camp',
    intelType:   'bandit_camp',
    description: 'A chaotic sprawl of tents, bones and noise. The greenskins inside are cowardly but numerous.',
    icon:        '👺',
    category:    'combat',
    baseWeight:  6,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      forest: 3.0, marsh: 2.0, hills: 1.5, plains: 1.0, mountain: 0.5, desert: 0.2,
    },
  },

  mercenary_company: {
    id:          'mercenary_company',
    name:        'Mercenary Company',
    intelType:   'bandit_camp',
    description: 'A professional warband between contracts. They fight hard and demand good coin — but can be hired.',
    icon:        '⚔',
    category:    'combat',
    baseWeight:  4,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      plains: 2.5, hills: 1.5, forest: 0.8, mountain: 0.5, marsh: 0.4, desert: 0.6,
    },
  },

  wolf_rider_camp: {
    id:          'wolf_rider_camp',
    name:        'Wolf Rider Camp',
    intelType:   'bandit_camp',
    description: 'Fast-moving goblin cavalry who raid and vanish before retaliation arrives.',
    icon:        '🐺',
    category:    'combat',
    baseWeight:  5,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      plains: 2.5, forest: 2.0, hills: 1.5, marsh: 0.5, mountain: 0.3, desert: 1.0,
    },
  },

  ogre_camp: {
    id:          'ogre_camp',
    name:        'Ogre Camp',
    intelType:   'bandit_camp',
    description: 'Where ogres make camp, nothing grows and travellers disappear. Extremely dangerous — but the loot is legendary.',
    icon:        '💀',
    category:    'combat',
    baseWeight:  4,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      mountain: 2.5, hills: 2.0, forest: 1.5, plains: 0.8, marsh: 0.5, desert: 0.6,
    },
  },

  orc_warcamp: {
    id:          'orc_warcamp',
    name:        'Orc Warcamp',
    intelType:   'bandit_camp',
    description: 'A full Greenskin warcamp. Boyz, bosses and boars, all looking for a fight.',
    icon:        '🪓',
    category:    'combat',
    baseWeight:  4,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      plains: 2.0, forest: 1.8, marsh: 1.2, hills: 1.5, mountain: 0.4, desert: 0.5,
    },
  },

  dark_elf_raiders: {
    id:          'dark_elf_raiders',
    name:        'Dark Elf Raiders',
    intelType:   'bandit_camp',
    description: 'A landing party of Dark Elf corsairs. Disciplined, cruel, and carrying prisoners they\'ll sell if left alone.',
    icon:        '🌑',
    category:    'combat',
    baseWeight:  2,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      coast: 3.0, forest: 2.0, marsh: 1.5, hills: 1.0, mountain: 0.5, plains: 0.8, desert: 0.3,
    },
  },

  dwarf_expedition: {
    id:          'dwarf_expedition',
    name:        'Dwarf Expedition',
    intelType:   'bandit_camp',
    description: 'A heavily armed Dwarven prospecting party, deep in grudge-paying territory. They won\'t move without a fight.',
    icon:        '⛏',
    category:    'combat',
    baseWeight:  2,
    baseDuration: 24 * 3600,
    terrainMultipliers: {
      mountain: 3.0, hills: 2.5, forest: 0.5, plains: 0.4, marsh: 0.2, desert: 0.8,
    },
  },

  beast_lair: {
    id:          'beast_lair',
    name:        'Beast Lair',
    intelType:   'bandit_camp',
    description: 'A den of monstrous creatures. No negotiation possible — only steel and nerve will clear it.',
    icon:        '🦴',
    category:    'combat',
    baseWeight:  1,
    baseDuration: 48 * 3600,
    terrainMultipliers: {
      forest: 3.0, marsh: 2.5, mountain: 2.0, hills: 1.0, plains: 0.3, desert: 0.2,
    },
  },

  dragon_cult: {
    id:          'dragon_cult',
    name:        'Dragon Cult',
    intelType:   'bandit_camp',
    description: 'Fanatics who worship a living dragon. They guard their master with their lives and cannot be reasoned with.',
    icon:        '🐲',
    category:    'combat',
    baseWeight:  1,
    baseDuration: 48 * 3600,
    terrainMultipliers: {
      mountain: 3.0, desert: 2.0, hills: 1.5, forest: 0.8, plains: 0.3, marsh: 0.2,
    },
  },

  // ── Event ─────────────────────────────────────────────────────

  ancient_ruins: {
    id:          'ancient_ruins',
    name:        'Ancient Ruins',
    intelType:   'ruins',
    description: 'Crumbling stone walls hint at a civilization long forgotten. Scholars would pay dearly for access.',
    icon:        '🏛',
    category:    'event',
    baseWeight:  8,
    baseDuration: 14 * 24 * 3600,
    terrainMultipliers: {
      desert: 2.5, mountain: 2.0, hills: 1.5, forest: 0.8, plains: 0.6, marsh: 0.4,
    },
  },

  abandoned_keep: {
    id:          'abandoned_keep',
    name:        'Abandoned Keep',
    intelType:   'ruins',
    description: 'A crumbling fortress ruin, long since stripped of defenders. Treasures may still lie within its vaults.',
    icon:        '🏚',
    category:    'event',
    tier:        2,
    baseWeight:  8,
    baseDuration: 14 * 24 * 3600,
    terrainMultipliers: {
      mountain: 2.0, hills: 2.0, plains: 1.2, forest: 1.0, marsh: 0.6, desert: 0.8,
    },
  },

  wandering_sage: {
    id:          'wandering_sage',
    name:        'Wandering Sage',
    intelType:   'ruins',
    description: 'A travelling scholar bearing ancient knowledge. Time spent with them grants rare insight.',
    icon:        '📖',
    category:    'event',
    tier:        2,
    baseWeight:  8,
    baseDuration: 6 * 3600,
    terrainMultipliers: {
      plains: 2.0, forest: 1.8, hills: 1.2, marsh: 0.6, mountain: 0.5, desert: 0.4,
    },
  },

  // ── Trade ─────────────────────────────────────────────────────

  merchant_caravan: {
    id:          'merchant_caravan',
    name:        'Merchant Caravan',
    intelType:   'mercenary_camp',
    description: 'A traveling trader rests here with exotic wares and willing ears.',
    icon:        '🐪',
    category:    'trade',
    baseWeight:  8,
    baseDuration: 12 * 3600,
    terrainMultipliers: {
      plains: 2.5, hills: 1.0, forest: 0.5, mountain: 0.2, marsh: 0.2, desert: 0.4,
    },
  },

  traveling_merchant: {
    id:          'traveling_merchant',
    name:        'Traveling Merchant',
    intelType:   'mercenary_camp',
    description: 'A wealthy trader with exotic goods far beyond the usual stock. A lucrative encounter.',
    icon:        '💰',
    category:    'trade',
    tier:        2,
    baseWeight:  6,
    baseDuration: 10 * 3600,
    terrainMultipliers: {
      plains: 2.5, hills: 1.2, forest: 0.8, mountain: 0.3, marsh: 0.2, desert: 0.6,
    },
  },

  // ── Legendary ─────────────────────────────────────────────────

  ancient_relic: {
    id:          'ancient_relic',
    name:        'Ancient Relic',
    intelType:   'ruins',
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
    intelType:   'ruins',
    description: 'Strange luminescent crystals, formed over centuries in the murky depths. None have seen their like before.',
    icon:        '💠',
    category:    'legendary',
    baseWeight:  3,
    baseDuration: 21 * 24 * 3600,
    terrainMultipliers: {
      marsh: 4.0, forest: 0.4, plains: 0.0, hills: 0.0, mountain: 0.0, desert: 0.0,
    },
  },

  // Intelligence-only entries — baseWeight 0 so they are never rolled randomly.
  // Written directly by _scanIntelligence() in lord-screen.js.
  enemy_city: {
    id:          'enemy_city',
    name:        'Ciudad Enemiga',
    icon:        '🏯',
    category:    'intelligence',
    baseWeight:  0,
    baseDuration: 0,
    intelType:   'enemy_city',
  },
  enemy_lord: {
    id:          'enemy_lord',
    name:        'Señor Enemigo',
    icon:        '👑',
    category:    'intelligence',
    baseWeight:  0,
    baseDuration: 0,
    intelType:   'enemy_lord',
  },
};

// ── Category display metadata ──────────────────────────────────

const DISCOVERY_CATEGORY_META = {
  nothing:      { label: 'Nothing',      icon: '🌫', cssClass: 'dc-nothing'      },
  resource:     { label: 'Resource',     icon: '💎', cssClass: 'dc-resource'     },
  combat:       { label: 'Combat',       icon: '⚔',  cssClass: 'dc-combat'       },
  event:        { label: 'Event',        icon: '📜', cssClass: 'dc-event'        },
  trade:        { label: 'Trade',        icon: '🤝', cssClass: 'dc-trade'        },
  quest:        { label: 'Quest',        icon: '⚡', cssClass: 'dc-quest'        },
  legendary:    { label: 'Legendary',    icon: '⭐', cssClass: 'dc-legendary'    },
  intelligence: { label: 'Intelligence', icon: '👁', cssClass: 'dc-intelligence' },
};
