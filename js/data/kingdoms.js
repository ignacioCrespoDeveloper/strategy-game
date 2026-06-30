// =============================================
//  data/kingdoms.js — Kingdom definitions
//
//  A Kingdom is the top-level political entity:
//  culture, military philosophy, economy, AI priorities.
//
//  Houses and Leaders are defined separately in houses.js.
//  Units and Buildings are universal — kingdoms express
//  differences through the `modifiers` hook (no gameplay yet).
// =============================================

const KINGDOMS = [
  {
    id:      'northern',
    name:    'Northern Kingdom',
    symbol:  '❄',
    color:   '#5a8acc',
    desc:    'A land of honor, fortresses, and endless winter. The Northern Kingdom endures through discipline, ancient blood-oaths, and walls that have never fallen.',

    culture: 'nordic',

    // How this kingdom approaches the three pillars of grand strategy
    philosophy: {
      economy:   'subsistence',    // subsistence | trade | industrial | agrarian | raiding
      military:  'defensive',      // defensive | expansionist | raiding | diplomatic | balanced
      diplomacy: 'honor',          // honor | pragmatic | aggressive | isolationist | mercantile
    },

    militaryFocus: 'heavy_infantry', // heavy_infantry | cavalry | ranged | naval | siege | mixed
    preferredTerrain: ['forest', 'mountain'],

    // AI weights — no gameplay implementation yet, architecture only
    aiPriority: {
      expansion: 0.3,
      defense:   0.8,
      trade:     0.3,
      military:  0.7,
    },

    // Kingdom-level modifier hooks — no gameplay yet
    // Future: { type: 'building', key: 'lumber_camp', stat: 'income', mult: 1.25 }
    modifiers: [],

    // Flavor
    historicalNote: 'The Northern Kingdom has stood for four hundred years. Three southern empires have tried to break it. None survived the attempt.',
  },

  {
    id:      'merchant_league',
    name:    'Merchant League',
    symbol:  '⚓',
    color:   '#c8940c',
    desc:    'A confederation of port cities bound by contract, not blood. Wealth is the only true law in the League — and they have more of it than anyone.',

    culture: 'maritime',

    philosophy: {
      economy:   'trade',
      military:  'diplomatic',
      diplomacy: 'pragmatic',
    },

    militaryFocus: 'mercenaries',
    preferredTerrain: ['plains'],

    aiPriority: {
      expansion: 0.5,
      defense:   0.4,
      trade:     0.9,
      military:  0.4,
    },

    modifiers: [],

    historicalNote: 'The League began as a mutual defense pact between seven port cities. It now controls more maritime trade than any kingdom on the continent.',
  },

  {
    id:      'imperial',
    name:    'Imperial Kingdom',
    symbol:  '🦅',
    color:   '#b03030',
    desc:    'Built on administration, roads, and centuries of imperial law. The Empire expands not only by conquest, but by bureaucratic absorption and taxation so efficient it feels inevitable.',

    culture: 'imperial',

    philosophy: {
      economy:   'industrial',
      military:  'expansionist',
      diplomacy: 'pragmatic',
    },

    militaryFocus: 'heavy_infantry',
    preferredTerrain: ['plains', 'desert'],

    aiPriority: {
      expansion: 0.8,
      defense:   0.5,
      trade:     0.6,
      military:  0.7,
    },

    modifiers: [],

    historicalNote: 'The Empire has annexed thirty-two independent territories in two centuries. None were taken by force alone — the roads and census came first.',
  },

  {
    id:      'mountain_clans',
    name:    'Mountain Clans',
    symbol:  '⛏',
    color:   '#806040',
    desc:    'Forged in iron and stone. The Mountain Clans answer to no outside king, trade in ore and arms, and have never once lost a siege on home ground.',

    culture: 'clannic',

    philosophy: {
      economy:   'industrial',
      military:  'defensive',
      diplomacy: 'isolationist',
    },

    militaryFocus: 'heavy_infantry',
    preferredTerrain: ['mountain'],

    aiPriority: {
      expansion: 0.2,
      defense:   0.9,
      trade:     0.5,
      military:  0.6,
    },

    modifiers: [],

    historicalNote: 'Three major armies have attempted to subjugate the Mountain Clans. Two turned back. One never came back at all.',
  },

  {
    id:      'pirate_confederation',
    name:    'Pirate Confederation',
    symbol:  '☠',
    color:   '#208060',
    desc:    'No laws. No kings. No mercy. The Confederation controls the sea lanes and demands tribute from every ship that crosses their waters. They call it a tax. Everyone else calls it extortion.',

    culture: 'corsair',

    philosophy: {
      economy:   'raiding',
      military:  'raiding',
      diplomacy: 'aggressive',
    },

    militaryFocus: 'cavalry',   // fast hit-and-run land forces; naval focus is future
    preferredTerrain: ['plains'],

    aiPriority: {
      expansion: 0.7,
      defense:   0.2,
      trade:     0.4,
      military:  0.8,
    },

    modifiers: [],

    historicalNote: 'The Confederation is technically not a kingdom. They insist on this distinction while collecting kingdom-sized tribute.',
  },
];

// ── Backward compatibility alias ─────────────────────────────────────
// All existing code that references FACTIONS (renderer.js, ui.js, game.js)
// continues to work without modification. FACTIONS === KINGDOMS.
const FACTIONS = KINGDOMS;
