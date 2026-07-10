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
    xpReward:         5,
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

  // Returns the real action duration (seconds), applying any class passive effects.
  // Rogue Explorer: Search Area takes 50% of base time.
  function getActionDuration(lord, actionId) {
    const def     = LORD_ACTIONS[actionId];
    if (!def) return 0;
    const cls     = LORD_CLASSES[lord.classId];
    const effects = cls?.passive?.effects || {};
    if (actionId === 'search_area' && effects.searchDurationMult != null) {
      return Math.round(def.duration * effects.searchDurationMult);
    }
    return def.duration;
  }

  // ── CRUD ─────────────────────────────────────────────────────

  function create(playerId, name, raceId, classId) {
    const n = (name || '').trim();
    if (n.length < 2)           return { ok: false, error: 'Lord name must be at least 2 characters.' };
    if (n.length > 30)          return { ok: false, error: 'Lord name cannot exceed 30 characters.' };
    if (!RACES[raceId])         return { ok: false, error: 'Select a race before continuing.' };
    if (!LORD_CLASSES[classId]) return { ok: false, error: 'Select a class before continuing.' };

    const lords = _getAll();
    const taken = Object.values(lords).some(l => l.name.toLowerCase() === n.toLowerCase());
    if (taken) return { ok: false, error: 'A lord with that name already exists.' };

    const id  = _generateId();
    const lord = {
      id, playerId,
      name: n, race: raceId, classId,
      createdAt:    TimeService.now(),
      cityIds:      [],
      level:        1,
      xp:           0,
      xpToNext:     100,
      talentPoints: 0,
      actionQueue:  [],
      baseStats:    { ...LORD_BASE_STATS },
      currentHp:    LORD_BASE_STATS.health,
      hpRegenAt:    TimeService.now(),
      x:            null,
      y:            null,
    };

    lords[id] = lord;
    _saveAll(lords);
    PlayerService.update(playerId, { lordId: id });
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

  function addCity(lordId, cityId) {
    const lords = _getAll();
    if (!lords[lordId]) return false;
    if (!lords[lordId].cityIds.includes(cityId)) lords[lordId].cityIds.push(cityId);
    _saveAll(lords);
    return true;
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
      lord.xpToNext     = lord.level * 150;
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

  return {
    create, getById, save, addCity, setPosition,
    enqueueAction, enqueueMoveAction, tickActions, checkLevelUp, tickHp,
    actionTimeRemaining, actionProgress,
    getEffectiveStats, getActionDuration,
  };
})();
