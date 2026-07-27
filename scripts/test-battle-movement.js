// =============================================================
//  scripts/test-battle-movement.js
//
//  Multi-account integration test for Hexfront's movement/combat
//  loop: moving, direct PvP attack, multi-defender battles (city
//  garrison + 2 defending lords), lord capture/ransom/release,
//  questing, scouting, and raiding (+ raid interrupted by an
//  arriving enemy).
//
//  Creates 5 REAL, disposable Supabase accounts, drives them
//  through the actual /api/* endpoints the real client uses (no
//  browser — plain HTTP), asserts on the results, then deletes
//  every account + its game data + its map tiles again so nothing
//  is left behind in the live project.
//
//  USAGE
//    node scripts/test-battle-movement.js
//
//  REQUIRES
//    - The dev server running locally: npm start (or npm run dev)
//    - server/.env populated (SUPABASE_URL, SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY) — same file the server itself uses
//
//  Ambush is NOT covered here — see "Known gaps" in TESTING.md.
//  Entering ambush stance is a client-only mutation that never
//  reaches Supabase (js/core/storage.js's SERVER_KEYS skips syncing
//  'lords' writes), so there is currently no real endpoint that
//  makes a lord observably ambush-stanced server-side. That's a
//  product bug, not a gap in this script — see TESTING.md.
// =============================================================

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', 'server', '.env') });

const SUPABASE_URL  = process.env.SUPABASE_URL;
const ANON_KEY      = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE       = process.env.TEST_API_BASE || 'http://localhost:3000';
const RUN_ID          = Date.now();
const PASSWORD        = 'TestPass123!';
// Eastern edge of the map (MAP_WIDTH/HEIGHT = 20×10) — as far as possible
// from where real players are likely to have founded cities. The map is now
// small enough that a collision with real game state is possible; if a
// city-found call fails with "already occupied", pick different tiles here.
// Same relative geometry as the original 100×100 layout (bob = alice+(0,4),
// carol = alice+(4,0), dave = alice+(4,4), eve = alice+(-4,-2 clamped)) so
// travel distances/timings in the tests are unchanged.
const ZONE = { alice: [14, 4], bob: [14, 8], carol: [18, 4], dave: [18, 8], eve: [10, 2] };

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY — check server/.env');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ── tiny test-framework helpers ─────────────────────────────────

let passCount = 0, failCount = 0, skipCount = 0;
const failures = [];

function section(title) { console.log(`\n=== ${title} ===`); }
function info(msg) { console.log(`  · ${msg}`); }
function assert(name, cond, detail) {
  if (cond) { passCount++; console.log(`  ✅ ${name}`); }
  else { failCount++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
function skip(name, reason) { skipCount++; console.log(`  ⏭  ${name} — skipped (${reason})`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(path, token, body = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...json };
}

// Direct read of a player's own storage rows via the service-role client —
// used for assertions the API itself doesn't conveniently expose (e.g.
// checking ANOTHER account's lord fields, which no /api/* route reveals to
// a third party by design).
async function readStorage(playerId, key) {
  const { data, error } = await admin.from('storage').select('value').eq('player_id', playerId).eq('key', key).maybeSingle();
  if (error) throw new Error(`readStorage(${playerId}, ${key}) failed: ${error.message}`);
  return data?.value ?? null;
}

// ── account setup ────────────────────────────────────────────────

async function createTestAccount(label, race, classId, lordName) {
  const email    = `hexfront-test-${RUN_ID}-${label}@example.com`;
  const username = `Test${label}${RUN_ID % 100000}`;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { username, race },
  });
  if (createErr) throw new Error(`createUser(${label}) failed: ${createErr.message}`);

  const anon = createClient(SUPABASE_URL, ANON_KEY);
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`signIn(${label}) failed: ${signInErr.message}`);

  const acct = { label, userId: created.user.id, email, token: session.session.access_token };

  const lordRes = await api('/api/lord/create', acct.token, { name: lordName, classId });
  if (!lordRes.ok) throw new Error(`lord/create(${label}) failed: ${lordRes.error}`);
  acct.lordId = lordRes.lord.id;

  const [x, y] = ZONE[label.toLowerCase()];
  const cityRes = await api('/api/city/found', acct.token, { name: `${lordName}'s Hold`, x, y });
  if (!cityRes.ok) throw new Error(`city/found(${label}) failed: ${cityRes.error}`);
  acct.cityId = cityRes.city.id;
  acct.x = x; acct.y = y;

  // Marching costs food (distance × (2500 + 500·models)) — the starter kit
  // only covers a couple of lone-lord moves. Top the test accounts up so
  // the scenarios exercise MOVEMENT mechanics, not food scarcity (which the
  // economy suite covers via EconomyCore.getMarchFoodCost directly).
  const playersBlob = await readStorage(acct.userId, 'players');
  if (playersBlob?.[acct.userId]) {
    playersBlob[acct.userId].resources = { ...(playersBlob[acct.userId].resources || {}), food: 1_000_000 };
    const { error: topUpErr } = await admin.from('storage').upsert(
      { player_id: acct.userId, key: 'players', value: playersBlob },
      { onConflict: 'player_id,key' },
    );
    if (topUpErr) throw new Error(`food top-up(${label}) failed: ${topUpErr.message}`);
  }

  console.log(`  created ${label}: player=${acct.userId.slice(0, 8)}… lord=${lordName} (${classId}/${race}) city@(${x},${y})`);
  return acct;
}

