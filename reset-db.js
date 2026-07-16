// =============================================
//  reset-db.js — Wipes ALL game data from Supabase
//
//  Clears:
//    - storage table (all player game state)
//    - world_state table (shared world)
//    - battle_reports table (pvp reports)
//    - All Supabase auth users
//
//  Run: node reset-db.js
//  !! IRREVERSIBLE — backup first if needed !!
// =============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url     = process.env.SUPABASE_URL;
const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !svcKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(url, svcKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function clearTable(table, pkCol) {
  const { error, count } = await admin.from(table).delete({ count: 'exact' }).not(pkCol, 'is', null);
  if (error) {
    console.error(`  ✗ Failed to clear ${table}:`, error.message);
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

console.log('Clearing game tables…');
await clearTable('storage',     'player_id');
await clearTable('world_state', 'key');

try {
  await clearTable('battle_reports', 'id');
} catch (_) {
  console.log('  — battle_reports table not found, skipping');
}

console.log('\nDeleting auth users…');
await deleteAllUsers();

console.log('\n✓ Reset complete. All players must register again.\n');
