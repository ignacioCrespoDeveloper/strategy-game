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
  BUILDING_DEFS, UNIT_DEFS, UNIT_ROSTER, RACES, EconomyCore, RESEARCH_DEFS, RESEARCH_TIERS,
  TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS,
  DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES,
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
check('dark elf +30% wood applies', raceRates.wood === Math.floor(og(30, 1) * 1.3));

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

check('6 books defined, tiers gate at Library 1/4/8',
  Object.keys(RESEARCH_DEFS).length === 6 &&
  RESEARCH_TIERS[1] === 1 && RESEARCH_TIERS[2] === 4 && RESEARCH_TIERS[3] === 8);

const fx = EconomyCore.getResearchEffects({ agronomy_tomes: 3, engineering_tomes: 2, cartography: 5 });
check('getResearchEffects sums bonus keys across books',
  Math.abs(fx.food_production - 0.12) < 1e-9 &&
  Math.abs(fx.construction_speed - (-0.08)) < 1e-9 &&
  Math.abs(fx.march_food_cost - (-0.40)) < 1e-9);

check('research production bonus stacks with race in getRates',
  EconomyCore.getRates({ lumber_mill: 1 }, { wood_production: 0.30 + 0.20 }, null).wood === Math.floor(og(30, 1) * 1.5));

check('getBuildTime applies race + Engineering Tomes (dwarf −20% + −20% → ×0.6)',
  EconomyCore.getBuildTime(BUILDING_DEFS.town_hall, 1, RACES.dwarf.bonuses, { construction_speed: -0.20 }) ===
  Math.round(BUILDING_DEFS.town_hall.buildTime(1) * 0.6));

check('Town Hall divides build time nanite-style (Lv1 ÷2, Lv5 ÷32)',
  EconomyCore.getCityBuildDivisor({ town_hall: 5, farm: 3 }) === 32 &&
  EconomyCore.getBuildTime(BUILDING_DEFS.library, 1, null, null, { town_hall: 1 }) ===
  Math.round(BUILDING_DEFS.library.buildTime(1) / 2) &&
  EconomyCore.getBuildTime(BUILDING_DEFS.dragon_lair, 1, null, null, { town_hall: 5 }) ===
  Math.round(BUILDING_DEFS.dragon_lair.buildTime(1) / 32));

check('race/research % applies on top of the Town Hall divisor (5s floor holds)',
  EconomyCore.getBuildTime(BUILDING_DEFS.library, 1, RACES.dwarf.bonuses, { construction_speed: -0.20 }, { town_hall: 4 }) ===
  Math.max(5, Math.round(BUILDING_DEFS.library.buildTime(1) * 0.6 / 16)));

check('getRecruitTime applies Drill Manuals (−20% at L5)',
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 2, { recruit_speed: -0.20 }) === Math.round(600 * 2 * 0.8));

// ── Hangar rule + military chain + veterancy (2026-07-27) ──────
check('hangar rule: training-building levels above the gate divide recruit time',
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1, null, 1, 1) === 600 &&   // at unlock: ÷1
  EconomyCore.getRecruitTime({ recruitTime: 600 }, 1, null, 5, 1) === 120 &&   // 4 above: ÷5
  EconomyCore.getRecruitTime({ recruitTime: 21600 }, 1, null, 12, 8) === Math.round(21600 / 5));

check('getUnitTraining finds the roster gate',
  JSON.stringify(EconomyCore.getUnitTraining('human', 'spearmen')) === JSON.stringify({ buildingId: 'barracks', minLevel: 1 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('human', 'greatswords')) === JSON.stringify({ buildingId: 'barracks', minLevel: 9 }) &&
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
  JSON.stringify(EconomyCore.getUnitTraining('dark_elf', 'black_guard_naggarond')) === JSON.stringify({ buildingId: 'barracks', minLevel: 10 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('high_elf', 'sun_dragon')) === JSON.stringify({ buildingId: 'dragon_lair', minLevel: 1 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('high_elf', 'frostheart_phoenix')) === JSON.stringify({ buildingId: 'dragon_lair', minLevel: 3 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('dwarf', 'quarrellers')) === JSON.stringify({ buildingId: 'archery_range', minLevel: 3 }) &&
  JSON.stringify(EconomyCore.getUnitTraining('dwarf', 'thunderers')) === JSON.stringify({ buildingId: 'engineering_workshop', minLevel: 1 }));

check('Cartography discounts march food (lone lord 1 tile: 50 → 30 at −40%)',
  EconomyCore.getMarchFoodCost(1, null, { march_food_cost: -0.40 }) === 30);

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
            researchQueue: [{ bookId: 'agronomy_tomes', targetLevel: 2, startedAt: 0, finishAt: 1_000 }] },
  lords: {}, cities: {}, armies: {},
}));
const researchDone = catchUp(researchState, 2_000, { EconomyCore, RACES, UNIT_DEFS, BUILDING_DEFS, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS });
check('catchUp completes finished research into player.research',
  researchDone.player.research?.agronomy_tomes === 2 && researchDone.player.researchQueue.length === 0);

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
