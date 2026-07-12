// =============================================
//  battle-history.js — Per-lord battle record store
//
//  Persists the last MAX_PER battles per lord in localStorage.
//  The full report object is stored so the Battle tab can replay the log.
//
//  Storage key: 'battle_history'
//  Shape: { [lordId]: BattleRecord[] }
//
//  BattleRecord:
//    id           → unique string
//    outcome      → 'victory' | 'defeat' | 'draw'
//    campName     → display name of the enemy (e.g. "Bandit Camp (Nivel 2)")
//    campIcon     → emoji
//    campLevel    → number
//    terrain      → terrain id
//    goldEarned   → number (0 on defeat)
//    xpEarned     → number
//    modelsLost   → number
//    rounds       → number
//    reason       → 'eliminated' | 'routed' | 'retreated' | 'max_rounds'
//    at           → timestamp ms
//    report       → full BattleReport for log replay
// =============================================

const BattleHistoryService = (() => {
  const KEY     = 'battle_history';
  const MAX_PER = 20;

  function _getAll()      { return StorageService.get(KEY) || {}; }
  function _saveAll(data) { StorageService.set(KEY, data); }

  function save(lordId, entry) {
    const all = _getAll();
    if (!all[lordId]) all[lordId] = [];
    const id = 'bh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    all[lordId].unshift({ id, at: TimeService.now(), ...entry });
    if (all[lordId].length > MAX_PER) all[lordId] = all[lordId].slice(0, MAX_PER);
    _saveAll(all);
  }

  function getForLord(lordId) {
    return _getAll()[lordId] || [];
  }

  return { save, getForLord };
})();
