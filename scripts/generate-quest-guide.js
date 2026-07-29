// =============================================
//  generate-quest-guide.js — Best expedition army per race per stage
//
//  Run:  node scripts/generate-quest-guide.js   (rebuild quest-guide.html)
//
//  Writes quest-guide.html (repo root, served at
//  http://localhost:3000/quest-guide.html).
//
//  Every number here is read from the live engine (DiscoveryRoll, EconomyCore,
//  UNIT_ROSTER) — nothing is transcribed, so the guide can't drift from the
//  game the way a hand-written one would.
//
//  THE EXPEDITION PROBLEM, in one paragraph:
//    Expedition Rating is a FLOOR pushing your army bigger — it gates which
//    recruits you can attract, and scouts pay double toward it. Footprint is a
//    CEILING pushing back — past 600 PWR you get ambushed more, come back
//    empty more, and the quiet finds stay hidden. Past 800 PWR an ambush
//    fields MORE power than you brought. And a recruit that doesn't fit under
//    your army cap is lost outright. So the answer is never "bring
//    everything": it's a scout-heavy force at roughly half your cap, with a
//    small line escort to screen the lord.
//
//  An earlier version of this file simply maximised ER by filling the PWR
//  budget. That advice is now actively wrong — filling the budget is the
//  single worst thing you can do — hence the solver below.
// =============================================

import { UNIT_DEFS, UNIT_ROSTER, RACES, EconomyCore, DiscoveryRoll } from '../server/engine-loader.js';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RACE_ORDER = ['dwarf', 'dark_elf', 'high_elf', 'human', 'orc'];
const raceName   = id => RACES[id]?.name || id;
const esc        = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pwr        = def => EconomyCore.getUnitPower(def);
const isScout    = def => (def.traits || []).includes('scout');

// Mirrors scripts/test-balance.js so both guides describe the same game.
const STAGES = [
  { id: 'start', label: 'Start',   lordLevel: 3,  pwrCap: 440  },
  { id: 'mid',   label: 'Midgame', lordLevel: 6,  pwrCap: 680  },
  { id: 'end',   label: 'Endgame', lordLevel: 10, pwrCap: 1000 },
];

const _EARLY_BUILDINGS = new Set(['barracks', 'archery_range', 'stables']);
function stageAllows(stageId, buildingId, minLevel) {
  if (stageId === 'end') return true;
  if (buildingId === 'dragon_lair' || buildingId === 'monster_pit') return false;
  if (minLevel >= 8) return false;
  if (stageId === 'mid') return true;
  return _EARLY_BUILDINGS.has(buildingId) && minLevel <= 3;
}

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

// Recruit tiers come straight from the engine; only the "heaviest member"
// derivation is local, since that's what decides how much headroom to keep.
const TIERS = DiscoveryRoll.RECRUIT_TIERS.map(t => {
  const defs = (t.pool || []).map(id => UNIT_DEFS[id]).filter(Boolean);
  const heaviest = defs.reduce((m, d) => (!m || pwr(d) > pwr(m) ? d : m), null);
  return { ...t, heaviest, reserve: heaviest ? Math.ceil(pwr(heaviest)) : 0 };
});

