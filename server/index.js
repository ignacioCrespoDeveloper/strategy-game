// =============================================
//  server/index.js — Hexfront game server
//
//  Serves static files (same as before) +
//  an authoritative PvP combat API.
//
//  Required env vars (copy .env.example → .env):
//    SUPABASE_URL               — your project URL
//    SUPABASE_SERVICE_ROLE_KEY  — service role secret (never expose client-side)
//    PORT                       — optional, defaults to 3000
// =============================================

import 'dotenv/config';
import express              from 'express';
import { fileURLToPath }    from 'url';
import { dirname, join }    from 'path';
import { resolvePvpAttack, scanTile, declareAttack } from './combat-resolver.js';
import { BattleEngine, UNIT_DEFS } from './engine-loader.js';
import { syncPlayerState }         from './sync.js';
import { handleBuild }             from './actions/build.js';
import { handleRecruit }           from './actions/recruit.js';
import { handleLordAction }        from './actions/lord-action.js';
import { handleLordCreate }        from './actions/lord-create.js';
import { handleCityFound }         from './actions/city-found.js';
import { handleHireMerc }          from './actions/hire-merc.js';

const app       = express();
const PORT      = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(join(__dirname, '..')));

// ── PvP API ───────────────────────────────────────────────────
//
//  POST /api/pvp/resolve
//  Headers: Authorization: Bearer <supabase_access_token>
//  Body:    { attackerLordId, targetTileX, targetTileY }
//
//  Returns: { ok, report, terrain }
//
// POST /api/sync — offline catch-up on login
app.post('/api/sync', syncPlayerState);

app.post('/api/pvp/resolve', resolvePvpAttack);

// ── Tile scan API ─────────────────────────────────────────────
//
//  POST /api/scan/tile
//  Headers: Authorization: Bearer <supabase_access_token>
//  Body:    { tileX, tileY }
//
//  Returns: { ok, discoveries: [{ type, tileX, tileY, ttl, rawData }] }
//
//  Called client-side when a Search Area action completes.
//  The server uses the service role key to read all players' lords on
//  the given tile and returns only those that pass the canBeAttacked()
//  visibility check. The client never has access to enemy army sizes
//  (RLS prevents it), so this check must be server-side.
//
app.post('/api/scan/tile', scanTile);

// POST /api/attack/declare — write pvp_threat notification to defenders
app.post('/api/attack/declare', declareAttack);

// ── Authoritative action API ──────────────────────────────────
// POST /api/city/build    — validate + enqueue construction server-side
// POST /api/city/recruit  — validate + enqueue unit training server-side
// POST /api/lord/action   — validate + enqueue move/search_area server-side
app.post('/api/city/build',    handleBuild);
app.post('/api/city/recruit',  handleRecruit);
app.post('/api/city/found',    handleCityFound);
app.post('/api/lord/action',   handleLordAction);
app.post('/api/lord/create',   handleLordCreate);
app.post('/api/lord/hire-merc', handleHireMerc);

// ── Lords debug ───────────────────────────────────────────────
// GET /api/debug/lords — dumps all lords from Supabase so we can verify positions are synced
app.get('/api/debug/lords', async (req, res) => {
  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await admin.from('storage').select('player_id, value').eq('key', 'lords');
  if (error) return res.json({ error: error.message });
  const summary = (data || []).map(row => ({
    player_id: row.player_id,
    lords: Object.values(row.value || {}).map(l => ({ id: l.id, name: l.name, x: l.x, y: l.y })),
  }));
  res.json(summary);
});

// ── Auth debug (remove before shipping) ──────────────────────
app.post('/api/debug-auth', async (req, res) => {
  const { createClient } = await import('@supabase/supabase-js');
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.json({ error: 'no token in header' });

  // Try 1: service role client
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const r1 = await admin.auth.getUser(token);

  // Try 2: anon key client (uses SUPABASE_URL from env; anon key is public anyway)
  const ANON_KEY = 'sb_publishable_AxppcJg1z-yJ6hfOLLhRkA_dOd_8BLx';
  const anonClient = createClient(process.env.SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r2 = await anonClient.auth.getUser(token);

  // JWT payload (no sig check — just for debugging)
  let jwtPayload = null;
  try {
    const parts = token.split('.');
    jwtPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch (e) { jwtPayload = { parseError: e.message }; }

  // Try 3: service role DB query (tests that service key works for PostgREST)
  const userId = r2.data?.user?.id ?? r1.data?.user?.id;
  let dbResult = null;
  if (userId) {
    const { data: dbData, error: dbErr } = await admin
      .from('storage')
      .select('key')
      .eq('player_id', userId)
      .limit(5);
    dbResult = dbErr
      ? { error: dbErr.message, code: dbErr.code, hint: dbErr.hint }
      : { ok: true, keys: dbData?.map(r => r.key) };
  }

  res.json({
    tokenLength: token.length,
    tokenPrefix: token.substring(0, 20) + '...',
    jwtPayload,
    serviceRoleResult: { user: r1.data?.user?.id ?? null, error: r1.error?.message, status: r1.error?.status },
    anonKeyResult:     { user: r2.data?.user?.id ?? null, error: r2.error?.message, status: r2.error?.status },
    dbQueryResult: dbResult,
  });
});

// ── Health check ──────────────────────────────────────────────
// GET /api/health — confirms server is up, engine is loaded,
// Supabase env vars are present, and runs a quick engine smoke test.
app.get('/api/health', (req, res) => {
  // Quick engine smoke test: 1v1 bandits vs dreadspears
  const def = UNIT_DEFS['dreadspears'];
  const ctx = {
    terrain: 'plains',
    attacker: {
      id: 'test_atk',
      units: [{
        id: 'a0', sourceId: 'dreadspears', name: def.name,
        role: 'infantry', traits: [...def.traits], abilities: [],
        maxHp: def.combatStats.hp, currentHp: def.combatStats.hp,
        attack: def.combatStats.attack, defense: def.combatStats.defense,
        speed: def.combatStats.speed, leadership: 0,
        count: 3, startCount: 3, isLord: false, isRouting: false,
        _frenzBonus: 0, _burning: false,
      }],
      morale: 80,
    },
    defender: {
      id: 'test_def',
      units: [{
        id: 'd0', sourceId: 'bandits', name: 'Bandits',
        role: 'infantry', traits: [], abilities: [],
        maxHp: 50, currentHp: 50,
        attack: 4, defense: 3, speed: 3, leadership: 0,
        count: 2, startCount: 2, isLord: false, isRouting: false,
        _frenzBonus: 0, _burning: false,
      }],
      morale: 55,
    },
  };

  let engineOk = false;
  let engineResult = null;
  try {
    const report = BattleEngine.resolve(ctx);
    engineOk     = ['attacker', 'defender', 'draw'].includes(report.winner);
    engineResult = { winner: report.winner, reason: report.reason, rounds: report.rounds };
  } catch (e) {
    engineResult = { error: e.message };
  }

  res.json({
    status:       'ok',
    server:       'Hexfront PvP API',
    supabaseUrl:  process.env.SUPABASE_URL ? '✓ set' : '✗ missing',
    serviceKey:   process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ set' : '✗ missing',
    engine:       engineOk ? '✓ loaded' : '✗ error',
    engineSmoke:  engineResult,
    unitCount:    Object.keys(UNIT_DEFS).length,
  });
});

// ── Boot ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚔  Hexfront dev server → http://localhost:${PORT}`);
  console.log(`   PvP endpoint:          POST /api/pvp/resolve\n`);
});
