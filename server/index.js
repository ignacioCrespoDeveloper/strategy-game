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
import { resolvePvpAttack, scanPresence, scanIncomingAttacks } from './combat-resolver.js';
import { runDispatch } from './tick/event-dispatcher.js';
import { BattleEngine, UNIT_DEFS } from './engine-loader.js';
import { syncPlayerState }         from './sync.js';
import { handleBuild }             from './actions/build.js';
import { handleDemolish }          from './actions/demolish.js';
import { handleMarketSell }        from './actions/market-sell.js';
import { handleResearchStart, handleResearchInstant } from './actions/research.js';
import { handleBlessingConsecrate } from './actions/blessing.js';
import { handleRecruit }           from './actions/recruit.js';
import { handleLordAction }        from './actions/lord-action.js';
import { handleLordCreate }        from './actions/lord-create.js';
import { handleCityFound }         from './actions/city-found.js';
// hire-merc.js is gone: buying mercenaries required a discovered bandit camp
// to buy them FROM, and camps were retired with the expedition rework.
// Mercenaries now join via the expedition Recruits outcome instead, gated by
// Expedition Rating rather than gold. Removed 2026-07-29.
import { handleLordRevive }        from './actions/lord-revive.js';
import { handleLordRansom }        from './actions/lord-ransom.js';
import { handleLordRelease }       from './actions/lord-release.js';
import { handleLordPrisonList }    from './actions/lord-prison-list.js';
import { handleArmyDisband }       from './actions/army-disband.js';
import { handleArmyTransfer }      from './actions/army-transfer.js';
import { handleInstantBuild }      from './actions/instant-build.js';
import { handleInstantRecruit }    from './actions/instant-recruit.js';
import { handleCancelBuild }       from './actions/cancel-build.js';
import { handleCancelRecruit }     from './actions/cancel-recruit.js';
import { handleCancelAction }      from './actions/cancel-action.js';
import { runRankingUpdate }        from './tick/ranking-updater.js';
// pve-attack.js is gone: combat expedition finds resolve as an immediate
// ambush inside catch-up.js now, so no camp is ever written to the map and
// there is nothing left to attack. Removed 2026-07-29.
import { handleInstantAction }     from './actions/instant-action.js';
import { handleSetRace }           from './actions/set-race.js';
import { handleLordTalents }       from './actions/lord-talents.js';
import { handleLordMounts }        from './actions/lord-mounts.js';
import { handleLordSaveXp }        from './actions/lord-save-xp.js';
import { handleQuestResolve }      from './actions/quest-resolve.js';
import { handleScoutResolve }      from './actions/scout-resolve.js';
import { handleRaidStart }         from './actions/raid-start.js';
import { handleRaidCancel }        from './actions/raid-cancel.js';
import { handleRaidInstant }       from './actions/raid-instant.js';
import { handleClanCreate }        from './actions/clan-create.js';
import { handleClanApply }         from './actions/clan-apply.js';
import { handleClanAccept }        from './actions/clan-accept.js';
import { handleClanReject }        from './actions/clan-reject.js';
import { handleClanLeave }         from './actions/clan-leave.js';
import { handleClanKick }          from './actions/clan-kick.js';
import { handleClanList }          from './actions/clan-list.js';
import { handleClanWarDeclare }    from './actions/clan-war-declare.js';
import { runClanWarUpdate }        from './tick/clan-war-updater.js';

const app       = express();
const PORT      = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(join(__dirname, '..')));

