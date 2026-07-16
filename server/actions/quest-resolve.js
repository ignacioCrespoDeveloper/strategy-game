// =============================================
//  actions/quest-resolve.js — POST /api/lord/quest-resolve
//
//  Body: { lordId }
//
//  Called by the client immediately when a search_area timer expires
//  (browser was open). loadAndCatchUp runs first, which causes catchUp
//  to process the expired action, roll the discovery, and store the
//  result in lord.pendingDiscoveries[].
//
//  This endpoint drains those pending discoveries, saves state, and
//  returns the results to the client so it can show the popup.
//
//  For the offline case (browser closed during quest) the sync endpoint
//  drains pendingDiscoveries instead — this endpoint is for online play.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleQuestResolve(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const discoveries = lord.pendingDiscoveries || [];
  lord.pendingDiscoveries = [];

  const saveError = await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });
  if (saveError) {
    return res.status(500).json({ ok: false, error: 'Failed to save quest result — please try again' });
  }

  return res.json({ ok: true, discoveries, lord, player });
}
