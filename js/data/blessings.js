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
//    *_production      → % BUILDING resource output (additive with race/research,
//                        applied in EconomyCore.getRates)
//    resource_yield_bonus → % extra RESOURCES (never gold) from raiding and
//                        expeditions, in server/tick/catch-up.js. The companion
//                        to *_production: together they cover the whole resource
//                        pool, which is what a "+X% resources" blessing has to
//                        do to be worth its offering (buildings alone are ~24%)
//    pop_growth_bonus  → % population growth (positive growth only)
//
//  State lives on the player (empire-wide, like research):
//    player.activeBlessing = { id, startedAt, finishAt } | null
// =============================================

// Temple level that unlocks the blessing system (owning any Temple).
var BLESSING_MIN_TEMPLE = 1;

// Cost per hour of favor. A 1h rite at Temple 1 costs this; a 5h rite at
// Temple 5 costs 5×. Linear on purpose — no bulk discount, no bulk
// penalty, so the choice is purely "how long do I want this on for".
//
// Gold 1250 → 3000 and a RESOURCE cost added on 2026-07-30. The reasoning for
// the first half still holds: blessings are the ONLY unbounded, recurring sink
// in the game. Everything else terminates once bought, so this is the dial that
// stops the late economy flattening out.
//
// ⚠ THE PRICE LEVEL IS KNOWN WRONG AND IS SCHEDULED TO CHANGE.
// The resource half was added to "drain the most over-supplied pool" against an
// assumed ~190k gold/day that this file used to state as fact. At the real
// curve it does the opposite: full uptime costs 65% of ALL gold income and only
// 13% of resource income — a gold sink with a resource garnish, aimed at the
// wrong pool. Never restate an income figure here; run
// `node scripts/economy-projection.js`, which prints the curve AND a per-blessing
// PAYBACK verdict. Today that reads NEVER for god_of_fertility and TRADE at a
// terrible rate for god_of_nature (887 gold per 1,000 resources, where the
// merchant runs the reverse trade at ~50).
//
// Phase 2c of ECONOMY-REBALANCE-PLAN.md: charge each blessing in the currency it
// does NOT give you, cap full-uptime cost at ~25-30% of that currency's daily
// income, and widen *_production to all resource income. See ECONOMY-AUDIT.md §C.
// At full uptime this is currently 72,000 gold + 144,000 resources per day.
var BLESSING_GOLD_PER_HOUR = 1500;
var BLESSING_RES_PER_HOUR  = 3000; // per resource — wood AND stone AND food

// ── WHICH currency each blessing is charged in ──────────────────
//
// THE RULE: charge the currency the blessing does NOT give you. A blessing is
// a CONVERSION, so billing it in the same currency it produces is how
// god_of_nature ended up mathematically unable to break even — it was charged
// 144,000 resources/day to yield 75,000.
//
// Values are multipliers on the two base rates above, so the price level and
// the price MIX are separate dials. Full-uptime cost stays at ~25-30% of the
// charged currency's daily income (measure it: the PAYBACK section of
// scripts/economy-projection.js prints the net per blessing).
//
//   god_of_war         gives tempo + PvP loot  → gold
//   god_of_destruction gives gold AND resources → both
//   god_of_nature      gives resources          → gold (double, it pays no res)
//   god_of_fertility   gives population         → food (thematic: cradles eat grain)
//
// An unlisted blessing falls back to the old flat gold+all-three shape, so a
// new def is never accidentally free.
// Keys follow the canonical order — gold, then EconomyCore.RESOURCE_KEYS
// (wood → stone → food). blessingCost() returns the same shape, and the Temple
// tab renders it, so a food-first literal here surfaces as a food-first chip.
var BLESSING_COST_MIX = {
  god_of_war:         { gold: 1.0, wood: 0,   stone: 0,   food: 0   },
  god_of_destruction: { gold: 1.0, wood: 1.0, stone: 1.0, food: 1.0 },
  god_of_nature:      { gold: 2.0, wood: 0,   stone: 0,   food: 0   },
  god_of_fertility:   { gold: 0,   wood: 0,   stone: 0,   food: 2.0 },
};
var BLESSING_COST_MIX_DEFAULT = { gold: 1.0, wood: 1.0, stone: 1.0, food: 1.0 };

// How many hours the player may buy, from their HIGHEST Temple level
// across all cities (mirrors how research keys off the highest Library).
function blessingMaxHours(templeLevel) {
  return Math.max(1, Math.floor(templeLevel || 1));
}

// Active duration in SECONDS for a chosen number of hours.
function blessingDuration(hours) {
  return Math.max(1, Math.floor(hours || 1)) * 3600;
}

// Offering for a chosen number of hours OF A SPECIFIC BLESSING.
//
// ⚠ RETURNS AN OBJECT, not a number (changed 2026-07-30 when the resource cost
// was added). Every caller must read .gold / .wood / .stone / .food —
// a caller that still treats this as a scalar produces NaN or a free blessing.
//
// ⚠ TAKES A BLESSING ID (added 2026-07-30 with the cost-mix rework). Omitting it
// falls back to the flat gold+all-three shape, which is the DEAREST profile —
// so a caller that forgets the id overcharges rather than handing out a
// discount. Per hour, at the current rates:
//   god_of_war          1,500g
//   god_of_destruction  1,500g + 3,000 wood/stone/food
//   god_of_nature       3,000g
//   god_of_fertility    6,000 food
function blessingCost(hours, blessingId) {
  const h   = Math.max(1, Math.floor(hours || 1));
  const mix = (blessingId && BLESSING_COST_MIX[blessingId]) || BLESSING_COST_MIX_DEFAULT;
  return {
    gold:  Math.round(h * BLESSING_GOLD_PER_HOUR * (mix.gold  || 0)),
    wood:  Math.round(h * BLESSING_RES_PER_HOUR  * (mix.wood  || 0)),
    stone: Math.round(h * BLESSING_RES_PER_HOUR  * (mix.stone || 0)),
    food:  Math.round(h * BLESSING_RES_PER_HOUR  * (mix.food  || 0)),
  };
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
    description: 'The land answers the old god. Forests, quarries and fields yield more to those who honour the wild — and so does every wagon your lords drag home.',
    summary:     '+25% to ALL resource income — production, raiding and expeditions alike',
    // The *_production keys cover BUILDING output (EconomyCore.getRates).
    // resource_yield_bonus covers the other two thirds — raid and expedition
    // RESOURCES, never gold — in server/tick/catch-up.js.
    //
    // WHY BOTH: buildings are only ~24% of resource income, so a
    // production-only blessing was boosting a quarter of the pool by 25% and
    // could not cover its own offering at any price. Widening the scope, not
    // cutting the price, is what makes this a real choice.
    effects:     {
      wood_production: 0.25, stone_production: 0.25, food_production: 0.25,
      resource_yield_bonus: 0.25,
    },
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
