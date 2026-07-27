// =============================================
//  run-all-tests.js — Test runner + status feed
//
//  Runs the project's test suites and writes structured results to
//  test-results.json (repo root) after every state change, so the
//  live dashboard (test-status.html, served by the dev server at
//  http://localhost:3000/test-status.html) can poll and render them.
//
//  Run all suites:      node scripts/run-all-tests.js
//  Run a single suite:  node scripts/run-all-tests.js economy
//                       node scripts/run-all-tests.js battle
// =============================================

import { spawn }                   from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname }           from 'path';
import { fileURLToPath }           from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_FILE  = join(ROOT, 'test-results.json');

const SUITES = [
  {
    id:          'economy',
    name:        'Economy Engine',
    script:      'scripts/test-economy.js',
    description: 'OGame curves, building catalog, iron removal, client==server parity. Fast, in-process.',
  },
  {
    id:          'balance',
    name:        'Race & Strategy Balance',
    script:      'scripts/test-balance.js',
    description: 'Simulated round-robin: every race × strategy archetype at equal gold/PWR through the real battle engine. Flags overpowered races/strategies. In-process, ~10s.',
  },
  {
    id:          'battle',
    name:        'Battle / Movement Integration',
    script:      'scripts/test-battle-movement.js',
    description: '5 real accounts through the live /api/* endpoints: moves, PvP, capture/ransom, quests, raiding. ~3 min, needs the dev server running.',
  },
];

// ── Output parsing ────────────────────────────────────────────
// economy:  "── Section ──…", "  ✓ name", "  ✗ name — detail"
// battle:   "=== Section ===", "  ✅ name", "  ❌ name — detail", "  ⏭  name — skipped (reason)"

function parseChecks(output) {
  const checks = [];
  let section = '';
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    let m;
    if ((m = line.match(/^── (.+?) ─+$/)))        { section = m[1].trim(); continue; }
    if ((m = line.match(/^=== (.+) ===$/)))        { section = m[1].trim(); continue; }
    if ((m = line.match(/^\s*(?:✓|✅)\s+(.*)$/))) { checks.push({ section, status: 'pass', name: m[1] }); continue; }
    if ((m = line.match(/^\s*(?:✗|❌)\s+(.*)$/))) {
      const [name, ...detail] = m[1].split(' — ');
      checks.push({ section, status: 'fail', name, detail: detail.join(' — ') || '' });
      continue;
    }
    if ((m = line.match(/^\s*⏭\s+(.*)$/))) {
      const [name, ...detail] = m[1].split(' — ');
      checks.push({ section, status: 'skip', name, detail: detail.join(' — ') || '' });
      continue;
    }
  }
  return checks;
}

// ── State file ────────────────────────────────────────────────

let state;

function freshSuiteState(suite) {
  return {
    id: suite.id, name: suite.name, description: suite.description,
    status: 'pending', passed: 0, failed: 0, skipped: 0,
    startedAt: null, finishedAt: null, durationMs: null,
    checks: [], failures: [], exitCode: null, rawTail: '',
  };
}

function loadPrevious() {
  if (!existsSync(OUT_FILE)) return {};
  try {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    return Object.fromEntries((prev.suites || []).map(s => [s.id, s]));
  } catch { return {}; }
}

function save() {
  state.generatedAt = Date.now();
  writeFileSync(OUT_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ── Runner ────────────────────────────────────────────────────

function runSuite(suite, suiteState) {
  return new Promise(resolve => {
    suiteState.status    = 'running';
    suiteState.startedAt = Date.now();
    save();

    const child = spawn(process.execPath, [suite.script], { cwd: ROOT });
    let output = '';
    child.stdout.on('data', d => { output += d.toString('utf8'); });
    child.stderr.on('data', d => { output += d.toString('utf8'); });

    child.on('close', exitCode => {
      const checks = parseChecks(output);
      suiteState.checks     = checks;
      suiteState.passed     = checks.filter(c => c.status === 'pass').length;
      suiteState.failed     = checks.filter(c => c.status === 'fail').length;
      suiteState.skipped    = checks.filter(c => c.status === 'skip').length;
      suiteState.failures   = checks.filter(c => c.status === 'fail').map(c => c.name);
      suiteState.exitCode   = exitCode;
      suiteState.finishedAt = Date.now();
      suiteState.durationMs = suiteState.finishedAt - suiteState.startedAt;
      suiteState.status     = (exitCode === 0 && suiteState.failed === 0) ? 'passed' : 'failed';
      // Keep the tail of the raw output for debugging when parsing found nothing
      // (e.g. the dev server was down and the suite died before any check ran).
      suiteState.rawTail    = checks.length === 0 ? output.split(/\r?\n/).slice(-15).join('\n') : '';
      save();
      resolve();
    });
  });
}

async function main() {
  const only     = process.argv[2] || null;
  const selected = only ? SUITES.filter(s => s.id === only) : SUITES;
  if (selected.length === 0) {
    console.error(`Unknown suite "${only}". Available: ${SUITES.map(s => s.id).join(', ')}`);
    process.exit(1);
  }

  // Suites not selected this run keep their previous results on the dashboard.
  const previous = loadPrevious();
  state = {
    generatedAt: Date.now(),
    running:     true,
    suites:      SUITES.map(s =>
      selected.includes(s) ? freshSuiteState(s) : (previous[s.id] || freshSuiteState(s))
    ),
  };
  save();

  for (const suite of selected) {
    const suiteState = state.suites.find(s => s.id === suite.id);
    console.log(`\n▶ ${suite.name} (${suite.script})`);
    await runSuite(suite, suiteState);
    console.log(`  ${suiteState.status.toUpperCase()} — ${suiteState.passed} passed, ${suiteState.failed} failed, ${suiteState.skipped} skipped (${Math.round(suiteState.durationMs / 1000)}s)`);
  }

  state.running = false;
  save();

  const anyFailed = state.suites.some(s => selected.some(sel => sel.id === s.id) && s.status === 'failed');
  console.log(`\nResults written to test-results.json — view at http://localhost:3000/test-status.html`);
  process.exit(anyFailed ? 1 : 0);
}

main();
