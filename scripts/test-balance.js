// =============================================
//  test-balance.js — Race & strategy balance simulation
//
//  Run:  node scripts/test-balance.js
//
//  Ignores all time restrictions and fights the REAL battle engine.
//  Runs THREE tournaments — Start / Midgame / Endgame — each restricted
//  to the units whose war buildings realistically exist at that stage,
//  with a stage-appropriate lord level and PWR cap. For each stage,
//  every race builds four strategy-archetype armies (swarm / elite /
//  balanced / blocks) under the same gold budget and PWR cap, then a
//  full round-robin (both directions, repeated — the engine is random).
//
//  Pass/fail thresholds (regression guards): race-level win rates are
//  gated at EVERY stage (Nacho 2026-07-29: nothing below 40% or above
//  60% at any stage; the check band is 38–62 to absorb sampling noise).
//  Combo-level floor/ceiling checks remain endgame-only — archetype
//  spread within a race is deliberately wider than the race band.
//
//  Lords are IDENTICAL on both sides (level, stats, no talents) and
//  veterancy is symmetric-zero, so results isolate UNIT balance.
// =============================================

import { UNIT_DEFS, UNIT_ROSTER, BattleEngine, LORD_BASE_STATS, EconomyCore } from '../server/engine-loader.js';
import { writeFileSync } from 'fs';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(title) { console.log(`\n── ${title} ${'─'.repeat(Math.max(1, 50 - title.length))}`); }

// ── Config ──────────────────────────────────────────────────────
const GOLD_BUDGET = 60_000;
const REPS        = 96;       // battles per pair per direction — the engine
                              // is random; below ~40 the noise (±5pts on a
                              // combo's win rate) is larger than the effects
                              // being tuned. 96 keeps a combo's rate within
                              // about ±1.7pts and still runs in seconds.

const RACES = ['human', 'dwarf', 'orc', 'high_elf', 'dark_elf'];

// Progression stages. Caps follow the lord formula (200 + 80×level).
const STAGES = [
  { id: 'start', label: 'Start',   lordLevel: 3,  pwrCap: 440  },
  { id: 'mid',   label: 'Midgame', lordLevel: 6,  pwrCap: 680  },
  { id: 'end',   label: 'Endgame', lordLevel: 10, pwrCap: 1000 },
];

// Which units exist at each stage — driven by the roster gate plus the
// building-chain reality (workshops need Archery Range 5+ / Fortress,
// Monster Pit needs Barracks 8, Dragon Lair needs Barracks 12):
//   start: barracks / archery range / stables, gate level ≤ 3
//   mid:   everything except gate ≥ 8, Monster Pit and Dragon Lair
//   end:   the full roster
const _EARLY_BUILDINGS = new Set(['barracks', 'archery_range', 'stables']);
function stageAllows(stageId, buildingId, minLevel) {
  if (stageId === 'end') return true;
  if (buildingId === 'dragon_lair' || buildingId === 'monster_pit') return false;
  if (minLevel >= 8) return false;
  if (stageId === 'mid') return true;
  return _EARLY_BUILDINGS.has(buildingId) && minLevel <= 3;
}

// ── Real formulas — the SAME EconomyCore code the recruit gate uses.
const unitPwr = def => EconomyCore.getUnitPower(def);
const armyPwr = units => EconomyCore.getArmyPower(units, UNIT_DEFS);

function _role(def) {
  if (def.category === 'ranged')   return 'ranged';
  if (def.category === 'cavalry')  return 'cavalry';
  if (def.category === 'monster' || def.category === 'legendary') return 'monster';
  if ((def.traits || []).includes('ranged')) return 'ranged';
  return 'infantry';
}

// ── Army building (greedy under gold budget + PWR cap) ──────────
function raceUnits(race, stageId) {
  const out = [];
  for (const [buildingId, lvlMap] of Object.entries(UNIT_ROSTER[race] || {})) {
    for (const [lvl, ids] of Object.entries(lvlMap)) {
      if (!stageAllows(stageId, buildingId, Number(lvl))) continue;
      for (const id of ids) if (UNIT_DEFS[id]) out.push(UNIT_DEFS[id]);
    }
  }
  return out;
}

