// =============================================
//  generate-raid-guide.js — Raiding income, risk, and how it compares
//
//  Run:  node scripts/generate-raid-guide.js   (rebuild raid-guide.html)
//
//  Writes raid-guide.html (repo root, served at
//  http://localhost:3000/raid-guide.html).
//
//  Raiding is the game's PASSIVE income: you park a lord on a neutral tile,
//  it earns per hour, and it needs no further input — but the lord is locked
//  for the whole duration, the payout only lands when the raid ENDS, and any
//  enemy lord with an army who arrives forces a fight that forfeits
//  everything accrued.
//
//  The rates mirror server/tick/catch-up.js's _raidHourlyRewards, which is
//  authoritative. They're duplicated as a formula here (not imported) because
//  that function is module-private; the constants are asserted against the
//  client's own preview in lord-screen.js, which uses the same numbers.
//
//  This guide's real job is the CROSS-ACTIVITY comparison at the bottom —
//  raiding vs expeditions vs city income, in the same units, so the three
//  guides can be read against each other.
// =============================================

import { RACES, EconomyCore, DiscoveryRoll, STANCE_DEFS, UNIT_DEFS } from '../server/engine-loader.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// THE rate, straight from EconomyCore — the same call the server pays out
// with and the lord screen previews. This used to be a hand-synced copy.
const raidRates = lvl => {
  const r = EconomyCore.getRaidHourlyRewards(lvl);
  return { gold: r.gold, res: r.food };
};

const DURATIONS = STANCE_DEFS.raiding?.durations || [3600, 14400, 28800, 86400];
const fmtDur = s => s >= 86400 ? `${Math.round(s / 86400)}d` : s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 60)}m`;

// ── Income by level × duration ────────────────────────────────
const LEVELS = [1, 3, 5, 6, 8, 10];
const payoutRows = LEVELS.map(lvl => {
  const r = raidRates(lvl);
  const cells = DURATIONS.map(secs => {
    const h = secs / 3600;
    return `<td class="cell num">${Math.floor(r.gold * h).toLocaleString()}<span class="dim"> + ${Math.floor(r.res * h).toLocaleString()}×3</span></td>`;
  }).join('');
  return `<tr><td class="rowhead">Level ${lvl}</td><td class="cell num">${r.gold}</td><td class="cell num">${r.res} each</td>${cells}</tr>`;
}).join('');

// ── Finish-now credit cost ────────────────────────────────────
// Mirrors server/actions/raid-instant.js / instant-action.js: ceil(secsLeft/60), min 1.
const creditRows = DURATIONS.map(secs => {
  const full = Math.max(1, Math.ceil(secs / 60));
  return `<tr>
    <td class="rowhead">${fmtDur(secs)}</td>
    <td class="cell num">${full.toLocaleString()}</td>
    <td class="cell num">${Math.max(1, Math.ceil(secs / 2 / 60)).toLocaleString()}</td>
  </tr>`;
}).join('');

// ── Cross-activity comparison ─────────────────────────────────
// Expedition figures are MEASURED, not derived: the numbers below come from
// running the real catchUp over thousands of expeditions with the guide's
// recommended build (see generate-quest-guide.js). Recorded here so the three
// guides can be compared in one place; re-measure if the tuning changes.
const EXPEDITION_MEASURED = [
  { lvl: 3,  length: 'Short',    mins: 5,  gold: 50,  res: 60  },
  { lvl: 3,  length: 'Standard', mins: 15, gold: 92,  res: 100 },
  { lvl: 3,  length: 'Long',     mins: 30, gold: 157, res: 151 },
  { lvl: 6,  length: 'Short',    mins: 5,  gold: 74,  res: 80  },
  { lvl: 6,  length: 'Standard', mins: 15, gold: 132, res: 136 },
  { lvl: 6,  length: 'Long',     mins: 30, gold: 230, res: 224 },
  { lvl: 10, length: 'Short',    mins: 5,  gold: 106, res: 103 },
  { lvl: 10, length: 'Standard', mins: 15, gold: 189, res: 198 },
  { lvl: 10, length: 'Long',     mins: 30, gold: 337, res: 319 },
];

const compareRows = [3, 6, 10].map(lvl => {
  const r     = raidRates(lvl);
  const exps  = EXPEDITION_MEASURED.filter(e => e.lvl === lvl);
  const best  = exps.reduce((m, e) => (e.gold * (60 / e.mins) > m.gold * (60 / m.mins) ? e : m), exps[0]);
  const long  = exps.find(e => e.length === 'Long');
  const expGoldHr = Math.round(long.gold * (60 / long.mins));
  const expResHr  = Math.round(long.res  * (60 / long.mins));
  const bestHr    = Math.round(best.gold * (60 / best.mins));
  return `<tr>
    <td class="rowhead">Level ${lvl}</td>
    <td class="cell num">${r.gold}</td>
    <td class="cell num">${r.res * 3}</td>
    <td class="cell num good">${expGoldHr}</td>
    <td class="cell num good">${expResHr}</td>
    <td class="cell num">${(expGoldHr / r.gold).toFixed(1)}×</td>
    <td class="cell num dim">${bestHr} <span class="dim">(${best.length})</span></td>
  </tr>`;
}).join('');

const cityRows = [
  [1000, 0,  100], [2000, 0, 100], [2000, 5, 100], [5000, 10, 100], [5000, 10, 60],
].map(([pop, mk, happy]) => `
  <tr>
    <td class="rowhead">${pop.toLocaleString()} pop</td>
    <td class="cell num">${mk === 0 ? '—' : 'L' + mk}</td>
    <td class="cell num">${happy}%</td>
    <td class="cell num">${EconomyCore.getGoldRate({ marketplace: mk }, pop, happy)}</td>
  </tr>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hexfront — Raiding Guide</title>
