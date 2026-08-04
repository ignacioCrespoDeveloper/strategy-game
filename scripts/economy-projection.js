// =============================================
//  economy-projection.js — Economy pacing model
//
//  Run:  node scripts/economy-projection.js
//        node scripts/economy-projection.js --days 40
//        node scripts/economy-projection.js --verbose   (per-day table)
//
//  Answers ONE question: how long does a daily-active player take to buy
//  everything the game asks for? The target agreed 2026-07-29 is 2–3 WEEKS
//  for CORE progression (lords + cities + armies + civic/military buildings),
//  with mounts and the apex building tier deliberately out of reach until well
//  after that.
//
//  WHY THIS EXISTS: the economy audit's first pass under-anchored endgame
//  income by ~10× and produced apex costs a mature empire clears in half a day.
//  Eyeballing "that looks expensive" is what produced the problem this script
//  measures. Re-run it after ANY cost or income change and check the verdicts.
//
//  EVERY number below is READ FROM THE REAL DEFS via server/engine-loader.js —
//  building costs, unit costs, mount prices, blessing prices, raid rates,
//  expedition bands, production curves. Nothing is hardcoded except the player
//  BEHAVIOUR model (how many expeditions a day, etc.), which is flagged as such
//  and is the only thing you should have to argue about.
// =============================================

import {
  BUILDING_DEFS, UNIT_DEFS, UNIT_ROSTER, RACES, EconomyCore,
  // LORD_POWER_LEVEL_CAP, not LORD_MAX_LEVEL: this is an INCOME model and every
  // income line (raid rate, expedition loot scalar, army PWR cap) freezes at
  // level 10. Levels 11–20 buy stats and talents, which this model does not
  // price — running the sim to 20 would print bigger level numbers against
  // identical gold and read as a bug.
  MOUNT_POOL, BLESSING_DEFS, blessingCost, LORD_POWER_LEVEL_CAP,
  lordArmyPowerCapBase, DiscoveryRoll,
  MarketCore, RESEARCH_DEFS, TUNING, tune,
} from '../server/engine-loader.js';
import { lordRecruitCost } from '../server/actions/lord-create.js';
import { cityFoundCost }   from '../server/actions/city-found.js';

// The server's MAX_LORDS / MAX_CITIES constants are GONE (2026-08-03) — both
// caps are bought from the Library now (Codes of Command / Frontier Charters)
// and are UNCAPPED, so there is no longer a number to import. This model needs
// a finite target to price a "finished" account against, so it states one:
// 7 of each, the value the constants held, which keeps every demand row below
// comparable to previous runs of this script.
//
// These are MODELLING ASSUMPTIONS, not game rules. The research needed to
// reach them is priced separately in RESEARCH_TARGETS below — before this,
// expansion cost only gold, so leaving that out would understate demand.
const MAX_LORDS  = 7;
const MAX_CITIES = 7;

// What the modelled account researches to reach those two targets:
//   7 cities  = 1 + ceil(L/2) → Frontier Charters 12
//   7 lords   = 1 + L         → Codes of Command 6
const RESEARCH_TARGETS = { frontier_charters: 12, codes_of_command: 6 };

// Cumulative resource cost of researching a book from 0 to `level`.
function cumulativeResearchCost(bookId, level) {
  const def = RESEARCH_DEFS[bookId];
  if (!def) return 0;
  let total = 0;
  for (let l = 1; l <= level; l++) {
    total += Object.values(def.cost(l)).reduce((s, v) => s + v, 0);
  }
  return total;
}

// ── CLI ────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
// --strict makes the PAYBACK gate fatal. It is OFF by default because the
// rebalance plan's Phase 2/3 are what make those rows pass; turning it on now
// would leave the script permanently red, which is how a warning gets ignored
// (the same reasoning test-economy.js applies to the tuning dials). Turn it on
// as the exit gate for Phase 2.
const STRICT  = argv.includes('--strict');
const DAYS    = (() => {
  const i = argv.indexOf('--days');
  return i >= 0 && argv[i + 1] ? Math.max(1, parseInt(argv[i + 1], 10) || 30) : 30;
})();
// The long-tail milestones (mount ladder, apex Lv3) land well past the default
// reporting window, so the simulation always runs far enough to DATE them even
// when only 30 days are printed. Reporting horizon and simulation horizon are
// deliberately different numbers.
const SIM_DAYS = Math.max(DAYS, 120);

// --dial key=value (repeatable) — run the model with a dial set to something
// other than what js/data/tuning.js ships, WITHOUT editing that file.
//
//   node scripts/economy-projection.js --dial travelTime=5
//   node scripts/economy-projection.js --dial travelTime=5 --dial questGold=0.8
//
// Rule 7 of ECONOMY-REBALANCE-PLAN.md says a dial change is verified by running
// this script. That was a lie of omission: you had to EDIT the shipped file to
// find out, which means the answer to "what would x5 travel time do" could only
// be had by first half-committing to it. Mutating TUNING here is safe because
// `tune()` reads the live object on every call and this process is throwaway.
//
// Every override is echoed in the DIALS section below, so a projection run with
// an override can never be mistaken for the shipped curve.
const DIAL_OVERRIDES = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--dial') continue;
  const [key, raw] = String(argv[i + 1] || '').split('=');
  const value      = Number(raw);
  if (!key || !isFinite(value) || value < 0) {
    console.error(`--dial expects key=number, got "${argv[i + 1]}"`);
    process.exit(2);
  }
  if (!(key in (TUNING || {}))) {
    console.error(`--dial: unknown dial "${key}". Known: ${Object.keys(TUNING || {}).join(', ')}`);
    process.exit(2);
  }
  DIAL_OVERRIDES[key] = value;
  TUNING[key] = value;
}

const fmt  = n => Math.round(n).toLocaleString('en-US');
const fmtK = n => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M'
              : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + 'k'
              : String(Math.round(n));
const bar  = (frac, width = 24) => {
  const f = Math.max(0, Math.min(1, frac || 0));
  return '█'.repeat(Math.round(f * width)).padEnd(width, '·');
};

// =============================================================
//  PART 1 — THE BEHAVIOUR MODEL (the only hardcoded assumptions)
// =============================================================
//
// A "daily-active" player: logs in a few times a day, keeps lords busy, runs
// expeditions while online and parks lords in the raid stance while offline.
// Deliberately NOT a whale playing 16 hours a day, and not an idler either.
//
// If the projection disagrees with observed play, THIS is the block to argue
// with first — the cost and income formulas come from the real defs and are
// not guesses.
//
// TWO PROFILES since 2026-07-31. Pacing targets are stated for a specific kind
// of player ("the first two mounts by day 13-15 for a HARDCORE player"), and
// judging that against a daily-active model is how you end up repricing
// something that was never mispriced. `--profile hardcore` switches the block
// below; every other number in this script is unchanged.
const PROFILE = (() => {
  const i = argv.indexOf('--profile');
  const v = i >= 0 && argv[i + 1] ? argv[i + 1] : 'daily';
  return (v === 'hardcore') ? 'hardcore' : 'daily';
})();