// preference(defs) → ordered list of unit defs to greedily fill from.
const ARCHETYPES = {
  swarm:    defs => [...defs].sort((a, b) => a.goldCost - b.goldCost),
  elite:    defs => [...defs].sort((a, b) => unitPwr(b) - unitPwr(a)),
  balanced: defs => {
    // combined arms: a cheap screening line first, then the strongest
    // unit per role. Without the screen the expensive picks eat all the
    // targeting (the engine sends attacks at the front line first) and
    // the archetype measures screening rules, not race balance.
    const byRole = {};
    defs.forEach(d => {
      const r = _role(d);
      if (!byRole[r] || unitPwr(d) > unitPwr(byRole[r])) byRole[r] = d;
    });
    const screen = [...defs].filter(d => _role(d) === 'infantry')
      .sort((a, b) => a.goldCost - b.goldCost)[0];
    const picks = ['infantry', 'ranged', 'cavalry', 'monster'].map(r => byRole[r]).filter(Boolean);
    return screen && !picks.includes(screen) ? [screen, ...picks] : picks;
  },
  blocks: defs => {
    // regiments (2026-07-29 mass pass): FOUR line-unit types stacked
    // deep — a cheap screen, the best ranged battery, the two strongest
    // melee regiments. Exists to MEASURE the mass meta: before the
    // ranged-spill + ranks/wedge changes, one-of-each variety got all
    // the stack-count insurance and this archetype had no reason to win.
    // Monsters/legendaries are excluded on purpose (by category AND by
    // trait — dragons are category 'flying') — v1 picked the highest-PWR
    // unit and fielded 4× Arachnarok (5.9% win rate): a doomstack, not a
    // regiment. Melee regiments also require def ≥ 5: glass cannons
    // aren't line troops — v3 picked Giant Slayers (def 3) for dwarfs,
    // who died first, nuked side morale, and the army retreated with its
    // untouched Irondrakes (98% survival) still loaded: 18.7% win rate.
    const line   = defs.filter(d => d.category !== 'monster' && d.category !== 'legendary'
      && !(d.traits || []).includes('monster') && !(d.traits || []).includes('large'));
    const screen = [...line].filter(d => _role(d) === 'infantry')
      .sort((a, b) => a.goldCost - b.goldCost)[0];
    const ranged = [...line].filter(d => _role(d) === 'ranged')
      .sort((a, b) => unitPwr(b) - unitPwr(a))[0];
    const melee  = [...line].filter(d => d !== screen && d !== ranged && _role(d) !== 'ranged'
      && (d.combatStats?.defense ?? 0) >= 5)
      .sort((a, b) => unitPwr(b) - unitPwr(a));
    return [...new Set([screen, ranged, melee[0], melee[1]].filter(Boolean))];
  },
};

function buildArmy(race, archetype, stageId, pwrCap) {
  const prefs = ARCHETYPES[archetype](raceUnits(race, stageId));
  if (prefs.length === 0) return [];
  const stacks = new Map();
  let gold = 0, safety = 0;
  let added = true;
  while (added && safety++ < 500) {
    added = false;
    for (const def of prefs) {
      if (gold + def.goldCost > GOLD_BUDGET) continue;
      const trial = new Map(stacks);
      trial.set(def.id, (trial.get(def.id) || 0) + 1);
      const units = [...trial.entries()].map(([unitId, count]) => ({ unitId, count }));
      if (armyPwr(units) > pwrCap) continue;
      stacks.set(def.id, (stacks.get(def.id) || 0) + 1);
      gold += def.goldCost;
      added = true;
    }
  }
  return [...stacks.entries()].map(([unitId, count]) => ({ unitId, count }));
}

// ── Battle context (mirrors combat-resolver's _buildMultiContext) ──
function mkLord(prefix, lordLevel) {
  const s = { ...LORD_BASE_STATS };
  // identical lord on both sides — cancels out
  for (const k of Object.keys(s)) s[k] += lordLevel;
  return {
    id: `${prefix}_lord`, sourceId: `${prefix}_lord`, name: `${prefix} lord`,
    role: 'lord', traits: ['backline'], abilities: [],
    maxHp: s.health, currentHp: s.health,
    attack: s.attack, defense: s.defense, speed: s.speed,
    leadership: s.leadership || 8, magic: 0,
    count: 1, startCount: 1, isLord: true, isRouting: false,
    _frenzBonus: 0, _burning: false,
  };
}

function mkStack(stack, prefix, idx) {
  const def = UNIT_DEFS[stack.unitId];
  return {
    id: `${prefix}_${idx}`, sourceId: `${prefix}_${stack.unitId}`,
    name: def.name, role: _role(def),
    traits: [...(def.traits || [])], abilities: [...(def.abilities || [])],
    maxHp: def.combatStats?.hp ?? 100, currentHp: def.combatStats?.hp ?? 100,
    attack: def.combatStats?.attack ?? 5, defense: def.combatStats?.defense ?? 5,
    speed: def.combatStats?.speed ?? 5, leadership: 0,
    count: stack.count, startCount: stack.count,
    isLord: false, isRouting: false, _frenzBonus: 0, _burning: false,
  };
}

