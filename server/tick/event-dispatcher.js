// =============================================
//  tick/event-dispatcher.js — Server-side event queue processor
//
//  Runs on a setInterval in server/index.js every ~5 s.
//  Fetches all pending_events with fire_at <= now, claims each
//  atomically (pending → processing), then advances that player's
//  state via catchUp — the same engine sync.js uses on login.
//
//  This is what makes the game server-authoritative: PvP battles,
//  building completions, recruitment, and lord moves all resolve
//  on the server regardless of whether either player is online.
//
//  Architecture:
//    action endpoint → saves queue item + inserts pending_events row
//    dispatcher (this file) → fires at finishAt → catchUp → save
//    client → display-only; picks up results via /api/sync poll
// =============================================

import { createClient }     from '@supabase/supabase-js';
import { catchUp }          from './catch-up.js';
import { resolvePvpBattle } from '../combat-resolver.js';
import {
  DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL,
  LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS,
} from '../engine-loader.js';

const _ENGINE   = { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS };
const SYNC_KEYS = ['players', 'lords', 'cities', 'armies'];

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// Advance a single player's state — mirrors sync.js without the HTTP layer.
async function _advancePlayer(admin, playerId) {
  const { data: rows, error: loadErr } = await admin
    .from('storage').select('key, value')
    .eq('player_id', playerId).in('key', SYNC_KEYS);
  if (loadErr) throw new Error('load failed: ' + loadErr.message);

  const raw        = Object.fromEntries((rows || []).map(r => [r.key, r.value]));
  const rawPlayers = raw.players || {};
  const player     = rawPlayers[playerId];
  if (!player) return; // player record not yet bootstrapped

  const result = catchUp(
    { player, lords: raw.lords || {}, cities: raw.cities || {}, armies: raw.armies || {} },
    Date.now(),
    _ENGINE,
  );

  if (result.changed) {
    const updatedPlayers = { ...rawPlayers, [playerId]: result.player };
    const { error: saveErr } = await admin.from('storage').upsert([
      { player_id: playerId, key: 'lords',   value: result.lords   },
      { player_id: playerId, key: 'cities',  value: result.cities  },
      { player_id: playerId, key: 'armies',  value: result.armies  },
      { player_id: playerId, key: 'players', value: updatedPlayers },
    ], { onConflict: 'player_id,key' });
    if (saveErr) throw new Error('save failed: ' + saveErr.message);
  }

  // Drain any pending PvP attacks set by catchUp when an attack-intent move completed.
  // resolvePvpBattle reads fresh state from Supabase and writes all battle results itself.
  for (const lord of Object.values(result.lords)) {
    if (!lord?.pendingPvpAttack) continue;
    const { tileX, tileY } = lord.pendingPvpAttack;
    try {
      await resolvePvpBattle(admin, playerId, lord.id, tileX, tileY);
    } catch (e) {
      console.warn(`[dispatcher] PvP resolve failed for lord ${lord.id}:`, e.message);
    }
  }
}

// Recover events stuck in 'processing' after a server crash.
// Any row processing for more than 60 s is assumed orphaned and reset to 'pending'.
const _PROCESSING_TIMEOUT_MS = 60_000;

async function _recoverStuck(admin) {
  const cutoff = Date.now() - _PROCESSING_TIMEOUT_MS;
  const { error } = await admin
    .from('pending_events')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('created_at', cutoff);
  if (error) console.warn('[dispatcher] recovery query failed:', error.message);
}

// Poll pending_events and process all due rows.
// Events are processed in fire_at order so earlier attacks resolve before later ones
// (e.g. attack arriving at T=100 resolves before attack at T=120 on the same tile).
export async function runDispatch() {
  const admin = _admin();
  const nowMs = Date.now();

  await _recoverStuck(admin);

  const { data: dueEvents, error } = await admin
    .from('pending_events')
    .select('*')
    .eq('status', 'pending')
    .lte('fire_at', nowMs)
    .order('fire_at', { ascending: true })
    .limit(100);

  if (error) { console.warn('[dispatcher] fetch error:', error.message); return; }
  if (!dueEvents?.length) return;

  for (const event of dueEvents) {
    // Optimistic claim: only succeeds if status is still 'pending'.
    // Prevents double-processing on server restart or concurrent instances.
    const { data: claimed } = await admin
      .from('pending_events')
      .update({ status: 'processing' })
      .eq('id', event.id)
      .eq('status', 'pending')
      .select('id');

    if (!claimed?.length) continue; // another run already claimed it

    try {
      await _advancePlayer(admin, event.player_id);
      await admin.from('pending_events').update({ status: 'done' }).eq('id', event.id);
    } catch (e) {
      console.error('[dispatcher] event failed:', event.id, event.type, e.message);
      await admin.from('pending_events').update({ status: 'failed' }).eq('id', event.id);
    }
  }
}
