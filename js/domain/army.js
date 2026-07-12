// =============================================
//  army.js — Army domain service
//
//  Each Lord owns one Army.
//  An Army is a list of unit stacks: [{ unitId, count }]
//
//  Storage: 'armies' → { [lordId]: ArmyRecord }
//
//  Architecture note: army size cap, supply system, multi-army
//  support are intentionally not implemented here. This service
//  is the single source of truth for unit counts.
// =============================================

const ArmyService = (() => {
  const KEY = 'armies';

  function _getAll()       { return StorageService.get(KEY) || {}; }
  function _saveAll(all)   { StorageService.set(KEY, all); }

  function get(lordId) {
    const all = _getAll();
    if (!all[lordId]) return { lordId, units: [] };
    return all[lordId];
  }

  function save(army) {
    const all = _getAll();
    all[army.lordId] = army;
    _saveAll(all);
  }

  // Add `count` of `unitId` to the lord's army. Creates the stack if missing.
  function addUnits(lordId, unitId, count) {
    const army  = get(lordId);
    const stack = army.units.find(u => u.unitId === unitId);
    if (stack) {
      stack.count += count;
    } else {
      army.units.push({ unitId, count });
    }
    save(army);
    return army;
  }

  // Remove `count` of `unitId`. Returns { ok, error }.
  function removeUnits(lordId, unitId, count) {
    const army  = get(lordId);
    const stack = army.units.find(u => u.unitId === unitId);
    if (!stack || stack.count < count) {
      return { ok: false, error: 'Not enough units.' };
    }
    stack.count -= count;
    army.units   = army.units.filter(u => u.count > 0);
    save(army);
    return { ok: true };
  }

  // Total unit count across all stacks.
  function totalUnits(lordId) {
    return get(lordId).units.reduce((sum, u) => sum + u.count, 0);
  }

  // Apply battle losses and sub-model HP damage from a BattleReport.
  // losses:    [{ unitId, modelsLost }]
  // hpUpdates: [{ unitId, currentHp }] — persists front-model HP between battles
  function applyBattleLosses(lordId, losses, hpUpdates = []) {
    const army = get(lordId);
    losses.forEach(({ unitId, modelsLost }) => {
      const stack = army.units.find(u => u.unitId === unitId);
      if (!stack) return;
      stack.count = Math.max(0, stack.count - modelsLost);
    });
    hpUpdates.forEach(({ unitId, currentHp }) => {
      const stack = army.units.find(u => u.unitId === unitId);
      if (stack && stack.count > 0) stack.currentHp = Math.round(currentHp);
    });
    army.units = army.units.filter(u => u.count > 0);
    save(army);
  }

  return { get, save, addUnits, removeUnits, totalUnits, applyBattleLosses };
})();
