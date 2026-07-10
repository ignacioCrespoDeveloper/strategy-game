// =============================================
//  units.js — Unit definitions + race-keyed recruitment roster
//
//  UNIT_DEFS:        full unit record per unit type
//  UNIT_ROSTER:      race → building → minLevel → [unitId]
//  MERCENARY_ROSTER: discoveryId → available unit ids after negotiation
//
//  Each unit record contains:
//    id            → unique snake_case key
//    name          → display name
//    icon          → emoji fallback when image unavailable
//    image         → path to unit portrait (assets/units/)
//    race          → race key matching RACES, or null for mercenaries
//    category      → broad category for UI grouping
//    description   → flavour description shown in recruitment UI
//    goldCost      → gold to recruit one batch
//    recruitTime   → seconds to train (0 = instant, for mercenaries)
//    upkeep        → gold per turn maintenance cost
//    populationCost→ population slots consumed
//    combatStats   → { attack, defense, hp, speed }
//    traits        → [traitId, ...] — passive combat behaviours (see traits.js)
//    abilities     → [abilityId, ...] — active phase abilities (see abilities.js)
//    tags          → [tagId, ...] — descriptive labels (see tags.js)
//
//  Stats answer:     "How strong is this unit?"
//  Traits answer:    "How does this unit fight?"
//  Abilities answer: "What unique moment can this unit create?"
//  Tags answer:      "What IS this unit?"
//
//  To add a new race: add an entry to UNIT_ROSTER.
//  To add a new unit: add to UNIT_DEFS and reference it from a roster.
//  The recruitment system reads these tables — no other files change.
// =============================================