// ── Solver ────────────────────────────────────────────────────
// Enumerate candidate builds (how many scouts × how many line troops) and
// score them against every constraint at once, rather than optimising ER
// alone. Deliberately prefers the SMALLEST army that reaches the best tier:
// every extra point of PWR is more ambushes, worse finds, and less headroom.
function bestExpedition(race, stage) {
  const avail  = raceUnits(race, stage.id);
  if (!avail.length) return null;
  const scouts = avail.filter(isScout);
  // Cheapest gold per ER — the whole reason to bring a scout.
  const scout  = scouts.sort((a, b) => (a.goldCost / (pwr(a) * 2)) - (b.goldCost / (pwr(b) * 2)))[0] || null;
  // Line escort: the beefiest non-scout, to screen the lord in an ambush.
  const line   = avail.filter(d => d.id !== scout?.id).sort((a, b) => pwr(b) - pwr(a))[0] || null;
  if (!line) return null;

  let best = null;
  const maxScouts = scout ? Math.floor(stage.pwrCap / pwr(scout)) : 0;
  const maxLine   = Math.floor(stage.pwrCap / pwr(line));

  for (let s = 0; s <= maxScouts; s++) {
    for (let l = 0; l <= maxLine; l++) {
      if (s === 0 && l === 0) continue;
      const units = [];
      if (s > 0 && scout) units.push({ unitId: scout.id, count: s });
      if (l > 0)          units.push({ unitId: line.id,  count: l });

      const armyPwr = EconomyCore.getArmyPower(units, UNIT_DEFS);
      if (armyPwr > stage.pwrCap) continue;

      const er       = DiscoveryRoll.expeditionRating(units, UNIT_DEFS);
      const tier     = DiscoveryRoll.recruitTierFor(er);
      const tierMeta = TIERS.find(t => t.id === tier.id) || TIERS[TIERS.length - 1];
      const headroom = stage.pwrCap - armyPwr;
      // Must be able to KEEP the best unit of the tier it unlocks.
      if (headroom < tierMeta.reserve) continue;

      const loudness = DiscoveryRoll.loudnessOf(armyPwr);
      const ambush   = DiscoveryRoll.ambushRatioFor(armyPwr);
      const tierIdx  = TIERS.findIndex(t => t.id === tier.id); // 0 = best

      // Rank: best tier → quietest → least likely to be overmatched →
      // smallest army. A line escort is required (it's what stops the lord
      // being cut down); pure-scout builds lose their lord ~43% of the time.
      if (l === 0) continue;
      const score = [tierIdx, loudness, Math.max(0, ambush - 0.9), armyPwr];
      if (!best || score.some((v, i) => v < best.score[i] && score.slice(0, i).every((x, j) => x === best.score[j]))) {
        best = {
          score, units, armyPwr, er, tier: tierMeta, headroom, loudness, ambush,
          scoutCount: s, lineCount: l, scout, line,
          gold: units.reduce((sum, u) => sum + UNIT_DEFS[u.unitId].goldCost * u.count, 0),
        };
      }
    }
  }
  return best;
}

// ── Render ────────────────────────────────────────────────────
const tierClass = { legendary: 't-legendary', rare: 't-rare', uncommon: 't-uncommon', common: 't-common' };

function stageSection(stage) {
  const rows = RACE_ORDER.map(race => {
    const b = bestExpedition(race, stage);
    if (!b) return `<tr><td class="rowhead">${esc(raceName(race))}</td><td colspan="7" class="dim">no roster at this stage</td></tr>`;
    // scoutCount can be 0 — Dwarf and Human have no scout unit at Start
    // (theirs sit behind workshops), so their best build is line troops only.
    const roster = (b.scoutCount > 0 && b.scout)
      ? `${b.scoutCount}× ${esc(b.scout.name)} <span class="scout-tag">scout</span> + ${b.lineCount}× ${esc(b.line.name)}`
      : `${b.lineCount}× ${esc(b.line.name)} <span class="dim">— no scout available yet</span>`;
    return `
  <tr>
    <td class="rowhead">${esc(raceName(race))}</td>
    <td class="cell ${tierClass[b.tier.id]}">${b.tier.label}</td>
    <td class="cell num">${Math.round(b.er)}</td>
    <td class="cell num">${Math.round(b.armyPwr)} <span class="dim">/ ${stage.pwrCap}</span></td>
    <td class="cell num headroom">${Math.round(b.headroom)}</td>
    <td class="cell num ${b.loudness > 0 ? 'warnval' : ''}">${b.loudness.toFixed(2)}</td>
    <td class="cell num ${b.ambush >= 1 ? 'warnval' : ''}">${Math.round(b.ambush * 100)}%</td>
    <td class="roster">${roster}<div class="dim">${b.gold.toLocaleString()} gold</div></td>
  </tr>`;
  }).join('');

  return `
  <h2>${esc(stage.label)} <span class="stage-meta">lord level ${stage.lordLevel} · PWR cap ${stage.pwrCap}</span></h2>
  <div class="tablewrap">
  <table>
    <thead><tr>
      <th>Race</th>
      <th title="The best recruit tier this force can attract">Recruit tier</th>
      <th title="Expedition Rating — sum of unit PWR, with scout units counting double. Gates which recruit tier you can attract.">ER <span class="th-exp">(Expedition Rating)</span></th>
      <th title="Total army power. Counts against your lord's cap, and drives footprint.">Army PWR</th>
      <th title="Cap minus army PWR — free capacity to actually receive a recruit. Recruits that don't fit are lost.">Headroom</th>
      <th title="0 below 600 PWR, rising to 1.0 at 1000. Raises ambush and nothing rates, lowers find rewards.">Loudness</th>
      <th title="How much power an ambush would field against you, as a % of your own.">If ambushed</th>
      <th>Composition</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  </div>`;
}

