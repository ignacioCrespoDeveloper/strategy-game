// =============================================
//  abilities.js — Active ability definitions
//
//  Abilities are different from Traits:
//    Traits  → passive, always active during their hook phase
//    Abilities → activate once during a specific named battle phase
//
//  Structure per ability:
//    id          → unique snake_case key
//    name        → display name
//    description → player-facing description of the effect
//    phase       → which battle phase triggers this ability
//                  (future combat engine dispatches by phase name)
//    targetMode  → 'single' | 'aoe' | 'backline' | 'self'
//    hook        → dot-path the combat engine will call (future)
//
//  Battle phases (planned order):
//    1. pre_battle        → morale checks, terror, buffs
//    2. ranged_volley     → ranged units fire
//    3. cavalry_charge    → cavalry charge bonus
//    4. melee_frontline   → main melee exchange
//    5. special_abilities → unique unit abilities fire here
//    6. post_round        → regeneration, frenzy increments
//
//  Adding an ability: add an entry here, then reference its id
//  in a unit's `abilities` array inside UNIT_DEFS.
// =============================================

const ABILITY_DEFS = {

  fire_breath: {
    id:          'fire_breath',
    name:        'Fire Breath',
    description: 'The War Hydra exhales a torrent of flame, dealing heavy fire damage to a single enemy unit.',
    phase:       'special_abilities',
    targetMode:  'single',
    hook:        'onSpecialAbilitiesPhase.dealHeavyFireDamageSingle',
  },

  dragon_breath: {
    id:          'dragon_breath',
    name:        'Dragon Breath',
    description: 'The Black Dragon unleashes a devastating blast of fire that scorches multiple enemy units simultaneously.',
    phase:       'special_abilities',
    targetMode:  'aoe',
    hook:        'onSpecialAbilitiesPhase.dealMassiveFireDamageAoE',
  },

  sky_dive: {
    id:          'sky_dive',
    name:        'Sky Dive',
    description: 'The Black Dragon plummets from the sky onto the enemy backline, bypassing all frontline units to strike support and ranged targets.',
    phase:       'special_abilities',
    targetMode:  'backline',
    hook:        'onSpecialAbilitiesPhase.strikeEnemyBackline',
  },

};
