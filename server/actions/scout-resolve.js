// =============================================
//  actions/scout-resolve.js — POST /api/lord/scout-resolve
//
//  Body: { lordId }
//
//  Called by the client when a 'scout' action timer expires (browser open).
//  loadAndCatchUp runs first, which causes catchUp to process the completed
//  action and set lord.pendingScoutResolve — this endpoint then calls
//  resolveScout() (server/combat-resolver.js), which does the actual
//  cross-player report-gathering that loadAndCatchUp's single-player load
//  can't do itself.
//
//  For the offline case (browser closed during the scout) the dispatcher
//  drains pendingScoutResolve instead — this endpoint is for online play.
//
//  The client sends nothing but a lordId, and the response is only used for
//  the immediate toast: the report itself always arrives through /api/sync,
//  because resolveScout stashes it on the lord either way.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { resolveScout }              from '../combat-resolver.js';

export async function handleScoutResolve(req, res) {
  const { lordId } = req.body || {};
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
    // Two very different situations land here, and the client needs to tell
    // them apart:
    //   'pending'            — the scout hasn't actually finished server-side
    //                          yet (client clock ran ahead). Nothing to collect.
    //   'resolved_elsewhere' — the ~5 s dispatcher already drained it. It
    //                          stashed the intel as a scout report on the lord,
    //                          so the client should sync to pull it in rather
    //                          than sit there with no feedback.
    const stillQueued = (lord.actionQueue || []).some(a => a.actionId === 'scout');
    return res.json({ ok: true, outcome: stillQueued ? 'pending' : 'resolved_elsewhere', lord, player });
  }

  const result = await resolveScout(admin, playerId, lordId, pending.tileX, pending.tileY);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.error });

  return res.json({
    ok:      true,
    outcome: result.outcome,
    report:  result.report,
  });
}
