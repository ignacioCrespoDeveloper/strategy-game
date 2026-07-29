// =============================================
//  races.js — Race definitions
//
//  Each race declares flat bonus keys.
//  Domain services (production, construction, etc.)
//  read these keys directly — no switch statements.
//
//  To add a new race: append an entry here. Nothing else changes.
// =============================================

var RACES = {
  human: {
    id:          'human',
    name:        'Human',
    icon:        gi('crown'),
    glyph:       '👑',
    portrait:    'assets/lord/humans/warrior/warrior1.jpg',
    portraitGlow: 'rgba(230, 180, 110, 0.32)',
    sampleUnits: ['greatswords', 'reiksguard'],
    description: 'Adaptable and industrious. Humans thrive in all climates and excel at commerce and construction. No single specialty — but no weakness either.',
    bonusLabel:  '+5% all resource production · −10% construction time',
    bonuses: {
      food_production:    0.05,
      wood_production:    0.05,
      stone_production:   0.05,
      construction_speed: -0.10,  // negative = faster
      population_growth:  0.00,
    },
  },

  dwarf: {
    id:          'dwarf',
    name:        'Dwarf',
    icon:        gi('war-pick'),
    glyph:       '⛏',
    portrait:    'assets/lord/dwarfs/warrior/warrior1.jpg',
    portraitGlow: 'rgba(210, 195, 165, 0.32)',
    sampleUnits: ['irondrakes', 'dwarf_cannon'],
    description: 'Masters of stone. Dwarven engineers build twice as fast as any other race, and their quarries run deeper than the roots of mountains.',
    bonusLabel:  '+30% stone · −20% construction time',
    bonuses: {
      food_production:    0.00,
      wood_production:    0.00,
      stone_production:   0.30,
      construction_speed: -0.20,
      population_growth:  0.00,
    },
  },

  orc: {
    id:          'orc',
    name:        'Orc',
    icon:        gi('battle-axe'),
    glyph:       '🪓',
    portrait:    'assets/lord/orcs/warrior/warrior1.jpg',
    portraitGlow: 'rgba(120, 200, 90, 0.32)',
    sampleUnits: ['black_orcs', 'trolls'],
    description: 'Relentless and vast in number. Orcish clans multiply faster than any other race and feed their hordes through unmatched agricultural toil. Strength in numbers.',
    bonusLabel:  '+25% population growth · +20% food production',
    bonuses: {
      food_production:    0.20,
      wood_production:    0.00,
      stone_production:   0.00,
      construction_speed: 0.00,
      population_growth:  0.25,
    },
  },

  high_elf: {
    id:          'high_elf',
    name:        'High Elves',
    icon:        gi('elf-helmet'),
    glyph:       '✨',
    portrait:    'assets/lord/high_elves/warrior/warrior1.jpg',
    portraitGlow: 'rgba(180, 220, 255, 0.35)',
    sampleUnits: ['dragon_princes', 'swordmasters_of_hoeth'],
    description: 'The firstborn of the Elves, masters of magic, diplomacy, and war in equal measure. High Elves produce the finest goods, construct in marble and mithril, and grow their society with patience born of centuries.',
    // Was '+20% culture · +15% food · −10% construction time'. `culture` is a
    // CITY stat (city-stats.js), never a race bonus key — that claim was
    // fabricated — and the label silently omitted the +10% wood players were
    // already getting. Now matches `bonuses` below exactly. NOTE: the 0.05
    // population_growth is deliberately still unlisted because nothing reads
    // that key yet; see ROADMAP.md "Dead race-bonus keys".
    bonusLabel:  '+15% food · +10% wood · −10% construction time',
    bonuses: {
      food_production:    0.15,
      wood_production:    0.10,
      stone_production:   0.00,
      construction_speed: -0.10,
      population_growth:  0.05,
    },
  },

  dark_elf: {
    id:          'dark_elf',
    name:        'Dark Elves',
    icon:        gi('evil-moon'),
    glyph:       '🌑',
    portrait:    'assets/lord/dark_elves/warrior/warrior1.jpg',
    portraitGlow: 'rgba(140, 40, 200, 0.35)',
    sampleUnits: ['black_guard_naggarond', 'war_hydra'],
    description: 'Exiled kin of the Elves, twisted by centuries in the deep. They bend shadow and dark wood to their will, fell entire forests for their cursed works, and breed faster than their surface cousins ever did.',
    bonusLabel:  '+30% wood · +15% population growth',
    bonuses: {
      food_production:    0.00,
      wood_production:    0.30,
      stone_production:   0.00,
      construction_speed: 0.00,
      population_growth:  0.15,
    },
  },
};
