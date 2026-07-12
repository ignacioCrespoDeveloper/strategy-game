// =============================================
//  intelligence.js — Kingdom-wide intelligence pool
//
//  All discoveries belong to the PLAYER, not to individual lords.
//  When any lord searches a tile, the result is added here and
//  immediately visible to every other lord of that player.
//
//  Future systems (PvP detection, AI scouting) will WRITE here.
//  Future systems (Battle Simulator, AI planning) will READ from here.
//
//  IntelRecord shape:
//  {
//    id:           string,
//    playerId:     string,
//    type:         IntelType,
//    tileX:        number,
//    tileY:        number,
//    discoveredAt: timestamp,
//    discoveredBy: lordId,
//    expiresAt:    timestamp | null,   // null = permanent
//    qualityTier:  'vague'|'clear'|'precise',
//    data:         object,             // type + tier specific payload
//  }
//
//  Intel types:
//    'enemy_lord'      — a hostile lord spotted
//    'enemy_city'      — a hostile city spotted
//    'bandit_camp'     — a bandit presence
//    'mercenary_camp'  — mercenaries for hire
//    'ruins'           — ancient structure
//    'resources'       — harvestable resource node
// =============================================

const IntelligenceService = (() => {
  const KEY = 'intelligence'; // { [playerId]: IntelRecord[] }

  function _getAll() { return StorageService.get(KEY) || {}; }
  function _save(all) { StorageService.set(KEY, all); }
  function _id() { return 'intel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5); }

  // ── Quality tier ─────────────────────────────────────────────
  // Determines how much information is revealed about a discovery.
  // Rogue → 'precise'  (full detail)
  // Future scout/magic classes → 'clear'
  // Everyone else → 'vague'

  // currentTier: the existing tier for this record (null = first time seeing it).
  // Cities use progressive tiers: null→vague, vague→clear, clear→precise.
  function getQualityTier(lord, type, currentTier = null) {
    if (lord.classId === 'rogue') return 'precise';
    if (type === 'enemy_city') {
      if (currentTier === null)    return 'vague';
      if (currentTier === 'vague') return 'clear';
      return 'precise';
    }
    return 'vague';
  }

  // ── Data builders — one per IntelType ───────────────────────
  // Each builder returns a tier-appropriate data payload.
  // When adding a new IntelType, add a builder here and a UI renderer
  // in overview-screen.js. Nothing else needs to change.

  const _DATA_BUILDERS = {
    enemy_lord(tier, raw) {
      if (tier === 'vague')   return { summary: 'Actividad militar detectada.' };
      if (tier === 'clear')   return { summary: 'Señor enemigo detectado.', armySize: raw?.armySize || 'Desconocido' };
      /* precise */           return {
        summary:      'Señor enemigo identificado.',
        armyCapacity: raw?.armyCapacity || null,
        lastActivity: raw?.lastActivity || null,
        lordClass:    raw?.lordClass    || null,
        stanceId:     raw?.stanceId     || null,
        stanceName:   raw?.stanceName   || null,
      };
    },
    enemy_city(tier, raw) {
      const name          = raw?.name || 'Desconocido';
      const garrisonCount = raw?.garrisonCount ?? null;
      const garrisonUnits = raw?.garrisonUnits || [];
      if (tier === 'vague')   return { summary: 'Asentamiento enemigo avistado.', name, garrisonCount, garrisonUnits: null };
      if (tier === 'clear')   return { summary: 'Ciudad enemiga reconocida.',     name, garrisonCount, garrisonUnits };
      /* precise */           return { summary: 'Ciudad enemiga identificada.',   name, garrisonCount, garrisonUnits, population: raw?.population };
    },
    bandit_camp(tier, raw) {
      if (tier === 'vague')   return { summary: 'Hostile presence detected.' };
      /* clear / precise */   return { summary: 'Bandit camp located.', strength: raw?.strength || 'Unknown' };
    },
    mercenary_camp(tier, raw) {
      /* all tiers */         return { summary: 'Mercenary camp located.', units: raw?.units || [] };
    },
    ruins(tier, raw) {
      if (tier === 'vague')   return { summary: 'Ancient structure detected.' };
      /* clear / precise */   return { summary: 'Ruins located.', reward: raw?.reward || 'Unknown' };
    },
    resources(tier, raw) {
      if (tier === 'vague')   return { summary: 'Resource deposits detected.' };
      /* clear / precise */   return { summary: 'Resources located.', resourceType: raw?.resourceType, amount: raw?.amount };
    },
  };

  function _buildData(type, tier, rawData) {
    const builder = _DATA_BUILDERS[type];
    return builder ? builder(tier, rawData) : { summary: 'Unknown discovery.' };
  }

  // ── Public API ───────────────────────────────────────────────

  // Get all non-expired records for a player.
  function getPlayerRecords(playerId) {
    const now = TimeService.now();
    return (_getAll()[playerId] || []).filter(r => !r.expiresAt || r.expiresAt > now);
  }

  // Get records filtered by type.
  function getByType(playerId, type) {
    return getPlayerRecords(playerId).filter(r => r.type === type);
  }

  // Build a typed record from a search result (called by lord-screen _resolveSearch).
  // searchResult: { type, tileX, tileY, rawData?, ttl? }
  // lord: the lord who performed the search
  // Returns the record object (not yet saved — call addRecord to persist).
  function buildRecord(lord, searchResult) {
    const tier = getQualityTier(lord, searchResult.type, searchResult.currentTier ?? null);
    return {
      type:         searchResult.type,
      tileX:        searchResult.tileX,
      tileY:        searchResult.tileY,
      discoveredBy: lord.id,
      qualityTier:  tier,
      expiresAt:    searchResult.ttl ? TimeService.now() + searchResult.ttl : null,
      data:         _buildData(searchResult.type, tier, searchResult.rawData || {}),
    };
  }

  // Persist a record to the player's intelligence pool.
  function addRecord(playerId, record) {
    const all = _getAll();
    if (!all[playerId]) all[playerId] = [];
    all[playerId].push({ id: _id(), playerId, discoveredAt: TimeService.now(), ...record });
    _save(all);
  }

  function removeRecord(playerId, recordId) {
    const all = _getAll();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(r => r.id !== recordId);
    _save(all);
  }

  // Remove expired records. Call on login or overview open.
  function expireOld(playerId) {
    const all = _getAll();
    if (!all[playerId]) return;
    const now = TimeService.now();
    all[playerId] = all[playerId].filter(r => !r.expiresAt || r.expiresAt > now);
    _save(all);
  }

  return {
    getQualityTier,
    buildRecord,
    addRecord,
    removeRecord,
    getPlayerRecords,
    getByType,
    expireOld,
  };
})();
