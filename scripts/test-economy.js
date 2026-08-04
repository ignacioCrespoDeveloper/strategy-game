// =============================================
//  test-economy.js — Economy engine verification
//
//  Run:  node scripts/test-economy.js
//
//  Verifies the OGame-style economy overhaul:
//    1. Building catalog shape (categories, no iron buildings)
//    2. OGame production/cost/build-time curves
//    3. Water (energy) factor math
//    4. Iron fully removed from every cost table
//    5. Client formulas == server catch-up results
//       (single source of truth: EconomyCore via engine-loader)
// =============================================

import {
  BUILDING_DEFS, UNIT_DEFS, UNIT_ROSTER, RACES, EconomyCore, MarketCore, UnitUnlockService,
  RESEARCH_DEFS, RESEARCH_TIERS,
  BLESSING_DEFS, BLESSING_COST_MIX, blessingMaxHours, blessingDuration, blessingCost,
  lordRansomCost,
  TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS,
  DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES,
  LORD_MAX_LEVEL, LORD_POWER_LEVEL_CAP, lordPowerLevel, lordArmyPowerCapBase,
  TALENT_LEVELS, MAX_TALENTS, lordTalentSlots, nextTalentLevel,
  getLordTalentIds, mergeTalentEffects, lordTalentEffects,
  MOUNT_POOL, MOUNT_SLOTS,
  ITEM_DEFS, itemsOfTier, itemDurationMs, itemBonusLabel,
  DiscoveryRoll, TUNING, tune,
} from '../server/engine-loader.js';
import { catchUp } from '../server/tick/catch-up.js';

