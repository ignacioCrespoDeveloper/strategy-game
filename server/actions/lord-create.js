// =============================================
//  actions/lord-create.js — POST /api/lord/create
//
//  Body: { name, raceId, classId }
//
//  Creates a new lord server-side. Validates name
//  uniqueness globally, deducts recruitment cost from
//  player.coins, sets player.lordId on first lord.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { LORD_BASE_STATS, LORD_CLASSES, RACES } from '../engine-loader.js';

const MAX_LORDS = 5;

function _recruitCost(existingLordCount) {
  return Math.round(400 * Math.pow(1.5, existingLordCount));
}

function _generateId() {
  return 'l_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export async function handleLordCreate(req, res) {
  const { name, raceId, classId } = req.body || {};
  if (!name || !raceId || !classId) {
    return res.status(400).json({ ok: false, error: 'Missing name, raceId, or classId' });
  }

  const n = name.trim();
  if (n.length < 2)  return res.status(400).json({ ok: false, error: 'Lord name must be at least 2 characters.' });
  if (n.length > 30) return res.status(400).json({ ok: false, error: 'Lord name cannot exceed 30 characters.' });
  if (!RACES[raceId])         return res.status(400).json({ ok: false, error: 'Invalid race.' });
  if (!LORD_CLASSES[classId]) return res.status(400).json({ ok: false, error: 'Invalid class.' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const playerLords = Object.values(lords).filter(l => l.playerId === playerId);
  if (playerLords.length >= MAX_LORDS) {
    return res.status(400).json({ ok: false, error: `Maximum of ${MAX_LORDS} lords reached.` });
  }

  // Global name uniqueness check
  const nameTaken = Object.values(lords).some(l => l.name.toLowerCase() === n.toLowerCase());
  if (nameTaken) return res.status(400).json({ ok: false, error: 'A lord with that name already exists.' });

  const cost = _recruitCost(playerLords.length);
  if ((player.coins || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Recruiting costs ${cost.toLocaleString()} 💰 gold. Not enough coins.` });
  }

  // Deduct cost
  player.coins = (player.coins || 0) - cost;

  const now  = Date.now();
  const id   = _generateId();
  const lord = {
    id, playerId,
    name: n, race: raceId, classId,
    createdAt:      now,
    level:          1,
    xp:             0,
    xpToNext:       150,
    talentPoints:   0,
    actionQueue:    [],
    stance:         { id: 'idle', startedAt: null, finishAt: null },
    baseStats:      { ...LORD_BASE_STATS },
    currentHp:      LORD_BASE_STATS.health,
    hpRegenAt:      now,
    downtimeUntil:  null,
    downtimeReason: null,
    x:              null,
    y:              null,
  };

  lords[id] = lord;

  // Set player.lordId if this is their first lord
  const isFirst = !Object.values(lords).some(l => l.playerId === playerId && l.id !== id);
  if (isFirst) player.lordId = id;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