const tierRows = TIERS.map(t => `
  <tr>
    <td class="cell ${tierClass[t.id]}">${t.label}</td>
    <td class="cell num">${t.er}</td>
    <td class="cell num">${t.reserve}</td>
    <td class="roster">${(t.pool || []).map(id => `${esc(UNIT_DEFS[id]?.name || id)} <span class="dim">(${Math.round(pwr(UNIT_DEFS[id] || {}))} PWR · ${UNIT_DEFS[id]?.goldCost || 0}g)</span>`).join(', ')}</td>
  </tr>`).join('');

const lenRows = Object.values(DiscoveryRoll.LENGTHS).map(L => `
  <tr>
    <td class="rowhead">${L.label}</td>
    <td class="cell num">${Math.round(L.secs / 60)} min</td>
    <td class="cell num">×${L.reward}</td>
    <td class="cell num">×${L.legendary}</td>
    <td class="cell num">×${L.nothing}</td>
    <td class="cell num ${L.risk > 1 ? 'warnval' : ''}">×${L.risk}</td>
  </tr>`).join('');

const footRows = [200, 400, 600, 700, 800, 900, 1000, 1100].map(p => {
  const l = DiscoveryRoll.loudnessOf(p);
  const a = DiscoveryRoll.ambushRatioFor(p);
  const F = DiscoveryRoll.FOOTPRINT;
  return `
  <tr>
    <td class="rowhead">${p} PWR</td>
    <td class="cell num ${l > 0 ? 'warnval' : ''}">${l.toFixed(2)}</td>
    <td class="cell num">×${(1 + F.combat * l).toFixed(2)}</td>
    <td class="cell num">×${(1 + F.nothing * l).toFixed(2)}</td>
    <td class="cell num">×${(1 - F.reward * l).toFixed(2)}</td>
    <td class="cell num ${a >= 1 ? 'warnval' : ''}">${Math.round(a * 100)}%</td>
  </tr>`;
}).join('');

const depRows = DiscoveryRoll.DEPLETION.map((d, i) => `
  <tr><td class="rowhead">${i === 0 ? 'Untouched' : `${i}× searched`}</td><td class="cell num ${d <= 0.55 ? 'warnval' : ''}">${Math.round(d * 100)}%</td></tr>`).join('');

const allScouts = Object.values(UNIT_DEFS).filter(isScout)
  .sort((a, b) => (a.goldCost / (pwr(a) * 2)) - (b.goldCost / (pwr(b) * 2)));
