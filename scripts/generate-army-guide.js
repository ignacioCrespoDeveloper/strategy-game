// =============================================
//  generate-army-guide.js — Race matchup matrix + top armies
//
//  Run:  node scripts/test-balance.js          (refresh balance-results.json)
//        node scripts/generate-army-guide.js   (rebuild army-guide.html)
//
//  Writes army-guide.html (repo root, served by the dev server at
//  http://localhost:3000/army-guide.html):
//    1. Race-vs-race win matrix (row race's win % against column race,
//       pooled over all strategy archetypes and both attack directions)
//    2. Top 5 army compositions — gold cost, PWR, win rate, full roster
// =============================================

import { RACES } from '../server/engine-loader.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT        = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultsPath = join(ROOT, 'balance-results.json');
if (!existsSync(resultsPath)) {
  console.error('balance-results.json not found — run `node scripts/test-balance.js` first.');
  process.exit(1);
}
const res = JSON.parse(readFileSync(resultsPath, 'utf8'));

const RACE_ORDER = ['dwarf', 'dark_elf', 'high_elf', 'human', 'orc'];
const raceName   = id => RACES[id]?.name || id;
const esc        = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Flavor names for the race/strategy archetypes.
const ARMY_NAMES = {
  'human/swarm':       'The Empire Muster',
  'human/elite':       'Imperial Steel',
  'human/balanced':    'The Imperial Line',
  'dwarf/swarm':       'The Throng',
  'dwarf/elite':       "The King's Guard",
  'dwarf/balanced':    'The Dwarf Castle',
  'orc/swarm':         'Da Waaagh!',
  'orc/elite':         'Da Big Boss Mob',
  'orc/balanced':      'Da Warband',
  'high_elf/swarm':    'Host of Ulthuan',
  'high_elf/elite':    'The Dragon Host',
  'high_elf/balanced': 'The Silver Host',
  'dark_elf/swarm':    'The Black Ark Raiders',
  'dark_elf/elite':    'The Menagerie',
  'dark_elf/balanced': 'Host of Naggaroth',
};

// Cell color: green when the row race is winning the matchup, red when losing.
function cellClass(rate) {
  if (rate === null || rate === undefined) return '';
  if (rate >= 0.60) return 'c-strong';
  if (rate >= 0.53) return 'c-good';
  if (rate >  0.47) return 'c-even';
  if (rate >  0.40) return 'c-bad';
  return 'c-weak';
}

function matrixTable(stage) {
  const rows = RACE_ORDER.map(x => `
  <tr>
    <th class="rowhead">${esc(raceName(x))}</th>
    ${RACE_ORDER.map(y => {
      const rate = stage.raceVsRate?.[x]?.[y];
      const label = rate === null || rate === undefined ? '—' : `${(rate * 100).toFixed(1)}%`;
      return `<td class="cell ${cellClass(rate)}${x === y ? ' mirror' : ''}">${label}</td>`;
    }).join('')}
    <td class="cell total">${((stage.raceRate?.[x] ?? 0) * 100).toFixed(1)}%</td>
  </tr>`).join('');
  return `
  <h2>${esc(stage.label)} matchups <span class="stage-meta">lord level ${stage.lordLevel} · PWR cap ${stage.pwrCap}</span></h2>
  <div class="tablewrap">
  <table class="matrix">
    <thead><tr><th></th>${RACE_ORDER.map(y => `<th>${esc(raceName(y))}</th>`).join('')}<th>Overall</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>`;
}

const STAGE_ORDER = ['start', 'mid', 'end'];
const stageBlocks = STAGE_ORDER
  .map(id => res.stages?.[id])
  .filter(Boolean)
  .map(matrixTable)
  .join('');

