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
  const KEY = 'discoveries';

  function _getAll()       { return StorageService.get(KEY) || {}; }
  function _saveAll(data)  { StorageService.set(KEY, data); }
  function _forPlayer(pid) { return _getAll()[pid] || []; }

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

  // Perform a search on the lord's current tile.
  // Returns { def, record }.
  // record is null when category === 'nothing' (nothing is not stored).
  function search(lord, playerId) {
    if (lord.x == null || lord.y == null) {
      return { def: DISCOVERY_DEFS.nothing_found, record: null };
    }

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

  const _BASE_REWARDS = {
    timber_cache:     { wood: 150,  xp: 30  },
    abandoned_mine:   { iron: 100,  xp: 40  },
    stone_deposit:    { stone: 120, xp: 30  },
    wild_game:        { food: 200,  xp: 20  },
    lost_treasure:    { gold: 100,  xp: 60  },
    ancient_ruins:    {             xp: 80  },
    merchant_caravan: { gold: 70,   xp: 20  },
    ancient_relic:    { gold: 150,  xp: 160 },
    bog_crystal:      { gold: 120,  xp: 120 },
  };

  function _rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const _RES_TYPES = ['gold', 'food', 'wood', 'stone', 'iron'];

  function _rollRewards(def) {
    const rewards = [];

    if (def.id === 'bandit_camp') {
      const win = Math.random() < 0.55;
      rewards.push({ type: 'combat', outcome: win ? 'victory' : 'defeat' });
      if (win) {
        rewards.push({ type: 'gold', amount: _rand(50, 80) });
        rewards.push({ type: 'xp',   amount: 50 });
      } else {
        rewards.push({ type: 'xp', amount: 20 });
      }
      return rewards;
    }

    const base = _BASE_REWARDS[def.id];
    if (base) {
      _RES_TYPES.forEach(t => { if (base[t] > 0) rewards.push({ type: t, amount: base[t] }); });
      if (base.xp > 0) rewards.push({ type: 'xp', amount: base.xp });
    } else {
      rewards.push({ type: 'xp', amount: 20 });
    }
    return rewards;
  }

  // Claim a discovery: compute rewards, remove record, return { ok, def, record, rewards }.
  function claim(recordId, playerId) {
    const all     = _getAll();
    const records = all[playerId] || [];
    const idx     = records.findIndex(r => r.id === recordId);
    if (idx === -1) return { ok: false, error: 'Discovery not found or already claimed.' };

    const record  = records[idx];
    const def     = DISCOVERY_DEFS[record.definitionId];
    if (!def) return { ok: false, error: 'Unknown discovery type.' };

    const rewards = _rollRewards(def);
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

    const def        = DISCOVERY_DEFS[record.definitionId];
    const mercRoster = MERCENARY_ROSTER[def?.id];
    if (!mercRoster) return { ok: false, error: 'Cannot negotiate with this discovery.' };

    records[idx] = { ...record, negotiated: true, mercenaryUnits: mercRoster.units };
    all[playerId] = records;
    _saveAll(all);
    return { ok: true, record: records[idx], mercenaryUnits: mercRoster.units };
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

  return { search, claim, negotiate, getActive, expireOld, formatExpiry };
})();
