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
//  buffs to the (future) Temple blessings — never stack a third
//  combat-power system in here.
// =============================================

// Research cost/time curve: base · 1.8^(level-1)
const _rscale = (base, level) => Math.floor(base * Math.pow(1.8, level - 1));

// tier → required Library level (highest library across the empire)
var RESEARCH_TIERS = { 1: 1, 2: 4, 3: 8 };

var RESEARCH_DEFS = {

  // ── Tier 1 — Library Lv 1 ───────────────────────────────────────

  agronomy_tomes: {
    id:          'agronomy_tomes',
    name:        'Agronomy Tomes',
    icon:        gi('wheat'),
    image:       'assets/tomes/AgronomyTomes.webp',
    tier:        1,
    maxLevel:    5,
    description: 'Crop rotation, irrigation and husbandry. Each volume raises food production across your empire.',
    cost:         level => ({ wood: _rscale(400, level), stone: _rscale(200, level), food: _rscale(100, level) }),
    researchTime: level => _rscale(300, level),
    bonuses:      level => ({ food_production: 0.04 * level }),
  },

  forestry_tomes: {
    id:          'forestry_tomes',
    name:        'Forestry Tomes',
    icon:        gi('wood-pile'),
    image:       'assets/tomes/ForestryTomes.webp',
    tier:        1,
    maxLevel:    5,
    description: 'Coppicing, seasoning and sawmill technique. Each volume raises wood production across your empire.',
    cost:         level => ({ wood: _rscale(300, level), stone: _rscale(250, level), food: _rscale(150, level) }),
    researchTime: level => _rscale(300, level),
    bonuses:      level => ({ wood_production: 0.04 * level }),
  },

  masonry_tomes: {
    id:          'masonry_tomes',
    name:        'Masonry Tomes',
    icon:        gi('war-pick'),
    image:       'assets/tomes/MasonryTomes.webp',
    tier:        1,
    maxLevel:    5,
    description: 'Quarrying, dressing and load-bearing arches. Each volume raises stone production across your empire.',
    cost:         level => ({ wood: _rscale(350, level), stone: _rscale(150, level), food: _rscale(150, level) }),
    researchTime: level => _rscale(300, level),
    bonuses:      level => ({ stone_production: 0.04 * level }),
  },

  // ── Tier 2 — Library Lv 4 ───────────────────────────────────────

  engineering_tomes: {
    id:          'engineering_tomes',
    name:        'Engineering Tomes',
    icon:        gi('hammer-nails'),
    image:       'assets/tomes/EngineeringTomes.webp',
    tier:        2,
    maxLevel:    5,
    description: 'Cranes, scaffolds and formwork. Each volume cuts construction time in every city.',
    cost:         level => ({ wood: _rscale(1200, level), stone: _rscale(900, level), food: _rscale(400, level) }),
    researchTime: level => _rscale(1200, level),
    bonuses:      level => ({ construction_speed: -0.04 * level }),
  },

  cartography: {
    id:          'cartography',
    name:        'Cartography',
    icon:        gi('treasure-map'),
    image:       'assets/tomes/CartographyTomes.webp',
    tier:        2,
    maxLevel:    5,
    description: 'Surveyed roads and provisioning charts. Each volume cuts the food cost of marching between tiles.',
    cost:         level => ({ wood: _rscale(900, level), stone: _rscale(600, level), food: _rscale(800, level) }),
    researchTime: level => _rscale(1200, level),
    bonuses:      level => ({ march_food_cost: -0.08 * level }),
  },

  // ── Tier 3 — Library Lv 8 ───────────────────────────────────────

  drill_manuals: {
    id:          'drill_manuals',
    name:        'Drill Manuals',
    icon:        gi('crossed-swords'),
    tier:        3,
    maxLevel:    5,
    description: 'Standardized drills and muster rolls. Each volume cuts unit recruitment time in every city.',
    cost:         level => ({ wood: _rscale(3000, level), stone: _rscale(2200, level), food: _rscale(1600, level) }),
    researchTime: level => _rscale(3600, level),
    bonuses:      level => ({ recruit_speed: -0.04 * level }),
  },
};