const BEHAVIOUR_DAILY = {
  // Hours per day a lord is actively driven on expeditions vs. left raiding.
  // Expeditions pay several times more per hour but need attention; the raid
  // stance is the offline channel. 4h active / 20h parked is a working player.
  activeHoursPerDay: 4,
  raidHoursPerDay:   20,

  // Expedition length used while actively playing. 'standard' = 15 min, so
  // 4 active hours ≈ 16 expeditions per lord per day.
  expeditionLength: 'standard',

  // Tile depletion: a player who moves between expeditions keeps payouts high;
  // one who re-rolls the same tile decays to ×0.40. Assume moderate movement.
  avgDepletion: 0.85,

  // Loudness penalty on payout. A composed scout force stays quiet (×1.0); a
  // maxed line army sits at ×0.65. Assume a middling force.
  avgLoudness: 0.35,

  // Share of expedition finds that pay resources rather than gold or nothing.
  // BASE_REWARDS is 11 resource defs / 9 gold defs, and the "nothing" weight
  // shrinks as ER rises, so ~45% resource / ~30% gold / ~25% dry is a fair
  // read of the roll for a mid-to-late force.
  findResourceShare: 0.45,
  findGoldShare:     0.30,

  // How much of the day a Temple blessing is running. It is the only unbounded
  // recurring sink, so uptime drives a large share of late demand.
  blessingUptime: 0.5,

  // Population a city settles at per city-tier step, used for gold income and
  // for the slot cap. Rough but only gold depends on it, and gold from cities
  // is a small channel next to raiding.
  // The 3,500/day here predates the 2026-08-03 status-ladder retune and now
  // agrees with it — it lands between Growing (3,000) and Prosperous (4,000).
  // Before that retune the engine was paying 14,376/day and this model was
  // the thing telling the truth.
  popByDay: day => Math.min(100000, 1000 + day * 3500),

  // How full a lord's army actually is, as a fraction of the PWR cap, and how
  // much scout weighting it carries (scouts count x2 for ER). THIS IS THE
  // MOST SENSITIVE ASSUMPTION IN THE WHOLE MODEL: it decides which ER band the
  // expedition rolls in, and the tier bands are 5x apart. A day-3 player has a
  // handful of units and no deliberate scouts; a week-2 player fields near the
  // cap and has learned to bring scouts.
  armyFillByDay:  day => Math.min(1.0,  0.25 + day * 0.05),
  scoutErByDay:   day => Math.min(1.45, 1.00 + day * 0.03),

  // Typical effective lord speed, and how many searches a player runs on one
  // tile before moving on (DEPLETION floors at x0.40 after 5). Together these
  // set the travel overhead per expedition, which is the only route by which
  // the travelTime dial touches income.
  lordSpeed:        6,
  searchesPerTile:  3,
};

// HARDCORE: the same game played hard, not a different game. Every delta below
// is a BEHAVIOUR a player can actually choose — more hours driving expeditions
// instead of parked, moving between tiles so payouts stay high, bringing scout
// comps so the force stays quiet, keeping a blessing up. Nothing here grants
// income the daily-active player cannot also earn; it is all effort.
const BEHAVIOUR_HARDCORE = {
  ...BEHAVIOUR_DAILY,
  activeHoursPerDay: 10,   // 4  — drives expeditions most of the waking day
  raidHoursPerDay:   14,   // 20 — still parks overnight (the two must sum to 24)
  avgDepletion:      0.95, // 0.85 — moves on instead of re-rolling a bare tile
  avgLoudness:       0.20, // 0.35 — deliberate scout composition
  searchesPerTile:   2,    // 3
  blessingUptime:    0.85, // 0.5
  // Fills the PWR cap sooner and learns the scout lever earlier. Same ceilings —
  // a hardcore player reaches the caps faster, they do not get higher ones.
  armyFillByDay:  day => Math.min(1.0,  0.35 + day * 0.09),
  scoutErByDay:   day => Math.min(1.45, 1.00 + day * 0.05),
};

const BEHAVIOUR = PROFILE === 'hardcore' ? BEHAVIOUR_HARDCORE : BEHAVIOUR_DAILY;

// Ramp: when the player can afford / bothers to add lords and cities. Derived
// from the expansion cost curve rather than asserted — a lord is added as soon
// as cumulative net gold could have paid for it (checked in the loop below).
const RACE = RACES.human; // +5% to all three resources; the median race.

// =============================================================
//  PART 2 — INCOME (all rates from EconomyCore / DiscoveryRoll)
// =============================================================

// Per-lord raid income per hour, straight from THE raid rate.
function raidPerHour(lordLevel) {
  return EconomyCore.getRaidHourlyRewards(lordLevel);
}

// Expected payout of ONE expedition, using the real tier bands, the real ER
// tier-odds distribution, and the real level/length/depletion/loudness scalars.
function expeditionExpected(lordLevel, erTierId) {
  const len       = DiscoveryRoll.lengthOf(BEHAVIOUR.expeditionLength);
  const tier      = DiscoveryRoll.RECRUIT_TIERS.find(t => t.id === erTierId)
                 || DiscoveryRoll.RECRUIT_TIERS[DiscoveryRoll.RECRUIT_TIERS.length - 1];
  const loudMult  = 1 - DiscoveryRoll.FOOTPRINT.reward * BEHAVIOUR.avgLoudness;
  const scalar    = (1 + DiscoveryRoll.LEVEL_SCALAR_PER_LEVEL * (lordLevel - 1))
                  * len.reward * BEHAVIOUR.avgDepletion * loudMult;

  // Expected band midpoint weighted by the tier-odds distribution (which sums
  // to 1 — it is a probability, not a weight; see RECRUIT_TIERS).
  let resMid = 0, goldMid = 0;
  for (const [tierNum, p] of Object.entries(tier.tierOdds)) {
    const range = DiscoveryRoll.TIER_RANGES[tierNum];
    if (!range || !p) continue;
    resMid  += p * (range.res[0]  + range.res[1])  / 2;
    goldMid += p * (range.gold[0] + range.gold[1]) / 2;
  }
  // The quest tuning dials are applied HERE because this function models the
  // payout rather than calling DiscoveryRoll.rollRewards (which is a random
  // draw). rollRewards applies the same two dials to the same bands — if that
  // ever changes, change it here too. Missing this made the projection blind to
  // the two biggest dials in the game, which is the worst possible time to be
  // blind: right when someone is tuning.
  //
  // DiscoveryRoll.RES_RATIO (the 3:2:1 wood/stone/food yield split) is the one
  // multiplier in rollRewards that is deliberately NOT mirrored here, and it is
  // not an oversight. This projection models resource income as a single lumped
  // number — it never asks which resource — and RES_RATIO's multipliers average
  // to exactly 1.0 across the three, with the catalog weighted so each turns up
  // about equally often (see js/data/discoveries.js). So the lump is unchanged
  // by it. Applying it here anyway would be double-counting. If this file ever
  // starts breaking resources out per type, that stops being true: multiply
  // each type's line by DiscoveryRoll.resYieldMult(type) at that point.
  return {
    resources: resMid  * scalar * BEHAVIOUR.findResourceShare * tune('questResources'),
    gold:      goldMid * scalar * BEHAVIOUR.findGoldShare     * tune('questGold'),
  };
}

