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
//    cost(level)   → { wood, stone, food } — paid from the empire pool, and
//                    declared in that key order (EconomyCore.RESOURCE_KEYS)
//    researchTime(level) → seconds
//    bonuses(level)→ cumulative flat bonus keys at that level, same
//                    grammar as races.js — read via
//                    EconomyCore.getResearchEffects(player.research):
//      *_production       → % resource production (additive with race)
//      construction_speed → % build time (negative = faster)
//      march_food_cost    → % march food cost (negative = cheaper)
//      recruit_speed      → % recruit time (negative = faster)
//      travel_speed       → % lord march speed (positive = faster)
//      city_slots         → EXTRA cities the player may found (count, not %)
//      lord_slots         → EXTRA lords the player may recruit (count)
//      espionage_power    → scout-report intel level (count)
//
//  The last three are COUNTS, not percentages. getResearchEffects only
//  sums numbers, so they ride the same pipe — but read them as integers.
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
//
//  2026-08-03 — OGame price import. Four books now carry OGame's own
//  research costs verbatim, on OGame's own factor, with metal→wood,
//  crystal→stone and deuterium→food:
//    Cartography        = Hyperspace Drive        10k/20k/6k   ×2
//    Frontier Charters  = Astrophysics             4k/ 8k/4k   ×1.75
//    Codes of Command   = Computer Technology       0/400/600  ×2
//    Spymaster's Ledger = Espionage Technology    200/1k /200  ×2
//  Research TIME stays on the catalog's own 1.35 curve for all of them.
//  OGame's research times are tuned for a months-long round; on this
//  game's ~30–45 day arc a ×2 time curve would put a level-10 book a
//  week out on its own. Cost is the limiter here, exactly as it is for
//  buildings — see RESEARCH_COST_FACTOR below.
// =============================================

