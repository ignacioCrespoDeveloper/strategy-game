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
  MOUNT_POOL, blessingCost, LORD_MAX_LEVEL, DiscoveryRoll,
  RESEARCH_DEFS, TUNING, tune,
} from '../server/engine-loader.js';
import { MAX_LORDS, lordRecruitCost } from '../server/actions/lord-create.js';
import { MAX_CITIES, cityFoundCost } from '../server/actions/city-found.js';

// ── CLI ────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const DAYS    = (() => {
  const i = argv.indexOf('--days');
  return i >= 0 && argv[i + 1] ? Math.max(1, parseInt(argv[i + 1], 10) || 30) : 30;
})();

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
const BEHAVIOUR = {
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
  return {
    resources: resMid  * scalar * BEHAVIOUR.findResourceShare * tune('questResources'),
    gold:      goldMid * scalar * BEHAVIOUR.findGoldShare     * tune('questGold'),
  };
}

// ER band a lord's army reaches. Army PWR is capped at 200 + level×80, and the
// player fills that cap gradually (see armyFillByDay) with growing scout
// weighting (scouts count x2 for ER — the documented composition lever, see
// discovery-roll.js RECRUIT_TIERS).
function erTierFor(lordLevel, day) {
  const cap = 200 + lordLevel * 80;
  const er  = cap * BEHAVIOUR.armyFillByDay(day) * BEHAVIOUR.scoutErByDay(day);
  return { tierId: DiscoveryRoll.erTierFor(er).id, er };
}

// City production per hour, from the real building curves.
function cityProduction(buildings, population) {
  const bonuses = {};
  for (const r of ['food', 'wood', 'stone']) {
    bonuses[r + '_production'] = RACE.bonuses[r + '_production'] || 0;
  }
  const rates = EconomyCore.getRates(buildings, bonuses, null);
  const stats = EconomyCore.getStats(buildings, population, []);
  return {
    resources: rates.food + rates.wood + rates.stone,
    gold:      EconomyCore.getGoldRate(buildings, population, stats.happiness),
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
  const cap   = 200 + lordLevel * 80;
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

const APEX_ALL = ['dragon_lair', 'fortress', 'eagle_tower', 'monster_pit', 'slayer_lodge',
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
  const armyOne  = armyCostAtCap(LORD_MAX_LEVEL);
  // Armies are re-bought after losses — the only naturally recurring gold sink.
  const ARMY_REBUYS = 3;
  coreGold += armyOne * MAX_LORDS * ARMY_REBUYS;

  let coreRes = 0;
  for (const id of ['lumber_mill', 'stone_quarry', 'farm', 'aqueduct']) {
    coreRes += cumulativeBuildingCost(id, 15) * MAX_CITIES;
  }
  coreRes += cumulativeBuildingCost('town_hall', 10) * MAX_CITIES;
  for (const id of CIVIC_IDS) coreRes += cumulativeBuildingCost(id, 8) * MAX_CITIES;

  // ENDGAME — deliberately beyond the 3-week window.
  // Two mount figures: what a player REALISTICALLY buys (top mounts on their
  // 3 main lords) and the completionist total. The realistic one is the number
  // that should stay out of reach for months; the total is the ceiling.
  const mountPerLord   = MOUNT_ONE_PER_TIER.reduce((s, m) => s + m.cost, 0);
  const mountGold      = mountPerLord * 3;
  const mountGoldAll   = mountPerLord * MAX_LORDS;
  let apexRes = 0;
  for (const id of APEX_IDS) apexRes += cumulativeBuildingCost(id, 3);
  let tomeRes = 0;
  for (const [id, def] of Object.entries(RESEARCH_DEFS)) {
    const cap = Number.isFinite(def.maxLevel) ? def.maxLevel : 10; // uncapped tomes: sample 10 levels
    for (let l = 1; l <= cap; l++) {
      const c = def.cost(l);
      tomeRes += (c.food || 0) + (c.wood || 0) + (c.stone || 0);
    }
  }

  return { coreGold, coreRes, mountGold, mountGoldAll, mountPerLord, apexRes, tomeRes, armyOne };
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

  // PER-CITY building state. Cities are founded EMPTY (town_hall 1, as seeded
  // by city-found.js) and must develop from scratch, so founding one does not
  // instantly multiply production — an earlier version shared a single loadout
  // across all cities and handed city 2 a fully-built economy on day 1.
  const cityBuildings = [{ town_hall: 1, lumber_mill: 0, stone_quarry: 0, farm: 0, aqueduct: 0, marketplace: 0 }];

  for (let day = 1; day <= days; day++) {
    // Lord level tracks time played, capped by the real LORD_MAX_LEVEL.
    const lordLevel = Math.max(1, Math.min(LORD_MAX_LEVEL, Math.floor(day / 2) + 1));
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
      cityBuildings.push({ town_hall: 1, lumber_mill: 0, stone_quarry: 0, farm: 0, aqueduct: 0, marketplace: 0 });
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
    const bUnit = blessingCost(1);
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

    rows.push({ day, lords, cities, lordLevel, dayGold, dayRes, cumGold, cumRes, goldSpent, resSpent,
                erTier: erBand.tierId, er: erBand.er,
                prod: cityBuildings[0].lumber_mill, th: cityBuildings[0].town_hall,
                mix: { raidRes, expRes, cityRes, raidGold, expGold, cityGold } });
  }

  return { demand, rows, coreGoldDoneDay, coreResDoneDay, mountsAffordableDay, apexAffordableDay };
}

// =============================================================
//  PART 5 — REPORT
// =============================================================

const { demand, rows, coreGoldDoneDay, coreResDoneDay, mountsAffordableDay, apexAffordableDay } = simulate(DAYS);

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
    console.log(`  ${k.padEnd(20)} x${String(v).padEnd(6)}${v !== 1 ? '  <-- CHANGED' : ''}`);
  }
  console.log('  NOTE: verdicts below reflect these dials, not the shipped defaults.');
}