const UNIT_DEFS = {

  // ── Dark Elf ─────────────────────────────────────────────────────

  dreadspears: {
    id:             'dreadspears',
    name:           'Dreadspears',
    icon:           '🗡',
    image:          'assets/units/dreadspears.webp',
    race:           'dark_elf',
    category:       'infantry',
    description:    'Disciplined spear-wielding infantry. Cheap, reliable, and deadly against cavalry and large beasts.',
    goldCost:       40,
    recruitTime:    30,
    upkeep:         2,
    populationCost: 1,
    combatStats:    { attack: 5, defense: 7, hp: 80, speed: 4 },
    traits:         ['shield_wall', 'anti_large'],
    abilities:      [],
    tags:           ['infantry', 'human', 'shield'],
  },

  bleakswords: {
    id:             'bleakswords',
    name:           'Bleakswords',
    icon:           '⚔',
    image:          'assets/units/bleakswords.webp',
    race:           'dark_elf',
    category:       'infantry',
    description:    'Veteran swordsmen who thirst for blood. They grow deadlier the more wounds they inflict.',
    goldCost:       70,
    recruitTime:    45,
    upkeep:         3,
    populationCost: 1,
    combatStats:    { attack: 7, defense: 6, hp: 90, speed: 5 },
    traits:         ['bloodlust'],
    abilities:      [],
    tags:           ['infantry', 'human'],
  },

  darkshards: {
    id:             'darkshards',
    name:           'Darkshards',
    icon:           '🏹',
    image:          'assets/units/darkshards.webp',
    race:           'dark_elf',
    category:       'ranged',
    description:    'Elite crossbow warriors. Their bolts punch through armor, but they crumple in melee.',
    goldCost:       80,
    recruitTime:    45,
    upkeep:         3,
    populationCost: 1,
    combatStats:    { attack: 10, defense: 3, hp: 65, speed: 5 },
    traits:         ['ranged', 'armor_piercing', 'fragile'],
    abilities:      [],
    tags:           ['infantry', 'ranged', 'human'],
  },

  witch_elves: {
    id:             'witch_elves',
    name:           'Witch Elves',
    icon:           '🗡',
    image:          'assets/units/witch_elves.webp',
    race:           'dark_elf',
    category:       'elite',
    description:    'Frenzied assassins of Khaine. Incredibly fast and lethal — but they wear almost no armor.',
    goldCost:       120,
    recruitTime:    60,
    upkeep:         5,
    populationCost: 2,
    combatStats:    { attack: 14, defense: 3, hp: 60, speed: 9 },
    traits:         ['frenzy', 'fear', 'dodge'],
    abilities:      [],
    tags:           ['infantry', 'human'],
  },

  dark_riders: {
    id:             'dark_riders',
    name:           'Dark Riders',
    icon:           '🐎',
    image:          'assets/units/dark_riders.webp',
    race:           'dark_elf',
    category:       'cavalry',
    description:    'Swift cavalry that strikes hard and fast. Excellent scouts; their charge disrupts enemy lines.',
    goldCost:       100,
    recruitTime:    60,
    upkeep:         5,
    populationCost: 2,
    combatStats:    { attack: 9, defense: 5, hp: 85, speed: 9 },
    traits:         ['charge', 'fast', 'flanker', 'scout'],
    abilities:      [],
    tags:           ['cavalry', 'human'],
  },

  war_hydra: {
    id:             'war_hydra',
    name:           'War Hydra',
    icon:           '🐉',
    image:          'assets/units/war_hydra.webp',
    race:           'dark_elf',
    category:       'monster',
    description:    'A monstrous many-headed beast chained and driven by Beastmasters. It regenerates wounds and terrifies all who face it.',
    goldCost:       400,
    recruitTime:    300,
    upkeep:         20,
    populationCost: 5,
    combatStats:    { attack: 18, defense: 10, hp: 300, speed: 4 },
    traits:         ['large', 'monster', 'guardian', 'regeneration', 'fear'],
    abilities:      ['fire_breath'],
    tags:           ['monster', 'large'],
  },

  black_dragon: {
    id:             'black_dragon',
    name:           'Black Dragon',
    icon:           '🐲',
    image:          'assets/units/black_dragon.webp',
    race:           'dark_elf',
    category:       'legendary',
    description:    'A legendary flying predator of unmatched power. Its mere presence causes terror. The pinnacle of Dark Elf military might.',
    goldCost:       1000,
    recruitTime:    600,
    upkeep:         50,
    populationCost: 10,
    combatStats:    { attack: 25, defense: 15, hp: 600, speed: 8 },
    traits:         ['flying', 'terror', 'large', 'monster', 'fire_attack'],
    abilities:      ['dragon_breath', 'sky_dive'],
    tags:           ['dragon', 'flying', 'monster', 'large'],
  },

  // ── Mercenaries ──────────────────────────────────────────────────

  bandits: {
    id:             'bandits',
    name:           'Bandits',
    icon:           '🗡',
    image:          null,
    race:           null,
    category:       'mercenary',
    description:    'Desperate outlaws looking for coin. Cheap and quick to hire.',
    goldCost:       30,
    recruitTime:    0,
    upkeep:         3,
    populationCost: 0,
    combatStats:    { attack: 5, defense: 4, hp: 70, speed: 5 },
    traits:         [],
    abilities:      [],
    tags:           ['infantry', 'human', 'mercenary'],
  },

  bandit_archers: {
    id:             'bandit_archers',
    name:           'Bandit Archers',
    icon:           '🏹',
    image:          null,
    race:           null,
    category:       'mercenary',
    description:    'Rogue marksmen who sell their bows to the highest bidder.',
    goldCost:       45,
    recruitTime:    0,
    upkeep:         4,
    populationCost: 0,
    combatStats:    { attack: 8, defense: 3, hp: 60, speed: 5 },
    traits:         ['ranged'],
    abilities:      [],
    tags:           ['infantry', 'ranged', 'human', 'mercenary'],
  },
};

// ── Race → Building → min building level → [unitId] ─────────────
//
// Each key under a race is a BUILDING_DEFS id.
// Each sub-key is the minimum level of that building needed.
// Multiple levels can unlock different units from the same building.

const UNIT_ROSTER = {
  dark_elf: {
    barracks:      { 1: ['dreadspears'], 2: ['bleakswords'], 4: ['witch_elves'] },
    archery_range: { 1: ['darkshards'] },
    stables:       { 2: ['dark_riders'] },
    monster_pit:   { 3: ['war_hydra'] },
    dragon_lair:   { 1: ['black_dragon'] },
  },
  // Add new races here — no other files change.
};

// ── Discovery → mercenary units available after negotiate ────────
const MERCENARY_ROSTER = {
  bandit_camp: { units: ['bandits', 'bandit_archers'] },
  // Future: orc_camp, goblin_camp, mercenary_company, etc.
};
