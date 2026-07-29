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
//    honorEarned  → number (signed — can be negative; 0 if no honor changed)
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

  // ── Ambush records — the expedition combat outcome ─────────────
  // Derives the WHOLE entry from the BattleReport, so the two call sites
  // (lord-screen's live resolve and discovery.js's offline sync ingest) cannot
  // produce differently-shaped rows for the same fight. The server stamps
  // report._meta with campName/campIcon/campLevel/terrain, so nothing here has
  // to be passed in twice.
  //
  // WHY THIS EXISTS: lord-screen.js called `BattleHistoryService.add()` — a
  // method that never existed on this service. It threw a TypeError on EVERY
  // ambush, and because the call sat above addLog / ActivityService.log /
  // _toast in _applyAmbushResult, and the caller re-renders only AFTER the
  // result loop, that one missing method silently cost the player the battle
  // report, the quest-log entry, the activity entry, the toast AND the
  // post-quest re-render (the screen appeared to hang until you navigated
  // away and back). Fixed 2026-07-29. This is now the ONLY way an ambush
  // reaches the history — do not hand-build the record at a call site.
  function saveAmbush(lordId, opts) {
    const report = opts?.report;
    if (!lordId || !report) return false;

    const meta = report._meta || {};
    const at   = opts.at || TimeService.now();
    const name = opts.campName || meta.campName || 'Ambush';

    // A given ambush reaches the client through exactly ONE path (whichever
    // endpoint drains lord.pendingDiscoveries clears it), so this is a
    // belt-and-braces guard rather than a load-bearing one.
    const dupe = getForLord(lordId).some(b =>
      b.at === at && b.campName === name && b.rounds === report.rounds);
    if (dupe) return false;

    const counted = side => (side || []).reduce((n, u) => n + (u.count || 0), 0);
    const won     = report.winner === 'attacker';

    save(lordId, {
      at,
      outcome:      won ? 'victory' : 'defeat',
      campName:     name,
      campIcon:     meta.campIcon || '',
      campLevel:    opts.campLevel ?? meta.campLevel ?? null,
      lordLevel:    opts.lordLevel || null,
      terrain:      meta.terrain || null,
      // Loot is only paid on a win; the report carries it either way.
      goldEarned:   won ? (report.loot?.gold || 0) : 0,
      resourceLoot: won ? (report.loot?.resource || null) : null,
      xpEarned:     report.xpEarned || 0,
      modelsLost:   Math.max(0, counted(report.attacker?.unitsStart) - counted(report.attacker?.unitsSurviving)),
      rounds:       report.rounds || 0,
      reason:       report.reason || '',
      honorEarned:  0,   // PvE awards no honor — honor is a purely PvP metric.
      report,
    });
    return true;
  }

  function clearForLord(lordId) {
    const all = _getAll();
    if (!all[lordId]) return;
    delete all[lordId];
    _saveAll(all);
  }

  return { save, saveAmbush, getForLord, clearForLord };
})();
