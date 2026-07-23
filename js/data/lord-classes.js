// =============================================
//  lord-classes.js — Lord class definitions
//
//  Every lord starts from LORD_BASE_STATS.
//  The chosen class applies permanent modifiers.
//
//  To add a new class: append an entry to LORD_CLASSES.
//  Nothing else changes.
// =============================================

var LORD_BASE_STATS = {
  health:     100,
  attack:     5,
  defense:    5,
  leadership: 5,
  magic:      5,
  speed:      5,
};

// Soft display maximums for progress bars — not hard caps.
var LORD_STAT_MAX = {
  health:     200,
  attack:     20,
  defense:    20,
  leadership: 20,
  magic:      20,
  speed:      20,
};

// Icon, colour and label for each stat — consumed by all UI components.
var LORD_STAT_META = {
  health:     { label: 'Health',     icon: '❤',  color: '#4aaa4a' },
  attack:     { label: 'Attack',     icon: '⚔',  color: '#c05040' },
  defense:    { label: 'Defense',    icon: '🛡',  color: '#4070d0' },
  leadership: { label: 'Leadership', icon: '👑',  color: '#c8933a' },
  magic:      { label: 'Magic',      icon: '✨',  color: '#9040c0' },
  speed:      { label: 'Speed',      icon: '💨',  color: '#30a0b0' },
};

var LORD_CLASSES = {
  warrior: {
    id:          'warrior',
    name:        'Warrior',
    icon:        '⚔',
    color:       '#c05040',
    description: 'Masters of direct combat. Warriors lead from the front and inspire allies through sheer force of arms.',
    modifiers:   { attack: 2, defense: 2 },
    passive: {
      id:          'commander',
      name:        'Commander',
      icon:        '🛡',
      description: 'Born to lead armies into battle. Future: grants +2 Attack to every unit under your command.',
    },
  },

  rogue: {
    id:          'rogue',
    name:        'Rogue',
    icon:        '🗡',
    color:       '#20b060',
    description: 'Swift and elusive. Rogues excel at exploration and strike before the enemy knows they are there.',
    modifiers:   { speed: 3, attack: 1 },
    passive: {
      id:          'explorer',
      name:        'Explorer',
      icon:        '🔍',
      description: 'Search Area takes half the time. Higher chance of valuable discoveries.',
      effects: {
        searchDurationMult:   0.5,
        discoveryWeightBonus: 0.3,
      },
    },
  },

  priest: {
    id:          'priest',
    name:        'Priest',
    icon:        '✝',
    color:       '#d0b040',
    description: 'Spiritual leaders who bolster the faith of the people. Priests keep cities loyal and prosperous.',
    modifiers:   { leadership: 3, defense: 1 },
    passive: {
      id:          'faithkeeper',
      name:        'Faithkeeper',
      icon:        '☀',
      description: 'Improves city Happiness while the lord is present. Future: healing, diplomacy and religious authority.',
    },
  },

  mage: {
    id:          'mage',
    name:        'Mage',
    icon:        '🔮',
    color:       '#8040c0',
    description: 'Scholars of the arcane. Mages wield devastating magic and push the boundaries of knowledge.',
    modifiers:   { magic: 4, leadership: 1 },
    passive: {
      id:          'arcane_scholar',
      name:        'Arcane Scholar',
      icon:        '📚',
      description: 'Deep mastery of magical arts. Future: magic damage, research acceleration, magic resistance.',
    },
  },

  dark_lord: {
    id:          'dark_lord',
    name:        'Dark Lord',
    icon:        '💀',
    color:       '#8030a0',
    description: 'Warlords who thrive on conquest and fear. Their dark power grows with every victory.',
    modifiers:   { attack: 2, magic: 2 },
    passive: {
      id:          'dark_presence',
      name:        'Dark Presence',
      icon:        '🔥',
      description: 'Spreads corruption and terror. Future: dark magic bonuses, enhanced rewards from aggressive actions.',
    },
  },
};

