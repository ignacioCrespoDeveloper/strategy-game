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
import { runDispatch } from './tick/event-dispatcher.js';
import { BattleEngine, UNIT_DEFS } from './engine-loader.js';
import { syncPlayerState }         from './sync.js';
import { handleBuild }             from './actions/build.js';
import { handleRecruit }           from './actions/recruit.js';
import { handleLordAction }        from './actions/lord-action.js';
import { handleLordCreate }        from './actions/lord-create.js';
import { handleCityFound }         from './actions/city-found.js';
import { handleHireMerc }          from './actions/hire-merc.js';
import { handleLordRevive }        from './actions/lord-revive.js';
import { handleArmyDisband }       from './actions/army-disband.js';
import { handleInstantBuild }      from './actions/instant-build.js';
import { handlePveResult }         from './actions/pve-result.js';
import { handleInstantAction }     from './actions/instant-action.js';
import { handleSetRace }           from './actions/set-race.js';
import { handleLordTalents }       from './actions/lord-talents.js';
import { handleLordSaveXp }        from './actions/lord-save-xp.js';
import { handleQuestResolve }      from './actions/quest-resolve.js';

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

app.post('/api/pvp/resolve',         resolvePvpAttack);

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
app.post('/api/lord/revive',   handleLordRevive);
app.post('/api/army/disband',        handleArmyDisband);
app.post('/api/city/instant-build',  handleInstantBuild);
app.post('/api/lord/pve-result',     handlePveResult);
app.post('/api/lord/instant-action', handleInstantAction);
app.post('/api/player/set-race',     handleSetRace);
app.post('/api/lord/talents',        handleLordTalents);
app.post('/api/lord/save-xp',        handleLordSaveXp);
app.post('/api/lord/quest-resolve',  handleQuestResolve);

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

// ── Server-side event dispatcher ─────────────────────────────
//
// Polls pending_events every 5 s. For each due row (fire_at <= now):
//   1. Claims it atomically (status pending → processing)
//   2. Runs catchUp for that player — applies all completed queue items
//   3. Resolves any pending PvP attacks
//   4. Saves state to Supabase; marks event done
//
// This makes all game outcomes server-authoritative and independent
// of whether either player is online at the time the event fires.
setInterval(() => runDispatch().catch(e => console.error('[dispatcher] loop error:', e.message)), 5000);

// ── Boot ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚔  Hexfront dev server → http://localhost:${PORT}`);
  console.log(`   PvP endpoint:          POST /api/pvp/resolve\n`);
});
