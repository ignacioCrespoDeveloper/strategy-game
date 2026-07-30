// =============================================
//  actions/lord-action.js — POST /api/lord/action
//
//  Body (move):        { lordId, action: 'move',        destX, destY, intent? }
//  Body (search_area): { lordId, action: 'search_area', length? }
//                      length: 'short' | 'standard' | 'long' (default standard)
//  Body (scout):        { lordId, action: 'scout' }
//
//  Validates and enqueues the action server-side,
//  then persists and returns the updated lord so
//  the client can hydrate.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { LORD_CLASSES, STANCE_DEFS, MOUNT_POOL, TALENT_POOL, EconomyCore, DiscoveryRoll } from '../engine-loader.js';

// Base scout duration before the speed multiplier — mirrors move's own
// distance*20*(5/speed) curve so speed behaves consistently everywhere.
const _SCOUT_BASE_SECS = 240;
const _SCOUT_MIN_SECS  = 30;

function _getEffectiveSpeed(lord) {
  const base  = lord.baseStats?.speed ?? 5;
  const cls   = LORD_CLASSES[lord.classId];
  const mount = lord.mountId ? (MOUNT_POOL?.[lord.mountId]?.effects?.speed || 0) : 0;
  return base + (cls?.modifiers?.speed || 0) + mount;
}

function _isDown(lord) {
  return !!(lord.downtimeUntil && Date.now() < lord.downtimeUntil);
}

function _isStanced(lord) {
  return !!(lord.stance?.id && lord.stance.id !== 'idle' && Date.now() < lord.stance.finishAt);
}

// ── Tile depletion (was: per-lord search fatigue) ──────────────
// The 'search_fatigue' storage key is now keyed by TILE ("x,y"), not by lord.
// It used to hold { [lordId]: {count,date} } and drive a punishing duration
// ladder (5m → 15m → 30m as a lord quested more). Expedition length is now the
// player's own choice, so the same counter instead drives DIMINISHING RETURNS
// on the tile being searched: repeat expeditions on one spot strip it bare and
// moving on restores full value. Old lord-keyed rows simply read as unknown
// tiles (count 0) and age out on the next date rollover — no migration needed.
function _tileKey(x, y) { return `${x},${y}`; }

function _tileSearchCount(x, y, fatigueMap) {
  const today = new Date().toISOString().slice(0, 10);
  const f     = fatigueMap?.[_tileKey(x, y)];
  return (f && f.date === today) ? f.count : 0;
}

function _incrementTile(x, y, fatigueMap) {
  const today = new Date().toISOString().slice(0, 10);
  const key   = _tileKey(x, y);
  const curr  = fatigueMap?.[key];
  const count = (curr && curr.date === today) ? curr.count : 0;
  return { ...(fatigueMap || {}), [key]: { count: count + 1, date: today } };
}

export async function handleLordAction(req, res) {
  const { lordId, action, destX, destY, intent, length } = req.body || {};
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

    // March food cost (the OGame deuterium role): crossing tiles burns food,
    // paid up front at enqueue — same-tile actions stay free. No refund on
    // cancel/defeat, same as construction costs. Cartography research discounts.
    const foodCost = EconomyCore.getMarchFoodCost(
      distance, armies[lordId]?.units, EconomyCore.getResearchEffects(player.research));
    if (foodCost > 0) {
      player.resources = player.resources || { food: 0, wood: 0, stone: 0 };
      const have = Math.floor(player.resources.food || 0);
      if (have < foodCost) {
        return res.status(400).json({ ok: false, error: `Not enough food to march: need ${foodCost} 🌾, have ${have}. Feed your army or shorten the march.` });
      }
      player.resources.food = (player.resources.food || 0) - foodCost;
    }

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

    // Expedition length is the player's bet: longer = bigger payout, better
    // rare odds, more risk. Unknown/absent values fall back to Standard rather
    // than erroring, so an older client keeps working.
    const len = DiscoveryRoll.lengthOf(length);

    // Class passive AND talent both shorten expeditions; take the lowest of
    // whichever apply. This mirrors js/domain/lord.js getActionDuration exactly.
    // The talent was ignored here until 2026-07-30, so a Pathfinder lord that
    // was not also a Rogue saw the client promise a 25%-shorter expedition and
    // then got the full duration from the server.
    const cls        = LORD_CLASSES[lord.classId];
    const clsMult    = cls?.passive?.effects?.searchDurationMult;
    const talentMult = lord.talentId ? TALENT_POOL?.[lord.talentId]?.effects?.searchDurationMult : undefined;
    const mult = (clsMult != null && talentMult != null)
      ? Math.min(clsMult, talentMult)
      : (clsMult ?? talentMult ?? 1);
    const secs = Math.round(len.secs * mult);

    // Depletion is resolved HERE, at enqueue, not at resolution: the player is
    // told what this tile is still worth before committing. It also keeps
    // catch-up.js free of any storage dependency — it just reads the number
    // stamped on the queue item.
    const priorSearches = _tileSearchCount(lord.x, lord.y, extras.search_fatigue);
    const depletion     = DiscoveryRoll.depletionFor(priorSearches);

    lord.actionQueue = [{
      actionId: 'search_area', startedAt: now, finishAt: now + secs * 1000,
      length: len.id, depletion, priorSearches,
    }];
    updatedFatigue = _incrementTile(lord.x, lord.y, extras.search_fatigue);

  } else if (action === 'scout') {
    if (_isStanced(lord)) {
      const stanceDef = STANCE_DEFS[lord.stance.id];
      if (stanceDef?.restrictions?.includes('action')) {
        return res.status(400).json({ ok: false, error: `Cannot perform actions while in ${stanceDef.name} stance.` });
      }
    }

    if (lord.x == null) {
      return res.status(400).json({ ok: false, error: 'Your lord has no position. Found a city first.' });
    }

    // No search-fatigue tie-in — scouting is deliberately not throttled by
    // the discovery-farming fatigue system; intel TTL already gives it a
    // natural re-scout cadence.
    const speed = _getEffectiveSpeed(lord);
    const secs  = Math.max(_SCOUT_MIN_SECS, Math.round(_SCOUT_BASE_SECS * (5 / speed)));

    lord.actionQueue = [{ actionId: 'scout', startedAt: now, finishAt: now + secs * 1000 }];

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
    type:      intent === 'attack' ? 'pvp_attack'
             : action === 'search_area' ? 'search_area'
             : action === 'scout' ? 'scout'
             : 'move',
    fire_at:   queueItem.finishAt,
    payload:   { lordId, ...(destX != null ? { destX, destY } : {}) },
  });
  if (evtErr) console.warn('[lord-action] pending_events insert failed:', evtErr.message);

  // player is included so the client can hydrate the march food deduction
  // immediately (moves are the only lord action that spends resources).
  return res.json({ ok: true, lord, player });
}
