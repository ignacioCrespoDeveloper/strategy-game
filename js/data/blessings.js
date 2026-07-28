// =============================================
//  blessings.js — Temple blessings catalog ("divine favor")
//
//  The Temple is the devotion building. Owning a Temple unlocks the
//  blessing system; a player may consecrate exactly ONE blessing at a
//  time. Each consecration pays a GOLD offering and lasts a
//  Temple-level-scaled duration, then lapses. All races share the SAME
//  five blessings — this is a universal divine layer, not a racial one.
//
//  Design rule (keep it!): the Library owns ECONOMY/LOGISTICS/UNLOCKS,
//  lord talents own COMBAT STATS, and Temple blessings own timed,
//  empire-wide ECONOMIC/TEMPO buffs you actively choose — never a flat
//  always-on stack. Only one active at a time is the whole point.
//
//  Effect keys (read via EconomyCore.getBlessingEffects(activeBlessing)):
//    battle_loot_bonus → % extra plunder (resources + gold) when your lord
//                        sacks an ENEMY CITY in PvP (combat-resolver.js)
//    raid_bonus        → % extra gold + resources from the raiding stance
//    gold_income_bonus → % extra passive gold income
//    *_production      → % resource production (additive with race/research)
//    pop_growth_bonus  → % population growth (positive growth only)
//
//  State lives on the player (empire-wide, like research):
//    player.activeBlessing = { id, startedAt, finishAt } | null
//
//  Duration & offering scale with the player's HIGHEST Temple level
//  across all cities (mirrors how research keys off the highest Library).
//  Both are single-line tunables below.
// =============================================

// Temple level that unlocks the blessing system (owning any Temple).
var BLESSING_MIN_TEMPLE = 1;

// Growth factor shared by both curves so the gold-per-hour of favor
// stays flat as Temples grow — bigger Temple, grander (but proportional) rite.
var _BLESSING_SCALE = 1.3;

// Active duration (seconds) for a given highest-Temple level: 2h × 1.3^(L-1).
//   L1 → 2h · L3 → ~3.4h · L5 → ~5.7h · L10 → ~21h
function blessingDuration(templeLevel) {
  const L = Math.max(1, templeLevel || 1);
  return Math.round(2 * 3600 * Math.pow(_BLESSING_SCALE, L - 1));
}

// Gold offering to consecrate, for a given highest-Temple level:
// 2500 gold × 1.3^(L-1) — climbs in lock-step with the duration so the
// gold-per-hour of favor stays flat as Temples grow.
//   L1 → 2500 · L3 → ~4225 · L5 → ~7140 · L10 → ~26512
function blessingCost(templeLevel) {
  const L = Math.max(1, templeLevel || 1);
  return Math.round(2500 * Math.pow(_BLESSING_SCALE, L - 1));
}

var BLESSING_DEFS = {

  god_of_war: {
    id:          'god_of_war',
    name:        'God of War',
    icon:        gi('crossed-swords'),
    image:       'assets/blessings/godofwar.webp',
    description: 'The war-god feasts on conquest. When your lord storms an enemy city and wins, your soldiers strip its stores bare — plundering far more of the defender\'s resources and gold.',
    summary:     '+50% resources & gold plundered when you sack an enemy city',
    effects:     { battle_loot_bonus: 0.50 },
  },

  god_of_destruction: {
    id:          'god_of_destruction',
    name:        'God of Destruction',
    icon:        gi('battle-axe'),
    image:       'assets/blessings/godofdestruction.webp',
    description: 'Ruin follows in your wake. Raiding parties burn and pillage with abandon, dragging back a heavier haul of plunder.',
    summary:     '+50% rewards from raiding',
    effects:     { raid_bonus: 0.50 },
  },

  god_of_commerce: {
    id:          'god_of_commerce',
    name:        'God of Commerce',
    icon:        gi('two-coins'),
    image:       'assets/blessings/godofcommerce.webp',
    description: 'Coin flows where the god of trade smiles. Markets bustle, tithes swell, and your treasury fills faster.',
    summary:     '+25% gold income',
    effects:     { gold_income_bonus: 0.25 },
  },

  god_of_nature: {
    id:          'god_of_nature',
    name:        'God of Nature',
    icon:        gi('holy-oak'),
    image:       'assets/blessings/godofnature.webp',
    description: 'The land answers the old god. Forests, quarries and fields yield more to those who honour the wild.',
    summary:     '+25% resource production',
    effects:     { food_production: 0.25, wood_production: 0.25, stone_production: 0.25 },
  },

  god_of_fertility: {
    id:          'god_of_fertility',
    name:        'God of Fertility',
    icon:        gi('three-friends'),
    image:       'assets/blessings/godoffertality.webp',
    description: 'Cradles fill and hearths grow crowded. Under the fertility-god your cities swell with new citizens.',
    summary:     '+30% population growth',
    effects:     { pop_growth_bonus: 0.30 },
  },
};
