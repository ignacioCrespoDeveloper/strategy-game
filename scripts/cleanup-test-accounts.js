// =============================================================
//  scripts/cleanup-test-accounts.js — remove orphaned test accounts
//
//  test-battle-movement.js cleans up after itself, but if a run is
//  killed mid-flight (Ctrl+C, crash, dead server) its 5 disposable
//  hexfront-test-* accounts leak: auth users, storage rows,
//  pending_events, and ghost cities on the shared world_state map.
//  This removes ALL of them, from any aborted run.
//
//  USAGE
//    node scripts/cleanup-test-accounts.js
//
//  Only touches accounts whose email matches hexfront-test-<digits>-*
//  — real players are never affected.
// =============================================================

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', 'server', '.env') });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Same key list as test-battle-movement.js's cleanupAccounts().
const STORAGE_KEYS = ['players', 'lords', 'cities', 'armies', 'activity_feed', 'discoveries', 'discovery_log', 'disc_log_meta', 'search_fatigue', 'honor_points', 'rank_score'];

const { data: page, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) { console.error('listUsers failed:', error.message); process.exit(1); }

const testUsers = page.users.filter(u => /^hexfront-test-\d+-/.test(u.email || ''));
console.log(`found ${testUsers.length} orphaned test account(s)`);

// Collect their city ids BEFORE deleting storage, so the ghost tiles can be
// stripped from the shared world_state row afterwards.
const doomedCityIds = new Set();
for (const u of testUsers) {
  const { data } = await admin.from('storage').select('value').eq('player_id', u.id).eq('key', 'cities').maybeSingle();
  for (const c of Object.values(data?.value || {})) if (c?.id) doomedCityIds.add(c.id);
}

for (const u of testUsers) {
  await admin.from('storage').delete().eq('player_id', u.id).in('key', STORAGE_KEYS);
  await admin.from('pending_events').delete().eq('player_id', u.id);
  const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
  console.log(`removed ${u.email}${delErr ? ' (auth delete failed: ' + delErr.message + ')' : ''}`);
}

if (doomedCityIds.size) {
  const { data } = await admin.from('storage').select('player_id, value').eq('key', 'world_state');
  for (const row of (data || [])) {
    const tiles = row.value?.tiles;
    if (!tiles) continue;
    let changed = false;
    for (const [key, tile] of Object.entries(tiles)) {
      if (tile?.cityId && doomedCityIds.has(tile.cityId)) { delete tiles[key]; changed = true; }
    }
    if (changed) await admin.from('storage').update({ value: row.value }).eq('player_id', row.player_id).eq('key', 'world_state');
  }
}
console.log('cleanup done');