// ER band a lord's army reaches. Army PWR is capped at 200 + level×80 (level
// frozen at 10), and the player fills that cap gradually (see armyFillByDay)
// with growing scout weighting (scouts count x2 for ER — the documented
// composition lever, see discovery-roll.js RECRUIT_TIERS).
function erTierFor(lordLevel, day) {
  const cap = lordArmyPowerCapBase(lordLevel);
  const er  = cap * BEHAVIOUR.armyFillByDay(day) * BEHAVIOUR.scoutErByDay(day);
  return { tierId: DiscoveryRoll.erTierFor(er).id, er };
}

// City production per hour, from the real building curves.
function cityProduction(buildings, population) {
  const bonuses = {};
  for (const r of ['wood', 'stone', 'food']) {
    bonuses[r + '_production'] = RACE.bonuses[r + '_production'] || 0;
  }
  const rates = EconomyCore.getRates(buildings, bonuses, null);
  const stats = EconomyCore.getStats(buildings, population, []);
  return {
    resources: rates.food + rates.wood + rates.stone,
    gold:      EconomyCore.getGoldRate(buildings, population, stats.happiness, stats.corruption),
  };
}

// Build order a player follows, cheapest-useful-first. The simulation buys the
// next level of whichever of these is cheapest that it can afford, so producer
// levels are EARNED from modelled income rather than assumed by date — an
// earlier version assumed L18 producers by day 25 and inflated endgame resource
// income by roughly 2x as a result.
const BUILD_ORDER = ['lumber_mill', 'stone_quarry', 'farm', 'town_hall', 'aqueduct', 'marketplace'];

function nextUpgradeCost(id, currentLevel) {
  const c = BUILDING_DEFS[id].cost(currentLevel + 1);
  return (c.food || 0) + (c.wood || 0) + (c.stone || 0);
}

// =============================================================
//  PART 3 — SINKS (all costs from the real defs)
// =============================================================

function cumulativeBuildingCost(id, toLevel) {
  const def = BUILDING_DEFS[id];
  if (!def) return 0;
  let total = 0;
  for (let l = 1; l <= toLevel; l++) {
    const c = def.cost(l);
    total += (c.food || 0) + (c.wood || 0) + (c.stone || 0);
  }
  return total;
}

// Cheapest full army for one lord at the PWR cap, priced with the real
// getUnitGoldCost. Uses the median human roster line so the number reflects
// what a player actually buys rather than a best case.
function armyCostAtCap(lordLevel) {
  const cap   = lordArmyPowerCapBase(lordLevel);
  const roster = UNIT_ROSTER.human || {};
  const ids   = new Set();
  for (const lvlMap of Object.values(roster)) {
    for (const list of Object.values(lvlMap)) list.forEach(id => ids.add(id));
  }
  const priced = [...ids]
    .map(id => UNIT_DEFS[id])
    .filter(d => d && d.goldCost > 0)
    .map(d => ({ gold: d.goldCost, pwr: EconomyCore.getUnitPower(d) }))
    .filter(u => u.pwr > 0);
  if (priced.length === 0) return 0;
  // Median gold-per-PWR across the roster × the cap.
  const rates = priced.map(u => u.gold / u.pwr).sort((a, b) => a - b);
  const median = rates[Math.floor(rates.length / 2)];
  return cap * median;
}

const MOUNTS = Object.values(MOUNT_POOL).sort((a, b) => a.unlockLevel - b.unlockLevel || a.cost - b.cost);
// One mount per unlock tier (the realistic purchase), cheapest in each tier.
const MOUNT_ONE_PER_TIER = (() => {
  const byTier = new Map();
  for (const m of MOUNTS) {
    if (!byTier.has(m.unlockLevel) || m.cost < byTier.get(m.unlockLevel).cost) byTier.set(m.unlockLevel, m);
  }
  return [...byTier.values()];
})();

// `fortress` LEFT THIS LIST on 2026-08-03 (Nacho's call). Its base was cut ÷10
// that day precisely so city defence would have a middle rung instead of
// "Guard Post or nothing" — at 320,000 it now sits an order of magnitude below
// the Imperial Palace (4.8M) and the Dragon Lair (6M), so counting it as apex
// made this milestone measure the cheapest thing in the list and report the
// tier as reachable a week early. It is a mid-tier defence building now, and
// the milestone measures the buildings that are still apex.
//
// It is deliberately NOT moved into the CORE basket either: that basket assumes
// L8 in all seven cities, which for a ×1.6 curve off 320k is ~22M per city.
// Fortress depth is a defence CHOICE, not core progression — the Guard Post is
// what represents city defence in CORE, and it is already in CIVIC_IDS.
const APEX_ALL = ['dragon_lair', 'eagle_tower', 'monster_pit', 'slayer_lodge',
                  'imperial_palace', 'sacred_grove', 'grand_forge', 'great_war_camp',
                  'slave_market', 'blood_citadel'];

// Most of the apex tier is RACE-GATED (unlockRequires type 'race'), so a single
// player can never build all 11 — a human reaches fortress + imperial_palace,
// a high elf reaches fortress + eagle_tower + dragon_lair + sacred_grove.
// Summing all 11 overstated apex demand ~5x. Read the real gate rather than
// hardcoding the split.
function apexReachableBy(raceId) {
  return APEX_ALL.filter(id => {
    const gates = BUILDING_DEFS[id]?.unlockRequires || [];
    const raceGate = gates.find(g => g.type === 'race');
    if (!raceGate) return true;
    // The catalog uses BOTH shapes: { ids: [...] } and singular { id: '...' }.
    // Same normalisation js/domain/building-unlock.js:45 applies — reading only
    // `ids` silently dropped every singular-gated building (imperial_palace,
    // grand_forge, eagle_tower, great_war_camp, slave_market, blood_citadel).
    const allowed = raceGate.ids || [raceGate.id];
    return allowed.includes(raceId);
  });
}
const APEX_IDS = apexReachableBy(RACE.id);
const CIVIC_IDS = ['library', 'courthouse', 'temple', 'tavern', 'marketplace',
                   'barracks', 'archery_range', 'stables', 'guard_post',
                   'gunpowder_workshop', 'engineering_workshop'];

