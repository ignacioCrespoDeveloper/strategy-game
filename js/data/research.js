// =============================================
//  research.js — Library research catalog ("books")
//
//  The Library is the research lab (OGame-style): each book is an
//  empire-wide research line with levels, researched one at a time.
//
//  Fields:
//    tier          → gates availability by the player's HIGHEST Library
//                    level across all cities (RESEARCH_TIERS below)
//    maxLevel      → book level cap
//    cost(level)   → { food, wood, stone } — paid from the empire pool
//    researchTime(level) → seconds
//    bonuses(level)→ cumulative flat bonus keys at that level, same
//                    grammar as races.js — read via
//                    EconomyCore.getResearchEffects(player.research):
//      *_production       → % resource production (additive with race)
//      construction_speed → % build time (negative = faster)
//      march_food_cost    → % march food cost (negative = cheaper)
//      recruit_speed      → % recruit time (negative = faster)
//
//  State lives on the player:
//    player.research      = { bookId: level }
//    player.researchQueue = [{ bookId, targetLevel, startedAt, finishAt }]
//
//  Design rule (keep it!): the Library owns ECONOMY / LOGISTICS /
//  UNLOCKS. Combat-stat bonuses belong to lord talents, morale/tempo
//  buffs to Temple blessings — never stack a third combat-power system
//  in here.
//
//  Catalog trimmed 2026-07-29 to these two while the progression is
//  re-tuned: the three *_production tomes and Drill Manuals were cut,
//  and both survivors dropped to tier 1 so the Library is useful the
//  moment it is built. RESEARCH_TIERS keeps tiers 2 and 3 defined for
//  the books coming next — a new book only needs a `tier` to use them.
// =============================================

// Research cost/time curve: base · 1.8^(level-1)
const _rscale = (base, level) => Math.floor(base * Math.pow(1.8, level - 1));

// tier → required Library level (highest library across the empire)
var RESEARCH_TIERS = { 1: 1, 2: 4, 3: 8 };

var RESEARCH_DEFS = {

  // ── Tier 1 — Library Lv 1 ───────────────────────────────────────

  engineering_tomes: {
    id:          'engineering_tomes',   // id kept: renaming it would orphan
                                        // every player's researched levels
    name:        'Slave Chronicles',
    icon:        gi('hammer-nails'),
    image:       'assets/tomes/EngineeringTomes.webp',
    tier:        1,
    maxLevel:    5,
    description: 'Ledgers of every gang, quarry and work-song since the first stone was dressed. Read them and your overseers know exactly how many bodies a wall costs — each volume cuts construction time in every city.',
    cost:         level => ({ wood: _rscale(1200, level), stone: _rscale(900, level), food: _rscale(400, level) }),
    researchTime: level => _rscale(1200, level),
    // Re-tuned 2026-07-29 alongside Cartography: was −4%/level (−20% at
    // cap), which stacked with the dwarf bonus and the Town Hall divisor
    // into near-instant builds. Now an odd ladder — 1/3/5/7/9% — so the
    // first volume is a nudge and the cap is under half what it was.
    bonuses:      level => ({ construction_speed: -0.01 * (2 * level - 1) }),
  },

  cartography: {
    id:          'cartography',
    name:        'Cartography',
    icon:        gi('treasure-map'),
    image:       'assets/tomes/CartographyTomes.webp',
    tier:        1,
    maxLevel:    7,
    description: 'Surveyed roads and provisioning charts. Each volume cuts the food cost of marching between tiles.',
    // Re-tuned 2026-07-29: was 5 levels of −8% (−40% total) for a token
    // stone/food price — the cheapest tome in the catalog also gutted the
    // single logistics cost that limits how far armies roam. Now 7 levels
    // of −1% (−7% total), and the survey work is paid for in quarried
    // stone and provisions rather than pocket change.
    cost:         level => ({ wood: _rscale(900, level), stone: _rscale(1800, level), food: _rscale(2400, level) }),
    researchTime: level => _rscale(1200, level),
    bonuses:      level => ({ march_food_cost: -0.01 * level }),
  },
};