// Express 4 (unlike Express 5) does NOT automatically catch a rejected
// promise thrown inside an async route handler — none of the action
// handlers below have their own try/catch. Combined with Node's default
// unhandled-rejection behavior (terminate the process), a single unexpected
// error in ANY one endpoint would otherwise crash the entire server for
// every player, not just the requesting one, and leave that one request
// hanging forever (client sees a frozen UI, no error ever comes back).
// Wrapping every route through this closes that off at the routing layer,
// for all current and future handlers, without editing each action file.
function _safe(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[${req.method} ${req.path}] unhandled error:`, err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  };
}

// ── PvP API ───────────────────────────────────────────────────
//
//  POST /api/pvp/resolve
//  Headers: Authorization: Bearer <supabase_access_token>
//  Body:    { attackerLordId, targetTileX, targetTileY }
//
//  Returns: { ok, report, terrain }
//
// POST /api/sync — offline catch-up on login
app.post('/api/sync', _safe(syncPlayerState));

app.post('/api/pvp/resolve',         _safe(resolvePvpAttack));

// POST /api/scan/presence — live, strength-free "there is a lord here" layer
// for the whole map, carrying owner identity (already public) but never army
// size. Cities have an equivalent already via the global world_state table.
// Anything beyond existence + owner requires a scout report.
//
// (The old POST /api/scan/tile lived here. It was the second entry point for
// the client-supplied `knownTiers` fog-of-war ladder, had no caller left after
// the Scout action took over, and went with that system.)
app.post('/api/scan/presence', _safe(scanPresence));

// POST /api/attack/incoming — derived list of enemy attack-marches heading
// at the caller's tiles. Powers the Overview red alert; never touches feeds.
app.post('/api/attack/incoming', _safe(scanIncomingAttacks));

// ── Authoritative action API ──────────────────────────────────
// POST /api/city/build    — validate + enqueue construction server-side
// POST /api/city/recruit  — validate + enqueue unit training server-side
// POST /api/lord/action   — validate + enqueue move/search_area server-side
app.post('/api/city/build',    _safe(handleBuild));
app.post('/api/city/demolish', _safe(handleDemolish));
app.post('/api/market/sell',   _safe(handleMarketSell));
app.post('/api/research/start',   _safe(handleResearchStart));
app.post('/api/research/instant', _safe(handleResearchInstant));
app.post('/api/blessing/consecrate', _safe(handleBlessingConsecrate));
app.post('/api/city/recruit',  _safe(handleRecruit));
app.post('/api/city/found',    _safe(handleCityFound));
app.post('/api/lord/action',   _safe(handleLordAction));
app.post('/api/lord/create',   _safe(handleLordCreate));
app.post('/api/lord/revive',   _safe(handleLordRevive));
app.post('/api/lord/ransom',       _safe(handleLordRansom));
app.post('/api/lord/release',      _safe(handleLordRelease));
app.post('/api/lord/prison-list',  _safe(handleLordPrisonList));
app.post('/api/army/disband',        _safe(handleArmyDisband));
app.post('/api/army/transfer',       _safe(handleArmyTransfer));
app.post('/api/city/instant-build',  _safe(handleInstantBuild));
app.post('/api/city/instant-recruit', _safe(handleInstantRecruit));
app.post('/api/city/cancel-build',   _safe(handleCancelBuild));
app.post('/api/city/cancel-recruit', _safe(handleCancelRecruit));
app.post('/api/lord/cancel-action',  _safe(handleCancelAction));
app.post('/api/lord/instant-action', _safe(handleInstantAction));
app.post('/api/player/set-race',     _safe(handleSetRace));
app.post('/api/lord/talents',        _safe(handleLordTalents));
app.post('/api/lord/mounts',         _safe(handleLordMounts));
app.post('/api/lord/save-xp',        _safe(handleLordSaveXp));
app.post('/api/lord/quest-resolve',  _safe(handleQuestResolve));
app.post('/api/lord/scout-resolve',  _safe(handleScoutResolve));
app.post('/api/lord/raid-start',     _safe(handleRaidStart));
app.post('/api/lord/raid-cancel',    _safe(handleRaidCancel));
app.post('/api/lord/raid-instant',   _safe(handleRaidInstant));
app.post('/api/clan/create',         _safe(handleClanCreate));
app.post('/api/clan/apply',          _safe(handleClanApply));
app.post('/api/clan/accept',         _safe(handleClanAccept));
app.post('/api/clan/reject',         _safe(handleClanReject));
app.post('/api/clan/leave',          _safe(handleClanLeave));
app.post('/api/clan/kick',           _safe(handleClanKick));
app.post('/api/clan/list',           _safe(handleClanList));
app.post('/api/clan/war-declare',    _safe(handleClanWarDeclare));

// ── Lords debug ───────────────────────────────────────────────
// GET /api/debug/lords — dumps all lords from Supabase so we can verify positions are synced
// SECURITY NOTE: this has no authentication at all — any unauthenticated
// caller can hit it and get every player's lord IDs/names/positions. Flagged
// in the PvP/PvE audit; left in place only because removing/gating a
// standing debug tool is a call for whoever relies on it, not something to
// silently delete mid-audit.
app.get('/api/debug/lords', _safe(async (req, res) => {
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
}));


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

  // Ranking updater — recalculate all player scores every 5 minutes
  runRankingUpdate().catch(e => console.error('[ranking-updater] boot run error:', e.message));
  setInterval(() => runRankingUpdate().catch(e => console.error('[ranking-updater] loop error:', e.message)), 5 * 60 * 1000);

  // Clan war updater — end wars whose time limit has passed, every minute
  runClanWarUpdate().catch(e => console.error('[clan-war-updater] boot run error:', e.message));
  setInterval(() => runClanWarUpdate().catch(e => console.error('[clan-war-updater] loop error:', e.message)), 60 * 1000);
});
