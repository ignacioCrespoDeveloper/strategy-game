// =============================================
//  lord-classes.js — Lord class definitions
//
//  Every lord starts from LORD_BASE_STATS.
//  The chosen class applies permanent modifiers.
//
//  To add a new class: append an entry to LORD_CLASSES.
//  Nothing else changes.
// =============================================

const LORD_BASE_STATS = {
  health:     100,
  attack:     5,
  defense:    5,
  leadership: 5,
  magic:      5,
  speed:      5,
};

// Soft display maximums for progress bars — not hard caps.
const LORD_STAT_MAX = {
  health:     200,
  attack:     20,
  defense:    20,
  leadership: 20,
  magic:      20,
  speed:      20,
};

// Icon, colour and label for each stat — consumed by all UI components.
const LORD_STAT_META = {
  health:     { label: 'Health',     icon: '❤',  color: '#4aaa4a' },
  attack:     { label: 'Attack',     icon: '⚔',  color: '#c05040' },
  defense:    { label: 'Defense',    icon: '🛡',  color: '#4070d0' },
  leadership: { label: 'Leadership', icon: '👑',  color: '#c8933a' },
  magic:      { label: 'Magic',      icon: '✨',  color: '#9040c0' },
  speed:      { label: 'Speed',      icon: '💨',  color: '#30a0b0' },
};

const LORD_CLASSES = {
  warrior: {
    id:          'warrior',
    name:        'Warrior',
    icon:        '⚔',
    color:       '#c05040',
    portrait:    'assets/lord/warrior.jpg',
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
    portrait:    'assets/lord/rogue',
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
