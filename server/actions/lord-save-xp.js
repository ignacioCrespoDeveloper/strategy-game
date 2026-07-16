// =============================================
//  actions/lord-save-xp.js — POST /api/lord/save-xp
//
//  Body: { lordId, xp, level, talentPoints }
//
//  Persists quest XP gains to Supabase immediately after the client
//  applies discovery rewards. Prevents syncNow() calls from overwriting
//  the updated XP with the stale pre-quest value held in Supabase.
//  Only allows XP/level to increase — never decrease.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handleLordSaveXp(req, res) {
  const { lordId, xp, level, xpToNext, talentPoints, baseStats } = req.body || {};
  if (!lordId || xp == null) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or xp' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  const sentLevel   = level || 1;
  const serverLevel = lord.level || 1;
  const leveledUp   = sentLevel > serverLevel;

  lords[lordId] = {
    ...lord,
    xp:           leveledUp ? (xp || 0) : Math.max(lord.xp || 0, xp || 0),
    level:        Math.max(serverLevel, sentLevel),
    xpToNext:     leveledUp ? (xpToNext || lord.xpToNext) : (lord.xpToNext || xpToNext),
    talentPoints: Math.max(lord.talentPoints || 0, talentPoints || 0),
    baseStats:    (baseStats && leveledUp) ? baseStats : (lord.baseStats || baseStats || null),
  };

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true });
}