// ── Total demand, split by horizon ─────────────────────────────
function computeDemand() {
  // CORE — what "bought everything" means for the 2–3 week target.
  let coreGold = 0;
  for (let n = 1; n < MAX_LORDS;  n++) coreGold += lordRecruitCost(n);
  for (let n = 1; n < MAX_CITIES; n++) coreGold += cityFoundCost(n);
  // Expansion alone, before any army — the first milestone in the budget table.
  const expansionGold = coreGold;
  const armyOne  = armyCostAtCap(LORD_POWER_LEVEL_CAP);
  // Armies are re-bought after losses — the only naturally recurring gold sink.
  const ARMY_REBUYS = 3;
  coreGold += armyOne * MAX_LORDS * ARMY_REBUYS;

  let coreRes = 0;
  for (const id of ['lumber_mill', 'stone_quarry', 'farm', 'aqueduct']) {
    coreRes += cumulativeBuildingCost(id, 15) * MAX_CITIES;
  }
  coreRes += cumulativeBuildingCost('town_hall', 10) * MAX_CITIES;
  for (const id of CIVIC_IDS) coreRes += cumulativeBuildingCost(id, 8) * MAX_CITIES;

  // The research that BUYS those 7 cities and 7 lords (2026-08-03). Empire-wide
  // and paid once, not per city — but it is now a hard prerequisite for the
  // MAX_CITIES multiplier above, so leaving it out would price an empire the
  // modelled account is not yet allowed to found.
  const expansionRes = Object.entries(RESEARCH_TARGETS)
    .reduce((s, [id, lvl]) => s + cumulativeResearchCost(id, lvl), 0);
  coreRes += expansionRes;

  // ENDGAME — deliberately beyond the 3-week window.
  // Two mount figures: what a player REALISTICALLY buys (top mounts on their
  // 3 main lords) and the completionist total. The realistic one is the number
  // that should stay out of reach for months; the total is the ceiling.
  const mountPerLord   = MOUNT_ONE_PER_TIER.reduce((s, m) => s + m.cost, 0);
  const mountGold      = mountPerLord * 3;
  const mountGoldAll   = mountPerLord * MAX_LORDS;
  const mountCheapest  = Math.min(...MOUNTS.map(m => m.cost));
  let apexRes = 0, apexL1Res = 0;
  for (const id of APEX_IDS) {
    apexRes   += cumulativeBuildingCost(id, 3);
    apexL1Res += cumulativeBuildingCost(id, 1);
  }
  // Every book is maxLevel: Infinity, so this row is a SAMPLE, and the sample
  // depth has to follow the curve or it stops meaning anything. A flat-10 depth
  // was fine while every book was on ×1.35; the OGame-priced books added
  // 2026-08-03 are on ×1.75/×2, where level 10 costs 500–1,000× level 1 and
  // nobody will ever buy it. Sampling those at 5 keeps the row reading as
  // "what a committed player actually researches" rather than as one absurd
  // Cartography number swamping the other five books.
  let tomeRes = 0;
  for (const [id, def] of Object.entries(RESEARCH_DEFS)) {
    const factor = (def.cost(2).stone || def.cost(2).food || def.cost(2).wood || 0)
                 / (def.cost(1).stone || def.cost(1).food || def.cost(1).wood || 1);
    const cap = Number.isFinite(def.maxLevel) ? def.maxLevel : (factor >= 1.6 ? 5 : 10);
    for (let l = 1; l <= cap; l++) {
      const c = def.cost(l);
      tomeRes += (c.food || 0) + (c.wood || 0) + (c.stone || 0);
    }
  }

  return { coreGold, coreRes, expansionGold, mountGold, mountGoldAll, mountPerLord,
           mountCheapest, apexRes, apexL1Res, tomeRes, armyOne };
}

// =============================================================
//  PART 4 — THE DAY-BY-DAY SIMULATION
// =============================================================

function simulate(days) {
  const demand = computeDemand();
  const rows   = [];

  let cumGold = 0, cumRes = 0;
  let goldSpent = 0, resSpent = 0;
  let lords = 1, cities = 1;
  let coreGoldDoneDay = null, coreResDoneDay = null;
  let mountsAffordableDay = null, apexAffordableDay = null;
  // Milestone days (the budget table in ECONOMY-REBALANCE-PLAN.md Part 2).
  // Each is dated against CUMULATIVE GROSS income vs. the cumulative demand up
  // to and including that milestone — i.e. "could a player who bought
  // everything before this, in order, now afford it".
  const ms = { expansion: null, firstMount: null, mountLadder: null, apexL1: null, apexL3: null,
               mount1: null, mount2: null };

  // PER-CITY building state. Cities are founded nearly empty (town_hall 1 and
  // NOTHING else, as seeded by city-found.js — the free Farm was removed
  // 2026-08-04) and must develop from scratch, so founding one does not
  // instantly multiply production — an earlier version shared a single loadout
  // across all cities and handed city 2 a fully-built economy on day 1. Keep
  // this literal in step with city-found.js.
  const foundingLoadout = () =>
    ({ town_hall: 1, lumber_mill: 0, stone_quarry: 0, farm: 0, aqueduct: 0, marketplace: 0 });

  const cityBuildings = [foundingLoadout()];

  for (let day = 1; day <= days; day++) {
    // Lord level tracks time played, capped at the level where income stops
    // growing (see the import note — LORD_MAX_LEVEL is 20, but 11–20 pay only
    // in stats and talents, neither of which this model prices).
    const lordLevel = Math.max(1, Math.min(LORD_POWER_LEVEL_CAP, Math.floor(day / 2) + 1));
    const pop       = BEHAVIOUR.popByDay(day);

    // ── Income ────────────────────────────────────────────────
    const raid = raidPerHour(lordLevel);
    const raidGold = raid.gold * BEHAVIOUR.raidHoursPerDay * lords;
    const raidRes  = (raid.food + raid.wood + raid.stone) * BEHAVIOUR.raidHoursPerDay * lords;

    // Expeditions per lord per day. Tile depletion pushes a player to move
    // every few searches, so travel eats into active time — which is how the
    // travelTime dial reaches the income model at all. The effect is small with
    // standard-length expeditions (a 1-tile hop is ~17s against a 900s search),
    // so travelTime is mostly a FEEL and PvP-reachability dial; do not expect
    // the verdicts below to move much when you change it.
    const searchSecs   = DiscoveryRoll.lengthOf(BEHAVIOUR.expeditionLength).secs;
    const hopSecs      = EconomyCore.getTravelTime(1, BEHAVIOUR.lordSpeed) / BEHAVIOUR.searchesPerTile;
    const expPerLord   = Math.floor(BEHAVIOUR.activeHoursPerDay * 3600 / (searchSecs + hopSecs));
    const erBand       = erTierFor(lordLevel, day);
    const expEach      = expeditionExpected(lordLevel, erBand.tierId);
    const expGold      = expEach.gold      * expPerLord * lords;
    const expRes       = expEach.resources * expPerLord * lords;

    let cityGold = 0, cityRes = 0;
    for (const b of cityBuildings) {
      const prod = cityProduction(b, pop);
      cityGold += prod.gold      * 24;
      cityRes  += prod.resources * 24;
    }

    const dayGold = raidGold + expGold + cityGold;
    const dayRes  = raidRes  + expRes  + cityRes;
    cumGold += dayGold;
    cumRes  += dayRes;

    // ── SPEND, in the order a player actually prioritises ─────
    // 1. EXPANSION FIRST. Lords and cities are investments that raise income,
    //    so a rational player buys them before burning gold on blessings. An
    //    earlier version ran blessings from day 1 at 1,250/h and starved
    //    expansion entirely — the model sat at 1 lord / 1 city for 10 days.
    while (lords < MAX_LORDS && (cumGold - goldSpent) >= lordRecruitCost(lords) + armyCostAtCap(lordLevel)) {
      goldSpent += lordRecruitCost(lords) + armyCostAtCap(lordLevel);
      lords++;
    }
    while (cities < MAX_CITIES && (cumGold - goldSpent) >= cityFoundCost(cities)) {
      goldSpent += cityFoundCost(cities);
      cities++;
      cityBuildings.push(foundingLoadout());
    }

    // 2. BUILD from resource surplus, cheapest-first along BUILD_ORDER —
    //    BUT BOUNDED BY BUILD TIME. The construction queue is serial per city,
    //    so each city has at most 24h of build capacity per day. This is the
    //    constraint Change A restored: with the old 2**level Town Hall divisor
    //    nearly everything completed instantly and resources were the only
    //    gate, which is precisely why nothing felt expensive. getBuildTime is
    //    the real function, so this tracks the live divisor.
    const raceB = RACE.bonuses;
    for (const b of cityBuildings) {
      let secondsLeft = 24 * 3600;
      for (let guard = 0; guard < 100; guard++) {
        const options = BUILD_ORDER
          .map(id => ({ id, cost: nextUpgradeCost(id, b[id]) }))
          .sort((a, b2) => a.cost - b2.cost);
        const pick = options.find(o => (cumRes - resSpent) >= o.cost);
        if (!pick) break;
        const secs = EconomyCore.getBuildTime(BUILDING_DEFS[pick.id], b[pick.id] + 1, raceB, null, b);
        if (secs > secondsLeft) break;   // no queue capacity left today
        secondsLeft -= secs;
        resSpent += pick.cost;
        b[pick.id]++;
      }
    }

    // 3. BLESSINGS from the gold surplus only, and only once a Temple is
    //    plausible (town_hall 3 gates it). Capped at the target uptime.
    // Costs are per-blessing now. The model prices god_of_destruction: it is
    // both the dearest profile (billed in gold AND all three resources) and the
    // one a rational player actually keeps running, so it is simultaneously the
    // realistic and the conservative choice.
    const bUnit = blessingCost(1, 'god_of_destruction');
    const bGoldPerH = typeof bUnit === 'object' ? (bUnit.gold || 0) : bUnit;
    const bResPerH  = typeof bUnit === 'object'
      ? (bUnit.food || 0) + (bUnit.wood || 0) + (bUnit.stone || 0) : 0;
    let bGold = 0, bRes = 0;
    const bestTownHall = Math.max(...cityBuildings.map(b => b.town_hall));
    if (bestTownHall >= 3) {
      const wantH   = 24 * BEHAVIOUR.blessingUptime;
      const goldCap = bGoldPerH > 0 ? (cumGold - goldSpent) / bGoldPerH : wantH;
      const resCap  = bResPerH  > 0 ? (cumRes  - resSpent)  / bResPerH  : wantH;
      const hours   = Math.max(0, Math.min(wantH, goldCap, resCap));
      bGold = hours * bGoldPerH;
      bRes  = hours * bResPerH;
      goldSpent += bGold;
      resSpent  += bRes;
    }

    // ── Verdict tracking ──────────────────────────────────────
    if (coreGoldDoneDay === null && cumGold >= demand.coreGold) coreGoldDoneDay = day;
    if (coreResDoneDay  === null && cumRes  >= demand.coreRes)  coreResDoneDay  = day;
    if (mountsAffordableDay === null && cumGold >= demand.coreGold + demand.mountGold) mountsAffordableDay = day;
    if (apexAffordableDay   === null && cumRes  >= demand.coreRes  + demand.apexRes)   apexAffordableDay   = day;

    if (ms.expansion   === null && cumGold >= demand.expansionGold)                     ms.expansion   = day;
    if (ms.firstMount  === null && cumGold >= demand.coreGold + demand.mountCheapest)   ms.firstMount  = day;
    if (ms.mountLadder === null && cumGold >= demand.coreGold + demand.mountPerLord)    ms.mountLadder = day;
    if (ms.apexL1      === null && cumRes  >= demand.coreRes  + demand.apexL1Res)       ms.apexL1      = day;
    if (ms.apexL3      === null && cumRes  >= demand.coreRes  + demand.apexRes)         ms.apexL3      = day;

    rows.push({ day, lords, cities, lordLevel, dayGold, dayRes, cumGold, cumRes, goldSpent, resSpent,
                erTier: erBand.tierId, er: erBand.er,
                prod: cityBuildings[0].lumber_mill, th: cityBuildings[0].town_hall,
                mix: { raidRes, expRes, cityRes, raidGold, expGold, cityGold } });
  }

  return { demand, rows, coreGoldDoneDay, coreResDoneDay, mountsAffordableDay, apexAffordableDay, ms };
}