// ── Income anchors (the thing the first audit pass got wrong) ──
console.log('\n-- INCOME ANCHORS (compare against plan section 2.1) ' + '-'.repeat(12));
const anchorRow = d => rows.find(r => r.day === d) || rows[rows.length - 1];
// BASELINE, measured immediately after Change B+C landed (2026-07-30) — not a
// wish. These are what this model produces for the BEHAVIOUR block above, so a
// later "OFF Nx" means either a cost/rate change moved income or the behaviour
// assumptions were edited. Re-baseline deliberately, never to silence a warning.
for (const [label, day, planGold, planRes] of [
  ['Early   (day 3)',  3,    5000,   73000],
  ['Mid     (day 10)', 10,  60000,  770000],
  ['Endgame (day 25)', 25, 252000, 3090000],
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
console.log(`  ENDGAME tomes  ${fmt(demand.tomeRes).padStart(12)}   (all Library books to cap; uncapped sampled at L10)`);

// ── Verdicts ──────────────────────────────────────────────────
console.log('\n-- VERDICTS ' + '-'.repeat(52));
const verdict = (label, day, lo, hi) => {
  if (day === null) { console.log(`  ${label.padEnd(30)} not reached within ${DAYS} days`); return; }
  const ok = day >= lo && day <= hi;
  console.log(`  ${label.padEnd(30)} day ${String(day).padStart(3)}   ${ok ? 'ON TARGET' : day < lo ? 'TOO FAST' : 'TOO SLOW'}`);
};
verdict('CORE gold demand met',      coreGoldDoneDay, 14, 28);
verdict('CORE resource demand met',  coreResDoneDay,  14, 28);
console.log('');
verdict('Mounts (all) affordable',   mountsAffordableDay, 29, 9999);
verdict('Apex tier (Lv3) affordable', apexAffordableDay,  29, 9999);
console.log('  (Endgame rows SHOULD read TOO SLOW / not reached — that is the');
console.log('   long tail working. Only the two CORE rows must be ON TARGET.)');

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
process.exit(coreOk ? 0 : 1);