const top5 = [...res.combos].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
const topRows = top5.map((c, i) => `
  <tr>
    <td class="rank">${i + 1}</td>
    <td class="a-name">${esc(ARMY_NAMES[c.key] || c.key)}<div class="a-sub">${esc(raceName(c.race))} — ${esc(c.arch)}</div></td>
    <td class="a-gold">${c.gold.toLocaleString()} gold</td>
    <td class="a-pwr">${c.pwr} PWR</td>
    <td class="winrate">${(c.winRate * 100).toFixed(1)}%</td>
    <td class="roster">${c.units.map(u => `${u.count}× ${esc(u.name)}`).join(', ')}</td>
  </tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hexfront — Army Matchups</title>
<style>
  :root { --bg:#14100c; --panel:#1e1811; --line:#3a2f1f; --gold:#c9a227; --text:#d8cdb8; --dim:#8d8270; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:15px/1.5 Georgia,'Times New Roman',serif; padding:2rem clamp(1rem,4vw,3rem); }
  h1 { color:var(--gold); font-size:1.9rem; letter-spacing:.04em; }
  .sub { color:var(--dim); margin:.3rem 0 2rem; font-style:italic; }
  h2 { color:var(--gold); border-bottom:1px solid var(--line); padding-bottom:.3rem; margin:2.2rem 0 .7rem; font-size:1.35rem; }
  .stage-meta { color:var(--dim); font-size:.8rem; font-weight:normal; font-style:italic; margin-left:.6rem; }
  .note { color:var(--dim); font-size:.85rem; margin:.3rem 0 1rem; }
  .tablewrap { overflow-x:auto; }
  table { border-collapse:collapse; background:var(--panel); }
  th { color:var(--dim); font-weight:normal; font-size:.78rem; text-transform:uppercase; letter-spacing:.07em; padding:.5rem .8rem; border-bottom:1px solid var(--line); text-align:left; }
  td { padding:.5rem .8rem; border-bottom:1px solid #2a2216; }
  tr:last-child td { border-bottom:none; }
  .matrix th, .matrix td { text-align:center; }
  .matrix .rowhead { text-align:left; color:#efe6d0; font-weight:bold; font-size:.95rem; text-transform:none; letter-spacing:0; border-bottom:1px solid #2a2216; }
  .cell { font-family:Consolas,monospace; font-size:.95rem; min-width:5.2rem; }
  .c-strong { color:#7fdf7f; font-weight:bold; }
  .c-good   { color:#a8cf8a; }
  .c-even   { color:#c9bfa8; }
  .c-bad    { color:#cf9a8a; }
  .c-weak   { color:#e07060; font-weight:bold; }
  .mirror   { opacity:.55; }
  .total    { border-left:1px solid var(--line); color:var(--gold); font-weight:bold; }
  .rank { color:var(--gold); font-weight:bold; font-size:1.1rem; text-align:center; }
  .a-name { color:#efe6d0; font-weight:bold; white-space:nowrap; }
  .a-sub { color:var(--dim); font-weight:normal; font-size:.75rem; }
  .a-gold, .a-pwr { white-space:nowrap; font-family:Consolas,monospace; }
  .winrate { color:#7fdf7f; font-weight:bold; font-family:Consolas,monospace; }
  .roster { font-size:.85rem; color:#b8ab90; }
  .legend { color:var(--dim); font-size:.8rem; margin-top:.5rem; }
</style>
</head>
<body>
  <h1>⚔ Hexfront — Army Matchups</h1>
  <p class="sub">Simulated through the real battle engine: every race × strategy archetype at the same PWR cap (${res.pwrCap}), ${res.reps} fights per pairing per side. Generated ${new Date(res.generatedAt).toLocaleString('en-GB')} — regenerate with <code>node scripts/test-balance.js</code> then <code>node scripts/generate-army-guide.js</code>.</p>

  <p class="note">Each cell: the ROW race's win rate against the COLUMN race (all strategies pooled, both attack directions). Diagonal = mirror matches between that race's own strategies. Last column: overall win rate vs the whole field. Stages limit armies to the units whose war buildings realistically exist at that point (Start: Barracks/Archery/Stables 1–3 · Midgame: + workshops and level 4–7 · Endgame: full roster incl. Monster Pit and Dragon Lair).</p>
  <p class="legend">Green — the row race wins the matchup · Red — it loses it · Faded — mirror.</p>
  ${stageBlocks}

  <h2>Best of the four archetypes <span class="stage-meta">endgame</span></h2>
  <p class="note"><b>These are not optimal armies, and the table is not a search.</b> The simulation builds exactly one army per race per archetype from four fixed heuristics (cheapest-first, highest-PWR-first, combined-arms, deep regiments) and ranks the twenty results. Each heuristic fills its army by walking its preference list and adding <em>one</em> of each unit that fits, then looping — so it produces one of every cavalry type rather than three of the best one, and it never evaluates putting the whole budget into a single unit. Read these as "the best of what four reasonable recipes produce", not "the strongest armies in the game".</p>
  <div class="tablewrap">
  <table>
    <thead><tr><th>#</th><th>Army</th><th>Cost</th><th>PWR</th><th>Win rate</th><th>Composition</th></tr></thead>
    <tbody>${topRows}</tbody>
  </table>
  </div>
</body>
</html>`;

writeFileSync(join(ROOT, 'army-guide.html'), html, 'utf8');
console.log('army-guide.html written — http://localhost:3000/army-guide.html');