// Instantly completes whatever's in lordId's actionQueue[0] (credits-based).
// NOTE: for plain moves this bypasses catchUp's pendingArrivalCheck — fine
// for pure repositioning, NOT fine when the move itself needs to trigger
// arrival-based combat (raid interception) or when it's the flight leg of
// intent:'attack' (which instant-action explicitly refuses anyway).
async function instantFinish(token, lordId) {
  return api('/api/lord/instant-action', token, { lordId });
}

async function moveTo(token, lordId, destX, destY, intent) {
  const body = { lordId, action: 'move', destX, destY };
  if (intent) body.intent = intent;
  return api('/api/lord/action', token, body);
}

// ── cleanup ──────────────────────────────────────────────────────

async function cleanupAccounts(accounts) {
  section('Cleanup');
  const STORAGE_KEYS = ['players', 'lords', 'cities', 'armies', 'activity_feed', 'discoveries', 'discovery_log', 'disc_log_meta', 'search_fatigue', 'honor_points', 'rank_score'];
  for (const acct of accounts) {
    if (!acct) continue;
    try {
      // Clear this account's city tile(s) from the shared world_state table
      // first — leaving a "ghost city" visible to real players on the map
      // would be the worst residue of this whole run.
      const worldState = await readStorage(acct.userId, 'world_state').catch(() => null);
      // world_state is actually a GLOBAL row, not per-player — handled once
      // below after the loop, not here. (Left this comment so the intent
      // of the two-pass cleanup is obvious to a future reader.)
      await admin.from('storage').delete().eq('player_id', acct.userId).in('key', STORAGE_KEYS);
      await admin.from('pending_events').delete().eq('player_id', acct.userId);
      await admin.auth.admin.deleteUser(acct.userId);
      info(`removed ${acct.label} (${acct.userId.slice(0, 8)}…)`);
    } catch (err) {
      console.warn(`  ⚠ cleanup failed for ${acct.label}: ${err.message}`);
    }
  }

  // world_state is one shared row keyed by a fixed key (not per-player) —
  // strip just the tiles this run's cities occupied rather than touching
  // anyone else's.
  try {
    const { data } = await admin.from('storage').select('player_id, value').eq('key', 'world_state');
    for (const row of (data || [])) {
      const tiles = row.value?.tiles;
      if (!tiles) continue;
      let changed = false;
      for (const acct of accounts) {
        if (!acct?.cityId) continue;
        const tileKey = `${acct.x},${acct.y}`;
        if (tiles[tileKey]?.cityId === acct.cityId) { delete tiles[tileKey]; changed = true; }
      }
      if (changed) {
        await admin.from('storage').update({ value: row.value }).eq('player_id', row.player_id).eq('key', 'world_state');
      }
    }
    info('cleared test city tiles from world_state');
  } catch (err) {
    console.warn(`  ⚠ world_state cleanup failed: ${err.message}`);
  }
}