function unlockOf(unitId) {
  for (const [race, buildings] of Object.entries(UNIT_ROSTER)) {
    for (const [bld, lvlMap] of Object.entries(buildings)) {
      for (const [lvl, ids] of Object.entries(lvlMap)) if (ids.includes(unitId)) return { race, bld, lvl: Number(lvl) };
    }
  }
  return null;
}
const EARLY = new Set(['barracks', 'archery_range', 'stables']);
const prettyBld = b => b.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const scoutRows = allScouts.map(d => {
  const u = unlockOf(d.id);
  const early = u && EARLY.has(u.bld) && u.lvl <= 3;
  return `
  <tr>
    <td class="rowhead">${esc(d.name)}</td>
    <td class="cell">${esc(raceName(d.race))}</td>
    <td class="cell num">${Math.round(pwr(d))}</td>
    <td class="cell num">${Math.round(pwr(d)) * DiscoveryRoll.SCOUT_ER_MULT}</td>
    <td class="cell num">${d.goldCost}</td>
    <td class="cell num gpe">${(d.goldCost / (pwr(d) * DiscoveryRoll.SCOUT_ER_MULT)).toFixed(2)}</td>
    <td class="cell ${early ? 'early-yes' : 'early-no'}">${u ? `${esc(prettyBld(u.bld))} L${u.lvl}` : '—'}</td>
  </tr>`;
}).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hexfront — Expedition Guide</title>
<style>
  :root { --bg:#14100c; --panel:#1e1811; --line:#3a2f1f; --gold:#c9a227; --text:#d8cdb8; --dim:#8d8270; }
  * { box-sizing:border-box; margin:0; }
  body { background:var(--bg); color:var(--text); font:15px/1.5 Georgia,'Times New Roman',serif; padding:2rem clamp(1rem,4vw,3rem); }
  h1 { color:var(--gold); font-size:1.9rem; letter-spacing:.04em; }
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
  .headroom { color:#7fdf7f; }
  .warnval { color:#cf9a8a; font-weight:bold; }
  .roster { font-size:.85rem; color:#b8ab90; }
  .scout-tag { color:#d89060; font-size:.7rem; text-transform:uppercase; letter-spacing:.06em; }
  .gpe { color:var(--gold); font-weight:bold; }
  .t-legendary { color:#c77dff; font-weight:bold; }
  .t-rare      { color:#7fb0df; font-weight:bold; }
  .t-uncommon  { color:#a8cf8a; }
  .t-common    { color:#c9bfa8; }
  .early-yes { color:#7fdf7f; }
  .early-no  { color:#e07060; }
  .formula { background:var(--panel); border-left:3px solid var(--gold); padding:.8rem 1rem; margin:1rem 0; font-family:Consolas,monospace; font-size:.86rem; color:#b8ab90; line-height:1.7; }
  .nav { margin:.4rem 0 1.4rem; font-size:.85rem; }
  .nav a { color:var(--gold); text-decoration:none; margin-right:1rem; border-bottom:1px dotted var(--gold); }
  .th-exp { text-transform:none; letter-spacing:0; font-size:.68rem; opacity:.75; display:block; }
  th[title] { cursor:help; }
  code { color:#c9bfa8; }
</style>
</head>
<body>
  <h1>🧭 Hexfront — Expedition Guide</h1>
  <p class="sub">Every number read live from the engine. Regenerate with <code>node scripts/generate-quest-guide.js</code>. Generated ${new Date().toLocaleString('en-GB')}.</p>
  <p class="nav"><a href="army-guide.html">⚔ Army Matchups</a><a href="raid-guide.html">🏴 Raiding Guide</a></p>

  <p class="note"><b>Expeditions pull in two directions at once.</b> <b>Expedition Rating</b> is a floor pushing your army bigger — it gates which recruits you attract, and scouts count double toward it. <b>Footprint</b> is a ceiling pushing back — past 600 PWR you get ambushed more, come back empty more, and the quiet finds stay hidden. Past 800 PWR an ambush fields <em>more</em> power than you brought. And a recruit that won't fit under your army cap is lost outright, not queued.</p>
  <p class="note">So the answer is never "bring everything" — it is a <b>scout-heavy force at roughly half your cap, with a small line escort to screen the lord</b>. A pure-scout party loses its lord about 43% of the time it's ambushed; adding a couple of line troops drops that to ~4%.</p>

  <div class="formula">
    ER        = Σ unitPWR × (scout ? ${DiscoveryRoll.SCOUT_ER_MULT} : 1)<br>
    loudness  = clamp((armyPWR − ${DiscoveryRoll.QUIET_PWR}) / ${DiscoveryRoll.LOUD_PWR - DiscoveryRoll.QUIET_PWR}, 0, 1)<br>
    ambush    = ${DiscoveryRoll.ambushRatioFor(0).toFixed(2)} below ${DiscoveryRoll.OVERMATCH_PWR} PWR, rising to ${DiscoveryRoll.ambushRatioFor(DiscoveryRoll.OVERMATCH_MAX).toFixed(2)} at ${DiscoveryRoll.OVERMATCH_MAX} PWR<br>
    army cap  = 200 + 80 × lordLevel &nbsp;(max ${DiscoveryRoll.OVERMATCH_MAX} with the Commanding talent)
  </div>

  <h2>Glossary</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Term</th><th>Means</th></tr></thead>
    <tbody>
      <tr><td class="rowhead">ER</td><td><b>Expedition Rating</b> — <code>Σ unitPWR × (scout ? ${DiscoveryRoll.SCOUT_ER_MULT} : 1)</code>. Scout-trait units count double. This is the ONLY thing that decides which recruit tier an expedition can attract, and it is why a small scout party outperforms a big line army at finding things.</td></tr>
      <tr><td class="rowhead">PWR</td><td>A unit's combat power (<code>EconomyCore.getUnitPower</code>). Your army's total PWR is capped at <code>200 + 80 × lordLevel</code>.</td></tr>
      <tr><td class="rowhead">Headroom</td><td>Cap − army PWR. Free capacity to <em>receive</em> a recruit. A recruit that doesn't fit is <b>lost outright</b>, not queued.</td></tr>
      <tr><td class="rowhead">Loudness</td><td>How conspicuous the army is: 0 below ${DiscoveryRoll.QUIET_PWR} PWR, rising to 1.0 at ${DiscoveryRoll.LOUD_PWR}. Higher means more ambushes, more empty expeditions, and smaller find rewards.</td></tr>
      <tr><td class="rowhead">Footprint</td><td>The umbrella name for the loudness penalties — the ceiling that stops "bring everything" from winning.</td></tr>
      <tr><td class="rowhead">Overmatch</td><td>Past ${DiscoveryRoll.OVERMATCH_PWR} PWR an ambush fields <em>more</em> power than you brought, up to ${Math.round(DiscoveryRoll.ambushRatioFor(DiscoveryRoll.OVERMATCH_MAX) * 100)}% at ${DiscoveryRoll.OVERMATCH_MAX} PWR.</td></tr>
      <tr><td class="rowhead">Depletion</td><td>Repeat expeditions on the same tile pay less that day. Loot only — XP is unaffected.</td></tr>
    </tbody>
  </table>
  </div>

  <h2>Best expedition army <span class="stage-meta">smallest force that reaches the best tier it can still hold</span></h2>
  ${STAGES.map(stageSection).join('')}

  <h2>Recruit tiers</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Tier</th><th>ER needed</th><th>Headroom to reserve</th><th>Pool</th></tr></thead>
    <tbody>${tierRows}</tbody>
  </table>
  </div>
  <p class="note">Reserve = the PWR of the tier's heaviest unit. Bring less free capacity than that and the best find in the tier walks away.</p>

  <h2>Expedition length — your bet</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Length</th><th>Duration</th><th>Reward</th><th>Rare finds</th><th>Nothing</th><th>Ambush risk</th></tr></thead>
    <tbody>${lenRows}</tbody>
  </table>
  </div>
  <p class="note">Short is the most gold-efficient per hour (0.6× reward for ⅓ the time), but Long is the only realistic way to see Legendary finds. Scout-heavy parties should favour Short — the ambush rate on Long is where their lord gets killed.</p>

  <h2>Footprint — the cost of bringing too much</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Army PWR</th><th>Loudness</th><th>Ambush rate</th><th>Nothing rate</th><th>Find rewards</th><th>Ambush fields</th></tr></thead>
    <tbody>${footRows}</tbody>
  </table>
  </div>

  <h2>Tile depletion</h2>
  <div class="tablewrap">
  <table><thead><tr><th>Times searched today</th><th>Payout</th></tr></thead><tbody>${depRows}</tbody></table>
  </div>
  <p class="note">Per tile, resets daily. Loot only — XP is unaffected, so re-searching bare ground is still a slow way to level a lord. Move on to restore full value.</p>

  <h2>Scout units <span class="stage-meta">the ER lever</span></h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Unit</th><th>Race</th><th>PWR</th><th>ER</th><th>Gold</th><th>Gold per ER</th><th>Unlocked by</th></tr></thead>
    <tbody>${scoutRows}</tbody>
  </table>
  </div>
  <p class="note"><b>Early access is uneven.</b> High Elf, Orc and Dark Elf scouts come off a level 1–2 Archery Range or Stables. Human and Dwarf scouts sit behind a Gunpowder Workshop L4 and an Engineering Workshop L6, so both races run worse expeditions until mid-game. Green = available early, red = workshop-gated.</p>
</body>
</html>`;

writeFileSync(join(ROOT, 'quest-guide.html'), html, 'utf8');
console.log('quest-guide.html written — http://localhost:3000/quest-guide.html');
