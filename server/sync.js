// =============================================
//  sync.js — POST /api/sync handler
//
//  Loads the calling player's state from Supabase,
//  runs the offline catch-up engine, writes any
//  changes back, and returns the fresh state so the
//  client can hydrate localStorage in one round-trip.
//
//  Called at login (App.init) and again on every screen
//  navigation that shows live game state (see app.js's
//  _SYNC_ON_ENTER) — mid-session actions still also go
//  through the client-side StorageService debounce.
// =============================================

import { createClient }     from '@supabase/supabase-js';
import { catchUp }           from './tick/catch-up.js';
import { resolvePvpBattle, resolveArrivalCheck } from './combat-resolver.js';
import { ENGINE as _ENGINE } from './engine-loader.js';

// Keys we load for catch-up (armies + cities + lords + player record).
// honor_points is its own key (see combat-resolver.js) so it's included here
// too — otherwise a PvP battle's honor change only reaches the client on a
// full page reload, never during an active session's periodic /api/sync calls.
const SYNC_KEYS = ['players', 'lords', 'cities', 'armies', 'honor_points'];

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
        clanId:       null,
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
          // Present only for combat finds — the ambush was already fought
          // server-side, so this carries its outcome to the client rather
          // than a camp for the player to attack later.
          ambush:   pending.ambush  || null,
          recruits: pending.recruits || null,
        });
      }
      lord.pendingDiscoveries = [];
      result.changed = true;
    }

    // Drain raid payout reports the same way — a raid that finished while the
    // browser was closed may have been completed by ANY catchUp caller (the
    // dispatcher, or a plain action endpoint), all of which throw their events
    // array away. catch-up.js persists the report on the lord so it survives
    // until a sync actually delivers it.
    for (const lord of Object.values(result.lords)) {
      if (!lord?.pendingRaidReports?.length) continue;
      for (const report of lord.pendingRaidReports) {
        // The catchUp above may have just completed this very raid and already
        // pushed an inline event for it — keyed by report id so the client
        // sees each completion exactly once.
        if (result.events.some(e => e.type === 'raid_complete' && e.id === report.id)) continue;
        result.events.push({ type: 'raid_complete', ...report });
      }
      lord.pendingRaidReports = [];
      result.changed = true;
    }

    // Drain scout reports the same way. resolveScout() (combat-resolver.js) is
    // the only writer — and only from the dispatcher's offline path, where the
    // gathered intel has nowhere else to go. The online path returns its
    // discoveries straight to lord-screen.js and stashes nothing, so a scout
    // is never reported twice.
    for (const lord of Object.values(result.lords)) {
      if (!lord?.pendingScoutReports?.length) continue;
      for (const report of lord.pendingScoutReports) {
        result.events.push({ type: 'scout_result', ...report });
      }
      lord.pendingScoutReports = [];
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

    // ── 4c. Drain pending arrival checks ────────────────────────────
    //  catchUp sets lord.pendingArrivalCheck on every plain (non-attack)
    //  move completion — "is a raiding lord sitting on the tile I just
    //  arrived at". Mirrors 4b's pattern exactly; the mover is the
    //  attacker if a fight happens, so the same atkLords/atkArmies/
    //  atkPlayer fields apply.
    try {
      for (const lord of Object.values(result.lords)) {
        if (!lord?.pendingArrivalCheck) continue;
        const { tileX, tileY } = lord.pendingArrivalCheck;
        lord.pendingArrivalCheck = null; // clear in response state immediately
        const arrivalResult = await resolveArrivalCheck(admin, playerId, lord.id, tileX, tileY);
        if (arrivalResult.ok && arrivalResult.outcome === 'raid_combat') {
          if (arrivalResult.atkLords)  Object.assign(result.lords,   arrivalResult.atkLords);
          if (arrivalResult.atkArmies) Object.assign(result.armies,  arrivalResult.atkArmies);
          if (arrivalResult.atkPlayer) result.player = arrivalResult.atkPlayer;
          if (arrivalResult.report) {
            result.events.push({
              type:     'raid_combat_resolved',
              lordId:   lord.id,
              lordName: lord.name || '',
              report:   arrivalResult.report,
              terrain:  arrivalResult.terrain,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[sync] pending arrival-check drain failed:', e.message);
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
        const ownerUsername = result.player?.username || 'Player';
        for (const city of playerCities) {
          if (city.x != null && city.y != null) {
            const key      = `${city.x},${city.y}`;
            const existing = worldState.tiles[key];
            // Cities are always visible map-wide by name + owner (garrison
            // stays hidden until scouted — see js/ui/map-view.js) — the
            // tile entry carries that metadata directly since a regular
            // client's RLS can't read another player's 'cities' row to
            // look it up on demand. Self-heals name/owner drift too, not
            // just a missing/legacy (bare cityId string) entry.
            const needsUpdate = !existing || typeof existing === 'string'
              || existing.cityId !== city.id || existing.name !== city.name
              || existing.ownerId !== playerId || existing.ownerUsername !== ownerUsername;
            if (needsUpdate) {
              worldState.tiles[key] = { cityId: city.id, name: city.name, ownerId: playerId, ownerUsername };
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
    //  Client calls StorageService.hydrate(state) to overwrite localStorage
    //  (a raw replace, not a merge — see js/core/storage.js hydrate()), so
    //  honorPoints must be stamped onto the player object here explicitly;
    //  it lives in Supabase under its own 'honor_points' key, never inside
    //  the players blob itself, so result.player never carries it.
    const responseState = {
      lords:   result.lords,
      cities:  result.cities,
      armies:  result.armies,
      players: { ...players, [playerId]: { ...result.player, honorPoints: raw.honor_points ?? result.player.honorPoints ?? 0 } },
    };

    return res.json({ ok: true, state: responseState, events: result.events, serverTime: Date.now() });

  } catch (err) {
    console.error('[sync] unexpected error:', err);
    return res.status(500).json({ error: 'Internal sync error' });
  }
}