// Research cost/time curve: base · factor^(level-1).
//
// FACTOR 1.8 → 1.35 (2026-08-03, ECONOMY-REBALANCE-PLAN Phase 3a). Every book
// here pays an exponential cost for a LINEAR benefit, so cost per 1% of effect
// multiplied by the factor at every level: Engineering Tomes went 2,500
// resources per 1% of build speed at L1 to 247,949 at L10, i.e. volumes 5–10
// were never worth buying and the Library's whole tail was decoration. At 1.35
// the same ladder rises ~1.35× per level instead of 1.8×, which a growing
// economy can actually keep pace with.
//
// The factor is a parameter rather than a constant so a future book with a
// genuinely different shape can opt out without forking this helper.
const RESEARCH_COST_FACTOR = 1.35;
const _rscale = (base, level, factor) => Math.floor(base * Math.pow(factor ?? RESEARCH_COST_FACTOR, level - 1));

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
    // Cap removed 2026-07-30 — nothing in the game should carry a hardcoded
    // level ceiling (every building is already Infinity). The ×1.8/level cost
    // curve is the limiter now, exactly as it is for buildings. The effect is
    // still bounded: getBuildTime floors its multiplier at 0.2 (−80%).
    maxLevel:    Infinity,
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
    // Cap removed 2026-07-30 — see engineering_tomes. getMarchFoodCost floors
    // its multiplier at 0.2, so the effect stays bounded at −80% however many
    // volumes are bought.
    maxLevel:    Infinity,
    description: 'Surveyed roads, relay posts and provisioning charts. Each volume moves your lords faster between tiles — and shaves a little off what the march eats on the way.',
    // CONVERTED 2026-08-03 onto OGame's Hyperspace Drive, at Nacho's call.
    //
    // Decision 4 of ECONOMY-REBALANCE-PLAN asked for this and was shelved
    // because `travel_speed` had no consumer — getTravelTime read no research
    // key at all. That consumer now exists (EconomyCore.getTravelTime takes
    // opts.researchEffects), so the conversion is real rather than decorative.
    //
    // Drive maths, exactly as OGame does it: the bonus is ADDITIVE on the base
    // speed, so time = base ÷ (1 + 0.30·level). L1 is a third off, L5 is 2.5×
    // faster, and there is no compounding blow-up. getTravelTime floors the
    // multiplier at 0.2 (a hard ×5 speed ceiling, reached at L14), which is the
    // same floor getBuildTime / getRecruitTime / getMarchFoodCost all use.
    //
    // march_food_cost is KEPT alongside it (−1%/level) rather than dropped:
    // it is the game's only food-logistics discount, and the two effects are
    // the same fiction — a surveyed road is both quicker and cheaper to walk.
    // The premise for cutting it died in Tanda 2 anyway (the 500/tile march
    // food cap was removed, so the base it discounts grows with army size).
    //
    // Price is the Hyperspace Drive's, ×2 per level. This is an ~11× jump on
    // the old L1 (5,100 → 36,000 resources): the old book bought −1% of one
    // logistics line for pocket change, this one halves the map.
    cost:         level => ({ wood: _rscale(10000, level, 2), stone: _rscale(20000, level, 2), food: _rscale(6000, level, 2) }),
    researchTime: level => _rscale(1200, level),
    bonuses:      level => ({ travel_speed: 0.30 * level, march_food_cost: -0.01 * level }),
  },

  // ── The two expansion books (OGame Astrophysics + Computer Tech) ──
  //
  // These are the Library's THIRD job, the one the header has always claimed
  // and no book has ever done: UNLOCKS. Until 2026-08-03 the number of cities
  // and lords a player could hold were two flat constants (MAX_CITIES /
  // MAX_LORDS = 7) behind a doubling gold price, so the entire expansion arc
  // was "wait for gold" with no decision in it.
  //
  // Both are tier 1 ON PURPOSE. They gate core progression now — city #2 and
  // lord #2 are behind them — so parking them at Library 4 would wall a new
  // player off from the whole mid-game. Tier 1 means the wall is the Library
  // itself (Town Hall 3 → Library 1), which is a reachable opening project.
  //
  // Neither replaces the gold cost: research unlocks the SLOT, gold still buys
  // the city or the lord. That is OGame's own split (Astrophysics unlocks the
  // colony slot; you still pay for the colony ship) and it keeps the ~600k of
  // endgame gold demand that scripts/economy-projection.js is calibrated on.
  //
  // NO CEILING (Nacho's call, 2026-08-03). The old flat 7 is gone in both
  // directions — the doubling gold price and the ×1.75/×2 research curve are
  // the only limiters, so a player who genuinely out-earns everyone can hold
  // an 8th city. The 20×10 map is the real backstop and stays the Tanda 5
  // problem ("more map/galaxies + colonisation cost — one problem, not two").

  frontier_charters: {
    id:          'frontier_charters',
    name:        'Frontier Charters',
    icon:        gi('scroll-unfurled'),
    tier:        1,
    maxLevel:    Infinity,
    description: 'Writs of settlement, sealed and witnessed. Every charter your clerks can defend in court is another frontier your banners may legally claim — each grants the right to found a new city.',
    // OGame Astrophysics verbatim: 4k/8k/4k on ×1.75 — the one research in the
    // game that is NOT on a doubling curve, because the thing it sells (a whole
    // extra city) already compounds on its own.
    cost:         level => ({ wood: _rscale(4000, level, 1.75), stone: _rscale(8000, level, 1.75), food: _rscale(4000, level, 1.75) }),
    researchTime: level => _rscale(1800, level),
    // ceil(level / 2) — OGame's colony formula exactly. Every ODD level buys a
    // city, every even level is the down payment on the next: L1→+1, L3→+2,
    // L5→+3. Combined with the free first city that is 1, 2, 2, 3, 3, 4…
    bonuses:      level => ({ city_slots: Math.ceil(level / 2) }),
  },

  codes_of_command: {
    id:          'codes_of_command',
    name:        'Codes of Command',
    icon:        gi('crown'),
    tier:        1,
    maxLevel:    Infinity,
    description: 'Standing orders, seals of authority and the chain of command that carries them. Every volume is one more lord who can act in your name without your presence.',
    // OGame Computer Technology verbatim: 0 metal / 400 crystal / 600 deut on
    // ×2. The zero wood column is not an oversight — it is the original, and it
    // gives the catalog one book that never touches the timber economy.
    cost:         level => ({ stone: _rscale(400, level, 2), food: _rscale(600, level, 2) }),
    researchTime: level => _rscale(1500, level),
    // +1 lord per level, OGame's fleet-slot formula. With the free first lord
    // that is 1, 2, 3, 4… — a flatter ladder than the cities on purpose, since
    // a lord is the unit of ACTION and a city is the unit of income.
    bonuses:      level => ({ lord_slots: level }),
  },

  // ── Tier 2 — Library Lv 4 ───────────────────────────────────────
  //
  // The Library gated itself and nothing else while it held two books: both
  // were tier 1, so reaching Library 4 bought literally nothing. These two are
  // the ladder (Phase 3a, "add books on growing bases").
  //
  // Both keys were checked for a LIVE CONSUMER before being written, which is
  // the whole lesson of the flavor-traits debt: `*_production` is summed with
  // race and blessing bonuses in js/domain/production.js and in catch-up.js,
  // and `recruit_speed` is read by EconomyCore.getRecruitTime, which
  // server/actions/recruit.js calls. `gold_income_bonus` was the plan's third
  // candidate and is NOT here — getGoldRate never reads it, so a book built on
  // it would have been decoration.
  //
  // New ids on purpose: `agronomy_tomes` and `drill_manuals` are the retired
  // 2026-07-29 books, and test-economy.js asserts those ids resolve to nothing.

  husbandry_records: {
    id:          'husbandry_records',
    name:        'Husbandry Records',
    icon:        gi('wheat'),
    tier:        2,
    maxLevel:    Infinity,
    description: 'Generations of yields, weather and herd counts, kept by clerks who never held a plough. Farms that follow them waste nothing — every volume raises food production across the empire.',
    cost:         level => ({ wood: _rscale(2400, level), stone: _rscale(1200, level), food: _rscale(3000, level) }),
    researchTime: level => _rscale(2400, level),
    // A percentage of a base that grows with every farm level — legitimate on
    // an exponential cost curve (Rule 4). Deliberately food-only: it is the
    // scarcest producer and the one the farm rebase above is also aimed at.
    bonuses:      level => ({ food_production: 0.03 * level }),
  },

  drill_yards: {
    id:          'drill_yards',
    name:        'Drill Yards',
    icon:        gi('crossed-swords'),
    tier:        2,
    maxLevel:    Infinity,
    description: 'Standing grounds where every formation is rehearsed until it needs no orders. Each volume shortens the time a city takes to muster new troops.',
    cost:         level => ({ wood: _rscale(1800, level), stone: _rscale(2400, level), food: _rscale(1800, level) }),
    researchTime: level => _rscale(2400, level),
    // Recruit time scales with the unit's PWR, so a percentage saving grows as
    // the roster does. getRecruitTime floors its multiplier at 0.2, so this
    // stays bounded however many volumes are bought.
    bonuses:      level => ({ recruit_speed: -0.02 * level }),
  },

  spymasters_ledger: {
    id:          'spymasters_ledger',
    name:        "Spymaster's Ledger",
    icon:        gi('spy'),
    tier:        2,
    maxLevel:    Infinity,
    description: 'Names, debts and habits, kept in a hand only your spymaster reads. Each volume buys your scouts deeper access — and makes an enemy who reads less than you an open book.',
    // OGame Espionage Technology verbatim: 200/1,000/200 on ×2.
    cost:         level => ({ wood: _rscale(200, level, 2), stone: _rscale(1000, level, 2), food: _rscale(200, level, 2) }),
    researchTime: level => _rscale(1500, level),
    // A COUNT, not a percentage. The consumer is server/combat-resolver.js's
    // _gatherScoutReport, which compares the SCOUT'S level against the TARGET'S
    // and hands back a report tier — OGame counter-espionage, where what you
    // learn depends on how far ahead of them you are, not on your level alone.
    // See SCOUT_INTEL_TIERS there for the ladder itself.
    //
    // Symmetric at zero: two players who never buy this book scout each other
    // at diff 0, so nobody is behind until somebody invests. That is the whole
    // reason this is the only book in the catalog whose value is RELATIVE.
    bonuses:      level => ({ espionage_power: level }),
  },
};