<style>
  :root { --bg:#14100c; --panel:#1e1811; --line:#3a2f1f; --gold:#c9a227; --text:#d8cdb8; --dim:#8d8270; --raid:#b090d8; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:15px/1.5 Georgia,'Times New Roman',serif; padding:2rem clamp(1rem,4vw,3rem); }
  h1 { color:var(--raid); font-size:1.9rem; letter-spacing:.04em; }
  .sub { color:var(--dim); margin:.3rem 0 1rem; font-style:italic; }
  h2 { color:var(--gold); border-bottom:1px solid var(--line); padding-bottom:.3rem; margin:2.2rem 0 .7rem; font-size:1.35rem; }
  .stage-meta { color:var(--dim); font-size:.8rem; font-weight:normal; font-style:italic; margin-left:.6rem; }
  .note { color:var(--dim); font-size:.85rem; margin:.3rem 0 1rem; line-height:1.55; }
  .tablewrap { overflow-x:auto; }
  table { border-collapse:collapse; background:var(--panel); width:100%; }
  th { color:var(--dim); font-weight:normal; font-size:.78rem; text-transform:uppercase; letter-spacing:.07em; padding:.5rem .8rem; border-bottom:1px solid var(--line); text-align:left; }
  td { padding:.5rem .8rem; border-bottom:1px solid #2a2216; }
  tr:last-child td { border-bottom:none; }
  .rowhead { color:#efe6d0; font-weight:bold; white-space:nowrap; }
  .cell { font-family:Consolas,monospace; font-size:.95rem; }
  .num { text-align:right; white-space:nowrap; }
  .dim { color:var(--dim); }
  .good { color:#7fdf7f; font-weight:bold; }
  .warn { margin:.8rem 0; padding:.6rem .9rem; border-radius:4px; background:rgba(180,90,70,.12); border-left:3px solid #cf9a8a; color:#cf9a8a; font-size:.85rem; line-height:1.55; }
  .nav { margin:.4rem 0 1.4rem; font-size:.85rem; }
  .nav a { color:var(--gold); text-decoration:none; margin-right:1rem; border-bottom:1px dotted var(--gold); }
</style>
</head>
<body>
  <h1>🏴 Hexfront — Raiding Guide</h1>
  <p class="sub">Rates read from the live engine. Regenerate with <code>node scripts/generate-raid-guide.js</code>. Generated ${new Date().toLocaleString('en-GB')}.</p>
  <p class="nav"><a href="army-guide.html">⚔ Army Matchups</a><a href="quest-guide.html">🧭 Expedition Guide</a></p>

  <p class="note"><b>Raiding is the passive option.</b> Park a lord on a neutral tile and it earns per hour with no further input — but the lord is locked for the whole duration, nothing is paid until the raid <em>ends</em>, and any enemy lord with an army who arrives forces a battle. Lose that battle and every coin accrued is forfeit.</p>

  <div class="warn">⚠ Rewards are paid <b>only on completion</b>. Cancelling forfeits everything earned so far — there is no partial payout. Finishing early with credits <em>does</em> pay in full.</div>

  <h2>Income by lord level <span class="stage-meta">gold/hr · each resource/hr · then total per raid</span></h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Lord</th><th>Gold/hr</th><th>Res/hr</th>${DURATIONS.map(s => `<th>${fmtDur(s)} raid</th>`).join('')}</tr></thead>
    <tbody>${payoutRows}</tbody>
  </table>
  </div>
  <p class="note">Formula: <code>gold = ${EconomyCore.RAID_BASE.gold} + ${EconomyCore.RAID_PER_LEVEL.gold} × level</code>, <code>each resource = ${EconomyCore.RAID_BASE.res} + ${EconomyCore.RAID_PER_LEVEL.res} × level</code> per hour — food, wood and stone all accrue at the same rate, so "×3" is the combined resource total. A God of Destruction blessing multiplies the whole payout by its <code>raid_bonus</code>.</p>

  <h2>Finishing early with credits</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Raid length</th><th>Credits if finished at once</th><th>Credits at halfway</th></tr></thead>
    <tbody>${creditRows}</tbody>
  </table>
  </div>
  <p class="note">Cost is <code>ceil(secondsRemaining / 60)</code>, minimum 1 — so it always costs exactly one credit per remaining minute, and finishing a 24h raid immediately is deliberately extortionate. Unlike cancelling, this pays the full reward.</p>

  <h2>Raiding vs Expeditions <span class="stage-meta">the comparison that matters</span></h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Lord</th><th>Raid gold/hr</th><th>Raid res/hr</th><th>Expedition gold/hr</th><th>Expedition res/hr</th><th>Ratio</th><th>Best expedition rate</th></tr></thead>
    <tbody>${compareRows}</tbody>
  </table>
  </div>
  <p class="note">Expedition figures are <b>measured</b>, not derived — thousands of runs through the real <code>catchUp</code> using the recommended scout-heavy build from the <a href="quest-guide.html" style="color:var(--gold)">Expedition Guide</a>, on a fresh tile, all outcomes pooled (including empty ones and ambushes). The "Long" column is used for the head-to-head since it's the fairest like-for-like against an hourly rate; the last column shows the best rate any length achieves.</p>
  <p class="note"><b>Expeditions pay several times what raiding does</b> — that is deliberate. Raiding costs no attention and carries no casualties; expeditions demand a click every few minutes, risk real units, and can get your lord killed. You are being paid for the attention and the risk.</p>

  <h2>City income for scale</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Population</th><th>Marketplace</th><th>Happiness</th><th>Gold/hr</th></tr></thead>
    <tbody>${cityRows}</tbody>
  </table>
  </div>
  <p class="note"><code>EconomyCore.getGoldRate</code> returns gold <b>per hour</b>: <code>pop × 0.004 × happiness%</code>, +8% per marketplace level. Cities are not a serious gold source — they exist to produce food, wood and stone. Gold comes from lords in the field.</p>

  <h2>Risk</h2>
  <p class="note">A raiding lord is a stationary target holding an ever-growing pile of loot. Any enemy lord with a non-empty army arriving on the tile triggers an automatic battle; losing it forfeits the raid and everything accrued. Longer raids are strictly more exposed — a 24h raid is 24× the window of a 1h one for the same hourly rate, so the duration choice is purely a bet on nobody finding you.</p>
  <p class="note">Raiding also cannot be combined with anything else: the lord is locked out of expeditions, scouting and movement for the entire duration. At level 10 an hour of raiding earns ${raidRates(10).gold} gold; an hour of expeditions earns roughly ${Math.round(337 * 2)}. The gap <em>is</em> the price of not having to be at the keyboard.</p>
</body>
</html>`;

writeFileSync(join(ROOT, 'raid-guide.html'), html, 'utf8');
console.log('raid-guide.html written — http://localhost:3000/raid-guide.html');