// =============================================================
//  PART 5 — REPORT
// =============================================================

const { demand, rows: allRows, coreGoldDoneDay, coreResDoneDay,
        mountsAffordableDay, apexAffordableDay, ms } = simulate(SIM_DAYS);
// Report only the requested window; the milestones above were dated against the
// full SIM_DAYS run so a day-60 milestone still gets a number on a 30-day report.
const rows = allRows.slice(0, DAYS);

console.log('\n' + '='.repeat(66));
console.log('  HEXFRONT ECONOMY PROJECTION');
console.log('  All costs/rates read from the live defs via engine-loader.');
console.log('  Target: CORE progression complete in 2-3 weeks (day 14-28).');
console.log('='.repeat(66));

// Show the dials first: if someone edited js/data/tuning.js, that is the most
// likely reason a verdict moved, and it should be the first thing they see.
const _dials    = TUNING || {};
const _dialKeys = Object.keys(_dials);
const _changed  = _dialKeys.filter(k => _dials[k] !== 1);
console.log('\n-- TUNING DIALS (js/data/tuning.js) ' + '-'.repeat(29));
if (_changed.length === 0) {
  console.log('  all at 1.0 (as designed) — ' + _dialKeys.join(', '));
} else {
  for (const k of _dialKeys) {
    const v = _dials[k];
    const tag = k in DIAL_OVERRIDES ? '  <-- --dial OVERRIDE (not shipped)'
              : v !== 1             ? '  <-- CHANGED'
              : '';
    console.log(`  ${k.padEnd(20)} x${String(v).padEnd(6)}${tag}`);
  }
  console.log('  NOTE: verdicts below reflect these dials, not the shipped defaults.');
}
if (Object.keys(DIAL_OVERRIDES).length > 0) {
  console.log(`  ** SIMULATION ONLY — ${Object.entries(DIAL_OVERRIDES).map(([k, v]) => `${k}=${v}`).join(', ')} came from --dial.`);
  console.log('     js/data/tuning.js was NOT modified. Nothing below is the shipped curve.');
}

