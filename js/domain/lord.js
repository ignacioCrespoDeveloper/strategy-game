// =============================================
//  lord.js — Lord domain service
// =============================================

const LORD_ACTIONS = {
  search_area: {
    id:               'search_area',
    name:             'Search Area',
    icon:             '🔍',
    desc:             'Search the current tile for hidden opportunities.',
    duration:         300,
    xpReward:         8,
    requiresPosition: true,
  },
  move_lord: {
    id:       'move_lord',
    name:     'Traveling',
    icon:     '🗺',
    desc:     'Moving to a new location.',
    duration: 0, // calculated dynamically per distance + speed
    xpReward: 0,
  },
};

const LordService = (() => {
  const LORDS_KEY = 'lords';

  function _getAll()        { return StorageService.get(LORDS_KEY) || {}; }
  function _saveAll(lords)  { StorageService.set(LORDS_KEY, lords); }
  function _generateId()    { return 'l_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

  // ── Stats & class helpers ─────────────────────────────────────

  // Returns the lord's effective stats: base + class permanent modifiers.
  function getEffectiveStats(lord) {
    const base = lord.baseStats || { ...LORD_BASE_STATS };
    const cls  = LORD_CLASSES[lord.classId];
    const mods = cls?.modifiers || {};
    const result = {};
    for (const key of Object.keys(LORD_BASE_STATS)) {
      result[key] = (base[key] ?? LORD_BASE_STATS[key]) + (mods[key] || 0);
    }
    return result;
  }

  // Returns the real action duration (seconds), applying fatigue tier and class passive.
  // Fatigue tiers: 0-7 searches → 5m, 8-14 → 15m, 15+ → 30m.
  // Rogue Explorer passive (searchDurationMult) applied on top.
  function getActionDuration(lord, actionId) {
    const def = LORD_ACTIONS[actionId];
    if (!def) return 0;
    if (actionId === 'search_area') {
      const base    = DiscoveryService.getSearchDuration(lord.id);
      const cls     = LORD_CLASSES[lord.classId];
      const effects = cls?.passive?.effects || {};
      if (effects.searchDurationMult != null) {
        return Math.round(base * effects.searchDurationMult);
      }
      return base;
    }
    return def.duration;
  }

  // ── CRUD ─────────────────────────────────────────────────────

  const MAX_LORDS = 5;

  // Cost to recruit lord N (1-indexed): 400 × 1.5^(N-1), rounded.
  function getRecruitCost(existingLordCount) {
    return Math.round(400 * Math.pow(1.5, existingLordCount));
  }

  // Gold/hour upkeep for a lord: 5 base + 1 per level.
  function getUpkeepPerHour(lord) {
    return 5 + (lord.level || 1);
  }

  // Command capacity: max army points this lord can field.
  function getCommandCapacity(lord) {
    return 6 + 2 * (lord.level || 1);
  }

  function create(playerId, name, raceId, classId) {
    const n = (name || '').trim();
    if (n.length < 2)           return { ok: false, error: 'Lord name must be at least 2 characters.' };
    if (n.length > 30)          return { ok: false, error: 'Lord name cannot exceed 30 characters.' };
    if (!RACES[raceId])         return { ok: false, error: 'Select a race before continuing.' };
    if (!LORD_CLASSES[classId]) return { ok: false, error: 'Select a class before continuing.' };

    const lords = _getAll();
    const playerLords = Object.values(lords).filter(l => l.playerId === playerId);
    if (playerLords.length >= MAX_LORDS) return { ok: false, error: `Maximum of ${MAX_LORDS} lords reached.` };

    const taken = Object.values(lords).some(l => l.name.toLowerCase() === n.toLowerCase());
    if (taken) return { ok: false, error: 'A lord with that name already exists.' };

    const cost = getRecruitCost(playerLords.length);
    const spend = PlayerService.spendCoins(playerId, cost);
    if (!spend.ok) return { ok: false, error: `Recruiting costs ${cost.toLocaleString()} 💰 gold. ${spend.error}` };

    const id  = _generateId();
    const lord = {
      id, playerId,
      name: n, race: raceId, classId,
      createdAt:    TimeService.now(),
      level:        1,
      xp:           0,
      xpToNext:     150,
      talentPoints: 0,
      actionQueue:  [],
      stance:       { id: 'idle', startedAt: null, finishAt: null },
      baseStats:    { ...LORD_BASE_STATS },
      currentHp:    LORD_BASE_STATS.health,
      hpRegenAt:    TimeService.now(),
      x:            null,
      y:            null,
    };

    lords[id] = lord;
    _saveAll(lords);
    const hasExisting = Object.values(lords).some(l => l.playerId === playerId && l.id !== id);
    if (!hasExisting) PlayerService.update(playerId, { lordId: id });
    return { ok: true, lord };
  }

  function getById(lordId) {
    return _getAll()[lordId] || null;
  }

  function save(lord) {
    const lords = _getAll();
    lords[lord.id] = lord;
    _saveAll(lords);
  }

  function setPosition(lordId, x, y) {
    const lords = _getAll();
    if (!lords[lordId]) return false;
    lords[lordId].x = x;
    lords[lordId].y = y;
    _saveAll(lords);
    return true;
  }

  // ── Action queue ──────────────────────────────────────────────

  // Enqueue a move action. Travel time = 20s per tile, reduced by speed stat.
  // Uses Chebyshev distance (diagonal = 1 tile).
  function enqueueMoveAction(lord, destX, destY) {
    if (lord.actionQueue.length > 0) return { ok: false, error: 'An action is already in progress.' };
    if (isStanced(lord)) {
      const def = STANCE_DEFS[lord.stance.id];
      if (def?.restrictions.includes('move')) return { ok: false, error: `Cannot move while in ${def.name} stance.` };
    }

    const speed    = getEffectiveStats(lord).speed;
    const fromX    = lord.x ?? destX;
    const fromY    = lord.y ?? destY;
    const distance = Math.max(1, Math.max(Math.abs(destX - fromX), Math.abs(destY - fromY)));
    const secs     = Math.round(distance * 20 * (5 / speed));

    const now = TimeService.now();
    lord.actionQueue = [{ actionId: 'move_lord', startedAt: now, finishAt: now + secs * 1000, destX, destY }];
    save(lord);
    return { ok: true, secs, distance };
  }

  function enqueueAction(lord, actionId) {
    if (lord.actionQueue.length > 0) return { ok: false, error: 'An action is already in progress.' };
    const def = LORD_ACTIONS[actionId];
    if (!def) return { ok: false, error: 'Unknown action.' };
    if (isStanced(lord)) {
      const stanceDef = STANCE_DEFS[lord.stance.id];
      if (stanceDef?.restrictions.includes('action')) return { ok: false, error: `Cannot perform actions while in ${stanceDef.name} stance.` };
    }

    if (def.requiresPosition && lord.x == null) {
      return { ok: false, error: 'Your lord has no position. Found a city first.' };
    }

    if (actionId === 'level_up') {
      const xpNeeded = lord.xpToNext || 100;
      if ((lord.xp || 0) < xpNeeded) {
        return { ok: false, error: `Need ${xpNeeded} XP to level up. You have ${lord.xp || 0}.` };
      }
    }

    const duration = getActionDuration(lord, actionId);
    const now = TimeService.now();
    lord.actionQueue = [{ actionId, startedAt: now, finishAt: now + duration * 1000 }];
    save(lord);
    return { ok: true };
  }

  // Lazy HP regen: call whenever displaying a lord. Mutates in place; returns true if changed.
  // Rate: 2% of maxHp per minute.
  function tickHp(lord) {
    const maxHp    = getEffectiveStats(lord).health;
    const curHp    = lord.currentHp ?? maxHp;
    if (curHp >= maxHp) { lord.currentHp = maxHp; return false; }

    const now      = TimeService.now();
    const elapsed  = (now - (lord.hpRegenAt || now)) / 60000; // minutes
    if (elapsed < 0.1) return false;

    const regen    = Math.max(1, Math.floor(maxHp * 0.02 * elapsed));
    lord.currentHp = Math.min(maxHp, curHp + regen);
    lord.hpRegenAt = now;
    return true;
  }

  // Auto level-up: called after any XP gain.
  // Applies +1 to all stats, +2 to class-specific stats, per level gained.
  // Mutates lord in place; caller must save.
  // Returns number of levels gained.
  function checkLevelUp(lord) {
    const cls     = LORD_CLASSES[lord.classId];
    const clsKeys = new Set(Object.keys(cls?.modifiers || {}));
    let leveled   = 0;

    while ((lord.xp || 0) >= (lord.xpToNext || 100)) {
      lord.xp           = Math.max(0, lord.xp - lord.xpToNext);
      lord.level        = (lord.level || 1) + 1;
      // XP curve: cumulative 50×N² → xpToNext at level N = 50×(2N+1)
      lord.xpToNext     = 50 * (2 * lord.level + 1);
      lord.talentPoints = (lord.talentPoints || 0) + 1;

      for (const key of Object.keys(LORD_BASE_STATS)) {
        lord.baseStats[key] = (lord.baseStats[key] ?? LORD_BASE_STATS[key]) + (clsKeys.has(key) ? 2 : 1);
      }
      lord.currentHp = getEffectiveStats(lord).health; // full heal on level up
      lord.hpRegenAt = TimeService.now();
      leveled++;
    }
    return leveled;
  }

  // Checks if the queued action completed, applies rewards + auto level-up.
  // Returns [{ name, actionId, leveled }].
  function tickActions(lord) {
    if (lord.actionQueue.length === 0) return [];
    const item = lord.actionQueue[0];
    if (TimeService.now() < item.finishAt) return [];

    const def = LORD_ACTIONS[item.actionId];
    lord.actionQueue = [];

    if (def && def.xpReward) {
      lord.xp = (lord.xp || 0) + def.xpReward;
    }

    if (item.actionId === 'move_lord' && item.destX != null) {
      lord.x = item.destX;
      lord.y = item.destY;
    }

    const leveled = checkLevelUp(lord);
    save(lord);
    return [{ name: def?.name || item.actionId, actionId: item.actionId, leveled, destX: item.destX, destY: item.destY }];
  }

  function actionTimeRemaining(lord) {
    if (lord.actionQueue.length === 0) return 0;
    return Math.max(0, Math.floor((lord.actionQueue[0].finishAt - TimeService.now()) / 1000));
  }

  function actionProgress(lord) {
    if (lord.actionQueue.length === 0) return 0;
    const item     = lord.actionQueue[0];
    const totalMs  = item.finishAt - item.startedAt;
    if (!totalMs) return 0;
    return Math.min(1, (TimeService.now() - item.startedAt) / totalMs);
  }

  // ── Stance API ────────────────────────────────────────────────

  function getStance(lord) {
    return lord.stance || { id: 'idle', startedAt: null, finishAt: null };
  }

  // Returns true when lord is in a non-idle timed stance that hasn't expired yet.
  function isStanced(lord) {
    const s = getStance(lord);
    if (s.id === 'idle') return false;
    if (!s.finishAt) return false;
    return TimeService.now() < s.finishAt;
  }

  // Enter a stance. Returns { ok, error? }.
  function enterStance(lord, stanceId, durationSecs) {
    const def = STANCE_DEFS[stanceId];
    if (!def) return { ok: false, error: 'Unknown stance.' };
    if (stanceId === 'idle') return { ok: false, error: 'Use exitStance() to return to idle.' };
    if (isStanced(lord)) return { ok: false, error: `Already in ${STANCE_DEFS[lord.stance.id]?.name || lord.stance.id} stance.` };
    if (lord.actionQueue.length > 0) return { ok: false, error: 'Cannot enter a stance while an action is in progress.' };
    if (def.durations && !def.durations.includes(durationSecs)) {
      return { ok: false, error: 'Invalid duration for this stance.' };
    }
    const now = TimeService.now();
    lord.stance = { id: stanceId, startedAt: now, finishAt: now + durationSecs * 1000 };
    save(lord);
    return { ok: true };
  }

  // Exit current stance and return to idle.
  function exitStance(lord) {
    lord.stance = { id: 'idle', startedAt: null, finishAt: null };
    save(lord);
  }

  // Check if stance timer has expired; if so, reset to idle.
  // Returns true if stance just expired (so callers can notify the player).
  function tickStance(lord) {
    const s = getStance(lord);
    if (s.id === 'idle' || !s.finishAt) return false;
    if (TimeService.now() >= s.finishAt) {
      lord.stance = { id: 'idle', startedAt: null, finishAt: null };
      save(lord);
      return true;
    }
    return false;
  }

  function getByPlayer(playerId) {
    return Object.values(_getAll()).filter(l => l.playerId === playerId);
  }

  function getAll() {
    return Object.values(_getAll());
  }

  // CP cap by lord level: Lv1=280, +80 per level.
  function getArmyPowerCap(lord) {
    return 200 + (lord.level || 1) * 80;
  }

  return {
    create, getById, getByPlayer, getAll, save, setPosition,
    getRecruitCost, getUpkeepPerHour, getCommandCapacity,
    enqueueAction, enqueueMoveAction, tickActions, checkLevelUp, tickHp,
    actionTimeRemaining, actionProgress,
    getEffectiveStats, getActionDuration,
    getStance, isStanced, enterStance, exitStance, tickStance,
    getArmyPowerCap,
  };
})();
