// =============================================
//  units.js — unit state and logic
// =============================================

const Units = (() => {
  let list = [];
  let nextId = 1;

  function init() {
    list = [];
    INITIAL_UNITS.forEach(u => spawn(u.type, u.c, u.r, u.owner));
  }

  function spawn(type, c, r, owner) {
    const def = UNIT_TYPES[type];
    const u = {
      id:       nextId++,
      type,
      owner,
      c, r,
      hp:       def.hp,
      maxHp:    def.hp,
      atk:      def.atk,
      def:      def.def,
      arm:      def.arm || 0,
      moves:    def.moves,
      maxMoves: def.moves,
      sight:    def.sight,
      xp:       0,
      level:    1,
      isLeader: false,
    };
    list.push(u);
    return u;
  }

  function getLeaderUnit() {
    return list.find(u => u.isLeader && u.owner === 'player') || null;
  }

  function awardXP(unitId, amount) {
    const unit = list.find(u => u.id === unitId);
    if (!unit) return false;
    unit.xp = (unit.xp || 0) + amount;
    return _checkLevelUp(unit);
  }

  function _checkLevelUp(unit) {
    const thresholds = UNIT_XP_THRESHOLDS; // [100, 300, 600]
    const maxLevel = thresholds.length + 1; // 4
    let leveled = false;
    while ((unit.level || 1) < maxLevel) {
      if (unit.xp >= thresholds[(unit.level || 1) - 1]) {
        unit.level = (unit.level || 1) + 1;
        _applyLevelStats(unit);
        leveled = true;
      } else break;
    }
    return leveled;
  }

  function _applyLevelStats(unit) {
    const base = UNIT_TYPES[unit.type];
    const b = UNIT_LEVEL_BONUSES[(unit.level || 1) - 1] || UNIT_LEVEL_BONUSES[0];
    const hpRatio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 1;
    unit.maxHp = Math.round(base.hp * b.maxHp);
    unit.hp    = Math.min(unit.maxHp, Math.max(1, Math.round(unit.maxHp * hpRatio)));
    unit.atk   = Math.round(base.atk * b.atk);
    unit.def   = Math.round(base.def * b.def);
    unit.arm   = Math.round((base.arm || 0) * b.arm);
  }

  function getAll()           { return list; }
  function getAt(c, r)        { return list.find(u => u.c === c && u.r === r) || null; }
  function getAllAt(c, r)      { return list.filter(u => u.c === c && u.r === r); }
  function byOwner(owner)     { return list.filter(u => u.owner === owner); }
  function remove(id)         { list = list.filter(u => u.id !== id); }

  function resetMoves(owner) {
    list.filter(u => u.owner === owner).forEach(u => {
      u.moves = u.maxMoves;
    });
  }

  // Move unit to (c, r) — combat is handled at army level in game.js
  function move(unit, c, r) {
    unit.c = c;
    unit.r = r;
    unit.moves = Math.max(0, unit.moves - 1);
    return { result: 'moved' };
  }

  function isPassable(c, r) {
    return !GameMap.isWater(c, r);
  }

  function isBlockedForPlayer(c, r) {
    const u = getAt(c, r);
    return u && u.owner === 'player';   // can't step on own unit
  }

  function reachableFor(unit) {
    return bfsReach(
      unit.c, unit.r, unit.moves,
      isPassable,
      () => false  // friendly stacking allowed — no blocking
    );
  }

  return {
    init, spawn, getAll, getAt, getAllAt, byOwner, remove,
    resetMoves, move, reachableFor, awardXP, getLeaderUnit,
  };
})();
