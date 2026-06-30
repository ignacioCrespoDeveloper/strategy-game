// =============================================
//  data/bloodlines.js — Bloodline heritage stubs
//
//  Bloodlines represent supernatural (or near-supernatural) hereditary
//  gifts. They are exceedingly rare — most leaders have none.
//
//  The world is low fantasy: dragons exist only in legend, magic is
//  exceptional. These bloodlines are whispered history, not daily reality.
//
//  Architecture only — no gameplay effects implemented yet.
//  Future hooks: lifespan, event pool, succession rules, special abilities.
// =============================================

const BLOODLINES = {

  none: {
    id:          'none',
    name:        'Common Blood',
    rarity:      'common',
    description: 'No supernatural heritage. The blood of a common man or woman who earned their place through talent, ambition, and survival.',
    isLegendary: false,
    // Future: all modifiers at 0, no special events
  },

  ancient_blood: {
    id:          'ancient_blood',
    name:        'Ancient Blood',
    rarity:      'rare',
    description: 'Lineage traced to the first lords of the old world. Not supernatural — merely old. Old enough that the blood carries echoes of a time when the world\'s rules were not yet fully written.',
    isLegendary: false,
    loreNote:    'Ancient Blood families have longer genealogical records, broader diplomatic recognition, and — according to those who carry it — occasional moments of uncanny clarity about future events that they never discuss publicly.',
    // Future: small legitimacy bonus, occasional foresight events
  },

  royal_blood: {
    id:          'royal_blood',
    name:        'Royal Blood',
    rarity:      'uncommon',
    description: 'Descended from a recognized royal line. Not mystical — political. The weight of expectation and the clarity of recognized succession that comes with an unbroken royal lineage.',
    isLegendary: false,
    loreNote:    'Royal Blood does not guarantee competence. It guarantees that when the bearer acts, others assume a reason behind it. This is worth more than most abilities in courts and councils.',
    // Future: diplomacy bonus, legitimacy bonus at game start
  },

  dragon_blood: {
    id:          'dragon_blood',
    name:        'Dragon Blood',
    rarity:      'legendary',
    description: 'The oldest and most disputed bloodline claim in the known world. No confirmed carrier has existed in recorded history. Ancient texts describe rulers who could walk through fire, whose presence silenced battlefields, whose words bound oaths that could not be broken.',
    isLegendary: true,
    loreNote:    'Three ruling families have claimed Dragon Blood in the last millennium. All three were eventually proven false — though two of them were extraordinarily effective rulers regardless, which suggests the claim carries power of its own kind.',
    // Future: legendary events, diplomatic weight, exceptional combat bonuses
    // Architecture note: no player house currently carries this bloodlineId
  },

  vampiric_blood: {
    id:          'vampiric_blood',
    name:        'The Dark Gift',
    rarity:      'legendary',
    description: 'A heritage spoken of in hushed voices in certain courts and denied emphatically by those suspected of carrying it. Neither fully human nor entirely other — something that extends life and sharpens the mind at costs that are never fully understood until it is too late to choose differently.',
    isLegendary: true,
    loreNote:    'The Church considers this bloodline heretical. Three noble families have been quietly monitored for signs of it for a century. None have been confirmed. The Church continues to monitor.',
    // Future: extreme intrigue bonuses, health events, church faction hostility
    // Architecture note: no player house currently carries this bloodlineId
  },
};