function fight(armyA, armyB, lordLevel) {
  const ctx = {
    terrain: 'plains',
    attacker: { id: 'A', units: [mkLord('a', lordLevel), ...armyA.map((s, i) => mkStack(s, 'a', i))], morale: 87 },
    defender: { id: 'B', units: [mkLord('b', lordLevel), ...armyB.map((s, i) => mkStack(s, 'b', i))], morale: 87 },
  };
  return BattleEngine.resolve(ctx).winner; // 'attacker' | 'defender' | 'draw'
}

// ── Tournament runner ───────────────────────────────────────────
const pct = x => `${Math.round(x * 1000) / 10}%`;

function runTournament(stage) {
  const combos = [];
  for (const race of RACES) {
    for (const arch of Object.keys(ARCHETYPES)) {
      const units = buildArmy(race, arch, stage.id, stage.pwrCap);
      if (units.length === 0) continue;
      const gold = units.reduce((s, u) => s + UNIT_DEFS[u.unitId].goldCost * u.count, 0);
      combos.push({ key: `${race}/${arch}`, race, arch, units, gold, pwr: Math.round(armyPwr(units)) });
    }
  }

  const score  = Object.fromEntries(combos.map(c => [c.key, { wins: 0, games: 0 }]));
  const raceVs = Object.fromEntries(RACES.map(x =>
    [x, Object.fromEntries(RACES.map(y => [y, { wins: 0, games: 0 }]))]));
  let attackerWins = 0, totalGames = 0;

  for (const A of combos) {
    for (const B of combos) {
      if (A.key === B.key) continue;
      for (let r = 0; r < REPS; r++) {
        const winner = fight(A.units, B.units, stage.lordLevel);
        score[A.key].games++; score[B.key].games++;
        raceVs[A.race][B.race].games++; raceVs[B.race][A.race].games++;
        totalGames++;
        if (winner === 'attacker') {
          score[A.key].wins++; raceVs[A.race][B.race].wins++; attackerWins++;
        } else if (winner === 'defender') {
          score[B.key].wins++; raceVs[B.race][A.race].wins++;
        } else {
          score[A.key].wins += 0.5; score[B.key].wins += 0.5;
          raceVs[A.race][B.race].wins += 0.5; raceVs[B.race][A.race].wins += 0.5;
        }
      }
    }
  }

  const comboRate = Object.fromEntries(combos.map(c => [c.key, score[c.key].wins / score[c.key].games]));
  const raceRate  = {};
  for (const race of RACES) {
    const keys = combos.filter(c => c.race === race).map(c => c.key);
    if (!keys.length) continue;
    raceRate[race] = keys.reduce((s, k) => s + score[k].wins, 0) / keys.reduce((s, k) => s + score[k].games, 0);
  }
  const archRate = {};
  for (const arch of Object.keys(ARCHETYPES)) {
    const keys = combos.filter(c => c.arch === arch).map(c => c.key);
    archRate[arch] = keys.reduce((s, k) => s + score[k].wins, 0) / keys.reduce((s, k) => s + score[k].games, 0);
  }
  const raceVsRate = Object.fromEntries(RACES.map(x =>
    [x, Object.fromEntries(RACES.map(y =>
      [y, raceVs[x][y].games > 0 ? raceVs[x][y].wins / raceVs[x][y].games : null]))]));

  return { stage, combos, comboRate, raceRate, archRate, raceVsRate, attackerShare: attackerWins / totalGames };
}

function printMatrix(t) {
  console.log(`\n${t.stage.label} — race matchup matrix (row's win rate vs column; lord ${t.stage.lordLevel}, cap ${t.stage.pwrCap}):`);
  const order = ['dwarf', 'dark_elf', 'high_elf', 'human', 'orc'];
  console.log('            ' + order.map(y => y.slice(0, 8).padStart(9)).join(''));
  for (const x of order) {
    const row = order.map(y => {
      const r = t.raceVsRate[x]?.[y];
      return (r === null || r === undefined ? '—' : pct(r)).padStart(9);
    }).join('');
    console.log(`  ${x.padEnd(10)}${row}   overall ${pct(t.raceRate[x] ?? 0)}`);
  }
}

// ── Run all three stages ────────────────────────────────────────
const tournaments = STAGES.map(runTournament);
const end = tournaments.find(t => t.stage.id === 'end');

for (const t of tournaments) {
  console.log(`\n${t.stage.label} armies (lord ${t.stage.lordLevel}, PWR cap ${t.stage.pwrCap}):`);
  t.combos.forEach(c => {
    const roster = c.units.map(u => `${u.count}× ${UNIT_DEFS[u.unitId].name}`).join(', ');
    console.log(`  ${c.key.padEnd(20)} PWR ${String(c.pwr).padStart(4)}  gold ${String(c.gold).padStart(6)}  → ${roster}`);
  });
}