// ── Income anchors (the thing the first audit pass got wrong) ──
console.log('\n-- INCOME ANCHORS (compare against plan section 2.1) ' + '-'.repeat(12));
const anchorRow = d => rows.find(r => r.day === d) || rows[rows.length - 1];
// BASELINE — what this model produces for the BEHAVIOUR block above AT THE
// SHIPPED DIALS. A later "OFF Nx" therefore means a cost/rate change moved
// income, or the behaviour assumptions were edited. Re-baseline deliberately,
// never to silence a warning.
//
// RE-BASELINED TWICE on 2026-07-30. First (Phase 0) because the shipped values
// (5k/73k · 60k/770k · 252k/3.09M) were measured with js/data/tuning.js at 1.0
// and never updated when the dials shipped at 0.5/0.5/0.25/0.5 — so every row
// read "OFF 0.4x" and the whole section trained people to ignore it. Then again
// (Phase 1) after questGold 0.25 → 0.60 landed.
//
// ⚠ THIS IS THE FROZEN REFERENCE CURVE. Phases 2-4 of
// ECONOMY-REBALANCE-PLAN.md price every sink against it and must NOT move it.
// If a later change shifts these rows, that change touched income — stop and
// re-argue it before repricing anything.
//
// Phase 1 lifted gold ~32% at day 25, not the ~16% predicted: raising the gold
// dial is not a flat channel bump, because faster gold buys lords and cities
// EARLIER and those compound into every channel. Resources rose ~13% for the
// same reason despite questResources never changing. Model second-order
// effects by running this script, never by scaling a channel on paper.
for (const [label, day, planGold, planRes] of [
  ['Early   (day 3)',  3,    4000,   35000],
  ['Mid     (day 10)', 10,  33000,  311000],
  ['Endgame (day 25)', 25, 145000, 1300000],
]) {
  const r = anchorRow(day);
  if (!r) continue;
  const gx = r.dayGold / planGold;
  const rx = r.dayRes  / planRes;
  const tag = x => (x >= 0.5 && x <= 2) ? 'ok ' : `OFF ${x.toFixed(1)}x`;
  console.log(`  ${label}  ${r.lords}L/${r.cities}C ${r.erTier.padEnd(9)} `
    + `gold ${fmtK(r.dayGold).padStart(6)}/d vs ${fmtK(planGold).padStart(5)} ${tag(gx).padEnd(9)} `
    + `res ${fmtK(r.dayRes).padStart(6)}/d vs ${fmtK(planRes).padStart(5)} ${tag(rx)}`);
}
console.log('  ("OFF Nx" = more than 2x from the planned anchor -> re-argue the');
console.log('   BEHAVIOUR block or the plan anchor BEFORE retuning any price.)');

// ── Where the money actually comes from ───────────────────────
console.log('\n-- INCOME MIX ' + '-'.repeat(50));
console.log('  Which channel dominates is the actionable number: costs are');
console.log('  balanced against total income, but only some channels scale.');
for (const day of [3, 10, 25]) {
  const r = anchorRow(day);
  if (!r) continue;
  const m  = r.mix;
  const rt = m.raidRes + m.expRes + m.cityRes;
  const gt = m.raidGold + m.expGold + m.cityGold;
  const pc = (a, b) => b > 0 ? Math.round(a / b * 100) + '%' : '0%';
  console.log(`  day ${String(day).padStart(2)}  resources: raid ${pc(m.raidRes, rt).padStart(4)}  expedition ${pc(m.expRes, rt).padStart(4)}  cities ${pc(m.cityRes, rt).padStart(4)}`);
  console.log(`         gold:      raid ${pc(m.raidGold, gt).padStart(4)}  expedition ${pc(m.expGold, gt).padStart(4)}  cities ${pc(m.cityGold, gt).padStart(4)}`);
}

// ── Demand ────────────────────────────────────────────────────
console.log('\n-- TOTAL DEMAND ' + '-'.repeat(48));
console.log(`  CORE gold      ${fmt(demand.coreGold).padStart(12)}   (lords + cities + ${fmt(demand.armyOne)}/army x ${MAX_LORDS} x3 re-buys)`);
console.log(`  CORE resources ${fmt(demand.coreRes).padStart(12)}   (producers L15, town hall L10, civic/military L8, x${MAX_CITIES} cities)`);
console.log(`  ENDGAME mounts ${fmt(demand.mountGold).padStart(12)}   (one per tier on 3 main lords; all ${MAX_LORDS} = ${fmt(demand.mountGoldAll)})`);
console.log(`  ENDGAME apex   ${fmt(demand.apexRes).padStart(12)}   (to Lv3, ${RACE.id}-reachable only: ${APEX_IDS.join(', ')})`);
console.log(`  ENDGAME tomes  ${fmt(demand.tomeRes).padStart(12)}   (all Library books; sampled at L10, or L5 for the OGame ×1.75/×2 curves)`);

// ── Milestones ────────────────────────────────────────────────
// THE budget table from ECONOMY-REBALANCE-PLAN.md Part 2. Every price in the
// game is supposed to fall out of these windows rather than being chosen, so
// this is the table to read first after any cost change.
console.log('\n-- MILESTONES (target windows from ECONOMY-REBALANCE-PLAN.md) ' + '-'.repeat(3));
const milestone = (label, day, lo, hi, note = '') => {
  if (day === null) {
    console.log(`  ${label.padEnd(30)} not reached in ${SIM_DAYS}d   MISSED   ${note}`);
    return false;
  }
  const ok = day >= lo && day <= hi;
  const tag = ok ? 'ON TARGET' : day < lo ? 'TOO FAST ' : 'TOO SLOW ';
  console.log(`  ${label.padEnd(30)} day ${String(day).padStart(3)}  target ${String(lo).padStart(2)}-${String(hi).padStart(3)}  ${tag} ${note}`);
  return ok;
};
// CORE rows keep the 14-28 gate they have always had — Phase 0 is instrumentation
// and must not silently move a pass criterion.
milestone('All lords + cities',        ms.expansion,     21, 28);
milestone('CORE gold demand met',      coreGoldDoneDay,  14, 28);
milestone('CORE resource demand met',  coreResDoneDay,   14, 28);
console.log('');
// Mount windows RETARGETED 2026-07-30 with the Phase 2a reprice. The old
// 45-55 / 55-90 windows described mounts as a long-tail sink; Nacho's decision
// made them a mid-game ACCESSORY, so a ladder finishing around day 30 is the
// intent now, not a failure. Retargeting to match a design decision is
// legitimate; retargeting to silence a number you do not like is not.
milestone('First mount',               ms.firstMount,    22,  30);
milestone('Mount ladder (1 lord)',     ms.mountLadder,   28,  40);
milestone('Mounts, 3 main lords',      mountsAffordableDay, 33, 55);
milestone('Apex building Lv1',         ms.apexL1,        35,  45);
milestone('Apex tier Lv3',             ms.apexL3,        50,  90);
console.log('  (Only the CORE rows gate the exit code. The long-tail windows are');
console.log('   the PLAN\'s proposals, not measurements — Phases 2-4 tune toward them.');
console.log('   Milestones compare gross cumulative income against cumulative demand,');
console.log('   so they ignore blessing spend and read slightly optimistic.)');

// ── Payback ───────────────────────────────────────────────────
// Rule 3 of the rebalance plan: a buff whose payback cannot be computed is not
// balanceable, and one that reads NEVER is a trap rather than a purchase. This
// is the section that would have caught god_of_nature and cartography shipping
// mathematically incapable of paying for themselves.
console.log('\n-- PAYBACK ' + '-'.repeat(53));
const end   = allRows[allRows.length - 1];
const endMix = end.mix;
// Resources are valued at the merchant's SELL rate (what you get for handing
// them over), so one-off gold prices can be compared against resource yields.
// The buy rate is deliberately not averaged in: this is asking "what is this
// pile worth", which is the selling question.
const _sellRates   = MarketCore.MARKET_SELL_RATES;
const RES_PER_GOLD = (_sellRates.wood + _sellRates.stone + _sellRates.food) / 3;
const goldEq = (g, r) => g + r / RES_PER_GOLD;
let paybackFails = 0;

