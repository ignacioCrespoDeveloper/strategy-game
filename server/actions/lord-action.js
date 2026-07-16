// =============================================
//  actions/lord-action.js — POST /api/lord/action
//
//  Body (move):        { lordId, action: 'move',        destX, destY, intent? }
//  Body (search_area): { lordId, action: 'search_area' }
//
//  Validates and enqueues the action server-side,
//  then persists and returns the updated lord so
//  the client can hydrate.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { LORD_CLASSES, STANCE_DEFS } from '../engine-loader.js';

function _getEffectiveSpeed(lord) {
  const base = lord.baseStats?.speed ?? 5;
  const cls  = LORD_CLASSES[lord.classId];
  return base + (cls?.modifiers?.speed || 0);
}

function _isDown(lord) {
  return !!(lord.downtimeUntil && Date.now() < lord.downtimeUntil);
}

function _isStanced(lord) {
  return !!(lord.stance?.id && lord.stance.id !== 'idle' && Date.now() < lord.stance.finishAt);
}

function _searchDuration(lordId, fatigueMap) {
  const today = new Date().toISOString().slice(0, 10);
  const f     = fatigueMap?.[lordId];
  const count = (f && f.date === today) ? f.count : 0;
  if (count < 8)  return 300;
  if (count < 15) return 900;
  return 1800;
}

function _incrementFatigue(lordId, fatigueMap) {
  const today  = new Date().toISOString().slice(0, 10);
  const curr   = fatigueMap?.[lordId];
  const count  = (curr && curr.date === today) ? curr.count : 0;
  return { ...(fatigueMap || {}), [lordId]: { count: count + 1, date: today } };
}

export async function handleLordAction(req, res) {
  const { lordId, action, destX, destY, intent } = req.body || {};
  if (!lordId || !action) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or action' });
  }

  const ctx = await loadAndCatchUp(req, res, ['search_fatigue']);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies, extras } = ctx;

  const lord = lords[lordId];
  if (!lord) return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  if (_isDown(lord)) {
    return res.status(400).json({ ok: false, error: 'Lord is incapacitated and cannot act.' });
  }
  if ((lord.actionQueue || []).length > 0) {
    return res.status(400).json({ ok: false, error: 'An action is already in progress.' });
  }

  const now = Date.now();
  let updatedFatigue = extras.search_fatigue || {};

  if (action === 'move') {
    if (destX == null || destY == null) {
      return res.status(400).json({ ok: false, error: 'Missing destX or destY' });
    }

    if (_isStanced(lord)) {
      const stanceDef = STANCE_DEFS[lord.stance.id];
      if (stanceDef?.restrictions?.includes('move')) {
        return res.status(400).json({ ok: false, error: `Cannot move while in ${stanceDef.name} stance.` });
      }
    }

    const speed    = _getEffectiveSpeed(lord);
    const fromX    = lord.x ?? destX;
    const fromY    = lord.y ?? destY;
    const distance = Math.max(Math.abs(destX - fromX), Math.abs(destY - fromY));
    const minSecs  = intent === 'attack' ? 60 : 0;
    const secs     = Math.max(minSecs, distance > 0 ? Math.round(distance * 20 * (5 / speed)) : 0);

    const item = { actionId: 'move_lord', startedAt: now, finishAt: now + secs * 1000, destX, destY };
    if (intent) item.intent = intent;
    lord.actionQueue = [item];

  } else if (action === 'search_area') {
    if (_isStanced(lord)) {
      const stanceDef = STANCE_DEFS[lord.stance.id];
      if (stanceDef?.restrictions?.includes('action')) {
        return res.status(400).json({ ok: false, error: `Cannot perform actions while in ${stanceDef.name} stance.` });
      }
    }

    if (lord.x == null) {
      return res.status(400).json({ ok: false, error: 'Your lord has no position. Found a city first.' });
    }

    const cls      = LORD_CLASSES[lord.classId];
    const mult     = cls?.passive?.effects?.searchDurationMult ?? 1;
    const baseSecs = _searchDuration(lordId, extras.search_fatigue);
    const secs     = Math.round(baseSecs * mult);

    lord.actionQueue    = [{ actionId: 'search_area', startedAt: now, finishAt: now + secs * 1000 }];
    updatedFatigue      = _incrementFatigue(lordId, extras.search_fatigue);

  } else {
    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  }

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Save fatigue separately (only for search_area)
  if (action === 'search_area') {
    await admin.from('storage').upsert(
      [{ player_id: playerId, key: 'search_fatigue', value: updatedFatigue }],
      { onConflict: 'player_id,key' },
    );
  }

  // Register a server-side dispatch event so the outcome resolves
  // even if both players go offline before finishAt.
  const queueItem = lord.actionQueue[0];
  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      intent === 'attack' ? 'pvp_attack' : action === 'search_area' ? 'search_area' : 'move',
    fire_at:   queueItem.finishAt,
    payload:   { lordId, ...(destX != null ? { destX, destY } : {}) },
  });
  if (evtErr) console.warn('[lord-action] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, lord });
}
