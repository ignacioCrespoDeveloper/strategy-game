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
  BLESSING_DEFS, blessingMaxHours, blessingDuration, blessingCost,
  TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS,
  DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES,
  DiscoveryRoll, TUNING, tune,
} from '../server/engine-loader.js';
import { catchUp } from '../server/tick/catch-up.js';

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
check('stone quarry cost L2 = 76 wood / 38 stone (×1.6)',
  BUILDING_DEFS.stone_quarry.cost(2).wood === Math.floor(48 * 1.6) &&
  BUILDING_DEFS.stone_quarry.cost(2).stone === Math.floor(24 * 1.6));
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

check('march food cost = distance × min(500, 50 + 45·models); same tile free',
  EconomyCore.getMarchFoodCost(0, [{ count: 10 }]) === 0 &&
  EconomyCore.getMarchFoodCost(1, null) === 50 &&
  EconomyCore.getMarchFoodCost(5, null) === 250 &&
  EconomyCore.getMarchFoodCost(3, [{ count: 6 }, { count: 4 }]) === 1500 &&
  EconomyCore.getMarchFoodCost(10, [{ count: 30 }]) === 5000);

// ── 3.5 Library research (books) ────────────────────────────────
section('Library research (books)');

// Catalog trimmed 2026-07-29 to two tier-1 books while progression is
// retuned; tiers 2 and 3 stay defined for the books coming next.
check('2 books defined, both available from Library 1',
  Object.keys(RESEARCH_DEFS).length === 2 &&
  Object.values(RESEARCH_DEFS).every(d => d.tier === 1) &&
  RESEARCH_TIERS[1] === 1 && RESEARCH_TIERS[2] === 4 && RESEARCH_TIERS[3] === 8);

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
  Math.abs(fx.march_food_cost - (-0.05)) < 1e-9);

// Slave Chronicles is an odd ladder: 1/3/5/7/9% over its first five volumes.
check('Slave Chronicles follows the 1/3/5/7/9% ladder',
  [1, 3, 5, 7, 9].every((pct, i) =>
    Math.abs(RESEARCH_DEFS.engineering_tomes.bonuses(i + 1).construction_speed + pct / 100) < 1e-9));

// Cartography is −1% per volume.
check('Cartography is −1% march food per level',
  Math.abs(RESEARCH_DEFS.cartography.bonuses(7).march_food_cost - (-0.07)) < 1e-9);

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
// goldCost = PWR × 3.5 × tier premium (EconomyCore.getUnitGoldCost).
// Camp-defender-only units (goldCost 0) are exempt — 0 is their marker.
const _misPriced = Object.values(UNIT_DEFS)
  .filter(u => !(u.race === null && u.goldCost === 0))
  .filter(u => u.goldCost !== EconomyCore.getUnitGoldCost(u));
