// =============================================
//  actions/scout-resolve.js — POST /api/lord/scout-resolve
//
//  Body: { lordId, knownTiers? }
//
//  Called by the client when a 'scout' action timer expires (browser open).
//  loadAndCatchUp runs first, which causes catchUp to process the completed
//  action and set lord.pendingScoutResolve — this endpoint then calls
//  resolveScout() (server/combat-resolver.js), which does the actual
//  cross-player ambush-check + intel-gathering that loadAndCatchUp's
//  single-player load can't do itself.
//
//  For the offline case (browser closed during the scout) the dispatcher
//  drains pendingScoutResolve instead — this endpoint is for online play.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { resolveScout }              from '../combat-resolver.js';

export async function handleScoutResolve(req, res) {
  const { lordId, knownTiers } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const pending = lord.pendingScoutResolve;

  // Persist whatever catchUp just advanced (including the pendingScoutResolve
  // flag itself) BEFORE calling resolveScout — resolveScout does its own
  // independent read of this player's `lords`/`armies` rows from Supabase,
  // not from this in-memory ctx, so a stale save here would hide the
  // just-completed action's position/state from it.
  const saveError = await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });
  if (saveError) return res.status(500).json({ ok: false, error: 'Failed to save state' });

  if (!pending) {
    // Not resolved yet (still in progress) or already drained by the
    // dispatcher — nothing new to report.
    return res.json({ ok: true, outcome: 'none', lord, player });
  }

  const result = await resolveScout(admin, playerId, lordId, pending.tileX, pending.tileY, knownTiers);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

  return res.json({
    ok:      true,
    outcome: result.outcome,
    discoveries: result.discoveries,
    report:      result.report,
    terrain:     result.terrain,
  });
}