// ── main ─────────────────────────────────────────────────────────

async function main() {
  console.log(`Hexfront battle/movement integration test — run ${RUN_ID}`);
  console.log(`API base: ${API_BASE}`);

  const health = await fetch(`${API_BASE}/api/health`).then(r => r.json()).catch(() => null);
  if (!health?.status) {
    console.error(`Dev server not reachable at ${API_BASE} — start it first (npm start).`);
    process.exit(1);
  }
  console.log(`Server: ${health.status}, engine ${health.engine}`);

  let alice, bob, carol, dave, eve;

  try {
    section('Setup: 5 disposable accounts + first lord + first city each');
    alice = await createTestAccount('Alice', 'human',    'warrior', 'Alice Stormblade');
    bob   = await createTestAccount('Bob',   'orc',       'warrior', 'Bob Ironhide');
    carol = await createTestAccount('Carol', 'dwarf',     'warrior', 'Carol Stonefist');
    dave  = await createTestAccount('Dave',  'high_elf',  'rogue',   'Dave Swiftblade');
    eve   = await createTestAccount('Eve',   'dark_elf',  'mage',    'Eve Nightweaver');
    assert('5 accounts created with a lord + city each', [alice, bob, carol, dave, eve].every(a => a.lordId && a.cityId));

    // ── Test 1: Movement ──────────────────────────────────────────
    section('Test 1: Movement (real travel timer, not instant-finished)');
    {
      const [destX, destY] = [eve.x, eve.y - 2];
      const mv = await moveTo(eve.token, eve.lordId, destX, destY);
      assert('move enqueued', mv.ok, mv.error);
      const secs = mv.ok ? Math.round((new Date(mv.lord.actionQueue[0].finishAt) - new Date(mv.lord.actionQueue[0].startedAt)) / 1000) : null;
      info(`travel time for 2 tiles: ${secs}s — waiting it out for real…`);
      if (mv.ok) {
        await sleep((secs + 2) * 1000);
        const sync = await api('/api/sync', eve.token, {});
        const lords = await readStorage(eve.userId, 'lords');
        const arrived = lords?.[eve.lordId];
        assert('lord arrived at destination after waiting', arrived?.x === destX && arrived?.y === destY, `got (${arrived?.x},${arrived?.y})`);
        eve.x = destX; eve.y = destY;
      }
    }

    // ── Test 2: Direct 1v1 PvP attack (real move+intent:'attack' flow) ──
    section("Test 2: Direct attack — Alice attacks Bob's city (move w/ intent:'attack', real wait, drained via /api/sync)");
    {
      const mv = await moveTo(alice.token, alice.lordId, bob.x, bob.y, 'attack');
      assert('attack-move enqueued', mv.ok, mv.error);
      if (mv.ok) {
        const secs = Math.round((new Date(mv.lord.actionQueue[0].finishAt) - new Date(mv.lord.actionQueue[0].startedAt)) / 1000);
        info(`attack ETA: ${secs}s (min 60s enforced) — waiting it out for real…`);
        await sleep((secs + 2) * 1000);
        // NOTE: the server's own background dispatcher (setInterval every 5s
        // in server/index.js) can resolve pendingPvpAttack before this
        // explicit /api/sync call gets to it — when that happens, sync's
        // `events` array comes back empty (nothing NEW to report) even
        // though the fight genuinely already resolved. That race makes
        // `events` an unreliable thing to assert on here; pendingPvpAttack
        // being cleared (by whichever mechanism got there first) is the
        // durable signal that resolution actually happened.
        const sync = await api('/api/sync', alice.token, {});
        info(`sync events: ${JSON.stringify((sync.events || []).map(e => e.type))}`);
        const aliceLords = await readStorage(alice.userId, 'lords');
        const arrivedAtTarget = aliceLords?.[alice.lordId]?.x === bob.x && aliceLords?.[alice.lordId]?.y === bob.y;
        assert('attacker arrived at target tile', arrivedAtTarget);
        assert('attack was resolved (pendingPvpAttack cleared)', aliceLords?.[alice.lordId]?.pendingPvpAttack == null);
      }
    }

    // ── Test 3: Multi-defender battle (garrison + 2 lords) ──────────
    section("Test 3: Multi-defender battle — Carol co-defends Bob's city, Dave attacks both + garrison");
    let multiDefenderReport = null;
    {
      // Army-less lords are invisible/unattackable as defenders by design
      // (combat-resolver.js's "army-less lords don't exist for combat"
      // rule) — Bob and Carol each need at least one unit or they won't
      // register as defenderGroups entries at all, leaving only the
      // garrison to fight. Dave gets a bigger stack so the odds favor him
      // winning (and having a shot at capturing a defender) rather than
      // leaving this to a coin flip.
      await api('/api/lord/hire-merc', bob.token, { lordId: bob.lordId, unitId: 'bandits' });
      await api('/api/lord/hire-merc', carol.token, { lordId: carol.lordId, unitId: 'bandits' });
      for (let i = 0; i < 5; i++) {
        const hire = await api('/api/lord/hire-merc', dave.token, { lordId: dave.lordId, unitId: 'bandits' });
        if (!hire.ok) { info(`hire-merc for Dave failed on attempt ${i + 1}: ${hire.error}`); break; }
      }
      const daveArmy = await readStorage(dave.userId, 'armies');
      info(`Dave's army before attack: ${JSON.stringify(daveArmy?.[dave.lordId]?.units)}`);

      const carolMove = await moveTo(carol.token, carol.lordId, bob.x, bob.y);
      assert('Carol move-to-co-defend enqueued', carolMove.ok, carolMove.error);
      if (carolMove.ok) await instantFinish(carol.token, carol.lordId);
      const carolLords = await readStorage(carol.userId, 'lords');
      assert('Carol repositioned onto Bob’s city tile', carolLords?.[carol.lordId]?.x === bob.x && carolLords?.[carol.lordId]?.y === bob.y);

      const daveMove = await moveTo(dave.token, dave.lordId, bob.x, bob.y);
      assert('Dave move-to-target enqueued', daveMove.ok, daveMove.error);
      if (daveMove.ok) await instantFinish(dave.token, dave.lordId);

      const resolve = await api('/api/pvp/resolve', dave.token, { attackerLordId: dave.lordId, targetTileX: bob.x, targetTileY: bob.y });
      assert('pvp/resolve succeeded', resolve.ok, resolve.error);
      if (resolve.ok) {
        multiDefenderReport = resolve.report;
        const meta = resolve.report._meta || {};
        info(`winner: ${resolve.report.winner}, reason: ${resolve.report.reason}`);
        info(`_meta.defenderGroups: ${JSON.stringify(meta.defenderGroups)}`);
        info(`_meta.garrison: ${JSON.stringify(meta.garrison)}`);
        assert('report._meta.defenderGroups has both Bob and Carol', (meta.defenderGroups || []).length === 2);
        assert('report._meta.garrison is set (Bob’s city)', !!meta.garrison);
      }
    }

    // ── Test 4: Capture / ransom / release ──────────────────────────
    section('Test 4: Lord capture → ransom or release (depends on Test 3’s outcome — RNG, not guaranteed)');
    {
      const bobLords   = await readStorage(bob.userId, 'lords');
      const carolLords = await readStorage(carol.userId, 'lords');
      const bobCaptured   = bobLords?.[bob.lordId]?.capturedByPlayerId === dave.userId;
      const carolCaptured = carolLords?.[carol.lordId]?.capturedByPlayerId === dave.userId;
      info(`Bob captured: ${bobCaptured}, Carol captured: ${carolCaptured}`);

      if (bobCaptured) {
        const ransom = await api('/api/lord/ransom', bob.token, { lordId: bob.lordId });
        assert('Bob successfully paid ransom to free his own lord', ransom.ok, ransom.error);
        if (ransom.ok) {
          const freed = await readStorage(bob.userId, 'lords');
          assert('Bob’s lord no longer shows capturedByPlayerId', !freed?.[bob.lordId]?.capturedByPlayerId);
        }
      } else {
        skip('ransom flow', 'Bob was not captured this run');
      }

      if (carolCaptured) {
        const release = await api('/api/lord/release', dave.token, { lordId: carol.lordId, ownerId: carol.userId });
        assert('Dave successfully released Carol’s lord for free', release.ok, release.error);
        if (release.ok) {
          const freed = await readStorage(carol.userId, 'lords');
          assert('Carol’s lord no longer shows capturedByPlayerId', !freed?.[carol.lordId]?.capturedByPlayerId);
        }
      } else {
        skip('release flow', 'Carol was not captured this run');
      }

      if (!bobCaptured && !carolCaptured) {
        info('Neither defender was captured (both survived, or Dave lost/drew) — this is a valid outcome, not a bug. Re-run to try for a capture, or see TESTING.md for a deterministic variant.');
      }
    }

    // ── Test 5: Quest (search_area) ──────────────────────────────────
    section("Test 5: Quest — Eve searches her tile (instant-finished via credits)");
    {
      const search = await api('/api/lord/action', eve.token, { lordId: eve.lordId, action: 'search_area' });
      assert('search_area enqueued', search.ok, search.error);
      if (search.ok) {
        const fin = await instantFinish(eve.token, eve.lordId);
        assert('instant-finish accepted (spent credits)', fin.ok, fin.error);
        const claim = await api('/api/lord/quest-resolve', eve.token, { lordId: eve.lordId });
        assert('quest-resolve returned a discovery', claim.ok && (claim.discoveries || []).length > 0, JSON.stringify(claim));
        if (claim.ok) info(`discovery: ${JSON.stringify(claim.discoveries[0]).slice(0, 200)}`);
      }
    }

    // ── Test 6: Scout ─────────────────────────────────────────────────
    section("Test 6: Scout — Dave scouts his current tile (Bob's city), instant-finished");
    {
      const scout = await api('/api/lord/action', dave.token, { lordId: dave.lordId, action: 'scout' });
      assert('scout enqueued', scout.ok, scout.error);
      if (scout.ok) {
        await instantFinish(dave.token, dave.lordId);
        const resolve = await api('/api/lord/scout-resolve', dave.token, { lordId: dave.lordId });
        assert('scout-resolve returned an outcome', resolve.ok && !!resolve.outcome, JSON.stringify(resolve));
        info(`scout outcome: ${resolve.outcome}, discoveries: ${(resolve.discoveries || []).length}`);
      }
    }

    // ── Test 7: Raiding (start → instant-finish → payout) ─────────
    section('Test 7: Raiding — Dave raids a neutral tile, instant-finished for full payout');
    const raidTile = { x: dave.x - 2, y: dave.y - 2 };
    {
      const mv = await moveTo(dave.token, dave.lordId, raidTile.x, raidTile.y);
      assert('move to neutral raid tile enqueued', mv.ok, mv.error);
      if (mv.ok) await instantFinish(dave.token, dave.lordId);

      const start = await api('/api/lord/raid-start', dave.token, { lordId: dave.lordId, durationSecs: 3600 });
      assert('raid-start succeeded', start.ok, start.error);
      if (start.ok) {
        const finish = await api('/api/lord/raid-instant', dave.token, { lordId: dave.lordId });
        assert('raid-instant succeeded with a gold payout', finish.ok && typeof finish.goldEarned === 'number', JSON.stringify(finish));
        if (finish.ok) info(`raid payout: +${finish.goldEarned}💰, stance now: ${finish.lord?.stance?.id}`);
        assert('stance reverted to idle after raid completion', finish.lord?.stance?.id === 'idle');
      }
    }

    // ── Test 8: Raid interrupted by an arriving enemy ────────────────
    section('Test 8: Raid interrupted — Eve arrives on Dave’s raid tile mid-raid, triggering combat');
    {
      const interceptTile = { x: raidTile.x, y: raidTile.y + 3 };

      // resolveArrivalCheck requires the ARRIVING lord to have a non-zero
      // army too ("army-less lords don't exist for combat" — same rule
      // Test 3 hit for the defenders) — without this, Eve's arrival
      // resolves as outcome:'no_army' and never touches Dave's raid at all.
      await api('/api/lord/hire-merc', eve.token, { lordId: eve.lordId, unitId: 'bandits' });

      const eveMove = await moveTo(eve.token, eve.lordId, interceptTile.x, interceptTile.y);
      assert('Eve pre-positions near the future raid tile', eveMove.ok, eveMove.error);
      if (eveMove.ok) await instantFinish(eve.token, eve.lordId);

      const daveMove = await moveTo(dave.token, dave.lordId, interceptTile.x, interceptTile.y);
      assert('Dave moves to the same tile as Eve', daveMove.ok, daveMove.error);
      if (daveMove.ok) await instantFinish(dave.token, dave.lordId);

      const start = await api('/api/lord/raid-start', dave.token, { lordId: dave.lordId, durationSecs: 3600 });
      assert('Dave starts raiding on the shared tile', start.ok, start.error);

      // A distance-0 move ("move" to the tile Eve is already standing on)
      // still enqueues a real move_lord action that resolves via the
      // normal catchUp path on the very next call — unlike instant-action,
      // this DOES set pendingArrivalCheck, which is what actually triggers
      // the ambush-on-raider check.
      const eveArrive = await moveTo(eve.token, eve.lordId, interceptTile.x, interceptTile.y);
      assert('Eve re-issues a (distance-0) arrival move', eveArrive.ok, eveArrive.error);
      const sync = await api('/api/sync', eve.token, {});
      info(`Eve's sync events: ${JSON.stringify((sync.events || []).map(e => e.type))}`);

      // stance alone can't distinguish "fight happened, Dave won" from "no
      // fight was triggered at all" (both leave stance === 'raiding') — so
      // check for the one thing _resolveCore unconditionally writes for
      // BOTH sides regardless of who wins: a 'pvp_result' activity-feed
      // entry. Its presence is the unambiguous signal that combat actually
      // ran, independent of outcome.
      const eveFeed = await readStorage(eve.userId, 'activity_feed');
      const fightEntry = (eveFeed?.[eve.userId] || []).find(e => e.type === 'pvp_result');
      const daveLords = await readStorage(dave.userId, 'lords');
      const stanceAfter = daveLords?.[dave.lordId]?.stance?.id;
      assert('Dave’s raid-vs-arrival combat actually resolved (pvp_result logged for Eve)', !!fightEntry, `activity_feed: ${JSON.stringify((eveFeed?.[eve.userId] || []).slice(0, 2))}`);
      info(`Dave's stance after Eve's arrival: ${stanceAfter} (idle = Eve won, raid forfeited; raiding = Dave won, raid continues)`);
    }

    section('Ambush');
    skip('ambush stance interaction', 'entering ambush is a client-only mutation that never reaches Supabase (see TESTING.md) — not reachable via any /api/* route today');

  } catch (err) {
    console.error('\nFATAL: test run aborted early:', err);
    failCount++;
    failures.push(`fatal: ${err.message}`);
  } finally {
    await cleanupAccounts([alice, bob, carol, dave, eve].filter(Boolean));
  }

  section('Summary');
  console.log(`  ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);
  if (failures.length) console.log(`  Failures: ${failures.join('; ')}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main();
