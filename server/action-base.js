// =============================================
//  action-base.js — Shared helpers for action endpoints
//
//  loadAndCatchUp(req, res)
//    → auth token → load Supabase state → run catch-up
//    → returns { admin, playerId, rawPlayers, player, lords, cities, armies }
//    → returns null and writes a 4xx/5xx response on failure
//
//  saveState(admin, playerId, rawPlayers, { player, lords, cities, armies })
//    → upserts all four keys to Supabase
// =============================================

import { createClient } from '@supabase/supabase-js';
import { catchUp }      from './tick/catch-up.js';

const STATE_KEYS = ['players', 'lords', 'cities', 'armies'];

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export async function loadAndCatchUp(req, res, extraKeys = []) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing auth token' });
    return null;
  }

  const admin = _admin();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return null;
  }

  const playerId = user.id;
  const allKeys  = extraKeys.length > 0 ? [...STATE_KEYS, ...extraKeys] : STATE_KEYS;

  const { data: rows, error: loadErr } = await admin
    .from('storage')
    .select('key, value')
    .eq('player_id', playerId)
    .in('key', allKeys);

  if (loadErr) {
    res.status(500).json({ ok: false, error: 'Failed to load player state' });
    return null;
  }

  const raw = {};
  (rows || []).forEach(r => { raw[r.key] = r.value; });

  const rawPlayers = raw.players || {};
  let player = rawPlayers[playerId];
  if (!player) {
    // Brand-new account: bootstrap a player record server-side so
    // subsequent actions (city founding, lord creation) can proceed.
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
    rawPlayers[playerId] = player;
  }

  const result = catchUp(
    {
      player,
      lords:  raw.lords  || {},
      cities: raw.cities || {},
      armies: raw.armies || {},
    },
    Date.now(),
  );

  const extras = {};
  for (const k of extraKeys) extras[k] = raw[k] ?? null;

  return {
    admin,
    playerId,
    rawPlayers,
    player:  result.player,
    lords:   result.lords,
    cities:  result.cities,
    armies:  result.armies,
    extras,
  };
}

export async function saveState(admin, playerId, rawPlayers, { player, lords, cities, armies }) {
  const updatedPlayers = { ...rawPlayers, [playerId]: player };
  const writes = [
    { player_id: playerId, key: 'lords',   value: lords },
    { player_id: playerId, key: 'cities',  value: cities },
    { player_id: playerId, key: 'armies',  value: armies },
    { player_id: playerId, key: 'players', value: updatedPlayers },
  ];

  const { error } = await admin
    .from('storage')
    .upsert(writes, { onConflict: 'player_id,key' });

  if (error) console.warn('[action] save warning:', error.message);
}