check('every priced unit follows goldCost = PWR × 3.5 × tier premium',
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

check('raid rate = base + perLevel × lord level, all 3 resources equal',
  JSON.stringify(EconomyCore.getRaidHourlyRewards(8)) ===
    JSON.stringify({ gold: 400, food: 500, wood: 500, stone: 500 }) &&
  JSON.stringify(EconomyCore.getRaidHourlyRewards(1)) ===
    JSON.stringify({ gold: 85, food: 115, wood: 115, stone: 115 }));

check('raid rate is defined by the exported tunables (guide reads these)',
  EconomyCore.RAID_BASE.gold === 40 && EconomyCore.RAID_PER_LEVEL.gold === 45 &&
  EconomyCore.RAID_BASE.res === 60  && EconomyCore.RAID_PER_LEVEL.res === 55);

check('raid rate floors at level 1 for a missing/zero level',
  JSON.stringify(EconomyCore.getRaidHourlyRewards(0)) ===
    JSON.stringify(EconomyCore.getRaidHourlyRewards(1)) &&
  JSON.stringify(EconomyCore.getRaidHourlyRewards(undefined)) ===
    JSON.stringify(EconomyCore.getRaidHourlyRewards(1)));

// The 2026-07-29 bump exists because raiding was not worth the stance. Pin the
// relationship rather than the raw number: a day of raiding must beat an hour
// of the Temple blessing it is meant to help pay for.
check('a 24h raid at Lv 8 out-earns an hour of blessing by a wide margin',
  EconomyCore.getRaidHourlyRewards(8).gold * 24 > blessingCost(1).gold * 2);

// ── Tuning dials (js/data/tuning.js) ────────────────────────────
// The dials are the designer-facing surface: one number per income/time
// channel, meant to be edited without touching code. Two things must hold —
// every dial ships at 1.0 (so a fresh clone is the designed game), and each one
// actually MOVES its channel and only its channel.
section('Tuning dials');

check('every dial ships at 1.0',
  Object.values(TUNING).every(v => v === 1));

check('the documented dial set is exactly what exists',
  JSON.stringify(Object.keys(TUNING).sort()) === JSON.stringify([
    'buildingProduction', 'populationGold', 'questGold', 'questResources',
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

check('travelTime dial stretches and compresses marches',
  withDial('travelTime', 2,   () => EconomyCore.getTravelTime(5, 5)) === 200 &&
  withDial('travelTime', 0.5, () => EconomyCore.getTravelTime(5, 5)) === 50);

// Slowing travel must not quietly make marching more expensive — march food is
// charged per TILE, not per second.
check('travelTime does not change march food cost',
  withDial('travelTime', 5, () => EconomyCore.getMarchFoodCost(3, [{ unitId: 'spearmen', count: 4 }], null)) ===
  EconomyCore.getMarchFoodCost(3, [{ unitId: 'spearmen', count: 4 }], null));

// ── The Merchant (MarketCore) ───────────────────────────────────
// Resources → gold, deliberately lossy, hard-capped per UTC day. The CAP is the
// safety mechanism, not the rate: a single tier-3 expedition find is up to
// 187,200 of one resource, so an uncapped merchant at any rate would become the
// primary gold channel.
section('The Merchant');

check('MarketCore is exported by engine-loader (client == server source)', !!MarketCore);

check('rates cover exactly the three tradable resources',
  JSON.stringify(Object.keys(MarketCore.MARKET_RATES).sort()) === JSON.stringify(['food', 'stone', 'wood']) &&
  JSON.stringify([...MarketCore.MARKET_RESOURCES].sort()) === JSON.stringify(['food', 'stone', 'wood']));

// Deliberately worse than production parity (~8 wood : 1 gold at comparable
// investment). If a rate ever drops under that, the merchant stops being a
// dump valve and starts being an income strategy.
check('every rate is worse than production parity (>= 10 : 1)',
  MarketCore.MARKET_RESOURCES.every(r => MarketCore.MARKET_RATES[r] >= 10));

check('daily cap scales per Marketplace level, and is zero without one',
  MarketCore.marketDailyCap(0) === 0 &&
  MarketCore.marketDailyCap(1) === MarketCore.MARKET_GOLD_PER_MK_LEVEL &&
  MarketCore.marketDailyCap(10) === MarketCore.MARKET_GOLD_PER_MK_LEVEL * 10);

check('no Marketplace means no trade at all',
  MarketCore.marketQuote('wood', 100000, 0, null, Date.now()).ok === false);

const _mkNow = Date.UTC(2026, 6, 30, 12, 0, 0);
const _q1 = MarketCore.marketQuote('wood', 1000, 5, null, _mkNow);
check('a plain sale converts at the published rate',
  _q1.ok && _q1.gold === Math.floor(1000 / MarketCore.MARKET_RATES.wood) &&
  _q1.spend === _q1.gold * MarketCore.MARKET_RATES.wood);

// spend must always be an exact multiple of the rate — the player should never
// hand over a remainder that buys nothing.
check('spend never takes a remainder the player is not paid for',
  [1, 19, 20, 21, 999, 1234567].every(amt => {
    const q = MarketCore.marketQuote('wood', amt, 5, null, _mkNow);
    return !q.ok || q.spend % MarketCore.MARKET_RATES.wood === 0;
  }));

check('a sale below one gold is rejected rather than eating the resources',
  MarketCore.marketQuote('wood', MarketCore.MARKET_RATES.wood - 1, 5, null, _mkNow).ok === false);

const _capLvl = 10;

// Worth stating plainly, because it shapes how the merchant FEELS: at 20:1 a
// single tier-3 expedition find (up to 187,200 wood) is only ~9,360 gold, well
// under the 30,000/day cap. The cap does not bind on one find — it binds on
// dumping a stockpile, which is exactly the behaviour it exists to bound.
const _oneFind = MarketCore.marketQuote('wood', 187200, _capLvl, null, _mkNow);
check('a single tier-3 find sells freely (the cap is not a per-sale gate)',
  _oneFind.ok && _oneFind.capped === false &&
  _oneFind.gold === Math.floor(187200 / MarketCore.MARKET_RATES.wood));

// THE headline guard: dumping a whole DAY of endgame resource income (~3.09M,
// see scripts/economy-projection.js) must be clamped to the daily cap.
const _bigDump = MarketCore.marketQuote('wood', 3090000, _capLvl, null, _mkNow);
check('dumping a full day of resource income is clamped to the daily cap',
  _bigDump.ok && _bigDump.gold === MarketCore.marketDailyCap(_capLvl) && _bigDump.capped === true);

// Partial fill: the overflow stays in the stockpile rather than being consumed.
check('a capped sale only spends what it was actually paid for',
  _bigDump.spend === _bigDump.gold * MarketCore.MARKET_RATES.wood && _bigDump.spend < 3090000);

const _spent = MarketCore.marketRecord(null, 1200, _mkNow);
const _full  = MarketCore.marketRecord(null, MarketCore.marketDailyCap(1), _mkNow);

check('the ledger accumulates within a day',
  MarketCore.marketSoldToday(_spent, _mkNow) === 1200 &&
  MarketCore.marketSoldToday(MarketCore.marketRecord(_spent, 300, _mkNow), _mkNow) === 1500);

check('remaining volume shrinks as the ledger fills, and floors at zero',
  MarketCore.marketRemainingToday(5, _spent, _mkNow) === MarketCore.marketDailyCap(5) - 1200 &&
  MarketCore.marketRemainingToday(1, _full, _mkNow) === 0);

// The cap resets on the UTC date rollover — the same date-key rule the
// expedition tile-depletion counter uses, so both age out identically.
const _tomorrow = _mkNow + 24 * 3600 * 1000;
check('the cap resets on the UTC date rollover',
  MarketCore.marketSoldToday(_full, _tomorrow) === 0 &&
  MarketCore.marketRemainingToday(5, _full, _tomorrow) === MarketCore.marketDailyCap(5));

check('a fully-spent day blocks further sales until reset',
  MarketCore.marketQuote('wood', 100000, 1, _full, _mkNow).ok === false &&
  MarketCore.marketQuote('wood', 100000, 1, _full, _tomorrow).ok === true);

// Sanity vs the income model: the merchant must stay a minority gold channel.
// Endgame gold income is ~252k/day (scripts/economy-projection.js).
check('the merchant stays a minority of endgame gold income',
  MarketCore.marketDailyCap(10) < 252000 * 0.25);

// ── Temple blessings ────────────────────────────────────────────
// Temple level is the CEILING on how many hours you may buy, not the
// duration itself — the player chooses underneath it and pays per hour.
section('Temple blessings');

check('Temple level caps the hours you may consecrate',
  blessingMaxHours(1) === 1 && blessingMaxHours(2) === 2 && blessingMaxHours(9) === 9 &&
  blessingMaxHours(0) === 1 && blessingMaxHours(undefined) === 1);

check('duration is exactly the hours chosen',
  blessingDuration(1) === 3600 && blessingDuration(5) === 5 * 3600);

// blessingCost returns { gold, food, wood, stone } since 2026-07-30. A caller
// that treats it as a number yields NaN or a free blessing, so pin the SHAPE as
// well as the linearity.
check('offering is an object with gold + all three resources',
  typeof blessingCost(1) === 'object' &&
  ['gold', 'food', 'wood', 'stone'].every(k => typeof blessingCost(1)[k] === 'number'));

check('offering is linear per hour (no bulk discount or penalty)',
  blessingCost(1).gold === 3000 && blessingCost(4).gold === 12000 &&
  blessingCost(8).gold === blessingCost(1).gold * 8 &&
  blessingCost(8).wood === blessingCost(1).wood * 8);

check('blessings drain resources, not just gold (the recurring resource sink)',
  blessingCost(1).food > 0 && blessingCost(1).wood > 0 && blessingCost(1).stone > 0);

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
const _TIERED = new Set(['resource', 'event', 'trade', 'legendary']);
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

// ── 5. Client formulas == server catch-up ───────────────────────
section('Client/server parity (catchUp uses EconomyCore)');

const ENGINE = { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS, BUILDING_DEFS, RACES, EconomyCore, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS };

const NOW  = 1_750_000_000_000;
const HOUR = 3_600_000;
const cityFixture = {
  id: 'c_test', playerId: 'p_test', name: 'Testheim', x: 3, y: 7,
  population: 5000, freePopulation: 3,
  buildings: { town_hall: 2, lumber_mill: 3, stone_quarry: 2, farm: 2, aqueduct: 4, marketplace: 1 },
  constructionQueue: [], recruitmentQueue: [], activeModifiers: [],
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
// getPopGrowthRate(stats, food) proves both sides agree.
const popRate  = EconomyCore.getPopGrowthRate(statsT, expected.food);
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
