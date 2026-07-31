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
import { LORD_BASE_STATS, LORD_CLASSES, RACES, rollLordPortrait, isClassRecruitable } from '../engine-loader.js';

// Exported so scripts/economy-projection.js reads the REAL expansion curve
// instead of keeping its own copy. js/domain/lord.js mirrors these for the
// client; that pair is the remaining duplication.
// Raised 5 → 7 on 2026-07-30: total gold demand was a fixed ~345k that a
// mature player cleared in days, so the endgame had nothing to buy. Keep the
// ×2 curve — doubling is what makes each marginal lord a real project (lord 7
// at 320k is ~2.7 days of endgame gold income, before its army).
export const MAX_LORDS = 7;

// First lord is free; subsequent lords cost 10k, 20k, 40k, 80k, 160k, 320k.
export function lordRecruitCost(existingLordCount) {
  if (existingLordCount === 0) return 0;
  return 10000 * Math.pow(2, existingLordCount - 1);
}
const _recruitCost = lordRecruitCost;

function _generateId() {
  return 'l_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export async function handleLordCreate(req, res) {
  const { name, classId, cityId } = req.body || {};
  if (!name || !classId) {
    return res.status(400).json({ ok: false, error: 'Missing name or classId' });
  }

  const n = name.trim();
  if (n.length < 2)  return res.status(400).json({ ok: false, error: 'Lord name must be at least 2 characters.' });
  if (n.length > 30) return res.status(400).json({ ok: false, error: 'Lord name cannot exceed 30 characters.' });
  // isClassRecruitable covers BOTH "does this class exist" and "is it offered"
  // — the modal hides Priest and Dark Lord, but the modal is not the gate. It
  // is also own-property-safe, so `classId: 'constructor'` is rejected here
  // rather than being written onto a lord.
  if (!isClassRecruitable(classId)) return res.status(400).json({ ok: false, error: 'Invalid class.' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const raceId = player.race;
  if (!raceId || !RACES[raceId]) {
    return res.status(400).json({ ok: false, error: 'No race set for your account. Please select a race first.' });
  }

  const playerLords = Object.values(lords).filter(l => l.playerId === playerId);
  if (playerLords.length >= MAX_LORDS) {
    return res.status(400).json({ ok: false, error: `Maximum of ${MAX_LORDS} lords reached.` });
  }

  // Global name uniqueness check
  const nameTaken = Object.values(lords).some(l => l.name.toLowerCase() === n.toLowerCase());
  if (nameTaken) return res.status(400).json({ ok: false, error: 'A lord with that name already exists.' });

  const cost = _recruitCost(playerLords.length);
  if ((player.coins || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Recruiting costs ${cost.toLocaleString()} gold. Not enough coins.` });
  }

  // Deduct cost
  player.coins = (player.coins || 0) - cost;

  const now  = Date.now();
  const id   = _generateId();
  const lord = {
    id, playerId,
    name: n, race: raceId, classId,
    // Rolled here, once, and never again — the server owns the dice so a
    // crafted request can't hand-pick a face, and so the choice survives
    // any later change to the art pools.
    portrait: rollLordPortrait(raceId, classId),
    createdAt:      now,
    level:          1,
    xp:             0,
    xpToNext:       150,
    talentPoints:   0,
    talentId:       null,
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

  // Place the lord at the chosen city
  if (cityId && cities[cityId] && cities[cityId].playerId === playerId) {
    lord.x = cities[cityId].x;
    lord.y = cities[cityId].y;
  }

  lords[id] = lord;

  // Set player.lordId if this is their first lord
  const isFirst = !Object.values(lords).some(l => l.playerId === playerId && l.id !== id);
  if (isFirst) player.lordId = id;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
