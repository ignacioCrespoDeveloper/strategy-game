// =============================================
//  races.js — Race definitions
//
//  Each race declares flat bonus keys.
//  Domain services (production, construction, etc.)
//  read these keys directly — no switch statements.
//
//  To add a new race: append an entry here. Nothing else changes.
// =============================================

const RACES = {
  human: {
    id:          'human',
    name:        'Human',
    icon:        '👑',
    description: 'Adaptable and industrious. Humans thrive in all climates and excel at commerce and construction. No single specialty — but no weakness either.',
    bonusLabel:  '+5% all resource production · −10% construction time',
    bonuses: {
      food_production:    0.05,
      wood_production:    0.05,
      stone_production:   0.05,
      iron_production:    0.05,
      construction_speed: -0.10,  // negative = faster
      population_growth:  0.00,
    },
  },

  elf: {
    id:          'elf',
    name:        'Elf',
    icon:        '🌿',
    description: 'Ancient and patient. Elves command nature with ease, producing food and lumber far beyond other races. Their forests grow where others see barren land.',
    bonusLabel:  '+30% food production · +30% wood production',
    bonuses: {
      food_production:    0.30,
      wood_production:    0.30,
      stone_production:   0.00,
      iron_production:    0.00,
      construction_speed: 0.00,
      population_growth:  0.00,
    },
  },

  dwarf: {
    id:          'dwarf',
    name:        'Dwarf',
    icon:        '⛏',
    description: 'Masters of stone and iron. Dwarven engineers build twice as fast as any other race, and their mines run deeper than the roots of mountains.',
    bonusLabel:  '+30% stone & iron · −20% construction time',
    bonuses: {
      food_production:    0.00,
      wood_production:    0.00,
      stone_production:   0.30,
      iron_production:    0.30,
      construction_speed: -0.20,
      population_growth:  0.00,
    },
  },

  orc: {
    id:          'orc',
    name:        'Orc',
    icon:        '🪓',
    description: 'Relentless and vast in number. Orcish clans multiply faster than any other race and feed their hordes through unmatched agricultural toil. Strength in numbers.',
    bonusLabel:  '+25% population growth · +20% food production',
    bonuses: {
      food_production:    0.20,
      wood_production:    0.00,
      stone_production:   0.00,
      iron_production:    0.00,
      construction_speed: 0.00,
      population_growth:  0.25,
    },
  },

  vampire: {
    id:          'vampire',
    name:        'Vampire',
    icon:        '🦇',
    description: 'Ancient lords of the night. Vampires raise colossal stone fortresses and arm their thralls in iron, but have no use for harvests — their cities feed on souls, not grain.',
    bonusLabel:  '+30% stone · +20% iron · −50% food production',
    bonuses: {
      food_production:    -0.50,
      wood_production:     0.00,
      stone_production:    0.30,
      iron_production:     0.20,
      construction_speed: -0.10,
      population_growth:   0.00,
    },
  },

  dark_elf: {
    id:          'dark_elf',
    name:        'Dark Elf',
    icon:        '🌑',
    portrait:    'assets/lord/Malekith_3.webp',
    portraitGlow: 'rgba(140, 40, 200, 0.35)',
    description: 'Exiled kin of the Elves, twisted by centuries in the deep. They bend shadow and dark wood to their will, forge the finest iron in cursed furnaces, and breed faster than their surface cousins ever did.',
    bonusLabel:  '+30% iron · +20% wood · +15% population growth',
    bonuses: {
      food_production:    0.00,
      wood_production:    0.20,
      stone_production:   0.00,
      iron_production:    0.30,
      construction_speed: 0.00,
      population_growth:  0.15,
    },
  },
};
