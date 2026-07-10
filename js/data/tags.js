// =============================================
//  tags.js — Unit type tags
//
//  Tags describe what a unit IS, not how it behaves.
//  They have no combat logic — they are labels.
//
//  The combat engine (and future UI filters) reads tags to:
//    - categorize units for display
//    - drive trait interactions (e.g. anti_large checks for 'large' tag)
//    - filter recruitment lists
//    - apply race-wide rules (e.g. "all Human units get +1 morale in home territory")
//
//  Adding a tag: add an entry here, then reference its id
//  in a unit's `tags` array inside UNIT_DEFS.
// =============================================

const TAG_DEFS = {

  // ── Unit class ────────────────────────────────────────────────

  infantry: {
    id:          'infantry',
    name:        'Infantry',
    description: 'Fights on foot in melee or at range.',
  },

  cavalry: {
    id:          'cavalry',
    name:        'Cavalry',
    description: 'Mounted unit. Benefits from charge attacks and flanking.',
  },

  monster: {
    id:          'monster',
    name:        'Monster',
    description: 'A powerful creature. Susceptible to anti-large effects.',
  },

  dragon: {
    id:          'dragon',
    name:        'Dragon',
    description: 'A legendary draconic creature. Also counts as Monster and Large.',
  },

  // ── Capabilities ─────────────────────────────────────────────

  ranged: {
    id:          'ranged',
    name:        'Ranged',
    description: 'Can attack during the Ranged Volley phase.',
  },

  flying: {
    id:          'flying',
    name:        'Flying',
    description: 'Moves through the air. Can bypass ground-based formations.',
  },

  large: {
    id:          'large',
    name:        'Large',
    description: 'A large-bodied unit. Vulnerable to Anti-Large trait.',
  },

  // ── Equipment ────────────────────────────────────────────────

  shield: {
    id:          'shield',
    name:        'Shield',
    description: 'Carries a shield. Can form defensive formations.',
  },

  // ── Species ──────────────────────────────────────────────────

  human: {
    id:          'human',
    name:        'Human',
    description: 'Humanoid unit (Dark Elf, Human, Dwarf, etc.).',
  },

  // ── Recruitment origin ────────────────────────────────────────

  mercenary: {
    id:          'mercenary',
    name:        'Mercenary',
    description: 'Hired for coin. No upkeep loyalty. Instant recruitment.',
  },

};
