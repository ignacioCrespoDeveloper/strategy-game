// =============================================
//  legendary_lords.js — Campaign identity system
// =============================================
// Each LegendaryLord IS the faction. Everything in the campaign
// derives from this choice: army, economy, diplomacy, victory condition.
// Fields are intentionally flat so every system can read them directly.

const LEGENDARY_LORDS = [

  // ── 1. THE CRIMSON EMPEROR ────────────────────────────
  {
    captureStyle: 'standard',
    id:          'crimson_emperor',
    name:        'The Crimson Emperor',
    title:       'Last Emperor of the Great Dominion',
    portrait:    '🏛',
    color:       '#c8102e',

    description: 'The last heir of an empire that once stretched across the known world. He has spent decades rebuilding its institutions, its roads, its legions. Where others build armies, he builds civilizations. His patience is legendary. His economy is unmatched.',
    playstyle:   'Economy & Technology · Empire Builder',
    theme:       'A grounded, methodical campaign rewarding long-term planning over aggressive expansion.',

    strengths:   ['Strongest economy in the game', 'Cities produce +2 gold per turn', 'Balanced military doctrine', 'Advanced research path (future)'],
    weaknesses:  ['Slow to mobilize in early turns', 'Victory requires holding many cities', 'No unique military advantage early'],

    victoryCondition: {
      short:       'Establish the Golden Empire',
      description: 'Control 8 cities simultaneously and accumulate 800 gold in your treasury. The Empire must be rich, not merely large.',
      icon:        '👑'
    },

    // Starting state
    startingResources: { gold: 250, iron: 30, food: 50, wood: 20 },
    startingUnits:     ['warrior', 'warrior', 'spearman', 'spearman', 'archer'],

    // Used by _traitEffect() in game.js
    traits:   ['guerrero', 'mercader'],
    skills:   { military: 65, diplomacy: 55, stewardship: 90 },
    age:      38,

    // Flat modifiers that supplement traits (extension points for future systems)
    modifiers: { goldPerCity: 2 },
    mechanics: ['imperial_reforms'],     // future tech tree
    uniqueUnits: ['imperial_guard', 'imperial_knights'],  // future unlock
  },

  // ── 2. THE DRAGON HEIR ───────────────────────────────
  {
    captureStyle: 'standard',
    id:          'dragon_heir',
    name:        'The Dragon Heir',
    title:       'Last of the Dragonrider Bloodline',
    portrait:    '🐉',
    color:       '#8b0000',

    description: 'The last noble of an ancient lineage said to carry dragon blood in their veins. He commands a young dragon — the last one alive. If it dies, it dies forever. His armies are small but elite, and other lords will bend the knee before crossing a dragonrider.',
    playstyle:   'Elite Army · Diplomacy · Dragon',
    theme:       'A high-risk, high-reward campaign where a single legendary creature changes everything.',

    strengths:   ['Dragon unit (unique, cannot be replaced)', 'Elite starting army', 'Can create vassal states (future)', 'Strong diplomatic standing'],
    weaknesses:  ['If the dragon dies, it is gone forever', 'Small army, difficult to replenish', 'Early economy is weak'],

    victoryCondition: {
      short:       'Five Vassal Kingdoms',
      description: 'Obtain five vassal kingdoms through conquest or diplomacy, with your dragon as the symbol of your supremacy.',
      icon:        '🐉'
    },

    startingResources: { gold: 150, iron: 50, food: 30, wood: 0 },
    startingUnits:     ['knight', 'knight', 'warrior', 'archer'],

    traits:   ['guerrero', 'cruel'],
    skills:   { military: 90, diplomacy: 70, stewardship: 40 },
    age:      26,

    modifiers:   {},
    mechanics:   ['dragon'],            // future: dragon unit with permanent death
    uniqueUnits: ['dragon_knight', 'dragon_guard'],
  },

  // ── 3. LORD OF PLAGUES ───────────────────────────────
  {
    captureStyle: 'plague',
    id:          'lord_of_plagues',
    name:        'The Lord of Plagues',
    title:       'He Who Walks Before the Pestilence',
    portrait:    '☠',
    color:       '#3a6b2a',

    description: 'He does not conquer cities. He infects them. Where his armies march, disease follows. Cities do not fall — they rot from within. His forces are cheap and replaceable. He does not need gold. He needs time, and time is the only resource he has in abundance.',
    playstyle:   'Attrition · Infection · Unconventional',
    theme:       'A completely different campaign where traditional conquest is replaced by spreading corruption.',

    strengths:   ['Large numbers of cheap units', 'Cities eventually fall without direct combat (future)', 'Immune to standard diplomacy penalties', 'Regenerating horde mentality'],
    weaknesses:  ['Weak economy (cities decay, not produce)', 'Units are individually weak', 'No allies — all factions oppose him'],

    victoryCondition: {
      short:       'Five Infected Cities',
      description: 'Infect or conquer five cities. Let the pestilence do what armies cannot.',
      icon:        '☠',
      checkId:     'five_infected_cities',
    },

    startingResources: { gold: 50, iron: 0, food: 80, wood: 30 },
    startingUnits:     ['militia', 'militia', 'militia', 'militia', 'archer'],

    traits:   ['cruel'],
    skills:   { military: 55, diplomacy: 10, stewardship: 30 },
    age:      null,   // ageless

    modifiers:   { goldPerCity: -1 },   // cities produce less under plague
    mechanics:   ['infection', 'corruption'],   // future: infection spread system
    uniqueUnits: ['plague_bearer', 'infected_infantry'],
  },

  // ── 4. THE GRAND CORSAIR ─────────────────────────────
  {
    captureStyle: 'standard',
    id:          'grand_corsair',
    name:        'The Grand Corsair',
    title:       'Lord of the Black Fleet',
    portrait:    '⚓',
    color:       '#1a4a7a',

    description: 'Born on the sea, built by the sea. His fleet is his fortress, his ports are his empire. Inland he struggles — the weight of armor, the softness of earth, the silence of no tides. But on the coast, he is unstoppable. He raids first. He asks questions later.',
    playstyle:   'Naval · Raiding · Speed · Coast',
    theme:       'A mobile, aggressive campaign that punishes overextension into the interior.',

    strengths:   ['Fast cavalry and light infantry', 'Excellent raiding income', 'Strong on coastal hexes (future)', 'Large starting wood supply for ships (future)'],
    weaknesses:  ['Heavy penalties fighting inland (future)', 'Cannot hold interior cities efficiently', 'Food production near zero'],

    victoryCondition: {
      short:       'Control Five Ports',
      description: 'Control five port cities simultaneously. The sea belongs to those who take it.',
      icon:        '⚓'
    },

    startingResources: { gold: 200, iron: 0, food: 0, wood: 60 },
    startingUnits:     ['scout', 'scout', 'archer', 'merc_arch'],

    traits:   ['mercader', 'cruel'],
    skills:   { military: 70, diplomacy: 35, stewardship: 65 },
    age:      44,

    modifiers:   { goldPerCity: 3 },  // raiding income (future: coastal only)
    mechanics:   ['naval_warfare', 'raiding'],
    uniqueUnits: ['black_corsair', 'sea_raider'],
  },

  // ── 5. THE DRAGON HUNTER ─────────────────────────────
  {
    captureStyle: 'standard',
    id:          'dragon_hunter',
    name:        'The Dragon Hunter',
    title:       'Grand Master of the Ancient Order',
    portrait:    '🗡️',
    color:       '#1a1a2e',

    description: 'His order was founded one thousand years ago for a single purpose: to ensure that no dragon ever rules over men. He carries The Cannibal — a captured dragon, broken and weaponized, used to hunt its own kind. He does not seek glory. He seeks extinction.',
    playstyle:   'Anti-Dragon · Elite Order · Monster Hunter',
    theme:       'A narrative campaign where the ultimate target is the Dragon Heir and his dragon.',

    strengths:   ['Possesses The Cannibal — a captured dragon (unique)', 'Heavily armored anti-cavalry units', 'Strong siege capability', 'Order mechanics (future)'],
    weaknesses:  ['No economic advantages', 'Highly focused — weak without a specific target', 'Isolated from normal diplomacy'],

    victoryCondition: {
      short:       'Kill the Dragon',
      description: 'Find and destroy the Dragon Heir\'s dragon. If the Dragon Heir is not in the campaign, control 6 cities instead.',
      icon:        '🗡️'
    },

    startingResources: { gold: 180, iron: 60, food: 20, wood: 0 },
    startingUnits:     ['knight', 'crossbow', 'spearman', 'spearman'],

    traits:   ['guerrero', 'cruel'],
    skills:   { military: 88, diplomacy: 25, stewardship: 45 },
    age:      52,

    modifiers:   {},
    mechanics:   ['cannibal_dragon', 'dragon_hunter_order'],
    uniqueUnits: ['black_knight', 'dragon_hunter_unit'],
  },

  // ── 6. LORD NOCTIS ───────────────────────────────────
  {
    captureStyle: 'standard',
    id:          'lord_noctis',
    name:        'Lord Noctis',
    title:       'Ancient Lord of House Noctis',
    portrait:    '🦇',
    color:       '#3a0a5a',

    description: 'He has ruled for one hundred and twenty years. His bloodline carries an ancient curse — they live long, they need blood to survive, they age slowly. He is not a monster. He is a politician. Every court in the known world owes him favors. He wins wars before they begin.',
    playstyle:   'Intrigue · Influence · Long Game · Politics',
    theme:       'A slow-burn political campaign where information and influence are more powerful than armies.',

    strengths:   ['Oldest and most experienced ruler', 'Largest starting gold reserve', 'Expert in court intrigue (future)', 'Can manipulate other courts without war (future)'],
    weaknesses:  ['Weaker in open field battles', 'Requires blood tribute (future: population cost)', 'Victory through influence, not conquest — slow and complex'],

    victoryCondition: {
      short:       'Dominate Five Royal Courts',
      description: 'Establish controlling influence over five royal courts through gold, espionage, and diplomacy. No army required.',
      icon:        '🦇'
    },

    startingResources: { gold: 320, iron: 10, food: 0, wood: 0 },
    startingUnits:     ['merc_inf', 'merc_inf', 'merc_arch', 'warrior'],

    traits:   ['mercader', 'piadoso'],
    skills:   { military: 40, diplomacy: 95, stewardship: 80 },
    age:      120,

    modifiers:   { goldPerCity: 1 },
    mechanics:   ['blood_curse', 'court_influence', 'espionage'],
    uniqueUnits: ['noctis_guard', 'shadow_agent'],
  },
];
