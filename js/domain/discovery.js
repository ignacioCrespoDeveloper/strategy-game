// =============================================
//  discovery.js — Discovery domain service
//
//  Owns: weighted roll, per-player storage, expiry.
//  Does NOT own: UI, action timing, XP rewards.
//
//  Storage key: 'discoveries'
//  Shape: { [playerId]: DiscoveryRecord[] }
//
//  DiscoveryRecord:
//    id           → unique string
//    definitionId → key in DISCOVERY_DEFS
//    tileX, tileY → map coordinates of the search
//    terrain      → terrain id at time of search
//    lordId       → which lord performed the search
//    discoveredAt → timestamp ms
//    expiresAt    → timestamp ms | null (null = never expires)
//
//  To support future discovery types (enemies, cities, artifacts):
//    Add a field to DiscoveryRecord and a new definitionId.
//    Add the definition to DISCOVERY_DEFS.
//    Nothing else needs to change.
// =============================================

const DiscoveryService = (() => {
  const KEY         = 'discoveries';
  const FATIGUE_KEY = 'search_fatigue';

  function _getAll()       { return StorageService.get(KEY) || {}; }
  function _saveAll(data)  { StorageService.set(KEY, data); }
  function _forPlayer(pid) { return _getAll()[pid] || []; }

  // ── Search fatigue ────────────────────────────────────────────
  // Tracks per-lord daily search count. Resets at midnight (UTC date key).
  function _todayKey()  { return new Date().toISOString().slice(0, 10); }
  function _getFatigue(){ return StorageService.get(FATIGUE_KEY) || {}; }

  function _lordFatigue(lordId) {
    const f = _getFatigue()[lordId];
    if (!f || f.date !== _todayKey()) return { count: 0, date: _todayKey() };
    return f;
  }

  // Returns the search_area action duration in seconds based on daily fatigue count.
  // Tier 1 (0-7 searches): 5 min · Tier 2 (8-14): 15 min · Tier 3 (15+): 30 min
  function getSearchDuration(lordId) {
    const count = _lordFatigue(lordId).count;
    if (count < 8)  return 300;
    if (count < 15) return 900;
    return 1800;
  }

  function incrementFatigue(lordId) {
    const f     = _getFatigue();
    const today = _todayKey();
    const curr  = f[lordId];
    f[lordId]   = (curr && curr.date === today)
      ? { count: curr.count + 1, date: today }
      : { count: 1, date: today };
    StorageService.set(FATIGUE_KEY, f);
  }

  function getFatigueCount(lordId) {
    return _lordFatigue(lordId).count;
  }

  // ── Weighted random roll ──────────────────────────────────────

  function _roll(terrainId) {
    const entries = Object.values(DISCOVERY_DEFS)
      .map(def => {
        const mults = def.terrainMultipliers || {};
        const mult  = (terrainId in mults) ? mults[terrainId] : 1.0;
        return { def, weight: def.baseWeight * mult };
      })
      .filter(e => e.weight > 0);

    let total = 0;
    entries.forEach(e => total += e.weight);

    let rand = Math.random() * total;
    for (const e of entries) {
      rand -= e.weight;
      if (rand <= 0) return e.def;
    }
    return entries[entries.length - 1].def;
  }

  // ── Public API ────────────────────────────────────────────────

  // ── Camp level / type rolling ─────────────────────────────────

  function _rollCampLevel(armyPower) {
    let base;
    if      (armyPower < 100)  base = 1;
    else if (armyPower < 300)  base = 2;
    else if (armyPower < 700)  base = 3;
    else if (armyPower < 1400) base = 4;
    else                       base = 5;

    // ±1 variance so there's a challenge floor and a stretch goal
    const roll = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
    return Math.max(1, Math.min(5, base + roll));
  }

  function _rollCampDetails(defId, armyPower) {
    const campDef = CAMP_DEFS[defId];
    if (!campDef) return null;

    const [minLevel, maxLevel] = campDef.levelRange;
    const level     = Math.max(minLevel, Math.min(maxLevel, _rollCampLevel(armyPower)));
    const defenders = campDef.defenderRosterByLevel[level]
      || campDef.defenderRosterByLevel[minLevel]
      || [{ unitId: 'bandits', count: 2 }];

    return { level, type: defId, defenders };
  }

  // Perform a search on the lord's current tile.
  // Returns { def, record }.
  // record is null when category === 'nothing' (nothing is not stored).
  // armyPower: optional — used to scale combat discovery difficulty.
  function search(lord, playerId, armyPower) {
    if (lord.x == null || lord.y == null) {
      return { def: DISCOVERY_DEFS.nothing_found, record: null };
    }

    // Every search attempt counts toward fatigue (even nothing found).
    incrementFatigue(lord.id);

    const terrain = WorldService.getTerrain(lord.x, lord.y);
    const def     = _roll(terrain.id);

    if (def.category === 'nothing') {
      return { def, record: null };
    }

    const now    = TimeService.now();
    const record = {
      id:           'disc_' + now + '_' + Math.random().toString(36).slice(2, 5),
      definitionId: def.id,
      tileX:        lord.x,
      tileY:        lord.y,
      terrain:      terrain.id,
      lordId:       lord.id,
      discoveredAt: now,
      expiresAt:    def.baseDuration > 0 ? now + def.baseDuration * 1000 : null,
    };

    if (def.category === 'combat') {
      record.campDetails = _rollCampDetails(def.id, armyPower || 0);
    }

    const all = _getAll();
    if (!all[playerId]) all[playerId] = [];
    all[playerId].push(record);
    _saveAll(all);

    return { def, record };
  }

  // Returns all non-expired records for a player, newest first.
  function getActive(playerId) {
    const now = TimeService.now();
    return _forPlayer(playerId)
      .filter(r => r.expiresAt === null || r.expiresAt > now)
      .sort((a, b) => b.discoveredAt - a.discoveredAt);
  }

  // Purge expired records. Call when opening lord screen.
  function expireOld(playerId) {
    const now = TimeService.now();
    const all = _getAll();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(r => r.expiresAt === null || r.expiresAt > now);
    _saveAll(all);
  }

  // ── Reward logic ──────────────────────────────────────────────

  // Which resource each discovery yields (value just needs to be truthy).
  // Actual amount is determined by def.tier + lord level in _rollRewards.
  const _BASE_REWARDS = {
    // Tier 1
    iron_vein:        { iron: 1,  xp: 15 },
    cliff_face:       { stone: 1, xp: 15 },
    fertile_fields:   { food: 1,  xp: 15 },
    river_crossing:   { food: 1,  xp: 15 },
    coin_cache:       { gold: 1,  xp: 15 },
    // Tier 2
    timber_cache:     { wood: 1,  xp: 30 },
    abandoned_mine:   { iron: 1,  xp: 40 },
    stone_deposit:    { stone: 1, xp: 30 },
    wild_game:        { food: 1,  xp: 20 },
    lost_treasure:    { gold: 1,  xp: 60 },
    // Tier 3
    ancient_forest:   { wood: 1,  xp: 70  },
    deep_ore_shaft:   { iron: 1,  xp: 80  },
    marble_quarry:    { stone: 1, xp: 80  },
    bountiful_hunt:   { food: 1,  xp: 60  },
    buried_vault:     { gold: 1,  xp: 100 },
    // Event / trade / legendary
    ancient_ruins:    {           xp: 80  },
    merchant_caravan: { gold: 1,  xp: 20  },
    ancient_relic:    { gold: 1,  xp: 160 },
    bog_crystal:      { gold: 1,  xp: 120 },
  };

  // Loot ranges by tier: [min, max] for resources and gold respectively.
  const _TIER_RANGES = {
    1: { res: [20,  60],  gold: [30,  80]  },
    2: { res: [40,  120], gold: [50,  150] },
    3: { res: [100, 250], gold: [150, 400] },
  };

  function _rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const _RES_TYPES = ['gold', 'food', 'wood', 'stone', 'iron'];

  // Rolls loot for a discovery. Amounts scale by def.tier (1-3) × lord level.
  // Tier 1 → small, Tier 2 → medium, Tier 3 → large. Lord level adds +12%/level.
  function _rollRewards(def, lordLevel) {
    const rewards = [];
    const level   = Math.max(1, lordLevel || 1);
    const scalar  = 1 + 0.12 * (level - 1);

    // Combat discoveries are resolved by BattleEngine — no rewards here.
    if (def.category === 'combat') return rewards;

    const tier   = def.tier || 2;
    const ranges = _TIER_RANGES[tier] || _TIER_RANGES[2];

    const base = _BASE_REWARDS[def.id];
    if (base) {
      _RES_TYPES.forEach(t => {
        if (!base[t] || base[t] <= 0) return;
        let amount;
        if (t === 'gold') {
          // lost_treasure has a fixed override range; others use tier range
          const [min, max] = def.id === 'lost_treasure' ? [80, 200] : ranges.gold;
          amount = Math.floor(_rand(min, max) * scalar);
        } else {
          const [min, max] = ranges.res;
          amount = Math.floor(_rand(min, max) * scalar);
        }
        rewards.push({ type: t, amount });
      });
      if (base.xp > 0) rewards.push({ type: 'xp', amount: base.xp });
    } else {
      rewards.push({ type: 'xp', amount: 20 });
    }
    return rewards;
  }

  // Claim a discovery: compute rewards, remove record, return { ok, def, record, rewards }.
  // Pass `lord` (optional) to scale loot by lord level.
  function claim(recordId, playerId, lord) {
    const all     = _getAll();
    const records = all[playerId] || [];
    const idx     = records.findIndex(r => r.id === recordId);
    if (idx === -1) return { ok: false, error: 'Discovery not found or already claimed.' };

    const record  = records[idx];
    const def     = DISCOVERY_DEFS[record.definitionId];
    if (!def) return { ok: false, error: 'Unknown discovery type.' };

    const rewards = _rollRewards(def, lord?.level);
    records.splice(idx, 1);
    all[playerId] = records;
    _saveAll(all);

    return { ok: true, def, record, rewards };
  }

  // Negotiate with a discovery: mark it as a mercenary source instead of claiming it.
  // The record stays active; lord can recruit from it via the Army tab.
  // Returns { ok, record, mercenaryUnits, error? }.
  function negotiate(recordId, playerId) {
    const all     = _getAll();
    const records = all[playerId] || [];
    const idx     = records.findIndex(r => r.id === recordId);
    if (idx === -1) return { ok: false, error: 'Discovery not found.' };

    const record      = records[idx];
    if (record.negotiated) return { ok: false, error: 'Already negotiated.' };

    const def       = DISCOVERY_DEFS[record.definitionId];
    const campDef   = CAMP_DEFS[def?.id];
    const mercUnits = campDef?.mercenaryRoster;
    if (!mercUnits || mercUnits.length === 0) return { ok: false, error: 'Cannot negotiate with this discovery.' };

    records[idx] = { ...record, negotiated: true, mercenaryUnits: mercUnits };
    all[playerId] = records;
    _saveAll(all);
    return { ok: true, record: records[idx], mercenaryUnits: mercUnits };
  }

  // Human-readable time remaining for a record.
  function formatExpiry(record) {
    if (!record.expiresAt) return 'Permanent';
    const ms = Math.max(0, record.expiresAt - TimeService.now());
    if (ms === 0)       return 'Expired';
    const s = Math.floor(ms / 1000);
    if (s < 3600)       return `${Math.floor(s / 60)}m`;
    if (s < 86400)      return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  // ── Search log ────────────────────────────────────────────────
  // Persistent per-player log of every search result, dismissible by the player.
  const LOG_KEY = 'discovery_log';
  function _getLog()        { return StorageService.get(LOG_KEY) || {}; }
  function _saveLog(data)   { StorageService.set(LOG_KEY, data); }

  function addLog(playerId, entry) {
    const all = _getLog();
    if (!all[playerId]) all[playerId] = [];
    const id  = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    all[playerId].unshift({ id, ...entry, loggedAt: TimeService.now() });
    if (all[playerId].length > 100) all[playerId] = all[playerId].slice(0, 100);
    _saveLog(all);
  }

  function getLog(playerId) {
    return (_getLog()[playerId] || []);
  }

  function dismissLog(playerId, logId) {
    const all = _getLog();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(e => e.id !== logId);
    _saveLog(all);
  }

  const META_KEY = 'disc_log_meta';
  function markLogSeen(playerId) {
    const meta = StorageService.get(META_KEY) || {};
    meta[playerId] = TimeService.now();
    StorageService.set(META_KEY, meta);
  }

  function getUnseenCount(playerId) {
    const meta  = StorageService.get(META_KEY) || {};
    const since = meta[playerId] || 0;
    return getLog(playerId).filter(e => e.loggedAt > since).length;
  }

  // Debug helper: immediately create a bandit_camp discovery (bypasses random roll).
  function spawnBanditCamp(lord, playerId, armyPower) {
    const def     = DISCOVERY_DEFS['bandit_camp'];
    const now     = TimeService.now();
    const x       = lord.x ?? 0;
    const y       = lord.y ?? 0;
    const terrain = WorldService.getTerrain(x, y);

    const record = {
      id:           'disc_dbg_' + now + '_' + Math.random().toString(36).slice(2, 5),
      definitionId: 'bandit_camp',
      tileX:        x,
      tileY:        y,
      terrain:      terrain.id,
      lordId:       lord.id,
      discoveredAt: now,
      expiresAt:    now + 86400 * 1000,
      campDetails:  _rollCampDetails('bandit_camp', armyPower || 0),
    };

    const all = _getAll();
    if (!all[playerId]) all[playerId] = [];
    all[playerId].push(record);
    _saveAll(all);

    return { def, record };
  }

  return {
    search, claim, negotiate, getActive, expireOld, formatExpiry,
    addLog, getLog, dismissLog, markLogSeen, getUnseenCount,
    spawnBanditCamp,
    getSearchDuration, incrementFatigue, getFatigueCount,
  };
})();
