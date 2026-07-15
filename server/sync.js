// =============================================
//  sync.js — POST /api/sync handler
//
//  Loads the calling player's state from Supabase,
//  runs the offline catch-up engine, writes any
//  changes back, and returns the fresh state so the
//  client can hydrate localStorage in one round-trip.
//
//  Called once at login (App.init) and never again
//  during a session — all mid-session writes still
//  go through the client-side StorageService debounce.
// =============================================

import { createClient } from '@supabase/supabase-js';
import { catchUp }      from './tick/catch-up.js';

// Keys we load for catch-up (armies + cities + lords + player record)
const SYNC_KEYS = ['players', 'lords', 'cities', 'armies'];

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export async function syncPlayerState(req, res) {

  // ── 1. Auth ──────────────────────────────────────────────────
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const admin = _admin();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const playerId = user.id;

  try {
    // ── 2. Load state from Supabase ──────────────────────────────
    const { data: rows, error: loadErr } = await admin
      .from('storage')
      .select('key, value')
      .eq('player_id', playerId)
      .in('key', SYNC_KEYS);

    if (loadErr) {
      console.error('[sync] load error:', loadErr.message);
      return res.status(500).json({ error: 'Failed to load player state' });
    }

    const raw = {};
    (rows || []).forEach(row => { raw[row.key] = row.value; });

    // New player or empty state — nothing to tick yet
    const players = raw.players || {};
    const player  = players[playerId];
    if (!player) {
      return res.json({ ok: true, state: raw, events: [] });
    }

    // ── 3. Run catch-up ──────────────────────────────────────────
    const result = catchUp(
      {
        player,
        lords:  raw.lords  || {},
        cities: raw.cities || {},
        armies: raw.armies || {},
      },
      Date.now(),
    );

    // ── 4. Write changed state back to Supabase ──────────────────
    //  Only write if something actually changed — avoids unnecessary
    //  DB round-trips for players who just logged in with nothing pending.
    if (result.changed) {
      const updatedPlayers = { ...players, [playerId]: result.player };
      const writes = [
        { player_id: playerId, key: 'lords',   value: result.lords   },
        { player_id: playerId, key: 'cities',  value: result.cities  },
        { player_id: playerId, key: 'armies',  value: result.armies  },
        { player_id: playerId, key: 'players', value: updatedPlayers },
      ];

      const { error: saveErr } = await admin
        .from('storage')
        .upsert(writes, { onConflict: 'player_id,key' });

      if (saveErr) {
        // Non-fatal: log and continue; client still gets the computed state
        console.warn('[sync] save warning:', saveErr.message);
      }
    }

    // ── 5. Return fresh state to client ──────────────────────────
    //  Client calls StorageService.hydrate(state) to overwrite localStorage.
    const responseState = {
      lords:   result.lords,
      cities:  result.cities,
      armies:  result.armies,
      players: { ...players, [playerId]: result.player },
    };

    return res.json({ ok: true, state: responseState, events: result.events });

  } catch (err) {
    console.error('[sync] unexpected error:', err);
    return res.status(500).json({ error: 'Internal sync error' });
  }
}
