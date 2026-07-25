// =============================================
//  traits.js — Reusable passive trait definitions
//
//  Traits describe HOW a unit fights.
//  They are passive — they activate automatically during specific
//  battle phases when the combat engine resolves them.
//
//  Structure per trait:
//    id          → unique snake_case key
//    name        → display name
//    description → player-facing description of the effect
//    hook        → dot-path the combat engine will call (future)
//                  format: "phase.action"
//
//  Adding a trait: add an entry here, then reference its id
//  in a unit's `traits` array inside UNIT_DEFS.
//  The combat engine reads `unit.traits`, looks each one up here,
//  and dispatches to `hook`. No other files change.
// =============================================

const TRAIT_DEFS = {

  // ── Defensive ─────────────────────────────────────────────────

  shield_wall: {
    id:          'shield_wall',
    name:        'Shield Wall',
    description: 'Reduces incoming melee damage while holding the frontline.',
    hook:        'onFrontlinePhase.reduceMeleeDamageTaken',
  },

  anti_large: {
    id:          'anti_large',
    name:        'Anti-Large',
    description: 'Deals bonus damage against Large and Monster units.',
    hook:        'onAttack.bonusVsLarge',
  },

  guardian: {
    id:          'guardian',
    name:        'Guardian',
    description: 'Intercepts attacks directed at nearby friendly ranged units.',
    hook:        'onDefend.interceptAttacksOnRanged',
  },

  regeneration: {
    id:          'regeneration',
    name:        'Regeneration',
    description: 'Restores a portion of HP at the end of each battle round.',
    hook:        'onRoundEnd.healHP',
  },

  // ── Offensive ─────────────────────────────────────────────────

  bloodlust: {
    id:          'bloodlust',
    name:        'Bloodlust',
    description: 'Deals increased damage against wounded (below 50% HP) enemies.',
    hook:        'onAttack.bonusVsWounded',
  },

  armor_piercing: {
    id:          'armor_piercing',
    name:        'Armor Piercing',
    description: 'Ignores a portion of the target\'s armor value.',
    hook:        'onAttack.ignoreArmor',
  },

  frenzy: {
    id:          'frenzy',
    name:        'Frenzy',
    description: 'Gains increasing Attack bonus each round as the battle continues.',
    hook:        'onRoundStart.incrementAttackBonus',
  },

  charge: {
    id:          'charge',
    name:        'Charge',
    description: 'Deals heavy bonus damage on the initial Cavalry Charge phase.',
    hook:        'onCavalryPhase.bonusDamage',
  },

  fire_attack: {
    id:          'fire_attack',
    name:        'Fire Attack',
    description: 'Attacks apply fire damage, ignoring regeneration effects.',
    hook:        'onAttack.applyFireDamage',
  },

  // ── Mobility ──────────────────────────────────────────────────

  fast: {
    id:          'fast',
    name:        'Fast',
    description: 'Acts before slower units each round; higher initiative order.',
    hook:        'onRoundStart.higherInitiative',
  },

  flanker: {
    id:          'flanker',
    name:        'Flanker',
    description: 'Bypasses the enemy frontline to target backline units.',
    hook:        'onTargetSelect.preferBackline',
  },

  scout: {
    id:          'scout',
    name:        'Scout',
    description: 'Expands the lord\'s search range during world exploration.',
    hook:        'onWorldSearch.increaseSearchRange',
  },

  flying: {
    id:          'flying',
    name:        'Flying',
    description: 'Can bypass enemy formation entirely to strike any target.',
    hook:        'onTargetSelect.ignoreFormation',
  },

  // ── Morale ────────────────────────────────────────────────────

  fear: {
    id:          'fear',
    name:        'Fear',
    description: 'Causes dread — reduces enemy morale at the start of battle.',
    hook:        'onBattleStart.reduceEnemyMorale',
  },

  terror: {
    id:          'terror',
    name:        'Terror',
    description: 'Overwhelming dread — may force enemy units to rout before combat begins.',
    hook:        'onBattleStart.causeTerrorCheck',
  },

  // ── Weaknesses ────────────────────────────────────────────────

  fragile: {
    id:          'fragile',
    name:        'Fragile',
    description: 'Poorly armored — receives additional damage from melee attacks.',
    hook:        'onFrontlinePhase.increaseMeleeDamageTaken',
  },

  dodge: {
    id:          'dodge',
    name:        'Dodge',
    description: 'Small chance to fully avoid an incoming melee attack each round.',
    hook:        'onDefend.chanceToEvade',
  },

  // ── Size / Type markers (passive state, readable by combat) ──

  large: {
    id:          'large',
    name:        'Large',
    description: 'This unit is Large — vulnerable to Anti-Large attacks.',
    hook:        'onReceiveDamage.vulnerableToAntiLarge',
  },

  monster: {
    id:          'monster',
    name:        'Monster',
    description: 'A monstrous creature — naturally causes Fear.',
    hook:        'onBattleStart.inherentFear',
  },

  // ── Ranged ────────────────────────────────────────────────────

  ranged: {
    id:          'ranged',
    name:        'Ranged',
    description: 'Attacks during the Ranged Volley phase before melee engagement.',
    hook:        'onRangedPhase.dealDamage',
  },

  // ── Formation ─────────────────────────────────────────────────

  frontline: {
    id:          'frontline',
    name:        'Frontline',
    description: 'Stands at the front of the formation — enemy melee attacks target Frontline units first, shielding those behind.',
    hook:        'onTargetSelect.frontlinePriority',
  },

  // ── Discipline / Morale ──────────────────────────────────────

  discipline: {
    id:          'discipline',
    name:        'Discipline',
    description: 'Well-drilled and steady under fire — more resistant to morale loss.',
    hook:        'onMoralePhase.reduceMoraleLossTaken',
  },

  stubborn: {
    id:          'stubborn',
    name:        'Stubborn',
    description: 'Refuses to break — significantly more resistant to retreat once morale is faltering.',
    hook:        'onMoralePhase.resistRetreat',
  },

  fearless: {
    id:          'fearless',
    name:        'Fearless',
    description: 'Immune to Fear and Terror — never suffers the pre-battle morale penalty from them.',
    hook:        'onBattleStart.immuneToFearTerror',
  },

  coward: {
    id:          'coward',
    name:        'Coward',
    description: 'Prone to fleeing — more likely to break and retreat once the fight turns against it.',
    hook:        'onMoralePhase.increasedRetreatChance',
  },

  mercenary: {
    id:          'mercenary',
    name:        'Mercenary',
    description: 'Fights only for coin, not loyalty — raises the whole side\'s chance to retreat once morale starts slipping.',
    hook:        'onMoralePhase.raiseSideRetreatChance',
  },

  // ── Combat / Special ─────────────────────────────────────────

  heavy_armor: {
    id:          'heavy_armor',
    name:        'Heavy Armor',
    description: 'Exceptionally well-armored — sharply reduces damage from attacks that aren\'t Armor Piercing.',
    hook:        'onReceiveDamage.reduceNonApDamage',
  },

  veteran: {
    id:          'veteran',
    name:        'Veteran',
    description: 'Battle-hardened from countless campaigns — fights more effectively than a fresh recruit.',
    hook:        'onAttack.veteranBonus',
  },

  berserk: {
    id:          'berserk',
    name:        'Berserk',
    description: 'Fights with reckless fury — deals increasing damage the more wounded it becomes.',
    hook:        'onAttack.bonusWhenWounded',
  },

  duelist: {
    id:          'duelist',
    name:        'Duelist',
    description: 'A master of single combat — deals bonus damage against enemy heroes and champions.',
    hook:        'onAttack.bonusVsHeroes',
  },

  aggressive: {
    id:          'aggressive',
    name:        'Aggressive',
    description: 'Eager for battle — gains an attack bonus in the opening rounds of combat.',
    hook:        'onRoundStart.earlyRoundAttackBonus',
  },

  impact: {
    id:          'impact',
    name:        'Impact',
    description: 'A charge that knocks enemy formations off balance, disrupting their footing.',
    hook:        'onCavalryPhase.knockbackBonus',
  },

  poison: {
    id:          'poison',
    name:        'Poison',
    description: 'Venomous attacks that keep damaging the target after the initial hit.',
    hook:        'onAttack.applyPoisonDamageOverTime',
  },

  accurate: {
    id:          'accurate',
    name:        'Accurate',
    description: 'Rarely misses — improved chance to strike true at range.',
    hook:        'onRangedPhase.improvedAccuracy',
  },

  // ── Siege ─────────────────────────────────────────────────────

  artillery: {
    id:          'artillery',
    name:        'Artillery',
    description: 'Heavy siege weaponry — devastating firepower, but slow and vulnerable up close.',
    hook:        'onRangedPhase.artilleryDamage',
  },

  siege: {
    id:          'siege',
    name:        'Siege',
    description: 'Built to break fortifications — deals bonus damage against defended positions.',
    hook:        'onAttack.bonusVsFortifications',
  },

  splash_damage: {
    id:          'splash_damage',
    name:        'Splash Damage',
    description: 'Ranged attacks hit an area, damaging multiple enemy models at once.',
    hook:        'onRangedPhase.areaOfEffectDamage',
  },

};