// -- Blessings: RECURRING, so the question is net-per-day, not days-to-repay.
console.log(`  BLESSINGS (24h uptime, vs day-${end.day} income ${fmtK(end.dayGold)}g / ${fmtK(end.dayRes)}res)`);
for (const [id, def] of Object.entries(BLESSING_DEFS)) {
  // Each blessing is billed in the currency it does NOT produce, so the cost
  // is per-blessing and must be read with the id.
  const bCost  = blessingCost(24, id);
  const bCostG = bCost.gold || 0;
  const bCostR = (bCost.food || 0) + (bCost.wood || 0) + (bCost.stone || 0);
  const e = def.effects || {};
  let gainG = 0, gainR = 0; const tempo = [];
  if (e.raid_bonus)        { gainG += endMix.raidGold * e.raid_bonus;  gainR += endMix.raidRes * e.raid_bonus; }
  if (e.quest_bonus)       { gainG += endMix.expGold  * e.quest_bonus; gainR += endMix.expRes  * e.quest_bonus; }
  if (e.gold_income_bonus) { gainG += endMix.cityGold * e.gold_income_bonus; }
  // *_production reaches BUILDING output only — that is the whole reason
  // god_of_nature cannot break even, so model it exactly, not generously.
  const prodKeys = ['food_production', 'wood_production', 'stone_production'].map(k => e[k] || 0);
  const prodAvg  = prodKeys.reduce((s, v) => s + v, 0) / 3;
  if (prodAvg) gainR += endMix.cityRes * prodAvg;
  // resource_yield_bonus is the other two thirds — raid and expedition
  // RESOURCES, never gold. Together with *_production it covers the whole pool.
  if (e.resource_yield_bonus) gainR += (endMix.raidRes + endMix.expRes) * e.resource_yield_bonus;
  if (e.pop_growth_bonus) {
    // Population is a permanent STOCK, so one day of uptime adds gold/day forever.
    // Read the healthy-city baseline straight off the status ladder instead of
    // hardcoding it — this used to be a literal 599 and silently went stale the
    // moment the tiers were retuned (2026-08-03).
    const baseRate = EconomyCore.STATUS_POP_RATE.growing;
    const extraPop = end.cities * baseRate * e.pop_growth_bonus * 24;
    gainG += extraPop * 0.004 * tune('populationGold') * 24;
  }
  if (e.recruit_speed)     tempo.push(`recruit ${Math.round(e.recruit_speed * 100)}%`);
  if (e.battle_loot_bonus) tempo.push(`PvP loot +${Math.round(e.battle_loot_bonus * 100)}%`);

  const netG = gainG - bCostG, netR = gainR - bCostR;
  const hasYield = gainG > 0 || gainR > 0;
  let tag, note = '';
  if (!hasYield && tempo.length)   tag = 'TEMPO';   // pure tempo/PvP buff — not a yield, not a failure
  else if (netG >= 0 && netR >= 0) tag = 'PAYS ';
  else if (netG <  0 && netR <  0) { tag = 'NEVER'; paybackFails++; }
  else {
    tag = 'TRADE';
    // The actionable number for a conversion: what you pay per 1,000 of what you
    // gain. Compare against the merchant, which runs the trade the other way at
    // ~50 gold per 1,000 resources (MARKET_SELL_RATES ~20:1).
    if (netR > 0 && netG < 0) note = `  (${fmt(-netG / netR * 1000)} gold per 1,000 res — merchant does the reverse at ~${fmt(1000 / RES_PER_GOLD)})`;
  }
  console.log(`    ${id.padEnd(20)} net ${fmtK(netG).padStart(7)}g ${fmtK(netR).padStart(9)}res  ${tag}`
    + (tempo.length ? `  (+tempo: ${tempo.join(', ')})` : '') + note);
}
console.log('    PAYS = net positive both ways · TRADE = converts one currency to the other');
console.log('    TEMPO = no yield by design (speed/PvP only) · NEVER = costs more of BOTH than it yields');

// -- Mounts: ONE-OFF, so days-to-repay is the right question.
// Income effects only: stat lines (attack/defense) buy combat power, which this
// model does not price. Speed IS priced — it shortens the hop between tiles and
// therefore buys expeditions per day.
function expIncomeAt(lordLevel, day, erMult, speed) {
  const searchSecs = DiscoveryRoll.lengthOf(BEHAVIOUR.expeditionLength).secs;
  const hopSecs    = EconomyCore.getTravelTime(1, speed) / BEHAVIOUR.searchesPerTile;
  const perLord    = Math.floor(BEHAVIOUR.activeHoursPerDay * 3600 / (searchSecs + hopSecs));
  const er         = lordArmyPowerCapBase(lordLevel) * BEHAVIOUR.armyFillByDay(day) * BEHAVIOUR.scoutErByDay(day) * (erMult || 1);
  const each       = expeditionExpected(lordLevel, DiscoveryRoll.erTierFor(er).id);
  return { gold: each.gold * perLord, res: each.resources * perLord };
}
console.log('\n  MOUNTS (one lord at L10, day ' + end.day + ')');
const baseExp  = expIncomeAt(LORD_POWER_LEVEL_CAP, end.day, 1, BEHAVIOUR.lordSpeed);
const baseEr   = lordArmyPowerCapBase(LORD_POWER_LEVEL_CAP) * BEHAVIOUR.armyFillByDay(end.day) * BEHAVIOUR.scoutErByDay(end.day);
// Keys that can move income at all. A mount carrying none of them is a pure
// stat purchase and its "NEVER" is a statement about the CATALOG, not a bug —
// so those are summarised in one line instead of 15 identical rows.
const INCOME_KEYS = ['expeditionRatingMult', 'raid_bonus', 'march_food_cost', 'quest_bonus'];
// A mount with no income key is priced against COMBAT, which this model does
// not price — so it is reported as STATS and is NOT a failure. It is validated
// by PRICE PARITY instead: `scout` and `field` are deliberate sidegrades at one
// shared slot price, so the combat mount is justified by its economic sibling
// clearing payback at the same cost. test-economy.js pins that parity, plus the
// bound that matters (a full ladder must cost less than the last lord + city).
let statMounts = 0, statCost = 0;
for (const m of MOUNTS) {
  const e = m.effects || {};
  if (!INCOME_KEYS.some(k => e[k])) { statMounts++; statCost += m.cost; continue; }

  const exp = expIncomeAt(LORD_POWER_LEVEL_CAP, end.day, e.expeditionRatingMult || 1,
                          BEHAVIOUR.lordSpeed + (e.speed || 0));
  let dG = exp.gold - baseExp.gold, dR = exp.res - baseExp.res;
  // quest_bonus is a straight % on the expedition payout — the scout slot's
  // real product, and the reason it no longer depends on crossing an ER band.
  if (e.quest_bonus) { dG += exp.gold * e.quest_bonus; dR += exp.res * e.quest_bonus; }
  if (e.raid_bonus) {
    const raid = EconomyCore.getRaidHourlyRewards(LORD_POWER_LEVEL_CAP);
    dG += raid.gold * BEHAVIOUR.raidHoursPerDay * e.raid_bonus;
    dR += (raid.food + raid.wood + raid.stone) * BEHAVIOUR.raidHoursPerDay * e.raid_bonus;
  }
  const perDay = goldEq(dG, dR);
  const days   = perDay > 0 ? m.cost / perDay : null;
  if (days === null || days > 60) paybackFails++;
  // Show the ER band on both sides: an ER multiplier that does not cross a band
  // boundary is worth exactly nothing, which is invisible from the effect alone.
  const erNote = e.expeditionRatingMult
    ? `  ER ${DiscoveryRoll.erTierFor(baseEr).id} -> ${DiscoveryRoll.erTierFor(baseEr * e.expeditionRatingMult).id}`
    : '';
  console.log(`    ${m.id.padEnd(18)} ${fmt(m.cost).padStart(9)}g  +${fmtK(dG).padStart(5)}g +${fmtK(dR).padStart(7)}res/d  `
    + (days === null ? 'NEVER' : `${days.toFixed(0)} days`) + erNote);
}
if (statMounts) {
  console.log(`    ${String(statMounts).padStart(2)} combat-only mounts (${fmt(statCost)}g total)  `
    + `STATS — priced by parity with their economic sidegrade, not by payback`);
}