for (const t of tournaments) printMatrix(t);

console.log('\nEndgame win rates by STRATEGY (all races pooled):');
Object.entries(end.archRate).sort((a, b) => b[1] - a[1])
  .forEach(([a, w]) => console.log(`  ${a.padEnd(10)} ${pct(w)}`));

console.log('\nEndgame win rates by race+strategy combo:');
Object.entries(end.comboRate).sort((a, b) => b[1] - a[1])
  .forEach(([k, w]) => console.log(`  ${k.padEnd(20)} ${pct(w)}`));

console.log(`\nEndgame attacker-side win share: ${pct(end.attackerShare)} (0.5 ≈ no side bias)`);

// Machine-readable summary for tooling (scripts/generate-army-guide.js
// bakes it into army-guide.html). Written next to test-results.json.
// Synchronous — a dynamic import here raced process.exit and the file
// silently never got written.
writeFileSync(new URL('../balance-results.json', import.meta.url), JSON.stringify({
  generatedAt: Date.now(),
  reps: REPS, goldBudget: GOLD_BUDGET, pwrCap: end.stage.pwrCap,
  raceRate: end.raceRate, archRate: end.archRate, comboRate: end.comboRate, raceVsRate: end.raceVsRate,
  combos: end.combos.map(c => ({
    key: c.key, race: c.race, arch: c.arch, pwr: c.pwr, gold: c.gold,
    winRate: end.comboRate[c.key],
    units: c.units.map(u => ({ unitId: u.unitId, name: UNIT_DEFS[u.unitId].name, count: u.count })),
  })),
  stages: Object.fromEntries(tournaments.map(t => [t.stage.id, {
    label: t.stage.label, lordLevel: t.stage.lordLevel, pwrCap: t.stage.pwrCap,
    raceRate: t.raceRate, raceVsRate: t.raceVsRate,
    combos: t.combos.map(c => ({
      key: c.key, race: c.race, arch: c.arch, pwr: c.pwr, gold: c.gold,
      winRate: t.comboRate[c.key],
      units: c.units.map(u => ({ unitId: u.unitId, name: UNIT_DEFS[u.unitId].name, count: u.count })),
    })),
  }])),
}, null, 2), 'utf8');

// ── Checks ──────────────────────────────────────────────────────
section('Balance thresholds (race band, all stages)');

// Races whose balance review is knowingly deferred: an out-of-band result
// reports as a skip instead of failing the suite. EMPTY right now — add a
// race here only with an explicit design decision.
const DEFERRED_RACES = new Set([]);

// Design target 40–60% per race per stage (2026-07-29 band pass landed
// every cell inside it: 40.7–57.6). Gated at 38–62: race rates at REPS 96
// carry ~±1pt of sampling noise, and the two tightest cells (orc start,
// dwarf end) sit at ~41 — an exact 40 cutoff would flip red on noise alone.
for (const t of tournaments) {
  for (const [race, rate] of Object.entries(t.raceRate)) {
    const inBand = rate >= 0.38 && rate <= 0.62;
    if (!inBand && DEFERRED_RACES.has(race)) {
      console.log(`  ⏭  ${t.stage.label}: race ${race} win rate ${pct(rate)} outside 38–62% — deferred (known open item, review pending)`);
      continue;
    }
    check(`${t.stage.label}: race ${race} win rate within 38–62% (got ${pct(rate)})`, inBand);
  }
}

// Ceiling 74%, not 72: the strongest legitimate combined-arms combo
// sits at a true ~71%, so a 72% ceiling flipped red on sampling noise
// alone. The degenerate outliers this check exists to catch measured
// 78–92% — 74 still catches all of them with margin.
const topCombo = Object.entries(end.comboRate).sort((a, b) => b[1] - a[1])[0];
check(`no race+strategy combo above 74% (top: ${topCombo[0]} at ${pct(topCombo[1])})`,
  topCombo[1] <= 0.74);

const worstCombo = Object.entries(end.comboRate).sort((a, b) => a[1] - b[1])[0];
check(`no race+strategy combo below 25% (bottom: ${worstCombo[0]} at ${pct(worstCombo[1])})`,
  worstCombo[1] >= 0.25);

check('every race fielded every archetype at endgame',
  RACES.every(r => end.combos.filter(c => c.race === r).length === Object.keys(ARCHETYPES).length));

// ── Summary ─────────────────────────────────────────────────────
console.log(`\n${'='.repeat(54)}`);
console.log(failed === 0 ? `ALL ${passed} CHECKS PASSED` : `${failed} FAILED, ${passed} passed`);
process.exit(failed === 0 ? 0 : 1);
