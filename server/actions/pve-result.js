// =============================================
//  actions/pve-result.js — POST /api/lord/pve-result
//
//  Body: { lordId, armyUnits: [{unitId, count, frontHp?}], lordHpAfter }
//
//  Persists PvE battle losses to Supabase immediately after the client
//  resolves a bandit-camp fight. This prevents syncNow() calls (triggered
//  by search/move completions) from overwriting the post-battle army with
//  the pre-battle state still held in Supabase.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';

export async function handlePveResult(req, res) {
  const { lordId, armyUnits, lordHpAfter, downtimeUntil, downtimeReason, actionQueue } = req.body || {};
  if (!lordId || !Array.isArray(armyUnits)) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or armyUnits' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  // Replace army units with post-battle state sent by client.
  const existing = armies[lordId] || { lordId, units: [] };
  armies[lordId] = { ...existing, units: armyUnits };

  // Apply lord post-battle state. If HP is 0 the lord fell — persist the full fallen state
  // so a browser refresh restores it correctly instead of reviving the lord at HP 1.
  if (lordHpAfter != null) {
    const fell = lordHpAfter <= 0;
    lords[lordId] = {
      ...lord,
      currentHp:      fell ? 0 : Math.max(1, Math.round(lordHpAfter)),
      downtimeUntil:  fell ? (downtimeUntil  || Date.now() + 60 * 60 * 1000) : null,
      downtimeReason: fell ? (downtimeReason || 'defeated')                   : null,
      actionQueue:    fell ? (actionQueue    || [])                            : lord.actionQueue,
    };
  }

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true });
}
