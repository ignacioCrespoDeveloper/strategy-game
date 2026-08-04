// =============================================
//  give-resources.js — DEV CHEAT: grant resources to a player
//
//  Adds wood / stone / food (and optionally gold) to a player's
//  empire pool by writing their Supabase 'players' blob directly.
//
//  Usage:
//    node scripts/give-resources.js                       → list all players
//    node scripts/give-resources.js <name>                → +100,000 each of wood/stone/food
//    node scripts/give-resources.js <name> <amount>       → +<amount> each
//    node scripts/give-resources.js <name> <amount> gold  → also +<amount> gold
//
//  <name> matches username or email, case-insensitive substring.
//  Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env (same as reset-db.js).
// =============================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url    = process.env.SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !svcKey) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(url, svcKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const nameArg  = process.argv[2] || null;
const amount   = Number(process.argv[3]) || 100_000;
const alsoGold = (process.argv[4] || '').toLowerCase() === 'gold';

// Load every players blob (one row per account) + emails for matching
const [{ data: rows, error }, { data: usersData }] = await Promise.all([
  admin.from('storage').select('player_id, value').eq('key', 'players'),
  admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
]);
if (error) { console.error('Failed to load players:', error.message); process.exit(1); }

const emailById = Object.fromEntries((usersData?.users || []).map(u => [u.id, u.email || '']));

const players = (rows || [])
  .map(r => ({ playerId: r.player_id, blob: r.value || {}, rec: (r.value || {})[r.player_id] }))
  .filter(p => p.rec);

if (!nameArg) {
  console.log('\nPlayers:');
  for (const p of players) {
    const res = p.rec.resources || {};
    console.log(`  ${p.rec.username || '?'}  <${emailById[p.playerId] || 'no email'}>` +
      `  wood=${Math.floor(res.wood || 0)} stone=${Math.floor(res.stone || 0)} food=${Math.floor(res.food || 0)} gold=${Math.floor(p.rec.coins || 0)}`);
  }
  console.log('\nUsage: node scripts/give-resources.js <name> [amount] [gold]');
  process.exit(0);
}

const needle  = nameArg.toLowerCase();
const matches = players.filter(p =>
  (p.rec.username || '').toLowerCase().includes(needle) ||
  (emailById[p.playerId] || '').toLowerCase().includes(needle));

if (matches.length === 0) {
  console.error(`No player matches "${nameArg}". Run with no arguments to list players.`);
  process.exit(1);
}
if (matches.length > 1) {
  console.error(`"${nameArg}" matches ${matches.length} players — be more specific:`);
  matches.forEach(p => console.error(`  ${p.rec.username} <${emailById[p.playerId] || ''}>`));
  process.exit(1);
}

const target = matches[0];
target.rec.resources = target.rec.resources || { wood: 0, stone: 0, food: 0 };
for (const res of ['wood', 'stone', 'food']) {
  target.rec.resources[res] = Math.floor((target.rec.resources[res] || 0) + amount);
}
if (alsoGold) target.rec.coins = Math.floor((target.rec.coins || 0) + amount);

target.blob[target.playerId] = target.rec;
const { error: saveErr } = await admin.from('storage').upsert(
  { player_id: target.playerId, key: 'players', value: target.blob },
  { onConflict: 'player_id,key' },
);
if (saveErr) { console.error('Save failed:', saveErr.message); process.exit(1); }

const res = target.rec.resources;
console.log(`\n✓ ${target.rec.username}: +${amount.toLocaleString()} wood/stone/food${alsoGold ? ' (+gold)' : ''}`);
console.log(`  now: wood=${Math.floor(res.wood).toLocaleString()} stone=${Math.floor(res.stone).toLocaleString()} food=${Math.floor(res.food).toLocaleString()} gold=${Math.floor(target.rec.coins || 0).toLocaleString()}`);
console.log('  (refresh the game — the next sync picks it up)\n');
