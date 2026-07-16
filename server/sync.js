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

import { createClient }     from '@supabase/supabase-js';
import { catchUp }           from './tick/catch-up.js';
import { resolvePvpBattle }  from './combat-resolver.js';
import { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS } from './engine-loader.js';

const _ENGINE = { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS };

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

    // New player: bootstrap a player record and persist it so subsequent
    // action endpoints (city/found, lord/create, etc.) can find it.
    const players = raw.players || {};
    let player    = players[playerId];
    if (!player) {
      const username = user.user_metadata?.username
        || user.email?.split('@')[0]
        || 'Player';
      player = {
        id:           playerId,
        username,
        coins:        5000,
        credits:      9999,
        lordId:       null,
        createdAt:    Date.now(),
        passwordHash: '__supabase__',
      };
      players[playerId] = player;

      // Persist immediately so action endpoints find it
      await admin.from('storage').upsert(
        { player_id: playerId, key: 'players', value: players },
        { onConflict: 'player_id,key' }
      );

      return res.json({
        ok: true,
        state: { players, lords: {}, cities: {}, armies: {} },
        events: [],
      });
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
      _ENGINE,
    );

    // Drain pendingDiscoveries from lords into events so the client can
    // display the quest results that resolved while the browser was closed.
    for (const lord of Object.values(result.lords)) {
      if (!lord?.pendingDiscoveries?.length) continue;
      for (const pending of lord.pendingDiscoveries) {
        result.events.push({
          type:     'quest_result',
          lordId:   lord.id,
          lordName: lord.name || '',
          defId:    pending.defId,
          category: pending.category,
          record:   pending.record  || null,
          rewards:  pending.rewards || [],
        });
      }
      lord.pendingDiscoveries = [];
      result.changed = true;
    }

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

    // ── 4b. Drain pending PvP attacks ───────────────────────────────
    //  catchUp sets lord.pendingPvpAttack when an attack-intent move
    //  completed while the browser was closed. We resolve those battles
    //  NOW — after the save above — so Supabase holds the updated lord
    //  position when _resolveCore reads it.
    try {
      for (const lord of Object.values(result.lords)) {
        if (!lord?.pendingPvpAttack) continue;
        const { tileX, tileY } = lord.pendingPvpAttack;
        lord.pendingPvpAttack = null; // clear in response state immediately
        const pvpResult = await resolvePvpBattle(admin, playerId, lord.id, tileX, tileY);
        if (pvpResult.ok) {
          if (pvpResult.atkLords)  Object.assign(result.lords,   pvpResult.atkLords);
          if (pvpResult.atkArmies) Object.assign(result.armies,  pvpResult.atkArmies);
          if (pvpResult.atkPlayer) result.player = pvpResult.atkPlayer;
          if (pvpResult.report) {
            result.events.push({
              type:     'pvp_resolved',
              lordId:   lord.id,
              lordName: lord.name || '',
              report:   pvpResult.report,
              terrain:  pvpResult.terrain,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[sync] pending PvP drain failed:', e.message);
    }

    // ── 5. Backfill world_state with this player's city positions ──
    //  This ensures all cities show on the shared world map for every player.
    try {
      const playerCities = Object.values(result.cities || {});
      if (playerCities.length > 0) {
        const { data: worldRows } = await admin
          .from('world_state').select('key, value').eq('key', 'world');
        const worldState = worldRows?.[0]?.value || { size: 20, tiles: {} };
        let changed = false;
        for (const city of playerCities) {
          if (city.x != null && city.y != null) {
            const key = `${city.x},${city.y}`;
            if (worldState.tiles[key] !== city.id) {
              worldState.tiles[key] = city.id;
              changed = true;
            }
          }
        }
        if (changed) {
          await admin.from('world_state').upsert(
            { key: 'world', value: worldState, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          );
        }
      }
    } catch (e) {
      console.warn('[sync] world_state backfill failed:', e.message);
    }

    // ── 6. Return fresh state to client ──────────────────────────
    //  Client calls StorageService.hydrate(state) to overwrite localStorage.
    const responseState = {
      lords:   result.lords,
      cities:  result.cities,
      armies:  result.armies,
      players: { ...players, [playerId]: result.player },
    };

    return res.json({ ok: true, state: responseState, events: result.events, serverTime: Date.now() });

  } catch (err) {
    console.error('[sync] unexpected error:', err);
    return res.status(500).json({ error: 'Internal sync error' });
  }
}
