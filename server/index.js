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
import express             from 'express';
import { fileURLToPath }   from 'url';
import { dirname, join }   from 'path';
import { resolvePvpAttack } from './combat-resolver.js';

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
app.post('/api/pvp/resolve', resolvePvpAttack);

// ── Boot ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n⚔  Hexfront dev server → http://localhost:${PORT}`);
  console.log(`   PvP endpoint:          POST /api/pvp/resolve\n`);
});