// =============================================
//  TALENT_POOL — Cross-class talents unlocked at level 5.
//
//  Lords choose exactly one talent, permanently.
//  Combat talents add traits/stats to the lord's BattleUnit.
//  Strategic talents apply passive effects via getTalentEffects().
//
//  effects keys used by the engine:
//    searchDurationMult    — multiplier on search action duration (lord.js)
//    goldDiscoveryBonus    — extra weight on gold-type discoveries (discovery.js)
//    commandCapacityBonus  — extra unit model slots (lord.js)
//    armyPowerCapBonus     — extra CP cap (lord.js)
//    attackerMoraleBonus   — own-side morale boost at battle start (battle-engine.js)
//    defenderMoraleMalus   — enemy morale penalty at battle start (battle-engine.js)
//    xpMultiplier          — multiplier on all XP earned (lord.js, lord-screen.js, battle-result-view.js)
//    recruitTimeMult       — multiplier on unit training duration (server/actions/recruit.js)
//    battleUnitTraits      — array of traits injected into the lord BattleUnit (battle-engine.js)
//    battleUnitAttackBonus — flat attack added to lord BattleUnit (battle-engine.js)
//    battleUnitDefenseBonus— flat defense added to lord BattleUnit (battle-engine.js)
// =============================================

var TALENT_POOL = {

  // ── Combat talents ────────────────────────────────────────────

  blademaster: {
    id:          'blademaster',
    name:        'Blademaster',
    icon:        '⚔',
    color:       '#c05040',
    category:    'combat',
    description: 'Your lord fights with deadly precision in battle. +4 Attack and armor-piercing strikes — enemy armor provides minimal protection.',
    hint:        'Best for Warriors',
    effects: {
      battleUnitAttackBonus: 4,
      battleUnitTraits:      ['armor_piercing'],
    },
  },

  double_strike: {
    id:          'double_strike',
    name:        'Double Strike',
    icon:        '🗡',
    color:       '#20b060',
    category:    'combat',
    description: 'Your lord strikes with blinding speed. 30% chance to attack twice per melee round.',
    hint:        'Best for Rogues & Dark Lords',
    effects: {
      battleUnitTraits: ['double_strike'],
    },
  },

  pyroblast: {
    id:          'pyroblast',
    name:        'Pyroblast',
    icon:        '🔥',
    color:       '#9040c0',
    category:    'combat',
    description: 'In the opening round your lord unleashes a torrent of arcane fire, scorching all enemies simultaneously and suppressing their regeneration.',
    hint:        'Best for Mages',
    effects: {
      battleUnitTraits: ['pyroblast'],
    },
  },

  iron_wall: {
    id:          'iron_wall',
    name:        'Iron Wall',
    icon:        '🛡',
    color:       '#4070d0',
    category:    'combat',
    description: 'Your lord becomes an immovable bastion. +4 Defense and the Shield Wall ability — incoming melee damage reduced while frontline units stand.',
    hint:        'Best for Warriors & Priests',
    effects: {
      battleUnitDefenseBonus: 4,
      battleUnitTraits:       ['shield_wall'],
    },
  },

  // ── Strategic talents ─────────────────────────────────────────

  pathfinder: {
    id:          'pathfinder',
    name:        'Pathfinder',
    icon:        '🔍',
    color:       '#30a0b0',
    category:    'strategic',
    description: 'Your lord navigates the wilderness with unmatched instinct. Quest duration reduced by 25%.',
    hint:        'Best for Rogues & explorers',
    effects: {
      searchDurationMult: 0.75,
    },
  },

  treasure_hunter: {
    id:          'treasure_hunter',
    name:        'Treasure Hunter',
    icon:        '💰',
    color:       '#c8933a',
    category:    'strategic',
    description: 'Your lord has a nose for coin. Gold-type discoveries (coin caches, lost treasures, buried vaults) appear 40% more frequently.',
    hint:        'Best for any gold-focused build',
    effects: {
      goldDiscoveryBonus: 0.4,
    },
  },

  commander: {
    id:          'commander',
    name:        'Commander',
    icon:        '👑',
    color:       '#c8933a',
    category:    'strategic',
    description: 'Your lord inspires loyalty and discipline. Army capacity increased by +2 unit slots.',
    hint:        'Best for large-army builds',
    effects: {
      commandCapacityBonus: 2,
    },
  },

  strategist: {
    id:          'strategist',
    name:        'Strategist',
    icon:        '🗺',
    color:       '#4070d0',
    category:    'strategic',
    description: 'Your lord commands with iron authority. Army Combat Power cap increased by +100 CP.',
    hint:        'Best for elite heavy armies',
    effects: {
      armyPowerCapBonus: 100,
    },
  },

  inspiring: {
    id:          'inspiring',
    name:        'Inspiring',
    icon:        '☀',
    color:       '#d0b040',
    category:    'strategic',
    description: 'Your lord\'s presence lifts the spirits of every soldier. Allied morale starts 10 points higher at the start of every battle.',
    hint:        'Best for Priests & support lords',
    effects: {
      attackerMoraleBonus: 10,
    },
  },

  fearsome: {
    id:          'fearsome',
    name:        'Fearsome',
    icon:        '💀',
    color:       '#8030a0',
    category:    'strategic',
    description: 'Your lord\'s reputation precedes them. Enemy forces enter battle with 10 less morale.',
    hint:        'Best for Dark Lords & aggressors',
    effects: {
      defenderMoraleMalus: 10,
    },
  },

  scholar: {
    id:          'scholar',
    name:        'Scholar',
    icon:        '📚',
    color:       '#9040c0',
    category:    'strategic',
    description: 'Your lord reflects deeply on every experience. All XP earned from quests, battles, and actions increased by 20%.',
    hint:        'Best for fast leveling',
    effects: {
      xpMultiplier: 1.2,
    },
  },

  drillmaster: {
    id:          'drillmaster',
    name:        'Drillmaster',
    icon:        '⚒',
    color:       '#c05040',
    category:    'strategic',
    description: 'Your lord runs relentless training regimens. Unit recruitment time reduced by 30%.',
    hint:        'Best for rapid army expansion',
    effects: {
      recruitTimeMult: 0.7,
    },
  },
};