// -- Producers: the level's cost against the output it actually adds.
console.log('\n  PRODUCERS (level cost / extra output — the 12x spread the audit found)');
for (const id of ['lumber_mill', 'stone_quarry', 'farm']) {
  const out = [];
  for (const l of [5, 10, 15, 20]) {
    const c    = BUILDING_DEFS[id].cost(l);
    const cost = (c.food || 0) + (c.wood || 0) + (c.stone || 0);
    const pr = BUILDING_DEFS[id].production(l), pv = BUILDING_DEFS[id].production(l - 1);
    const key = Object.keys(pr)[0];
    const raceB = RACE.bonuses[key + '_production'] || 0;
    const delta = (pr[key] - pv[key]) * tune('buildingProduction') * (1 + raceB);
    out.push(`L${String(l).padStart(2)} ${(cost / delta / 24).toFixed(0).padStart(3)}d`);
  }
  console.log(`    ${id.padEnd(18)} ${out.join('  ')}`);
}

// -- Research: Rule 4 — an exponential cost curve needs a benefit on a GROWING
// base. A bounded benefit (march food is capped per tile on a fixed-size map)
// can never be priced correctly, at any number.
//
// `march_food_cost` FLIPPED false → true on 2026-08-03. It was classified as
// bounded because march food was capped at 500/tile, which is reached at ten
// models — so past a small army the saving stopped growing and no price could
// be right. That cap was REMOVED in the same session (see getMarchFoodCost):
// the bill is now 50 + 45 per model with no ceiling, so a percentage of it
// rides the army as it grows. The rule did not change; the base did.
// COUNT vs PERCENT (2026-08-03). Three books now grant whole UNITS — a city, a
// lord, a rung of scout intel — not percentages, and pricing them "per 1% of
// effect" is meaningless. It is also arithmetically unsafe: the city ladder
// grants a slot every OTHER level, so the marginal percentage is 0 half the
// time and the first run of this table printed "frontier_charters L10
// InfinityM". Count books are priced per unit instead.
const COUNT_KEYS = { city_slots: 'city', lord_slots: 'lord', espionage_power: 'rung' };

// Keys whose benefit rides a base that GROWS with the empire, and are therefore
// legitimate on an exponential cost curve.
//   city_slots / lord_slots — the benefit IS a new income source. Nothing rides
//     a faster-growing base than "you now have another city".
const GROWING_BASE = { construction_speed: true, recruit_speed: true,
                       food_production: true, wood_production: true, stone_production: true,
                       gold_income_bonus: true, march_food_cost: true,
                       city_slots: true, lord_slots: true };

// UTILITY keys ride no income base and are not meant to — they buy information
// or tempo, exactly like the TEMPO blessings above. Not a payback failure; the
// rule simply does not apply. Counted separately so the distinction stays
// visible rather than being laundered into GROWING_BASE.
const UTILITY_KEYS = { espionage_power: true };

console.log('\n  RESEARCH (cost per marginal unit of effect — flat = healthy, exploding = wrong shape)');
for (const [id, def] of Object.entries(RESEARCH_DEFS)) {
  const keys = Object.keys(def.bonuses(1));
  // A book passes if ANY of its keys rides a growing base. Cartography emits
  // travel_speed AND march_food_cost; the speed half is bounded by the 20x10
  // map, the food half is not (march food scales with army size without limit
  // since the 500/tile cap was removed), and the second is enough to justify
  // the curve. Reading only keys[0] — as this did until 2026-08-03 — would have
  // condemned the book on whichever key happened to be declared first.
  const grows   = keys.some(k => GROWING_BASE[k]);
  const utility = !grows && keys.every(k => UTILITY_KEYS[k]);
  // Price against the key the book is actually SOLD on: the growing one if it
  // has one, else the first.
  const key     = keys.find(k => GROWING_BASE[k]) || keys[0];
  const unit    = COUNT_KEYS[key];
  const out = [];
  for (const l of [1, 5, 10]) {
    const c    = def.cost(l);
    const cost = (c.food || 0) + (c.wood || 0) + (c.stone || 0);
    const cur  = Math.abs(def.bonuses(l)[key] || 0);
    const prev = l > 1 ? Math.abs(def.bonuses(l - 1)[key] || 0) : 0;
    // Percent keys are quoted per 1%; count keys per whole unit. A level that
    // grants nothing on its own (the charter ladder's even levels) prints "—"
    // rather than dividing by zero.
    const marginal = unit ? (cur - prev) : (cur - prev) * 100;
    out.push(`L${String(l).padStart(2)} ${(marginal > 0 ? fmtK(cost / marginal) : '—').padStart(6)}`);
  }
  const verdict = grows   ? 'GROWS  ok'
                : utility ? 'UTILITY — buys information, not yield (by design)'
                :           'BOUNDED — unfixable on an exponential curve';
  if (!grows && !utility) paybackFails++;
  console.log(`    ${id.padEnd(20)} ${out.join('  ')}${unit ? ` per ${unit}` : ''}   base ${verdict}`);
}

console.log(`\n  ${paybackFails} payback failure(s).`
  + (STRICT ? '  --strict: these gate the exit code.' : '  (run with --strict to gate on these)'));

// ── Per-day table ─────────────────────────────────────────────
if (VERBOSE) {
  console.log('\n-- PER-DAY ' + '-'.repeat(53));
  console.log('  day  L  C lvl  TH prod |   gold/day    res/day |   cum gold     cum res | core res');
  for (const r of rows) {
    const frac = r.cumRes / demand.coreRes;
    console.log(`  ${String(r.day).padStart(3)} ${String(r.lords).padStart(2)} ${String(r.cities).padStart(2)}`
      + ` ${String(r.lordLevel).padStart(3)} ${String(r.th).padStart(3)} ${String(r.prod).padStart(4)} |`
      + ` ${fmtK(r.dayGold).padStart(9)} ${fmtK(r.dayRes).padStart(10)} |`
      + ` ${fmtK(r.cumGold).padStart(10)} ${fmtK(r.cumRes).padStart(11)} | ${bar(frac, 14)}`);
  }
} else {
  console.log('\n  (--verbose for the per-day table, --days N to extend the window)');
}

console.log('\n' + '='.repeat(66) + '\n');

const coreOk = [coreGoldDoneDay, coreResDoneDay].every(d => d !== null && d >= 14 && d <= 28);
process.exit((coreOk && (!STRICT || paybackFails === 0)) ? 0 : 1);
