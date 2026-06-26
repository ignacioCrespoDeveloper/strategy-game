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
    list.push({
      id:      nextId++,
      type,
      owner,
      c, r,
      hp:      def.hp,
      maxHp:   def.hp,
      atk:     def.atk,
      def:     def.def,
      moves:   def.moves,
      maxMoves:def.moves,
      sight:   def.sight,
    });
  }

  function getAll()           { return list; }
  function getAt(c, r)        { return list.find(u => u.c === c && u.r === r) || null; }
  function byOwner(owner)     { return list.filter(u => u.owner === owner); }
  function remove(id)         { list = list.filter(u => u.id !== id); }

  function resetMoves(owner) {
    list.filter(u => u.owner === owner).forEach(u => {
      u.moves = u.maxMoves;
    });
  }

  // Move unit; returns 'moved' | 'combat' | 'blocked'
  function move(unit, c, r) {
    const occupant = getAt(c, r);
    if (occupant) {
      if (occupant.owner !== unit.owner) {
        // Simple combat: attacker wins if atk > def's remaining hp/2
        occupant.hp -= Math.max(1, unit.atk - occupant.def / 2);
        unit.hp     -= Math.max(1, occupant.atk / 3);
        if (occupant.hp <= 0) {
          remove(occupant.id);
          unit.c = c; unit.r = r;
        }
        unit.moves = 0;
        return { result: 'combat', defeated: occupant.hp <= 0 };
      }
      return { result: 'blocked' };
    }
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
      (c, r) => { const u = getAt(c, r); return u && u.owner === unit.owner; }
    );
  }

  return {
    init, spawn, getAll, getAt, byOwner, remove,
    resetMoves, move, reachableFor,
  };
})();