// ── Neutralise the tuning dials for the formula checks ──────────
// Almost everything below asserts the DESIGNED numbers (a Lumber Mill Lv1
// makes 33 wood, gold is pop × 0.004 × happiness, …). Those are statements
// about the formulas, not about the designer's current preferences — so if a
// tuned js/data/tuning.js leaked in here, the whole suite would go red the
// moment someone used the file for its intended purpose. That would train
// everyone to ignore it.
//
// The dials' own wiring is verified in the "Tuning dials" section below, which
// sets and restores each one explicitly via withDial().
const _designerDials = { ...TUNING };
for (const k of Object.keys(TUNING)) TUNING[k] = 1;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 50 - title.length))}`); }

// Mirrors WorldService.getTerrain / catch-up.js _getTerrain
function terrainKey(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  const keys = ['forest','forest','plains','plains','plains','mountain','mountain','marsh','mountain','desert'];
  return keys[h % keys.length];
}

// ── 1. Catalog shape ────────────────────────────────────────────
section('Building catalog');

check('EconomyCore exported by engine-loader', !!EconomyCore);
check('iron_mine removed',   !BUILDING_DEFS.iron_mine);
check('blacksmith removed',  !BUILDING_DEFS.blacksmith);
check('barracks requires only town_hall 3',
  JSON.stringify(BUILDING_DEFS.barracks.requires) === JSON.stringify({ town_hall: 3 }));
check('grand_forge requires stone_quarry (not iron_mine)',
  BUILDING_DEFS.grand_forge.requires.stone_quarry === 3 && !BUILDING_DEFS.grand_forge.requires.iron_mine);

const resourceBuildings = Object.values(BUILDING_DEFS).filter(d => d.category === 'resources').map(d => d.id).sort();
check('resources category = aqueduct, farm, lumber_mill, stone_quarry',
  JSON.stringify(resourceBuildings) === JSON.stringify(['aqueduct', 'farm', 'lumber_mill', 'stone_quarry']),
  JSON.stringify(resourceBuildings));

const infraBuildings = Object.values(BUILDING_DEFS).filter(d => d.category === 'infrastructure').map(d => d.id).sort();
check('infrastructure category = courthouse, library, marketplace, tavern, temple, town_hall',
  JSON.stringify(infraBuildings) === JSON.stringify(['courthouse', 'library', 'marketplace', 'tavern', 'temple', 'town_hall']),
  JSON.stringify(infraBuildings));

const validCats = new Set(['resources', 'infrastructure', 'military', 'landmarks']);
check('every building has a valid category',
  Object.values(BUILDING_DEFS).every(d => validCats.has(d.category)));

// ── 2. OGame curves ─────────────────────────────────────────────
section('OGame curves (metal→wood, crystal→stone, deut→food)');

const og = (base, l) => Math.floor(base * l * Math.pow(1.1, l));

check('lumber mill production = 30·L·1.1^L',
  BUILDING_DEFS.lumber_mill.production(1).wood === og(30, 1) &&
  BUILDING_DEFS.lumber_mill.production(10).wood === og(30, 10));
check('stone quarry production = 20·L·1.1^L',
  BUILDING_DEFS.stone_quarry.production(5).stone === og(20, 5));
check('farm production = 10·L·1.1^L',
  BUILDING_DEFS.farm.production(9).food === og(10, 9));
check('no building declares OGame-style water production/consumption anymore',
  Object.values(BUILDING_DEFS).every(d => !d.water));
check('all 3 resource producers drain hygiene (−2/level)',
  ['farm', 'lumber_mill', 'stone_quarry'].every(id =>
    BUILDING_DEFS[id].effects(3).some(e => e.stat === 'hygiene' && e.value === -6)));
check('aqueduct is the hygiene counterweight (+8/level)',
  BUILDING_DEFS.aqueduct.effects(3).some(e => e.stat === 'hygiene' && e.value === 24));
check('lumber mill cost L1 = 60 wood / 15 stone (OGame metal mine)',
  BUILDING_DEFS.lumber_mill.cost(1).wood === 60 && BUILDING_DEFS.lumber_mill.cost(1).stone === 15);
// Factor 1.6 → 1.5 on 2026-08-03: all three producers now compound at the same
// rate, so the quarry's payback no longer diverges from the mill's forever.
// Pinned as a group rather than per-building — the point is that they AGREE.
check('all 3 producers compound at ×1.5',
  ['lumber_mill', 'stone_quarry', 'farm'].every(id => {
    const l1 = BUILDING_DEFS[id].cost(1), l2 = BUILDING_DEFS[id].cost(2);
    return l2.wood === Math.floor(l1.wood * 1.5) && l2.stone === Math.floor(l1.stone * 1.5);
  }));
// Cost base ÷ production base — the ratio the 12× payback spread came from.
// Mill 2.5 / quarry 3.6 / farm 30.0 before the 2026-08-03 rebase; the farm's
// 300 base against 10 production was the outlier that made it a dead building.
check('producer cost:production ratios are within 2.5× of each other',
  (() => {
    const ratio = (id, prod) => {
      const c = BUILDING_DEFS[id].cost(1);
      return (c.wood + c.stone) / prod;
    };
    const rs = [ratio('lumber_mill', 30), ratio('stone_quarry', 20), ratio('farm', 10)];
    return Math.max(...rs) / Math.min(...rs) <= 2.5;
  })());
check('resource build time = (wood+stone)·1.44s, min 15s',
  BUILDING_DEFS.lumber_mill.buildTime(1) === Math.max(15, Math.round(75 * 1.44)));

// ── 3. Plain production rates + hygiene loop ────────────────────
section('Production rates (no efficiency factor) + hygiene loop');

check('no production-factor / water mechanic exists',
  typeof EconomyCore.getProductionFactor === 'undefined' &&
  typeof EconomyCore.getWater === 'undefined' &&
  !('water' in EconomyCore.STAT_BASE));

const mineStats = EconomyCore.getStats({ farm: 2, lumber_mill: 2, stone_quarry: 2 }, 1000, []);
check('3 producers at L2 drag hygiene 50 → 38 (−12)', mineStats.hygiene === 38);

const balancedStats = EconomyCore.getStats({ farm: 2, lumber_mill: 2, stone_quarry: 2, aqueduct: 2 }, 1000, []);
check('aqueduct 2 pulls it back to 54 (+16)', balancedStats.hygiene === 54);

const baseRates = EconomyCore.getRates({ lumber_mill: 1 }, null, null);
check('production is plain building output (33 wood at L1)', baseRates.wood === og(30, 1));

const raceRates = EconomyCore.getRates({ lumber_mill: 1 }, RACES.dark_elf.bonuses, null);
check('Dark Elves +30% wood applies', raceRates.wood === Math.floor(og(30, 1) * 1.3));

const terrRates = EconomyCore.getRates({ lumber_mill: 1 }, null, TERRAIN_RESOURCE_MODS.forest);
check('forest +25% wood applies', terrRates.wood === Math.floor(og(30, 1) * 1.25));

check('gold rate downgraded to pop × 0.004 × happiness',
  EconomyCore.getGoldRate({}, 10000, 100) === 40 &&
  EconomyCore.getGoldRate({}, 10000, 50)  === 20);

// Corruption skims city tax since 2026-08-03 (Phase 4). The Courthouse existed
// to fight corruption and corruption did nothing measurable, so the building
// did nothing measurable — see getGoldRate. Pinned at both ends plus the
// omitted-argument case, which must behave exactly as before.
check('corruption skims city gold, capped at half',
  EconomyCore.getGoldRate({}, 10000, 100, 0)   === 40 &&
  EconomyCore.getGoldRate({}, 10000, 100)      === 40 &&   // absent arg = no skim
  EconomyCore.getGoldRate({}, 10000, 100, 50)  === 30 &&   // −25%
  EconomyCore.getGoldRate({}, 10000, 100, 100) === 20 &&   // −50%, the cap
  EconomyCore.getGoldRate({}, 10000, 100, 999) === 20);    // clamped

// The Courthouse's whole purpose. A market town without one must measurably
// lose gold to corruption; with one, it must get some back.
check('a Courthouse measurably restores gold a Marketplace leaks',
  (() => {
    const dirty = { town_hall: 5, marketplace: 8 };
    const clean = { ...dirty, courthouse: 6 };
    const gold  = b => {
      const s = EconomyCore.getStats(b, 50000, []);
      return EconomyCore.getGoldRate(b, 50000, s.happiness, s.corruption);
    };
    return gold(clean) > gold(dirty);
  })());

check('march food cost = distance × (50 + 45·models); same tile free',
  EconomyCore.getMarchFoodCost(0, [{ count: 10 }]) === 0 &&
  EconomyCore.getMarchFoodCost(1, null) === 50 &&
  EconomyCore.getMarchFoodCost(5, null) === 250 &&
  EconomyCore.getMarchFoodCost(3, [{ count: 6 }, { count: 4 }]) === 1500);

// The 500/tile ceiling was removed 2026-08-03: it was reached at exactly 10
// models, so every army from ten models upward marched for the same price and
// the per-model supply cost stopped existing precisely where armies get big.
// Pinned as a REGRESSION GUARD — re-introducing any ceiling breaks this.
check('march food scales past 10 models (the 500/tile cap is gone)',
  EconomyCore.getMarchFoodCost(10, [{ count: 30 }]) === 14000 &&
  EconomyCore.getMarchFoodCost(5,  [{ count: 40 }]) === 9250 &&
  EconomyCore.getMarchFoodCost(5,  [{ count: 40 }]) ===
    4 * EconomyCore.getMarchFoodCost(5, [{ count: 10 }]) - 3 * EconomyCore.getMarchFoodCost(5, null));

// ── 3.5 Library research (books) ────────────────────────────────
section('Library research (books)');

// Catalog trimmed 2026-07-29 to two tier-1 books, then given a tier-2 rung on
// 2026-08-03 (Phase 3a): before that, reaching Library 4 unlocked nothing at
// all, so the building gated only itself. Tier 3 stays defined and empty for
// the next rung. What matters is that every tier in use is REACHABLE and that
// tier 1 still opens the moment the Library exists.
check('books span tiers 1–2, tier 1 opens at Library 1',
  Object.keys(RESEARCH_DEFS).length >= 2 &&
  Object.values(RESEARCH_DEFS).some(d => d.tier === 1) &&
  Object.values(RESEARCH_DEFS).some(d => d.tier === 2) &&
  Object.values(RESEARCH_DEFS).every(d => RESEARCH_TIERS[d.tier] !== undefined) &&
  RESEARCH_TIERS[1] === 1 && RESEARCH_TIERS[2] === 4 && RESEARCH_TIERS[3] === 8);

// Every bonus key a book emits must have a live consumer. This is the check
// the flavor-trait debt earned: `gold_income_bonus` reads fine and does
// nothing, because getGoldRate never looks at it. Adding a book on a dead key
// ships a purchase that changes no number the player can see.
check('every research bonus key has a live consumer',
  (() => {
    const LIVE = new Set([
      'construction_speed',   // EconomyCore.getBuildTime
      'recruit_speed',        // EconomyCore.getRecruitTime
      'march_food_cost',      // EconomyCore.getMarchFoodCost
      'food_production',      // EconomyCore.getRates (summed in production.js / catch-up.js)
      'wood_production',
      'stone_production',
      'travel_speed',         // EconomyCore.getTravelTime
      'city_slots',           // EconomyCore.getCitySlots  → server/actions/city-found.js
      'lord_slots',           // EconomyCore.getLordSlots  → server/actions/lord-create.js
      'espionage_power',      // server/combat-resolver.js _gatherScoutReport
    ]);
    return Object.values(RESEARCH_DEFS).every(d =>
      Object.keys(d.bonuses(1)).every(k => LIVE.has(k)));
  })());

check('every book declares a tier that exists',
  Object.values(RESEARCH_DEFS).every(d => RESEARCH_TIERS[d.tier] != null));

// The id is load-bearing: player.research is keyed by it, so renaming the
// book to "Slave Chronicles" deliberately did NOT rename engineering_tomes.
check('engineering_tomes keeps its id through the rename',
  RESEARCH_DEFS.engineering_tomes?.name === 'Slave Chronicles' &&
  RESEARCH_DEFS.engineering_tomes?.id === 'engineering_tomes');

const fx = EconomyCore.getResearchEffects({ engineering_tomes: 2, cartography: 5 });
check('getResearchEffects sums bonus keys across books',
  Math.abs(fx.construction_speed - (-0.03)) < 1e-9 &&
  Math.abs(fx.march_food_cost - (-0.05)) < 1e-9 &&
  Math.abs(fx.travel_speed - 1.50) < 1e-9);

// Slave Chronicles is an odd ladder: 1/3/5/7/9% over its first five volumes.
check('Slave Chronicles follows the 1/3/5/7/9% ladder',
  [1, 3, 5, 7, 9].every((pct, i) =>
    Math.abs(RESEARCH_DEFS.engineering_tomes.bonuses(i + 1).construction_speed + pct / 100) < 1e-9));

// Cartography is −1% per volume, and since 2026-08-03 also +30% march SPEED
// per volume — OGame's Hyperspace Drive, which is what Nacho asked this book to
// be modelled on. Both keys: the drive conversion kept the food discount rather
// than replacing it.
check('Cartography is −1% march food and +30% march speed per level',
  Math.abs(RESEARCH_DEFS.cartography.bonuses(7).march_food_cost - (-0.07)) < 1e-9 &&
  Math.abs(RESEARCH_DEFS.cartography.bonuses(1).travel_speed - 0.30) < 1e-9 &&
  Math.abs(RESEARCH_DEFS.cartography.bonuses(5).travel_speed - 1.50) < 1e-9);

// ── OGame price import (2026-08-03) ───────────────────────────
// Four books carry OGame's own research costs verbatim, on OGame's own factor,
// metal→wood / crystal→stone / deuterium→food. Pin the Lv1 vectors: these are
// QUOTED numbers, so a silent edit here is a transcription error, not a
// balance call, and should fail loudly rather than drift.
check('the four OGame-priced books quote their source costs at Lv1',
  (() => {
    const at1 = id => RESEARCH_DEFS[id].cost(1);
    const eq  = (got, want) => Object.keys(want).every(k => got[k] === want[k]);
    return eq(at1('cartography'),       { wood: 10000, stone: 20000, food: 6000 })  // Hyperspace Drive
        && eq(at1('frontier_charters'), { wood:  4000, stone:  8000, food: 4000 })  // Astrophysics
        && eq(at1('codes_of_command'),  {              stone:   400, food:  600 })  // Computer Technology
        && eq(at1('spymasters_ledger'), { wood:   200, stone:  1000, food:  200 }); // Espionage Technology
  })());

// Astrophysics is the one OGame research NOT on a doubling curve (×1.75); the
// other three double. Checked as a RATIO so it survives a future base change.
check('OGame factors: Charters ×1.75, the other three ×2',
  Math.abs(RESEARCH_DEFS.frontier_charters.cost(2).stone / RESEARCH_DEFS.frontier_charters.cost(1).stone - 1.75) < 0.01 &&
  Math.abs(RESEARCH_DEFS.cartography.cost(2).wood        / RESEARCH_DEFS.cartography.cost(1).wood        - 2) < 0.01 &&
  Math.abs(RESEARCH_DEFS.codes_of_command.cost(2).food   / RESEARCH_DEFS.codes_of_command.cost(1).food   - 2) < 0.01 &&
  Math.abs(RESEARCH_DEFS.spymasters_ledger.cost(2).stone / RESEARCH_DEFS.spymasters_ledger.cost(1).stone - 2) < 0.01);

// ── Expansion slots (Frontier Charters / Codes of Command) ────
// These replaced the flat MAX_CITIES / MAX_LORDS = 7 constants, which had
// already drifted into five hand-copied values (server 7/7, city.js 7,
// lord.js 7, map-view.js 5, overview-screen.js 5/5). One formula now, and
// NO CEILING — the doubling gold price and the research curve are the limiters.
check('city slots follow OGame Astrophysics: 1 + ceil(level/2), uncapped',
  [[0, 1], [1, 2], [2, 2], [3, 3], [4, 3], [12, 7], [40, 21]].every(([lvl, want]) =>
    EconomyCore.getCitySlots(EconomyCore.getResearchEffects({ frontier_charters: lvl })) === want));

check('lord slots follow OGame Computer Tech: 1 + level, uncapped',
  [[0, 1], [1, 2], [6, 7], [30, 31]].every(([lvl, want]) =>
    EconomyCore.getLordSlots(EconomyCore.getResearchEffects({ codes_of_command: lvl })) === want));

// The founding city and founding lord are not purchasable and must survive a
// junk save — a negative or fractional key must never take them away.
check('slot formulas floor at the free founding city/lord',
  EconomyCore.getCitySlots({}) === 1 &&
  EconomyCore.getLordSlots({}) === 1 &&
  EconomyCore.getCitySlots({ city_slots: -5 })  === 1 &&
  EconomyCore.getLordSlots({ lord_slots: 2.7 }) === 3);

// Espionage is the only book whose key is read RELATIVELY (scout level minus
// target level, in server/combat-resolver.js _gatherScoutReport). All this end
// has to guarantee is that the key is an honest integer count.
check("Spymaster's Ledger emits its level as an integer count",
  [1, 4, 9].every(lvl =>
    EconomyCore.getResearchEffects({ spymasters_ledger: lvl }).espionage_power === lvl));

// ── City tiers & building slots ───────────────────────────────
section('City tiers & building slots');

// The ladder Nacho set on 2026-08-04, pinned as literals because they ARE the
// design. Tier 6 (200k pop) was deleted in the same pass: tier 5 already pays
// 200 slots, so it granted nothing.
check('slot ladder is 50/100/125/150/200 over five tiers',
  JSON.stringify(EconomyCore.SLOT_TABLE.map(r => [r.level, r.minPop, r.maxSlots])) ===
  JSON.stringify([[1, 0], [2, 10000], [3, 25000], [4, 50000], [5, 100000]]
    .map(([lvl, pop], i) => [lvl, pop, [50, 100, 125, 150, 200][i]])));

// A ladder that dips would hand a growing city FEWER slots than it already
// filled — and tier is a ratchet off peakPopulation, so nothing would ever
// take those buildings back. Both columns must climb.
check('tiers, thresholds and slot counts all ascend strictly',
  EconomyCore.SLOT_TABLE.every((r, i, a) => i === 0
    ? (r.level === 1 && r.minPop === 0)
    : (r.level > a[i - 1].level && r.minPop > a[i - 1].minPop && r.maxSlots > a[i - 1].maxSlots)));

// THE check that makes deleting a tier safe. A `city_tier` gate pointing at a
// tier the ladder no longer has is unreachable content: building-unlock.js
// finds no SLOT_TABLE row and prints "Requires City Tier 6 (0+ population)"
// on a building nobody can ever raise.
check('every city_tier building gate names a tier the ladder has',
  (() => {
    const levels = new Set(EconomyCore.SLOT_TABLE.map(r => r.level));
    const bad = Object.entries(BUILDING_DEFS)
      .flatMap(([id, d]) => (d.unlockRequires || [])
        .filter(r => r.type === 'city_tier' && !levels.has(r.minTier))
        .map(r => `${id}→T${r.minTier}`));
    return bad.length === 0;
  })());

// getSlotInfo reads PEAK population upstream (city-stats.js); here we only pin
// that the lookup floors on tier 1 rather than falling off the front of the
// table, and that a pop past the top rung stays on the top rung.
check('slot lookup floors at tier 1 and saturates at the top tier',
  EconomyCore.getSlotInfo({}, 0).maxSlots === 50 &&
  EconomyCore.getSlotInfo({}, 0).level === 1 &&
  EconomyCore.getCityLevel(9999) === 1 &&
  EconomyCore.getCityLevel(100000) === 5 &&
  EconomyCore.getCityLevel(5000000) === 5 &&
  EconomyCore.getSlotInfo({}, 5000000).maxSlots === 200);

check('usedSlots counts every building level, not every building',
  EconomyCore.getSlotInfo({ farm: 3, lumber_mill: 2 }, 1000).usedSlots === 5);

// ── No hardcoded level ceilings (2026-07-30) ──────────────────
// Nothing in the game should cap out at an arbitrary level: cost growth is the
// limiter. Buildings were already Infinity; the two tomes were the outliers.
check('no research book carries a finite maxLevel',
  Object.values(RESEARCH_DEFS).every(d => d.maxLevel === Infinity));

check('no building carries a finite maxLevel',
  Object.values(BUILDING_DEFS).every(d => d.maxLevel === Infinity));

// Uncapped levels only stay safe because every consumer clamps. Guard the
// clamps directly — an unclamped key plus an uncapped tome is unbounded.
check('deep tome levels stay inside the −80% clamps',
  EconomyCore.getBuildTime(BUILDING_DEFS.library, 1, null, { construction_speed: -5 }) ===
    Math.max(5, Math.round(BUILDING_DEFS.library.buildTime(1) * 0.2)) &&
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1, { recruit_speed: -5 }) === Math.round(600 * 0.2) &&
  EconomyCore.getMarchFoodCost(1, [{ unitId: 'spearmen', count: 1 }], { march_food_cost: -5 }) ===
    Math.floor(1 * 95 * 0.2));

// getRates was the ONE unclamped multiplier path (fixed 2026-07-30 alongside
// the cap removal, since a production tome would otherwise scale without limit).
check('production bonuses are clamped, not unbounded',
  EconomyCore.getRates({ lumber_mill: 1 }, { wood_production: 999 }, null).wood ===
  Math.floor(og(30, 1) * 4) &&
  EconomyCore.getRates({ lumber_mill: 1 }, { wood_production: -999 }, null).wood ===
  Math.floor(og(30, 1) * 0.1));

check('getResearchEffects ignores books that no longer exist (orphan keys)',
  Object.keys(EconomyCore.getResearchEffects({ agronomy_tomes: 5, drill_manuals: 3 })).length === 0);

check('research production bonus stacks with race in getRates',
  EconomyCore.getRates({ lumber_mill: 1 }, { wood_production: 0.30 + 0.20 }, null).wood === Math.floor(og(30, 1) * 1.5));

check('getBuildTime composes race + research construction_speed (−20% + −20% → ×0.6)',
  EconomyCore.getBuildTime(BUILDING_DEFS.town_hall, 1, RACES.dwarf.bonuses, { construction_speed: -0.20 }) ===
  Math.round(BUILDING_DEFS.town_hall.buildTime(1) * 0.6));

// Divisor is LINEAR (Lv N = ÷(1+N)), not 2**N. It was 2**N until 2026-07-30,
// which meant ÷1024 at Town Hall 10 and collapsed nearly every build to the
// max(5, …) floor — a Fortress Lv10 finished in 69s and construction time
// stopped being a cost at all. Guard the linearity explicitly: an exponential
// divisor is the single easiest way to delete the build-time gate by accident.
check('Town Hall divides build time linearly (Lv1 ÷2, Lv5 ÷6, Lv10 ÷11)',
  BUILDING_DEFS.town_hall.buildTimeDivisor(1)  === 2  &&
  BUILDING_DEFS.town_hall.buildTimeDivisor(5)  === 6  &&
  BUILDING_DEFS.town_hall.buildTimeDivisor(10) === 11 &&
  EconomyCore.getCityBuildDivisor({ town_hall: 5, farm: 3 }) === 6 &&
  EconomyCore.getBuildTime(BUILDING_DEFS.library, 1, null, null, { town_hall: 1 }) ===
  Math.round(BUILDING_DEFS.library.buildTime(1) / 2) &&
  EconomyCore.getBuildTime(BUILDING_DEFS.dragon_lair, 1, null, null, { town_hall: 5 }) ===
  Math.round(BUILDING_DEFS.dragon_lair.buildTime(1) / 6));

check('a high Town Hall no longer trivialises a late build (Fortress Lv10 stays minutes, not seconds)',
  EconomyCore.getBuildTime(BUILDING_DEFS.fortress, 10, null, null, { town_hall: 10 }) > 600);

check('race/research % applies on top of the Town Hall divisor (5s floor holds)',
  EconomyCore.getBuildTime(BUILDING_DEFS.library, 1, RACES.dwarf.bonuses, { construction_speed: -0.20 }, { town_hall: 4 }) ===
  Math.max(5, Math.round(BUILDING_DEFS.library.buildTime(1) * 0.6 / 5)));

check('getRecruitTime applies recruit_speed (−20% → ×0.8)',
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 2, { recruit_speed: -0.20 }) === Math.round(600 * 2 * 0.8));

// ── Hangar rule + military chain + veterancy (2026-07-27) ──────
check('hangar rule: training-building levels above the gate divide recruit time',
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1, null, 1, 1) === 600 &&   // at unlock: ÷1
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1, null, 5, 1) === 120 &&   // 4 above: ÷5
  EconomyCore.getRecruitTime({ recruitTime: 21600 }, 1, null, 12, 8) === Math.round(21600 / 5));

check('getUnitTraining finds the roster gate',
  JSON.stringify(EconomyCore.getUnitTraining('human', 'spearmen')) === JSON.stringify({ buildingId: 'barracks', minLevel: 1 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('human', 'greatswords')) === JSON.stringify({ buildingId: 'barracks', minLevel: 10 }) &&
  EconomyCore.getUnitTraining('human', 'bandits') === null); // mercs have no training building

check('military chain: each war building requires its predecessor',
  BUILDING_DEFS.archery_range.requires.barracks === 3 &&
  BUILDING_DEFS.stables.requires.barracks === 5 &&
  BUILDING_DEFS.gunpowder_workshop.requires.archery_range === 3 &&
  BUILDING_DEFS.engineering_workshop.requires.archery_range === 5 &&
  BUILDING_DEFS.eagle_tower.requires.archery_range === 6 &&
  BUILDING_DEFS.slayer_lodge.requires.barracks === 6 &&
  BUILDING_DEFS.monster_pit.requires.barracks === 8 &&
  BUILDING_DEFS.dragon_lair.requires.barracks === 12);

check('veterancy: +2%/level of the training building, SUMMED across cities',
  Math.abs(EconomyCore.getVeterancyPct('human', 'spearmen', [{ barracks: 5 }, { barracks: 3 }]) - 0.16) < 1e-9 &&
  EconomyCore.getVeterancyPct('human', 'bandits', [{ barracks: 5 }]) === 0 && // mercs unbuffed
  Math.abs(EconomyCore.getGarrisonVeterancyPct({ guard_post: 3, fortress: 2 }) - 0.10) < 1e-9);

check('elite gates hold: Black Orcs Barracks 10 (apex spread), 6h',
  UNIT_DEFS.black_orcs.recruitTime === 21600 &&
  JSON.stringify(EconomyCore.getUnitTraining('orc', 'black_orcs')) === JSON.stringify({ buildingId: 'barracks', minLevel: 10 }));

// Gold tracks PWR (2026-07-27): every priced unit must match the formula
// goldCost = PWR × GOLD_PER_PWR × tier premium (EconomyCore.getUnitGoldCost).
// The multiplier went 3.5 → 12.0 on 2026-07-30; this message said "× 3.5" for
// three days after, which is exactly the drift the check exists to prevent —
// so it now reads the live constant instead of restating it.
// Camp-defender-only units (goldCost 0) are exempt — 0 is their marker.
const _misPriced = Object.values(UNIT_DEFS)
  .filter(u => !(u.race === null && u.goldCost === 0))
  .filter(u => u.goldCost !== EconomyCore.getUnitGoldCost(u));
check('every priced unit follows goldCost = PWR × GOLD_PER_PWR × tier premium',
  _misPriced.length === 0, _misPriced.map(u => `${u.id} ${u.goldCost}≠${EconomyCore.getUnitGoldCost(u)}`).join(', '));

// New TWW3 roster (2026-07-27): every race fields the full building chain.
const _rosterIds = Object.values(UNIT_ROSTER ?? {}).flatMap(r =>
  Object.values(r).flatMap(lvlMap => Object.values(lvlMap).flat()));
const _missingDefs = _rosterIds.filter(id => !UNIT_DEFS[id]);
check('every UNIT_ROSTER entry has a UNIT_DEFS definition',
  _missingDefs.length === 0, _missingDefs.join(', '));
check('TWW3 tier units are gated in the roster',
  JSON.stringify(EconomyCore.getUnitTraining('human', 'demigryph_knights')) === JSON.stringify({ buildingId: 'stables', minLevel: 10 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('dark_elf', 'black_guard_naggarond')) === JSON.stringify({ buildingId: 'barracks', minLevel: 12 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('high_elf', 'sun_dragon')) === JSON.stringify({ buildingId: 'dragon_lair', minLevel: 1 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('high_elf', 'frostheart_phoenix')) === JSON.stringify({ buildingId: 'dragon_lair', minLevel: 3 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('dwarf', 'quarrellers')) === JSON.stringify({ buildingId: 'archery_range', minLevel: 3 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('dwarf', 'thunderers')) === JSON.stringify({ buildingId: 'engineering_workshop', minLevel: 1 }));

check('Cartography discounts march food (lone lord 1 tile: 50 → 46 at max −7%)',
  EconomyCore.getMarchFoodCost(1, null, { march_food_cost: -0.07 }) === 46);

// ── Raiding stance ──────────────────────────────────────────────
// One rate, three consumers: the server payout (catch-up.js), the lord-screen
// preview, and the published raid guide all call getRaidHourlyRewards.
section('Raiding stance');

// Compared with JSON.stringify, so this pins KEY ORDER as well as values —
// deliberately: the payout object is rendered as-is by the raid chips, and the
// canonical order is gold → wood → stone → food (EconomyCore.RESOURCE_KEYS).
check('raid rate = base + perLevel × lord level, all 3 resources equal',
  JSON.stringify(EconomyCore.getRaidHourlyRewards(8)) ===
    JSON.stringify({ gold: 400, wood: 500, stone: 500, food: 500 }) &&
  JSON.stringify(EconomyCore.getRaidHourlyRewards(1)) ===
    JSON.stringify({ gold: 85, wood: 115, stone: 115, food: 115 }));

check('raid rate is defined by the exported tunables (guide reads these)',
  EconomyCore.RAID_BASE.gold === 40 && EconomyCore.RAID_PER_LEVEL.gold === 45 &&
  EconomyCore.RAID_BASE.res === 60  && EconomyCore.RAID_PER_LEVEL.res === 55);

check('raid rate floors at level 1 for a missing/zero level',
  JSON.stringify(EconomyCore.getRaidHourlyRewards(0)) ===
    JSON.stringify(EconomyCore.getRaidHourlyRewards(1)) &&
  JSON.stringify(EconomyCore.getRaidHourlyRewards(undefined)) ===
    JSON.stringify(EconomyCore.getRaidHourlyRewards(1)));

// THE guard on the 2026-08-03 level-cap raise. Raiding is a linear-in-level
// income line, so a max level of 20 read raw would have taken a maxed lord from
// 490 to 940 gold/hour — a doubled endgame on a curve that was measured at
// level 10. Same story for expedition loot. Both must plateau.
check('raid rate plateaus at LORD_POWER_LEVEL_CAP — levels 11-20 pay no income',
  JSON.stringify(EconomyCore.getRaidHourlyRewards(LORD_MAX_LEVEL)) ===
    JSON.stringify(EconomyCore.getRaidHourlyRewards(LORD_POWER_LEVEL_CAP)),
  `L${LORD_MAX_LEVEL} ${EconomyCore.getRaidHourlyRewards(LORD_MAX_LEVEL).gold}g/h vs `
  + `L${LORD_POWER_LEVEL_CAP} ${EconomyCore.getRaidHourlyRewards(LORD_POWER_LEVEL_CAP).gold}g/h`);

// The 2026-07-29 bump exists because raiding was not worth the stance. Pin the
// relationship rather than the raw number: a day of raiding must beat an hour
// of the Temple blessing it is meant to help pay for.
check('a 24h raid at Lv 8 out-earns an hour of blessing by a wide margin',
  EconomyCore.getRaidHourlyRewards(8).gold * 24 > blessingCost(1, 'god_of_destruction').gold * 2);

// ── Lord ransom (repriced quadratic 2026-07-30, Phase 2b) ───────
// Was 300 + 150×level = 1,800 gold for a level-10 lord, about fifteen minutes
// of endgame gold income. The bound that matters is the relationship, not the
// literal: freeing a maxed lord must cost more than re-arming one, or capture
// is not a real PvP outcome.
check('ransoming a maxed lord costs more than a full army for one',
  lordRansomCost(10) > 30000 &&
  lordRansomCost(10) > EconomyCore.getUnitGoldCost(UNIT_DEFS.swordsmen) * 18,
  `L10 ransom ${lordRansomCost(10)}`);

// ── Lord leveling & talents (cap raised 10 → 20, 2026-08-03) ────
// The shape of the change: the level cap doubled, the POWER curve did not.
// Levels 11–20 pay in stats and talent slots only. These checks pin that split
// — see the two-halves block in js/data/lord-classes.js.
section('Lord leveling & talents');

check('level cap is 20, power curve freezes at 10',
  LORD_MAX_LEVEL === 20 && LORD_POWER_LEVEL_CAP === 10 &&
  lordPowerLevel(1) === 1 && lordPowerLevel(10) === 10 &&
  lordPowerLevel(11) === 10 && lordPowerLevel(LORD_MAX_LEVEL) === 10 &&
  lordPowerLevel(0) === 1 && lordPowerLevel(undefined) === 1);

// The four PWR-cap copies (lord.js, recruit.js, army-transfer.js, catch-up.js)
// all build on lordArmyPowerCapBase, so pinning it pins all four.
check('army PWR cap climbs to 1000 at level 10 and stops',
  lordArmyPowerCapBase(1)  === 280  &&
  lordArmyPowerCapBase(10) === 1000 &&
  lordArmyPowerCapBase(11) === 1000 &&
  lordArmyPowerCapBase(LORD_MAX_LEVEL) === 1000);

// The cap is what the ambush curve is tuned against — if the freeze ever comes
// off, discovery-roll.js's OVERMATCH_MAX becomes reachable-and-then-some and
// every endgame expedition changes shape.
check('the ambush ceiling still bounds a maxed lord + strategist talent',
  lordArmyPowerCapBase(LORD_MAX_LEVEL) + TALENT_POOL.strategist.effects.armyPowerCapBonus
    === DiscoveryRoll.OVERMATCH_MAX);

// Expedition loot is the other linear-in-level income line, and it is the
// biggest one in the game. rollRewards draws from a fixed band and multiplies
// by the level scalar, so a level-20 payout can NEVER exceed what the level-10
// scalar allows — unless the freeze comes off, in which case ~63% of draws
// break the ceiling and 400 samples catch it with certainty.
const _goldDef  = Object.values(DISCOVERY_DEFS).find(d =>
  d.category !== 'combat' && d.id !== 'lost_treasure' && DiscoveryRoll.BASE_REWARDS[d.id]?.gold > 0);
const _goldBand = DiscoveryRoll.TIER_RANGES[_goldDef.tier || 2].gold;
const _ceil10   = Math.floor(_goldBand[1]
  * (1 + DiscoveryRoll.LEVEL_SCALAR_PER_LEVEL * (LORD_POWER_LEVEL_CAP - 1))
  * DiscoveryRoll.lengthOf(undefined).reward
  * tune('questGold'));
const _maxAt20  = Math.max(...Array.from({ length: 400 }, () =>
  DiscoveryRoll.rollRewards(_goldDef, LORD_MAX_LEVEL, { depletion: 1 })
    .find(r => r.type === 'gold').amount));
check('expedition loot scalar plateaus at the power cap too',
  _maxAt20 <= _ceil10,
  `${_goldDef.id}: best of 400 rolls at L${LORD_MAX_LEVEL} was ${_maxAt20}, L${LORD_POWER_LEVEL_CAP} ceiling is ${_ceil10}`);

check('four talent slots, one every fifth level',
  MAX_TALENTS === 4 &&
  JSON.stringify(TALENT_LEVELS) === JSON.stringify([5, 10, 15, 20]) &&
  TALENT_LEVELS[TALENT_LEVELS.length - 1] === LORD_MAX_LEVEL &&
  lordTalentSlots(1) === 0 && lordTalentSlots(4)  === 0 &&
  lordTalentSlots(5) === 1 && lordTalentSlots(14) === 2 &&
  lordTalentSlots(15) === 3 && lordTalentSlots(20) === 4);

check('nextTalentLevel names the level that opens the next slot',
  nextTalentLevel(1) === 5 && nextTalentLevel(5) === 10 &&
  nextTalentLevel(19) === 20 && nextTalentLevel(20) === null);

// The pool must stay bigger than the budget, or the four picks stop being a
// build and become a checklist.
check('the talent pool offers more than a maxed lord can hold',
  Object.keys(TALENT_POOL).length > MAX_TALENTS);

// Read-time migration off the pre-2026-08-03 single `talentId`. No backfill was
// run, so every existing lord takes this path on their next read.
check('a legacy single-talent lord migrates into slot 1',
  JSON.stringify(getLordTalentIds({ level: 7, talentId: 'strategist' })) ===
    JSON.stringify(['strategist']));

// A lord holding a RETIRED id must get the slot back rather than being stuck
// holding a talent with no effect — the rule server/actions/lord-talents.js
// depends on to let them re-pick.
check('a retired talent id frees its slot instead of sticking',
  getLordTalentIds({ level: 20, talentIds: ['commander', 'blademaster'] }).length === 1 &&
  getLordTalentIds({ level: 20, talentIds: ['commander', 'blademaster'] })[0] === 'blademaster');

check('held talents never exceed what the level has earned',
  getLordTalentIds({ level: 5,  talentIds: ['blademaster', 'iron_wall'] }).length === 1 &&
  getLordTalentIds({ level: 1,  talentIds: ['blademaster'] }).length === 0 &&
  getLordTalentIds({ level: 20, talentIds: ['blademaster', 'blademaster'] }).length === 1);

// THE merge contract. Flat bonuses add, multipliers compound, traits union —
// and the result keeps the SHAPE of one talent's `effects`, which is what lets
// battle-engine/combat-resolver/recruit/catch-up read it unchanged.
const _merged = mergeTalentEffects(['blademaster', 'iron_wall', 'strategist', 'inspiring']);
check('talent effects merge: flat bonuses add, traits union',
  _merged.battleUnitAttackBonus  === 4   &&
  _merged.battleUnitDefenseBonus === 4   &&
  _merged.armyPowerCapBonus      === 100 &&
  _merged.attackerMoraleBonus    === 10  &&
  _merged.battleUnitTraits.includes('armor_piercing') &&
  _merged.battleUnitTraits.includes('shield_wall')    &&
  _merged.battleUnitTraits.length === 2);

// Duration multipliers COMPOUND. If a mult key ever fell through to the
// additive branch, ×0.75 would become +0.75 — a 75% LONGER expedition instead
// of a 25% shorter one, silently, on the one talent that sells speed.
check('duration multipliers compound rather than add',
  Math.abs(mergeTalentEffects(['pathfinder']).searchDurationMult - 0.75) < 1e-9 &&
  Math.abs(mergeTalentEffects(['drillmaster']).recruitTimeMult   - 0.7)  < 1e-9 &&
  Math.abs(mergeTalentEffects(['pathfinder', 'drillmaster']).searchDurationMult - 0.75) < 1e-9 &&
  mergeTalentEffects([]).searchDurationMult === undefined);

check('lordTalentEffects merges what the lord actually holds',
  lordTalentEffects({ level: 20, talentIds: ['blademaster', 'iron_wall'] }).battleUnitAttackBonus === 4 &&
  JSON.stringify(lordTalentEffects({ level: 1, talentIds: ['blademaster'] })) === '{}' &&
  JSON.stringify(lordTalentEffects(null)) === '{}');

// Legendary units gate on lord level 12 (unit-unlock.js). Under the old cap of
// 10 that was UNREACHABLE — the raise is what makes them recruitable at all.
check('the legendary lord-level gate is reachable under the new cap',
  UnitUnlockService.LEGENDARY_LORD_LEVEL <= LORD_MAX_LEVEL &&
  UnitUnlockService.LEGENDARY_LORD_LEVEL > LORD_POWER_LEVEL_CAP);

check('ransom stays trivial for a fresh lord and scales superlinearly',
  lordRansomCost(1) < 1000 &&
  lordRansomCost(10) / lordRansomCost(5) > 3);

// ── Tuning dials (js/data/tuning.js) ────────────────────────────
// The dials are the designer-facing surface: one number per income/time
// channel, meant to be edited without touching code. Two things must hold —
// every dial ships at 1.0 (so a fresh clone is the designed game), and each one
// actually MOVES its channel and only its channel.
section('Tuning dials');

// Deliberately does NOT assert 1.0 — a tuned repo is a legitimate state, and
// failing here would punish using the file. What must hold is that every dial
// is a usable number, since a typo'd string or negative would silently be
// swallowed by tune()'s fallback and the game would quietly play at 1.0.
check('every dial is a valid non-negative number',
  Object.keys(_designerDials).length > 0 &&
  Object.values(_designerDials).every(v => typeof v === 'number' && isFinite(v) && v >= 0),
  JSON.stringify(_designerDials));

const _tuned = Object.entries(_designerDials).filter(([, v]) => v !== 1);
console.log(_tuned.length === 0
  ? '  · dials: all at 1.0 (shipped defaults)'
  : `  · dials TUNED: ${_tuned.map(([k, v]) => `${k}=${v}`).join(' · ')} — neutralised for the formula checks above`);

check('the documented dial set is exactly what exists',
  JSON.stringify(Object.keys(TUNING).sort()) === JSON.stringify([
    'buildTime', 'buildingProduction', 'populationGold', 'questGold', 'questResources',
    'raidGold', 'raidResources', 'travelTime',
  ]));

check('tune() falls back to 1.0 for an unknown or malformed dial',
  tune('no_such_dial') === 1 && tune(undefined) === 1);

// Each dial is exercised by mutating TUNING, re-reading through the real
// function, then restoring. This proves the wiring, not just the constant.
function withDial(key, value, fn) {
  const prev = TUNING[key];
  TUNING[key] = value;
  try { return fn(); } finally { TUNING[key] = prev; }
}

const _baseRates = EconomyCore.getRates({ lumber_mill: 5 }, null, null).wood;
check('buildingProduction scales the 3 resource buildings',
  withDial('buildingProduction', 2, () => EconomyCore.getRates({ lumber_mill: 5 }, null, null).wood) === _baseRates * 2 &&
  withDial('buildingProduction', 0, () => EconomyCore.getRates({ lumber_mill: 5 }, null, null).wood) === 0);

// No marketplace + happiness 100 keeps the underlying rate a whole number
// (50,000 × 0.004 × 1.0 = 200), so the dial can be asserted exactly. With a
// fractional rate the dial applies BEFORE the floor — 198.4×3 floors to 595,
// not 198×3 — which is more accurate but not exactly divisible.
const _baseGold = EconomyCore.getGoldRate({}, 50000, 100);
check('populationGold scales city tax income',
  _baseGold === 200 &&
  withDial('populationGold', 3,   () => EconomyCore.getGoldRate({}, 50000, 100)) === 600 &&
  withDial('populationGold', 0.5, () => EconomyCore.getGoldRate({}, 50000, 100)) === 100);

const _baseRaid = EconomyCore.getRaidHourlyRewards(8);
check('raidGold and raidResources move independently',
  withDial('raidGold', 2, () => EconomyCore.getRaidHourlyRewards(8).gold) === _baseRaid.gold * 2 &&
  withDial('raidGold', 2, () => EconomyCore.getRaidHourlyRewards(8).wood) === _baseRaid.wood &&
  withDial('raidResources', 2, () => EconomyCore.getRaidHourlyRewards(8).wood) === _baseRaid.wood * 2 &&
  withDial('raidResources', 2, () => EconomyCore.getRaidHourlyRewards(8).gold) === _baseRaid.gold);

// Quest loot is a random draw from a band, so compare MEANS over enough samples
// rather than single rolls or ranges — the tier-1 band spans 800-5,000 (6.25x),
// wider than a small dial, so the ranges legitimately overlap and a min/max
// comparison would be flaky. 200 samples puts the mean's 3-sigma inside ~9%,
// so a 3x dial checked with 20% tolerance is stable.
const _questMean = mult => withDial('questResources', mult, () => {
  let sum = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const r = DiscoveryRoll.rollRewards(DISCOVERY_DEFS.fertile_fields, 1, { lengthId: 'standard' })
      .find(x => x.type === 'food');
    if (r) { sum += r.amount; n++; }
  }
  return n > 0 ? sum / n : 0;
});
const _qRatio = _questMean(3) / _questMean(1);
check('questResources scales expedition loot',
  _questMean(0) === 0 && _qRatio > 2.5 && _qRatio < 3.5,
  `x3 measured as x${_qRatio.toFixed(2)}`);

check('questGold and questResources are separate dials',
  withDial('questGold', 0, () => {
    const r = DiscoveryRoll.rollRewards(DISCOVERY_DEFS.fertile_fields, 1, { lengthId: 'standard' });
    return (r.find(x => x.type === 'food')?.amount || 0) > 0;   // resources untouched
  }) === true);

// Travel time: the formula used to be hand-copied in five places, so pin both
// the base rate and the dial on the shared function.
check('getTravelTime is 20s/tile at speed 5, scaled by speed',
  EconomyCore.getTravelTime(1, 5) === 20 &&
  EconomyCore.getTravelTime(5, 5) === 100 &&
  EconomyCore.getTravelTime(5, 10) === 50);

check('getTravelTime honours the attack-intent floor even at distance 0',
  EconomyCore.getTravelTime(0, 5) === 0 &&
  EconomyCore.getTravelTime(0, 5, { minSecs: 60 }) === 60);

// Cartography's travel_speed (2026-08-03) — the OGame drive is ADDITIVE on base
// speed, so it DIVIDES the march: +30% is time ÷ 1.3, NOT time × 0.7. Getting
// that backwards is the whole reason this is pinned.
check('travel_speed divides the march, drive-style',
  EconomyCore.getTravelTime(5, 5, { researchEffects: { travel_speed: 0.30 } }) === Math.round(100 / 1.3) &&
  EconomyCore.getTravelTime(5, 5, { researchEffects: { travel_speed: 1.50 } }) === 40 &&
  EconomyCore.getTravelTime(5, 5, { researchEffects: {} }) === 100 &&
  EconomyCore.getTravelTime(5, 5) === 100);

// Bounded like every other multiplier in economy-core (floor 0.2 = a hard ×5
// speed ceiling), and immune to a negative key inventing a slower march.
check('travel_speed is floored at ×5 and ignores negative keys',
  EconomyCore.getTravelTime(5, 5, { researchEffects: { travel_speed: 99 } }) === 20 &&
  EconomyCore.getTravelTime(5, 5, { researchEffects: { travel_speed: -0.9 } }) === 100);

// The attack floor outranks the drive: a fast lord with deep Cartography still
// gives the defender their 60s warning window.
check('the attack-intent floor still wins over travel_speed',
  EconomyCore.getTravelTime(1, 10, { minSecs: 60, researchEffects: { travel_speed: 3 } }) === 60);

check('travelTime dial stretches and compresses marches',
  withDial('travelTime', 2,   () => EconomyCore.getTravelTime(5, 5)) === 200 &&
  withDial('travelTime', 0.5, () => EconomyCore.getTravelTime(5, 5)) === 50);

// Slowing travel must not quietly make marching more expensive — march food is
// charged per TILE, not per second.
check('travelTime does not change march food cost',
  withDial('travelTime', 5, () => EconomyCore.getMarchFoodCost(3, [{ unitId: 'spearmen', count: 4 }], null)) ===
  EconomyCore.getMarchFoodCost(3, [{ unitId: 'spearmen', count: 4 }], null));

// buildTime (2026-08-04). Uses a LATE, expensive building so the assertions are
// nowhere near the max(5, …) floor — pinned on a cheap one, a dial of 3 could
// read as "correct" purely because both sides clamped to 5.
const _btDef = BUILDING_DEFS.fortress;
check('buildTime dial scales construction both ways',
  withDial('buildTime', 3,     () => EconomyCore.getBuildTime(_btDef, 5, null, null, null)) ===
    Math.round(_btDef.buildTime(5) * 3) &&
  withDial('buildTime', 1 / 3, () => EconomyCore.getBuildTime(_btDef, 5, null, null, null)) ===
    Math.round(_btDef.buildTime(5) / 3));

// The dial multiplies WITH the Town Hall divisor and the construction_speed %,
// it does not replace or short-circuit either. A dial that silently overrode
// the divisor would delete the Town Hall's entire reason to level.
check('buildTime composes with the Town Hall divisor and construction_speed',
  withDial('buildTime', 1 / 3, () =>
    EconomyCore.getBuildTime(_btDef, 5, null, { construction_speed: -0.20 }, { town_hall: 4 })) ===
  Math.max(5, Math.round(_btDef.buildTime(5) * 0.8 / 3 / 5)));

// The 5-second floor is the last word: no dial, however small, may produce an
// instant build. (A 0 dial must not yield a 0-second queue item either.)
check('buildTime cannot dial a build below the 5s floor',
  withDial('buildTime', 0.00001, () => EconomyCore.getBuildTime(_btDef, 10, null, null, null)) === 5 &&
  withDial('buildTime', 0,       () => EconomyCore.getBuildTime(_btDef, 10, null, null, null)) === 5);

// Build time is a PACING dial, not an economy one: it must not touch what a
// building costs, or the projection's resource curve would silently shift.
check('buildTime does not change what anything costs',
  JSON.stringify(withDial('buildTime', 3, () => _btDef.cost(5))) ===
  JSON.stringify(_btDef.cost(5)));

// ── The Merchant (MarketCore) ───────────────────────────────────
// Resources ⇄ gold, deliberately lossy in BOTH directions. The daily cap is
// currently OFF (Nacho, 2026-08-04), which makes the SPREAD the only thing
// standing between the merchant and a money pump — so that is what these
// checks defend hardest.
section('The Merchant');

check('MarketCore is exported by engine-loader (client == server source)', !!MarketCore);

check('both rate tables cover exactly the three tradable resources',
  JSON.stringify(Object.keys(MarketCore.MARKET_SELL_RATES).sort()) === JSON.stringify(['food', 'stone', 'wood']) &&
  JSON.stringify(Object.keys(MarketCore.MARKET_BUY_RATES).sort()) === JSON.stringify(['food', 'stone', 'wood']) &&
  JSON.stringify([...MarketCore.MARKET_RESOURCES].sort()) === JSON.stringify(['food', 'stone', 'wood']));

// Deliberately worse than production parity (~8 wood : 1 gold at comparable
// investment). If a rate ever drops under that, the merchant stops being a
// dump valve and starts being an income strategy.
check('every sell rate is worse than production parity (>= 10 : 1)',
  MarketCore.MARKET_RESOURCES.every(r => MarketCore.MARKET_SELL_RATES[r] >= 10));

// THE INVARIANT THE WHOLE FEATURE RESTS ON. Buy and sell are separate tables,
// so nothing structural stops someone "fixing" a rate into a loop where
// selling X and buying it back leaves you with more than you started. Checked
// per resource and as a full round trip, in units, not ratios — a ratio check
// would pass on rates that still round in the player's favour at small amounts.
check('no resource can be round-tripped for profit',
  MarketCore.MARKET_RESOURCES.every(r => {
    if (MarketCore.MARKET_BUY_RATES[r] >= MarketCore.MARKET_SELL_RATES[r]) return false;
    // Sell a big round amount, buy back with every coin it produced.
    const sold   = MarketCore.marketSellQuote(r, 1_000_000, null, Date.UTC(2026, 6, 30));
    const bought = MarketCore.marketBuyQuote(r, sold.gold, sold.gold);
    return bought.receive < sold.spend;
  }));

// And the reverse lap: gold → resources → gold must also lose.
check('gold cannot be round-tripped for profit either',
  MarketCore.MARKET_RESOURCES.every(r => {
    const bought = MarketCore.marketBuyQuote(r, 100_000, 100_000);
    const sold   = MarketCore.marketSellQuote(r, bought.receive, null, Date.UTC(2026, 6, 30));
    return sold.gold < bought.spend;
  }));

// NO BUILDING GATES THE MERCHANT, AND NO CAP IS IN FORCE (2026-08-04). It used
// to require a Marketplace and scale its cap off that building's level. Pinned
// explicitly because both regressions are silent — re-introducing a level
// argument would be ignored by these functions rather than throwing.
check('the merchant is ungated and uncapped',
  MarketCore.marketDailyCap() === null &&
  MarketCore.marketHasDailyCap() === false &&
  MarketCore.MARKET_GOLD_PER_MK_LEVEL === undefined &&
  MarketCore.MARKET_MIN_MARKETPLACE === undefined);

const _mkNow = Date.UTC(2026, 6, 30, 12, 0, 0);

check('a player with no buildings at all can still trade',
  MarketCore.marketSellQuote('wood', 100000, null, _mkNow).ok === true &&
  MarketCore.marketBuyQuote('wood', 100, 100).ok === true);

const _q1 = MarketCore.marketSellQuote('wood', 1000, null, _mkNow);
check('a plain sale converts at the published rate',
  _q1.ok && _q1.gold === Math.floor(1000 / MarketCore.MARKET_SELL_RATES.wood) &&
  _q1.spend === _q1.gold * MarketCore.MARKET_SELL_RATES.wood);

const _b1 = MarketCore.marketBuyQuote('wood', 1000, 5000);
check('a plain purchase converts at the published rate',
  _b1.ok && _b1.spend === 1000 && _b1.receive === 1000 * MarketCore.MARKET_BUY_RATES.wood);

// spend must always be an exact multiple of the rate — the player should never
// hand over a remainder that buys nothing.
check('spend never takes a remainder the player is not paid for',
  [1, 19, 20, 21, 999, 1234567].every(amt => {
    const q = MarketCore.marketSellQuote('wood', amt, null, _mkNow);
    return !q.ok || q.spend % MarketCore.MARKET_SELL_RATES.wood === 0;
  }));

check('a sale below one gold is rejected rather than eating the resources',
  MarketCore.marketSellQuote('wood', MarketCore.MARKET_SELL_RATES.wood - 1, null, _mkNow).ok === false);

// The buy-side equivalent of the same protection, plus the clamp that keeps a
// "spend it all" button honest when the purse moved under it.
check('a purchase is clamped to the purse and never goes negative',
  MarketCore.marketBuyQuote('wood', 999999, 250).spend === 250 &&
  MarketCore.marketBuyQuote('wood', 100, 0).ok === false &&
  MarketCore.marketBuyQuote('wood', 0, 5000).ok === false &&
  MarketCore.marketBuyQuote('wood', -50, 5000).ok === false);

check('neither side will trade a resource that is not tradable',
  MarketCore.marketSellQuote('iron', 1000, null, _mkNow).ok === false &&
  MarketCore.marketBuyQuote('iron', 1000, 5000).ok === false);

// WITH THE CAP OFF, nothing clamps a stockpile dump. Pinned as an explicit
// statement of the current design rather than left implicit — the day this
// starts failing is the day someone re-enabled the cap, which should be a
// deliberate act, not a surprise.
const _bigDump = MarketCore.marketSellQuote('wood', 3090000, null, _mkNow);
check('an uncapped merchant absorbs a full day of endgame resource income',
  _bigDump.ok && _bigDump.capped === false &&
  _bigDump.gold === Math.floor(3090000 / MarketCore.MARKET_SELL_RATES.wood));

// The ledger keeps recording while the cap is off, so switching the cap back on
// cannot hand anyone a fresh allowance they had already spent.
const _spent = MarketCore.marketRecord(null, 1200, _mkNow);
check('the ledger still accumulates within a day even with no cap',
  MarketCore.marketSoldToday(_spent, _mkNow) === 1200 &&
  MarketCore.marketSoldToday(MarketCore.marketRecord(_spent, 300, _mkNow), _mkNow) === 1500);

// The ledger resets on the UTC date rollover — the same date-key rule the
// expedition tile-depletion counter uses, so both age out identically.
const _tomorrow = _mkNow + 24 * 3600 * 1000;
check('the ledger resets on the UTC date rollover',
  MarketCore.marketSoldToday(_spent, _tomorrow) === 0);

// Uncapped, remaining volume is Infinity — NOT 0. A falsy check on this value
// would read "no trading allowed", the exact opposite of what it means, and
// would silently close the merchant for everyone.
check('remaining volume reads as unlimited, not as zero',
  MarketCore.marketRemainingToday(_spent, _mkNow) === Infinity &&
  MarketCore.marketRemainingToday(null, _mkNow) === Infinity);

// ⚠ WHAT UNCAPPING COSTS, stated in numbers so it is never a surprise. At
// endgame resource income (~3.09M/day, scripts/economy-projection.js) selling
// wood alone now out-earns every other gold channel combined (~145k/day). This
// check does not fail — it REPORTS. Nacho accepted this while testing; the fix,
// if it ever bites, is one number in market-core.js.
const ENDGAME_GOLD_PER_DAY = 145000;
const ENDGAME_RES_PER_DAY  = 3090000;
{
  const uncapped = MarketCore.marketSellQuote('wood', ENDGAME_RES_PER_DAY, null, _mkNow).gold;
  const pct      = Math.round((uncapped / ENDGAME_GOLD_PER_DAY) * 100);
  console.log(`  ⏭  merchant is UNCAPPED — a full day of wood converts to ${uncapped.toLocaleString()} gold`);
  console.log(`     = ${pct}% of all other endgame gold income (~${ENDGAME_GOLD_PER_DAY.toLocaleString()}/day).`);
  console.log(`     Accepted by Nacho 2026-08-04 for testing. Re-cap: MARKET_DAILY_GOLD_CAP in market-core.js.`);
}

// The one early-game guard that still holds without a cap: the RATE. A new
// player's entire starter kit is worth pocket change, so opening the merchant
// on day one is not a shortcut past the early game.
const STARTING_RESOURCES = 5000;   // server/actions/city-found.js first-city kit
const STARTING_GOLD      = 5000;   // server/action-base.js bootstrap
check('the starter kit is worth pocket change at the merchant',
  MarketCore.marketSellQuote('wood', STARTING_RESOURCES, null, _mkNow).gold < 500,
  `${MarketCore.marketSellQuote('wood', STARTING_RESOURCES, null, _mkNow).gold} gold from the full starter kit`);

// The buy side of the same question: spending the whole opening purse must not
// out-produce actually building the economy. A Lumber Mill Lv1 makes 33 wood/h,
// so the starting gold buys roughly a month of one mill — meaningful, not a
// replacement for building.
check('the opening purse buys a helpful, not decisive, amount of wood',
  MarketCore.marketBuyQuote('wood', STARTING_GOLD, STARTING_GOLD).receive
    < EconomyCore.getRates({ lumber_mill: 1 }, null, null).wood * 24 * 45,
  `${MarketCore.marketBuyQuote('wood', STARTING_GOLD, STARTING_GOLD).receive} wood for the whole opening purse`);

// ── Temple blessings ────────────────────────────────────────────
// Temple level is the CEILING on how many hours you may buy, not the
// duration itself — the player chooses underneath it and pays per hour.
section('Temple blessings');

check('Temple level caps the hours you may consecrate',
  blessingMaxHours(1) === 1 && blessingMaxHours(2) === 2 && blessingMaxHours(9) === 9 &&
  blessingMaxHours(0) === 1 && blessingMaxHours(undefined) === 1);

check('duration is exactly the hours chosen',
  blessingDuration(1) === 3600 && blessingDuration(5) === 5 * 3600);

// blessingCost returns { gold, wood, stone, food } since 2026-07-30. A caller
// that treats it as a number yields NaN or a free blessing, so pin the SHAPE as
// well as the linearity.
check('offering is an object with gold + all three resources',
  typeof blessingCost(1) === 'object' &&
  ['gold', 'food', 'wood', 'stone'].every(k => typeof blessingCost(1, 'god_of_destruction')[k] === 'number'));

check('offering is linear per hour (no bulk discount or penalty)',
  blessingCost(1, 'god_of_destruction').gold === 1500 &&
  blessingCost(4, 'god_of_destruction').gold === 6000 &&
  blessingCost(8, 'god_of_destruction').gold === blessingCost(1, 'god_of_destruction').gold * 8 &&
  blessingCost(8, 'god_of_destruction').wood === blessingCost(1, 'god_of_destruction').wood * 8);

// ── Per-blessing cost mix (2026-07-30, Phase 2c) ────────────────
// THE RULE: charge the currency the blessing does NOT give you. Billing a
// resource blessing in resources is what made god_of_nature unable to break
// even at any price, so this is the assertion that keeps the rule enforced
// rather than merely documented.
check('every blessing is billed in a currency it does NOT produce',
  // nature yields resources → gold only
  blessingCost(1, 'god_of_nature').gold > 0 &&
  ['food', 'wood', 'stone'].every(r => blessingCost(1, 'god_of_nature')[r] === 0) &&
  // fertility yields population → food only
  blessingCost(1, 'god_of_fertility').gold === 0 &&
  blessingCost(1, 'god_of_fertility').food > 0 &&
  // war is tempo/PvP → gold only
  blessingCost(1, 'god_of_war').gold > 0 &&
  ['food', 'wood', 'stone'].every(r => blessingCost(1, 'god_of_war')[r] === 0) &&
  // destruction yields both → billed in both
  blessingCost(1, 'god_of_destruction').gold > 0 &&
  blessingCost(1, 'god_of_destruction').wood > 0);

check('every blessing has a cost mix, and none of them is free',
  Object.keys(BLESSING_DEFS).every(id => {
    const c = blessingCost(1, id);
    return BLESSING_COST_MIX[id] && (c.gold + c.food + c.wood + c.stone) > 0;
  }));

// A missing/unknown id must fall back to the DEAREST profile — a caller that
// forgets to pass one should overcharge, never hand out a free blessing.
check('an unknown blessing id falls back to the dearest profile',
  JSON.stringify(blessingCost(3, 'no_such_blessing')) ===
  JSON.stringify(blessingCost(3, 'god_of_destruction')) &&
  JSON.stringify(blessingCost(3)) === JSON.stringify(blessingCost(3, 'god_of_destruction')));

// God of Nature must reach the WHOLE resource pool, not just buildings.
// Buildings are ~24% of resource income, so a production-only version could
// not cover its own offering at any price (measured 2026-07-30).
check('God of Nature covers building output AND raid/expedition resources',
  BLESSING_DEFS.god_of_nature.effects.wood_production > 0 &&
  BLESSING_DEFS.god_of_nature.effects.resource_yield_bonus > 0);

check('resource_yield_bonus never appears on a blessing that also boosts gold',
  Object.values(BLESSING_DEFS).every(d =>
    !d.effects?.resource_yield_bonus ||
    (!d.effects.raid_bonus && !d.effects.quest_bonus && !d.effects.gold_income_bonus)));

// ── Mounts (repriced 2026-07-30, ECONOMY-REBALANCE-PLAN.md Phase 2a) ──
section('Mounts');

// The catalog keeps an explicit `cost` on all 20 mounts AND a cost per slot in
// MOUNT_SLOTS — 24 literals that must agree. That is a drift shape, so pin it.
const _mountCostDrift = Object.values(MOUNT_POOL)
  .filter(m => m.cost !== MOUNT_SLOTS[m.slot]?.cost)
  .map(m => `${m.id} ${m.cost}≠${MOUNT_SLOTS[m.slot]?.cost}`);
check('every mount costs exactly its slot price', _mountCostDrift.length === 0, _mountCostDrift.join(', '));

check('every mount declares a slot that exists, and every slot is filled per race',
  Object.values(MOUNT_POOL).every(m => MOUNT_SLOTS[m.slot]) &&
  Object.keys(RACES).every(r => {
    const slots = Object.values(MOUNT_POOL).filter(m => m.race === r).map(m => m.slot).sort();
    return JSON.stringify(slots) === JSON.stringify(['apex', 'field', 'scout', 'war']);
  }));

// Mounts are an ACCESSORY, not the endgame gold sink (Rule 5: a terminal
// purchase cannot hold an endgame at any price). The concrete bound: a full
// mount ladder on one lord must stay under the cost of expanding to the last
// lord + last city, or mounts have quietly become the expansion competitor
// again — which is exactly the state the 2026-07-30 audit found.
const _ladder = MOUNT_SLOTS.scout.cost + MOUNT_SLOTS.war.cost + MOUNT_SLOTS.apex.cost;
check('a full mount ladder costs less than the last lord + last city',
  _ladder < 320000 + 256000, `ladder ${_ladder} vs 576000`);

// Every slot but `field` must carry an income key, or the PAYBACK table in
// scripts/economy-projection.js reads NEVER for it. `field` is the deliberate
// combat-only exception (see the MOUNT_POOL header).
const _incomeKeys = ['quest_bonus', 'raid_bonus', 'expeditionRatingMult'];
const _inert = Object.values(MOUNT_POOL)
  .filter(m => m.slot !== 'field')
  .filter(m => !_incomeKeys.some(k => m.effects?.[k]))
  .map(m => m.id);
check('every non-field mount carries an income effect', _inert.length === 0, _inert.join(', '));

// raid_bonus/quest_bonus were blessing-only keys before the reprice. A mount
// declaring one is inert unless catch-up.js sums it — assert the KEY GRAMMAR
// matches so the two sources stay interchangeable.
check('mount income keys reuse the blessing effect grammar',
  Object.values(MOUNT_POOL).every(m =>
    ['quest_bonus', 'raid_bonus'].every(k => m.effects?.[k] === undefined || typeof m.effects[k] === 'number')) &&
  BLESSING_DEFS.god_of_destruction.effects.raid_bonus > 0);

section('Temple blessings (continued)');

check('God of Commerce is gone; 4 blessings remain',
  !BLESSING_DEFS.god_of_commerce && Object.keys(BLESSING_DEFS).length === 4);

check('God of War also speeds recruitment',
  BLESSING_DEFS.god_of_war.effects.battle_loot_bonus === 0.50 &&
  BLESSING_DEFS.god_of_war.effects.recruit_speed === -0.20);

check('God of Destruction also boosts expeditions',
  BLESSING_DEFS.god_of_destruction.effects.raid_bonus === 0.50 &&
  BLESSING_DEFS.god_of_destruction.effects.quest_bonus === 0.30);

// recruit_speed reaches getRecruitTime from the blessing exactly as it does
// from a book — server/actions/recruit.js sums the two into one flat object.
const _warFx = EconomyCore.getBlessingEffects(
  { id: 'god_of_war', startedAt: 0, finishAt: Number.MAX_SAFE_INTEGER }, 1);
check('blessing recruit_speed stacks with research recruit_speed',
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1,
    { recruit_speed: (_warFx.recruit_speed || 0) + (-0.10) }) === Math.round(600 * 0.70));

check('an expired blessing grants nothing',
  Object.keys(EconomyCore.getBlessingEffects(
    { id: 'god_of_war', startedAt: 0, finishAt: 1000 }, 5000)).length === 0);

// ── Recruitment gate (UnitUnlockService) ────────────────────────
// server/actions/recruit.js runs this exact evaluator, so these assertions
// pin the authoritative gate — not just what the client chooses to display.
section('Recruitment gate');

const _gate = (unitId, ctx) => UnitUnlockService.check(unitId, ctx);

check('building gate: Greatswords need Barracks 10',
  _gate('greatswords', { race: 'human', buildings: { barracks: 9 } }).locked === true &&
  _gate('greatswords', { race: 'human', buildings: { barracks: 10 } }).locked === false);

check('building gate reason matches the building-unlock phrasing',
  _gate('greatswords', { race: 'human', buildings: { barracks: 9 } })
    .reasons[0] === 'Requires Barracks Level 10');

check('race gate: a dwarf lord cannot train Witch Elves at any barracks level',
  _gate('witch_elves', { race: 'dwarf', buildings: { barracks: 20 } }).locked === true &&
  _gate('witch_elves', { race: 'dwarf', buildings: { barracks: 20 } }).blockedBy[0] === 'race' &&
  _gate('witch_elves', { race: 'dark_elf', buildings: { barracks: 20 } }).locked === false);

// Regression: city_guard/militia_archer/garrison_soldier are goldCost 0 AND
// recruitTime 0. Before the gate existed, a crafted POST could fill an entire
// army-power cap with them, one second at a time, for free.
const _freeUnits = ['city_guard', 'militia_archer', 'garrison_soldier'];
check('garrison units can never be recruited (goldCost 0 + recruitTime 0 exploit)',
  _freeUnits.every(id => Object.keys(UNIT_ROSTER).every(r =>
    _gate(id, { race: r, buildings: { barracks: 20, guard_post: 20 } }).blockedBy[0] === 'trainable')));

check('mercenaries can never be recruited (they JOIN via expeditions)',
  _gate('bandits',    { race: 'human', buildings: { barracks: 20 } }).blockedBy[0] === 'trainable' &&
  _gate('ogre_bulls', { race: 'human', buildings: { barracks: 20 } }).blockedBy[0] === 'trainable');

const _dragonCtx = { race: 'dark_elf', buildings: { dragon_lair: 1 } };

check('legendary rule survived the move out of recruit.js',
  _gate('black_dragon', { ..._dragonCtx, lordLevel: 11 }).locked === true &&
  _gate('black_dragon', { ..._dragonCtx, lordLevel: 12 }).locked === false &&
  _gate('black_dragon', { ..._dragonCtx, lordLevel: 11 }).blockedBy.includes('lord_level'));

check('lordLevel omitted skips the legendary rule (catalog callers)',
  _gate('black_dragon', _dragonCtx).locked === false);

check('unknown unit ids fail closed',
  _gate('not_a_unit', { race: 'human', buildings: { barracks: 20 } }).locked === true);

// Every roster unit must be reachable: build its training building to the
// roster level and it unlocks. Catches a roster typo that would otherwise
// leave a unit permanently untrainable now that the server enforces this.
const _unreachable = [];
Object.entries(UNIT_ROSTER).forEach(([race, roster]) => {
  Object.entries(roster).forEach(([buildingId, lvlMap]) => {
    Object.entries(lvlMap).forEach(([minLevel, ids]) => ids.forEach(id => {
      const g = _gate(id, { race, buildings: { [buildingId]: Number(minLevel) }, lordLevel: 12 });
      if (g.locked) _unreachable.push(`${race}/${id}: ${g.reasons.join('; ')}`);
    }));
  });
});
check('every UNIT_ROSTER unit unlocks at its own gate (nothing is orphaned)',
  _unreachable.length === 0, _unreachable.join(' | '));

// The Tech Tree and the recruit list both render in roster iteration order,
// so a building whose levels are written out of order would show a Lv 12 unit
// above a Lv 8 one. JS iterates integer-like keys ascending, so this holds by
// construction today — this check is what keeps it true if someone ever
// switches a gate to a non-integer key or reorders by hand.
const _misordered = [];
Object.entries(UNIT_ROSTER).forEach(([race, roster]) => {
  Object.entries(roster).forEach(([buildingId, lvlMap]) => {
    const asRendered = Object.keys(lvlMap).map(Number);
    const ascending  = [...asRendered].sort((a, b) => a - b);
    if (asRendered.join() !== ascending.join()) {
      _misordered.push(`${race}/${buildingId}: renders ${asRendered.join(',')} — expected ${ascending.join(',')}`);
    }
  });
});
check('every building ladder renders in ascending gate order',
  _misordered.length === 0, _misordered.join(' | '));

// ── PWR (army power) — unified in EconomyCore (2026-07-27) ──────
const _plainDef  = { combatStats: { attack: 10, defense: 10, hp: 100, speed: 5 }, traits: [] };
const _terrorDef = { combatStats: { attack: 10, defense: 10, hp: 100, speed: 5 }, traits: ['terror', 'fragile'] };

check('getUnitPower: base = atk×3 + def×2 + hp/10 + speed×0.5',
  EconomyCore.getUnitPower(_plainDef) === 62.5);

check('getUnitPower: combat traits are taxed, drawbacks (fragile) are free',
  Math.abs(EconomyCore.getUnitPower(_terrorDef) - 62.5 * 1.12) < 1e-9 &&
  EconomyCore.getUnitPower({ ..._plainDef, traits: ['fragile', 'large', 'siege'] }) === 62.5);

check('getArmyPower: LINEAR in count (no ^0.8 doomstack discount)',
  Math.abs(EconomyCore.getArmyPower([{ unitId: 'x', count: 10 }], { x: _plainDef }) - 625) < 1e-9 &&
  Math.abs(EconomyCore.getProjectedArmyPower([{ unitId: 'x', count: 10 }], { x: _plainDef }, 'x', 2) - 750) < 1e-9);

check('getArmyPower matches per-unit sum on a real roster entry',
  Math.abs(EconomyCore.getArmyPower([{ unitId: 'spearmen', count: 3 }], UNIT_DEFS)
    - EconomyCore.getUnitPower(UNIT_DEFS.spearmen) * 3) < 1e-9);

const researchState = JSON.parse(JSON.stringify({
  player: { id: 'p_r', lordId: 'l_r', coins: 0, resources: { food: 0, wood: 0, stone: 0 },
            researchQueue: [{ bookId: 'cartography', targetLevel: 2, startedAt: 0, finishAt: 1_000 }] },
  lords: {}, cities: {}, armies: {},
}));
const researchDone = catchUp(researchState, 2_000, { EconomyCore, RACES, UNIT_DEFS, BUILDING_DEFS, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS });
check('catchUp completes finished research into player.research',
  researchDone.player.research?.cartography === 2 && researchDone.player.researchQueue.length === 0);

// ── 3.6 Resource display order ──────────────────────────────────
section('Resource order (wood → stone → food)');

// Costs, production and loot bundles are rendered by walking the OBJECT, so a
// literal's key order IS its display order. The Town Hall declared
// `{ food, wood, stone }` while the other 25 buildings declared wood first, and
// its cost panel alone read "food · wood · stone" (Nacho, 2026-08-04).
//
// Checked on the DEFS rather than the UI because that is where the drift starts:
// a new building copied from the wrong neighbour is one keystroke away, and no
// screen would fail loudly for it.
const CANON_ORDER = ['gold', ...EconomyCore.RESOURCE_KEYS];
const _keysInOrder = obj => {
  const present = Object.keys(obj || {}).filter(k => CANON_ORDER.includes(k));
  return JSON.stringify(present) === JSON.stringify(CANON_ORDER.filter(k => present.includes(k)));
};

check('EconomyCore.RESOURCE_KEYS is the canonical order',
  JSON.stringify(EconomyCore.RESOURCE_KEYS) === JSON.stringify(['wood', 'stone', 'food']));

const bldOrderBad = Object.values(BUILDING_DEFS)
  .filter(d => !_keysInOrder(d.cost(3)) || !_keysInOrder(d.production(3)))
  .map(d => d.id);
check('every building declares cost & production in canonical order',
  bldOrderBad.length === 0, bldOrderBad.join(', '));

const bookOrderBad = Object.values(RESEARCH_DEFS)
  .filter(d => !_keysInOrder(d.cost(2))).map(d => d.id);
check('every research book declares its cost in canonical order',
  bookOrderBad.length === 0, bookOrderBad.join(', '));

// Both the mix literal and what blessingCost builds from it — the Temple tab
// renders the returned object directly.
const blessOrderBad = Object.keys(BLESSING_COST_MIX)
  .filter(id => !_keysInOrder(BLESSING_COST_MIX[id]) || !_keysInOrder(blessingCost(2, id)));
check('every blessing offering is in canonical order',
  blessOrderBad.length === 0, blessOrderBad.join(', '));

check('raid payout bundle is in canonical order',
  _keysInOrder(EconomyCore.getRaidHourlyRewards(5)));

const raceOrderBad = Object.values(RACES).filter(r => {
  const prod = Object.keys(r.bonuses || {})
    .filter(k => k.endsWith('_production')).map(k => k.replace('_production', ''));
  return JSON.stringify(prod) !== JSON.stringify(EconomyCore.RESOURCE_KEYS.filter(k => prod.includes(k)));
}).map(r => r.id);
check('every race lists its *_production bonuses in canonical order',
  raceOrderBad.length === 0, raceOrderBad.join(', '));

const terrOrderBad = Object.keys(TERRAIN_RESOURCE_MODS)
  .filter(t => !_keysInOrder(TERRAIN_RESOURCE_MODS[t]));
check('every terrain lists its resource modifiers in canonical order',
  terrOrderBad.length === 0, terrOrderBad.join(', '));

check('the merchant lists its resources in canonical order',
  JSON.stringify(MarketCore.MARKET_RESOURCES) === JSON.stringify(EconomyCore.RESOURCE_KEYS));

// ── 4. Iron is gone ─────────────────────────────────────────────
section('Iron removal');

const bldWithIronCost = Object.values(BUILDING_DEFS).filter(d => (d.cost(3).iron || 0) > 0 || (d.production(3).iron || 0) > 0);
check('no building costs or produces iron', bldWithIronCost.length === 0,
  bldWithIronCost.map(d => d.id).join(', '));

const unitsWithResources = Object.values(UNIT_DEFS).filter(u => u.resourceCost);
check('units cost ONLY gold (no resourceCost on any unit)',
  unitsWithResources.length === 0, unitsWithResources.map(u => u.id).join(', '));

check('no race has iron_production', Object.values(RACES).every(r => !('iron_production' in r.bonuses)));
check('no terrain has an iron modifier',
  Object.values(TERRAIN_RESOURCE_MODS).every(m => !('iron' in m)));

// ── 4a. Security is gone ────────────────────────────────────────
section('Security removal');

// Deleted 2026-08-04: fifteen emitters fed it and nothing read it back. Pinned
// the same way iron is, because a half-removal is the dangerous state — getStats
// silently DROPS an effect whose stat is not in STAT_BASE, so a leftover
// `{ stat: 'security' }` costs a building its effect with no error anywhere.
check('security is not a stat', !('security' in EconomyCore.STAT_BASE));

check('City Defenses is stability alone',
  JSON.stringify(EconomyCore.DEFENSE_STATS) === JSON.stringify(['stability']));

const bldWithSecurity = Object.values(BUILDING_DEFS)
  .filter(d => (d.effects ? d.effects(3) : []).some(e => e.stat === 'security'));
check('no building grants security', bldWithSecurity.length === 0,
  bldWithSecurity.map(d => d.id).join(', '));

check('no terrain grants security',
  Object.values(TERRAIN_STAT_MODS).every(mods => mods.every(e => e.stat !== 'security')));

// The general form of the same bug: ANY effect naming a stat the engine does
// not have is dead weight the player is being charged for. Covers buildings and
// terrain in one sweep, so the next stat that gets cut cannot leave orphans.
const orphanEffects = [
  ...Object.values(BUILDING_DEFS).flatMap(d =>
    (d.effects ? d.effects(3) : []).map(e => [d.id, e.stat])),
  ...Object.entries(TERRAIN_STAT_MODS).flatMap(([t, mods]) => mods.map(e => [t, e.stat])),
].filter(([, stat]) => !(stat in EconomyCore.STAT_BASE));
check('every building/terrain effect names a stat that exists',
  orphanEffects.length === 0, orphanEffects.map(([o, s]) => `${o}→${s}`).join(', '));

// ── 4b. Expedition reward ladder ────────────────────────────────
section('Expedition tiers (DiscoveryRoll)');

// Contiguity: each tier's ceiling must be the next tier's floor, so no roll
// can land in a dead zone between brackets (OGame's S/M/L variants do the
// same). A gap here is invisible in play except as finds that "feel like
// duds", which is exactly the kind of thing that survives for months.
for (const kind of ['res', 'gold']) {
  for (const t of [1, 2]) {
    const hi = DiscoveryRoll.TIER_RANGES[t][kind][1];
    const lo = DiscoveryRoll.TIER_RANGES[t + 1][kind][0];
    check(`${kind}: tier ${t} ceiling meets tier ${t + 1} floor`, hi === lo, `${hi} vs ${lo}`);
  }
  for (const t of [1, 2, 3]) {
    const [lo, hi] = DiscoveryRoll.TIER_RANGES[t][kind];
    check(`${kind}: tier ${t} range ascends`, lo < hi, `${lo}..${hi}`);
  }
}

// tierOdds is a probability distribution, not weights — each band must sum to
// 1 or the published odds in quest-guide.html are a lie.
for (const band of DiscoveryRoll.RECRUIT_TIERS) {
  const sum = [1, 2, 3].reduce((s, t) => s + (band.tierOdds[t] || 0), 0);
  check(`${band.id}: tierOdds sum to 1`, Math.abs(sum - 1) < 1e-9, `sums to ${sum}`);
}

// Tier gating actually holds in the roll, on every terrain — a band with
// tierOdds 0 for a tier must NEVER produce it.
const _TIERED = new Set(['resource', 'item', 'trade', 'legendary']);
let gateLeaks = 0;
for (const terrain of ['plains', 'forest', 'mountain', 'marsh', 'desert']) {
  for (const band of DiscoveryRoll.RECRUIT_TIERS) {
    for (let i = 0; i < 4000; i++) {
      const def = DiscoveryRoll.rollDef(DISCOVERY_DEFS, terrain, 0, 'standard', 0, band.er);
      if (!def || !_TIERED.has(def.category)) continue;
      if ((band.tierOdds[def.tier || 2] || 0) === 0) gateLeaks++;
    }
  }
}
check('ER tier gating never leaks a forbidden tier', gateLeaks === 0, `${gateLeaks} leaks`);

// ── 4a-bis. City items ──────────────────────────────────────────
section('City items (js/data/items.js)');

const _ITEM_KEYS = new Set(['wood_production', 'stone_production', 'food_production']);

// Catalog shape. Items are the ONLY per-city production lever, so a def with a
// stray effect key would be applied to a city and silently do nothing.
const _badItems = Object.values(ITEM_DEFS).filter(d =>
  !d.id || !d.name || !d.icon || !d.summary || !d.description
  || ![1, 2, 3].includes(d.tier)
  || !(d.durationHours > 0)
  || Object.keys(d.effects || {}).length === 0
  || Object.keys(d.effects).some(k => !_ITEM_KEYS.has(k))
  || Object.values(d.effects).some(v => !(v > 0)));
check('every item def is well-formed', _badItems.length === 0, _badItems.map(d => d.id).join(', '));

check('item ids match their keys',
  Object.entries(ITEM_DEFS).every(([key, def]) => key === def.id));

check('itemDurationMs agrees with durationHours',
  Object.values(ITEM_DEFS).every(d => itemDurationMs(d.id) === d.durationHours * 3600 * 1000));

// THE COVERAGE RULE. Item finds are ER-gated like all tiered loot (see the tier
// gating check above), so an ER band whose tierOdds only reach tier N can ONLY
// ever be shown tier-N item finds. If either side of that pairing has a hole,
// some band of players can never obtain an item at all — which is exactly the
// bug that adding wandering_drover (tier 1) and forgotten_estate (tier 3) fixed
// when the three inherited defs were all tier 2.
const _itemDiscoveryTiers = new Set(Object.values(DISCOVERY_DEFS)
  .filter(d => d.category === 'item').map(d => d.tier || 2));
for (const tier of [1, 2, 3]) {
  check(`tier ${tier} has both an item and a way to find one`,
    itemsOfTier(tier).length > 0 && _itemDiscoveryTiers.has(tier),
    `${itemsOfTier(tier).length} items, discovery def: ${_itemDiscoveryTiers.has(tier)}`);
}

// An item find pays the item and its XP — never coin, never resources. Swept
// over every item def rather than spot-checked, since the branch keys off the
// CATEGORY and a new def inherits it for free.
let _itemRewardLeaks = [];
for (const def of Object.values(DISCOVERY_DEFS).filter(d => d.category === 'item')) {
  for (let i = 0; i < 50; i++) {
    const rewards = DiscoveryRoll.rollRewards(def, 10, { lengthId: 'long', depletion: 1 });
    const items   = rewards.filter(r => r.type === 'item');
    const spoils  = rewards.filter(r => ['gold', 'wood', 'stone', 'food'].includes(r.type));
    if (items.length !== 1 || spoils.length > 0) { _itemRewardLeaks.push(def.id); break; }
    if ((ITEM_DEFS[items[0].itemId] || {}).tier !== (def.tier || 2)) { _itemRewardLeaks.push(def.id + ':tier'); break; }
  }
}
check('item finds pay exactly one item of their own tier, and no coin or resources',
  _itemRewardLeaks.length === 0, _itemRewardLeaks.join(', '));

check('no item find declares dead gold in BASE_REWARDS',
  Object.values(DISCOVERY_DEFS).filter(d => d.category === 'item')
    .every(d => !(DiscoveryRoll.BASE_REWARDS[d.id] || {}).gold));

// itemBonusLabel is what the city view and the quest log both print. It must be
// built from effects, never prose, or the UI can promise a number nobody applies.
check('itemBonusLabel reads the effects, not the summary',
  itemBonusLabel(ITEM_DEFS.cattle) === '+20% food'
  && itemBonusLabel(ITEM_DEFS.horn_of_plenty) === '+25% all resources');

// ── Effect resolution: instantaneous vs time-weighted ──
const _T0 = 1_800_000_000_000;
const _hAgo = h => _T0 - h * 3_600_000;

const _liveCity = { activeItems: [{ itemId: 'cattle', startedAt: _hAgo(2), expiresAt: _T0 + 3_600_000 }] };
const _deadCity = { activeItems: [{ itemId: 'cattle', startedAt: _hAgo(30), expiresAt: _hAgo(6) }] };

check('an active item reports its full bonus',
  EconomyCore.getCityItemEffects(_liveCity, _T0).food_production === 0.20);
check('an expired item reports nothing',
  Object.keys(EconomyCore.getCityItemEffects(_deadCity, _T0)).length === 0);

// THE OFFLINE CASE, and the reason the weighted form exists at all: catch-up
// credits a whole window in one lump at one rate. An item that ran and lapsed
// inside that window must still be paid for the hours it was live, or a 24h
// item applied before a 48h absence would quietly pay nothing.
check('a lapsed item is still paid for the hours it ran',
  Math.abs(EconomyCore.getCityItemEffects(_deadCity, _T0, _hAgo(12)).food_production - 0.10) < 1e-9,
  JSON.stringify(EconomyCore.getCityItemEffects(_deadCity, _T0, _hAgo(12))));
check('an item applied mid-window is only paid from when it was applied',
  Math.abs(EconomyCore.getCityItemEffects(
    { activeItems: [{ itemId: 'cattle', startedAt: _hAgo(5), expiresAt: _T0 + 3_600_000 }] },
    _T0, _hAgo(10)).food_production - 0.10) < 1e-9);

// No slot limit (Nacho's call, 2026-08-04): two of the same item are two
// independent entries and their bonuses add.
check('identical items stack',
  EconomyCore.getCityItemEffects({ activeItems: [
    { itemId: 'cattle', startedAt: _hAgo(1), expiresAt: _T0 + 3_600_000 },
    { itemId: 'cattle', startedAt: _hAgo(1), expiresAt: _T0 + 3_600_000 },
  ] }, _T0).food_production === 0.40);

check('unknown and malformed entries are ignored, not thrown on',
  Object.keys(EconomyCore.getCityItemEffects(
    { activeItems: [null, { itemId: 'no_such_item', expiresAt: _T0 + 1 }] }, _T0)).length === 0);

// Pruning is what keeps activeItems from growing forever. It must run AFTER the
// window is paid — the weighting above is what makes that ordering safe.
const _pruneCity = { activeItems: [
  { itemId: 'cattle',        startedAt: _hAgo(30), expiresAt: _hAgo(6) },
  { itemId: 'ironwood_grove', startedAt: _hAgo(1),  expiresAt: _T0 + 3_600_000 },
] };
const _pruned = EconomyCore.pruneExpiredItems(_pruneCity, _T0);
check('pruneExpiredItems drops the lapsed entry and keeps the live one',
  _pruned === true && _pruneCity.activeItems.length === 1
  && _pruneCity.activeItems[0].itemId === 'ironwood_grove');
check('pruneExpiredItems reports no change when nothing lapsed',
  EconomyCore.pruneExpiredItems(_pruneCity, _T0) === false);

// ── End to end through catchUp: the number the player actually banks ──
// (The suite's shared ENGINE bundle is assembled further down, after this
// section — this is the same shape, scoped to these three runs.)
const _ITEM_ENGINE = {
  DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES,
  UNIT_DEFS, BUILDING_DEFS, RACES, EconomyCore, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS,
};

function _itemFixture(activeItems) {
  return {
    player: { id: 'p1', lordId: 'l1', coins: 0, resources: { wood: 0, stone: 0, food: 0 }, research: {} },
    lords:  { l1: { id: 'l1', playerId: 'p1', race: 'human', level: 1, actionQueue: [] } },
    armies: {},
    cities: { c1: {
      id: 'c1', playerId: 'p1', name: 'Item Test', x: 5, y: 5,
      population: 10000, freePopulation: 3,
      buildings: { town_hall: 5, lumber_mill: 10, stone_quarry: 10, farm: 10 },
      constructionQueue: [], activeItems,
      lastResourceUpdate: _hAgo(10), lastPopulationUpdate: _hAgo(10),
    } },
  };
}
const _noItemRun = catchUp(_itemFixture([]), _T0, _ITEM_ENGINE);
const _fullRun   = catchUp(_itemFixture([
  { itemId: 'ironwood_grove', startedAt: _hAgo(50), expiresAt: _T0 + 20 * 3_600_000 }]), _T0, _ITEM_ENGINE);

// The item is ADDITIVE with the race bonus, exactly like research and blessings
// — so the expected ratio is (1 + race + item) / (1 + race), NOT 1 + item.
// Humans carry +5% wood; asserting 1.60 here would be asserting the wrong model.
const _raceWood = RACES.human.bonuses.wood_production;
const _expected = (1 + _raceWood + 0.60) / (1 + _raceWood);
const _actual   = _fullRun.player.resources.wood / _noItemRun.player.resources.wood;
check('catchUp credits the item bonus additively with the race bonus',
  Math.abs(_actual - _expected) < 0.01, `expected ${_expected.toFixed(3)}, got ${_actual.toFixed(3)}`);

const _lapsedRun = catchUp(_itemFixture([
  { itemId: 'ironwood_grove', startedAt: _hAgo(30), expiresAt: _hAgo(5) }]), _T0, _ITEM_ENGINE);
const _halfExpected = (1 + _raceWood + 0.30) / (1 + _raceWood);
const _halfActual   = _lapsedRun.player.resources.wood / _noItemRun.player.resources.wood;
check('catchUp pays a mid-window expiry for exactly the half it ran',
  Math.abs(_halfActual - _halfExpected) < 0.01,
  `expected ${_halfExpected.toFixed(3)}, got ${_halfActual.toFixed(3)}`);
check('catchUp prunes the lapsed entry once it has been paid',
  _lapsedRun.cities.c1.activeItems.length === 0);
check('catchUp keeps a still-live entry',
  _fullRun.cities.c1.activeItems.length === 1);

// NO SLOT LIMIT means the only ceiling is PRODUCTION_BONUS_MAX inside getRates.
// Verify it actually bites, since an unbounded per-city multiplier is the one
// way this system could break the economy outright: 40 stacked Ironwood Groves
// (+2400%) must produce exactly what the clamp allows and not a unit more.
const _absurd = Array.from({ length: 40 }, () => (
  { itemId: 'ironwood_grove', startedAt: _hAgo(1), expiresAt: _T0 + 3_600_000 }));
const _absurdFx = EconomyCore.getCityItemEffects({ activeItems: _absurd }, _T0);
const _clamped  = EconomyCore.getRates({ lumber_mill: 10 }, { wood_production: _absurdFx.wood_production }, null);
const _atMax    = EconomyCore.getRates({ lumber_mill: 10 }, { wood_production: 3.0 }, null);
check('stacked items cannot outrun the production clamp',
  Math.abs(_absurdFx.wood_production - 24) < 1e-9 && _clamped.wood === _atMax.wood,
  `raw bonus ${_absurdFx.wood_production}, wood ${_clamped.wood} vs clamped ${_atMax.wood}`);

// ── 4b. Population growth invariants ────────────────────────────
section('Population growth (status ladder + famine)');

// NO CITY STATE MAY HOLD POPULATION STILL (Nacho's call, 2026-08-03). A flat
// rate is a dead end for the player: nothing to fix, nothing to plan against,
// and the UI had to invent a third "stagnant" wording for it. Sweep the whole
// matrix — every status tier × fed/starving — rather than spot-checking, since
// the old bug was one arithmetic coincidence (Growing 125 − penalty 125 = 0).
const _statsForTier = {
  // Loadouts measured to land on each tier at 1,000 pop on neutral terrain.
  prosperous: { town_hall: 10, farm: 8, aqueduct: 8, temple: 8, tavern: 8 },
  growing:    { town_hall: 5,  farm: 4, aqueduct: 3, temple: 2 },
  stable:     { town_hall: 1,  farm: 1 },
};
let flatFound = [];
for (const [label, buildings] of Object.entries(_statsForTier)) {
  const s = EconomyCore.getStats(buildings, 1000, []);
  for (const foodRate of [0, 50]) {
    for (const foodStock of [0, 10000]) {
      const r = EconomyCore.getPopGrowthRate(s, foodRate, foodStock);
      if (r === 0) flatFound.push(`${label} food=${foodRate} stock=${foodStock}`);
    }
  }
}
check('no status × larder combination yields 0 pop growth', flatFound.length === 0,
  flatFound.join(', '));

check('every STATUS_POP_RATE tier is non-zero',
  Object.values(EconomyCore.STATUS_POP_RATE).every(r => r !== 0));

// The specific coincidence that used to produce 0, and the one that used to let
// a Prosperous city GROW through a famine.
const _growingStats = EconomyCore.getStats(_statsForTier.growing, 1000, []);
const _prosperStats = EconomyCore.getStats(_statsForTier.prosperous, 1000, []);
check('a starving Growing city declines (was exactly 0)',
  EconomyCore.getPopGrowthRate(_growingStats, 0, 0) < 0,
  `got ${EconomyCore.getPopGrowthRate(_growingStats, 0, 0)}`);
check('a starving Prosperous city declines (was +42)',
  EconomyCore.getPopGrowthRate(_prosperStats, 0, 0) < 0,
  `got ${EconomyCore.getPopGrowthRate(_prosperStats, 0, 0)}`);

// Starvation must still respect the ladder: a bad city starves faster than a
// good one, or the player has no reason to fix stats during a famine.
check('starvation is worse for a worse status',
  EconomyCore.getPopGrowthRate(EconomyCore.getStats({}, 200000, []), 0, 0)
    < EconomyCore.getPopGrowthRate(_prosperStats, 0, 0));

// Food is an EMPIRE pool, so a farmless city in a stocked realm is fed.
check('city with no farm but a stocked empire is fed', EconomyCore.isCityFed(0, 5000));
check('city with a farm is fed even at 0 stock',       EconomyCore.isCityFed(11, 0));
check('no farm and no stock is a famine',             !EconomyCore.isCityFed(0, 0));

// A NEW CITY MUST OPEN STABLE AND GROWING. This is the exact founding loadout
// from server/actions/city-found.js — the regression it guards is a city that
// read "Stable" on the badge while shrinking at −42/hr from its first minute.
//
// The free Farm was removed on 2026-08-04, so the city now produces NO food of
// its own and is fed entirely from the empire larder. That makes the larder
// argument load-bearing rather than incidental: it is the starter kit
// city-found.js seeds alongside the city, and it is the only reason the opening
// hours are not a famine. Passing 0 here would be testing a state the game
// never actually creates.
const FOUNDING_BUILDINGS  = { town_hall: 1 };
const FOUNDING_POP        = 1000;
const FOUNDING_FOOD_STOCK = 5000;   // server/actions/city-found.js starter kit
for (const terrain of ['plains', 'forest', 'mountain', 'marsh', 'desert']) {
  const s      = EconomyCore.getStats(FOUNDING_BUILDINGS, FOUNDING_POP, TERRAIN_STAT_MODS[terrain] || []);
  const food   = EconomyCore.getRates(FOUNDING_BUILDINGS, {}, TERRAIN_RESOURCE_MODS[terrain] || {}).food;
  const status = EconomyCore.getCityStatus(s);
  const rate   = EconomyCore.getPopGrowthRate(s, food, FOUNDING_FOOD_STOCK);
  check(`new city on ${terrain} opens Stable or better`,
    ['stable', 'growing', 'prosperous'].includes(status.id), `got ${status.id}`);
  check(`new city on ${terrain} opens GROWING, not declining`, rate > 0, `got ${rate}/hr`);
  // No CRITICAL row at founding on any terrain. A single Warning is allowed and
  // is terrain flavour, not a defect: marsh is −15 hygiene, so a marsh city
  // opens with hygiene 39 (Warning) and must build an Aqueduct before it can
  // reach Prosperous. That is the cost of the tile the player picked — the
  // Warning still caps the badge, so it stays a real decision.
  check(`new city on ${terrain} has no Critical status row`,
    EconomyCore.STATUS_STATS.every(k => EconomyCore.getStatTier(k, s[k]) !== 'critical'),
    EconomyCore.STATUS_STATS.map(k => `${k}=${s[k]}(${EconomyCore.getStatTier(k, s[k])})`).join(' '));
}

// On NEUTRAL terrain — no terrain stat mods at all — the founding stats must be
// unambiguously healthy: every status row Stable or better. This is the
// "a new city starts stable" requirement with the terrain variable removed.
{
  const s = EconomyCore.getStats(FOUNDING_BUILDINGS, FOUNDING_POP, []);
  check('new city on neutral terrain: every status row Stable or better',
    EconomyCore.STATUS_STATS.every(k => ['excellent', 'stable'].includes(EconomyCore.getStatTier(k, s[k]))),
    EconomyCore.STATUS_STATS.map(k => `${k}=${s[k]}(${EconomyCore.getStatTier(k, s[k])})`).join(' '));
}

// The founding loadout is duplicated in three places (server, legacy client,
// projection script). It is now Town Hall ONLY — nothing else, no free Farm.
// Pinned in both directions: the Town Hall must be there (every producer
// requires it, so a city without one cannot start at all), and nothing else
// may quietly creep back in.
check('founding loadout is the Town Hall and nothing else',
  JSON.stringify(FOUNDING_BUILDINGS) === JSON.stringify({ town_hall: 1 }));

// The other half of removing the Farm: the city makes no food itself, so the
// larder is the only thing standing between a new city and a famine. If
// isCityFed ever stopped reading the empire pool, every new city would open
// starving — this is the check that would catch it.
check('a brand-new city grows only because the empire larder feeds it',
  EconomyCore.getRates(FOUNDING_BUILDINGS, {}, {}).food === 0 &&
  EconomyCore.isCityFed(0, FOUNDING_FOOD_STOCK) &&
  EconomyCore.getPopGrowthRate(
    EconomyCore.getStats(FOUNDING_BUILDINGS, FOUNDING_POP, []), 0, FOUNDING_FOOD_STOCK) > 0);

// ── 5. Client formulas == server catch-up ───────────────────────
section('Client/server parity (catchUp uses EconomyCore)');

const ENGINE = { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS, BUILDING_DEFS, RACES, EconomyCore, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS };

const NOW  = 1_750_000_000_000;
const HOUR = 3_600_000;
const cityFixture = {
  id: 'c_test', playerId: 'p_test', name: 'Testheim', x: 3, y: 7,
  population: 5000, freePopulation: 3,
  buildings: { town_hall: 2, lumber_mill: 3, stone_quarry: 2, farm: 2, aqueduct: 4, marketplace: 1 },
  constructionQueue: [], recruitmentQueue: [], activeItems: [],
  lastResourceUpdate: NOW - HOUR, lastPopulationUpdate: NOW - HOUR,
};
const state = {
  player: { id: 'p_test', lordId: 'l_test', coins: 1000, resources: { food: 0, wood: 0, stone: 0 } },
  lords:  { l_test: { id: 'l_test', race: 'dark_elf', level: 1, currentHp: 100 } },
  cities: { c_test: cityFixture },
  armies: {},
};

const result = catchUp(state, NOW, ENGINE);

const tKey   = terrainKey(3, 7);
const statsT = EconomyCore.getStats(cityFixture.buildings, cityFixture.population, TERRAIN_STAT_MODS[tKey] || []);
const expected = EconomyCore.getRates(cityFixture.buildings, RACES.dark_elf.bonuses, TERRAIN_RESOURCE_MODS[tKey] || {});

check(`catchUp wood gain (1h, terrain=${tKey}) matches EconomyCore`, Math.round(result.player.resources.wood) === expected.wood,
  `got ${result.player.resources.wood}, expected ${expected.wood}`);
check('catchUp stone gain matches EconomyCore', Math.round(result.player.resources.stone) === expected.stone,
  `got ${result.player.resources.stone}, expected ${expected.stone}`);
check('catchUp food gain matches EconomyCore', Math.round(result.player.resources.food) === expected.food,
  `got ${result.player.resources.food}, expected ${expected.food}`);

const stateWithIron = JSON.parse(JSON.stringify(state));
stateWithIron.player.resources.iron = 500;
const migrated = catchUp(stateWithIron, NOW, ENGINE);
check('catchUp strips legacy iron from player.resources', !('iron' in migrated.player.resources));

// Population growth parity: client CityStatsService delegates to the same
// EconomyCore.getPopGrowthRate, so asserting catchUp moved population by
// getPopGrowthRate(stats, cityFood, empireFoodStock) proves both sides agree.
// The stock argument is the pool AFTER this city banked its production, which
// is the order catch-up.js uses.
const popRate  = EconomyCore.getPopGrowthRate(statsT, expected.food, result.player.resources.food);
check('catchUp population growth matches EconomyCore.getPopGrowthRate',
  result.cities.c_test.population === Math.max(1, Math.round(cityFixture.population + popRate * 1)),
  `got ${result.cities.c_test.population}, expected ${cityFixture.population + popRate}`);

// Gold: pure income via EconomyCore.getGoldRate — upkeep no longer exists.
const goldRate = EconomyCore.getGoldRate(cityFixture.buildings, cityFixture.population, statsT.happiness);
check('catchUp gold income matches EconomyCore.getGoldRate (no upkeep)',
  result.player.coins === Math.floor(1000 + goldRate * 1),
  `got ${result.player.coins}, goldRate ${goldRate}`);

check('no unit carries upkeep fields anymore',
  Object.values(UNIT_DEFS).every(u => u.upkeep === undefined && u.foodUpkeep === undefined));

// ── Summary ─────────────────────────────────────────────────────
console.log(`\n${'='.repeat(54)}`);
console.log(failed === 0
  ? `ALL ${passed} CHECKS PASSED`
  : `${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
