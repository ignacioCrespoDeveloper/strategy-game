// =============================================
//  reset-db.js — Wipes ALL game data from Supabase
//
//  Clears EVERY table the game writes to — keep this list in sync with any
//  new table added under server/ (grep for `.from('`), or a reset silently
//  leaves live rows behind:
//    - storage        (all per-player state: players/lords/cities/armies/
//                      honor_points/activity_feed/battle_history/
//                      search_fatigue/rank_score)
//    - world_state    (shared world tile map + founded-city registry)
//    - battle_reports (pvp reports)
//    - clans          (see below)
//    - clan_wars      (see below)
//    - pending_events (queued build/recruit/research/blessing/march dispatch)
//    - All Supabase auth users
//
//  clans/clan_wars matter more than they look: they're the one entity NOT
//  keyed per-player in `storage`, so wiping storage alone strands them —
//  clan-list.js selects them unfiltered (ghost clans in every new player's
//  browser), clan-create.js keeps their names/tags reserved forever, and no
//  one can disband them because the `player.clanId` that would let a member
//  leave lived in the storage blob that just got wiped.
//
//  THIS FILE IS JAVASCRIPT, NOT SQL. Run it with node, from a terminal. It
//  cannot be pasted into the Supabase SQL editor — Postgres reports that as
//  `42601: syntax error at or near "//"`. If you want the paste-into-the-
//  dashboard version, use supabase/reset-db.sql, which clears the same tables
//  in the same order.
//
//  USAGE
//    node reset-db.js          → DRY RUN. Counts what would be destroyed and
//                                exits. Changes nothing. This is the default
//                                on purpose: the wipe is irreversible and
//                                there is no undo, so it must be typed for.
//    node reset-db.js --yes    → actually performs the wipe.
//
//  !! IRREVERSIBLE — there is no backup and no undo. The dry run exists so
//     you can see the blast radius (including the live player count) before
//     committing to it. !!
// =============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Default to the safe path. Only the explicit flag destroys anything — a
// bare `node reset-db.js`, a stray shell-history arrow-up, or an accidental
// double-enter all land in the dry run instead of wiping the world.
const CONFIRMED = process.argv.slice(2).some(a => a === '--yes' || a === '-y');

const url     = process.env.SUPABASE_URL;
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !svcKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(url, svcKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// `optional: true` = a table that may legitimately not exist yet (it ships in
// a migration under supabase/migrations/ that may not have been applied on
// this project). Postgrest reports that as 42P01, which is a "skip", not a
// failure — every other error still prints as one.
// Dry-run counterpart of clearTable — same table list, same optional-table
// handling, but a HEAD select instead of a delete. Kept adjacent to it so the
// two can't drift into reporting a different set of tables than the wipe hits.
async function countTable(table, { optional = false } = {}) {
  const { error, count } = await admin.from(table).select('*', { count: 'exact', head: true });
  if (error) {
    if (optional && (error.code === '42P01' || /does not exist/i.test(error.message))) {
      console.log(`  — ${table}: table not found, would skip`);
    } else {
      console.error(`  ✗ Could not count ${table}:`, error.message);
    }
    return;
  }
  console.log(`  • ${table}: ${count ?? '?'} rows would be deleted`);
}

async function countUsers() {
  let page = 1, total = 0;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) { console.error('  ✗ listUsers failed:', error.message); break; }
    if (!data.users.length) break;
    total += data.users.length;
    if (data.users.length < 50) break;
    page++;
  }
  console.log(`  • auth.users: ${total} accounts would be deleted`);
}

async function clearTable(table, pkCol, { optional = false } = {}) {
  const { error, count } = await admin.from(table).delete({ count: 'exact' }).not(pkCol, 'is', null);
  if (error) {
    if (optional && (error.code === '42P01' || /does not exist/i.test(error.message))) {
      console.log(`  — ${table}: table not found, skipping`);
    } else {
      console.error(`  ✗ Failed to clear ${table}:`, error.message);
    }
  } else {
    console.log(`  ✓ ${table}: ${count ?? '?'} rows deleted`);
  }
}

async function deleteAllUsers() {
  let page = 1;
  let total = 0;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) { console.error('  ✗ listUsers failed:', error.message); break; }
    if (!data.users.length) break;

    for (const user of data.users) {
      const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
      if (delErr) {
        console.error(`  ✗ Could not delete user ${user.email}:`, delErr.message);
      } else {
        total++;
      }
    }

    if (data.users.length < 50) break;
    page++;
  }

  console.log(`  ✓ auth.users: ${total} users deleted`);
}

console.log('\n⚠  HEXFRONT DATABASE RESET\n');

if (!CONFIRMED) {
  console.log('DRY RUN — nothing will be deleted.\n');
  console.log(`Target: ${url}\n`);
  await countTable('storage');
  await countTable('world_state');
  await countTable('battle_reports', { optional: true });
  await countTable('clan_wars',      { optional: true });
  await countTable('clans',          { optional: true });
  await countTable('pending_events', { optional: true });
  await countUsers();
  console.log('\nNothing was changed. To actually wipe all of the above:\n');
  console.log('    node reset-db.js --yes\n');
  process.exit(0);
}

console.log(`Target: ${url}`);
console.log('Clearing game tables…');
await clearTable('storage',     'player_id');
await clearTable('world_state', 'key');

// Migration-gated tables — skipped cleanly if the migration was never applied.
await clearTable('battle_reports', 'id', { optional: true });
// clan_wars BEFORE clans: clan_wars.clan_a/b_id are `on delete cascade`, so
// clearing clans first would silently take the wars with it and report a
// misleading "0 rows deleted" here. Both must precede deleteAllUsers() —
// clans.leader_id and clan_wars.declared_by reference auth.users(id) with NO
// cascade, so a surviving clan row makes deleting its leader's account fail
// outright on the FK.
await clearTable('clan_wars',      'id', { optional: true });
await clearTable('clans',          'id', { optional: true });
await clearTable('pending_events', 'id', { optional: true });

console.log('\nDeleting auth users…');
await deleteAllUsers();

console.log('\n✓ Reset complete. All players must register again.\n');