// =============================================
//  MOUNT_POOL — Unlocked at level 5. A lord may equip exactly one
//  mount at a time, freely swappable (unlike talents, not permanent).
//  Each swap costs `cost` gold, deducted server-side.
//
//  image  → path to mount artwork (assets/mounts/...), shown instead
//           of the icon when present; icon remains the fallback.
//  effects keys are flat bonuses added directly onto the lord's
//  effective stats (LordService.getEffectiveStats) — same keys as
//  LORD_BASE_STATS (health, attack, defense, leadership, magic, speed).
// =============================================

var MOUNT_POOL = {
  warhorse: {
    id:          'warhorse',
    name:        'Warhorse',
    icon:        '🐎',
    image:       null,
    color:       '#c8933a',
    description: 'A sturdy battle-trained warhorse. Balanced power and mobility for any lord.',
    cost:        400,
    effects: {
      attack: 2,
      speed:  2,
    },
  },

  dire_wolf: {
    id:          'dire_wolf',
    name:        'Dire Wolf',
    icon:        '🐺',
    image:       null,
    color:       '#4070d0',
    description: 'A massive wolf bred for speed and ambush tactics. Outruns any pursuer.',
    cost:        700,
    effects: {
      attack: 1,
      speed:  4,
    },
  },

  griffon: {
    id:          'griffon',
    name:        'Griffon',
    icon:        '🦅',
    image:       null,
    color:       '#30a0b0',
    description: 'A majestic aerial predator, striking from above with deadly talons.',
    cost:        1200,
    effects: {
      attack:  3,
      defense: 1,
    },
  },

  armored_boar: {
    id:          'armored_boar',
    name:        'Armored Boar',
    icon:        '🐗',
    image:       null,
    color:       '#8030a0',
    description: 'A tusked war-boar clad in iron plate. Slow to provoke, brutal in the charge.',
    cost:        900,
    effects: {
      attack:  2,
      defense: 3,
    },
  },
};
