// =============================================
//  actions/set-race.js — POST /api/player/set-race
//
//  Body: { raceId }
//
//  Sets player.race in Supabase. Used when a user
//  who registered without a race (e.g. Google OAuth)
//  picks their race on the race-select screen.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { RACES } from '../engine-loader.js';

export async function handleSetRace(req, res) {
  const { raceId } = req.body || {};
  if (!raceId || !RACES[raceId]) {
    return res.status(400).json({ ok: false, error: 'Invalid race.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  player.race = raceId;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, player });
}
