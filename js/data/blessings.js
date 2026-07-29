// =============================================
//  blessings.js — Temple blessings catalog ("divine favor")
//
//  The Temple is the devotion building. Owning a Temple unlocks the
//  blessing system; a player may consecrate exactly ONE blessing at a
//  time. Each consecration pays a GOLD offering and lasts a duration the
//  PLAYER CHOOSES, then lapses. All races share the SAME blessings —
//  this is a universal divine layer, not a racial one.
//
//  Temple level = how many HOURS you may buy (2026-07-29). Level 1 can
//  only consecrate a 1-hour rite; level 2 unlocks 1h or 2h; level 5
//  unlocks anything up to 5h, and so on. The Temple no longer dictates
//  the duration — it raises the ceiling and you pick underneath it. Gold
//  is charged per hour, so a longer rite simply costs proportionally
//  more and there is never a reason to feel punished for a small Temple.
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
//    quest_bonus       → % extra gold + resources from expedition finds
//                        (server/tick/catch-up.js, the reward apply loop)
//    recruit_speed     → % recruit time, negative = faster (same key the
//                        Library's books use; recruit.js sums both)
//    gold_income_bonus → % extra passive gold income — no blessing grants
//                        this today (God of Commerce was pulled 2026-07-29);
//                        the consumers stay so re-adding it is data-only
//    *_production      → % resource production (additive with race/research)
//    pop_growth_bonus  → % population growth (positive growth only)
//
//  State lives on the player (empire-wide, like research):
//    player.activeBlessing = { id, startedAt, finishAt } | null
// =============================================

// Temple level that unlocks the blessing system (owning any Temple).
var BLESSING_MIN_TEMPLE = 1;

// Gold per hour of favor. A 1h rite at Temple 1 costs this; a 5h rite at
// Temple 5 costs 5×. Linear on purpose — no bulk discount, no bulk
// penalty, so the choice is purely "how long do I want this on for".
var BLESSING_GOLD_PER_HOUR = 1250;

// How many hours the player may buy, from their HIGHEST Temple level
// across all cities (mirrors how research keys off the highest Library).
function blessingMaxHours(templeLevel) {
  return Math.max(1, Math.floor(templeLevel || 1));
}

// Active duration in SECONDS for a chosen number of hours.
function blessingDuration(hours) {
  return Math.max(1, Math.floor(hours || 1)) * 3600;
}

// Gold offering for a chosen number of hours.
//   1h → 1,250 · 3h → 3,750 · 8h → 10,000 · 12h → 15,000
function blessingCost(hours) {
  return Math.max(1, Math.floor(hours || 1)) * BLESSING_GOLD_PER_HOUR;
}

var BLESSING_DEFS = {

  god_of_war: {
    id:          'god_of_war',
    name:        'God of War',
    icon:        gi('crossed-swords'),
    image:       'assets/blessings/godofwar.webp',
    description: 'The war-god feasts on conquest. When your lord storms an enemy city and wins, your soldiers strip its stores bare — and back home the muster-yards never sleep, turning out fresh companies while the favour holds.',
    summary:     '+50% resources & gold plundered when you sack an enemy city · −20% recruit time',
    effects:     { battle_loot_bonus: 0.50, recruit_speed: -0.20 },
  },

  god_of_destruction: {
    id:          'god_of_destruction',
    name:        'God of Destruction',
    icon:        gi('battle-axe'),
    image:       'assets/blessings/godofdestruction.webp',
    description: 'Ruin follows in your wake. Raiding parties burn and pillage with abandon, and scouts sent into the wilds come back dragging whatever was not nailed down.',
    summary:     '+50% rewards from raiding · +30% gold & resources from expeditions',
    effects:     { raid_bonus: 0.50, quest_bonus: 0.30 },
  },

  // God of Commerce (gold_income_bonus 0.25) was pulled 2026-07-29 while the
  // blessing line-up is retuned. Its effect key is still honoured by
  // catch-up.js and production.js, so restoring it is a data-only change.

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
