// =============================================
//  game.js — main controller, input handling
// =============================================

const Game = (() => {
  let state = {
    selectedUnit:  null,
    selectedCity:  null,
    selectedGroup: [],     // array of unit ids in the group
    reachable:     [],
    phase:         'idle', // 'idle' | 'moving' | 'group-moving'
    resources:     { gold: 50, iron: 10, food: 20, wood: 10 },
    turn:          1,
  };

  function init() {
    GameMap.init();
    Cities.init();
    Units.init();

    Renderer.init(document.getElementById('mapCanvas'));

    document.getElementById('mapCanvas').addEventListener('click', onMapClick);
    document.getElementById('end-turn-btn').addEventListener('click', endTurn);

    UI.updateHUD(state.resources, state.turn);
    UI.showIdle(state.resources);
    render();
  }

  // ── Click handler ───────────────────────────
  function onMapClick(e) {
    const rect  = e.target.getBoundingClientRect();
    const hex   = pixelToHex(e.clientX - rect.left, e.clientY - rect.top, Renderer.getScale());
    if (!hex) return;

    const unit = Units.getAt(hex.c, hex.r);
    const city = Cities.getAt(hex.c, hex.r);

    // ── Group-moving phase ──────────────────
    if (state.phase === 'group-moving') {
      const isReachable = state.reachable.some(h => h.c === hex.c && h.r === hex.r);
      if (isReachable) {
        moveGroup(hex.c, hex.r);
      } else {
        // Cancel group move
        state.phase = 'idle';
        state.reachable = [];
        const groupUnits = getGroupUnits();
        UI.showGroup(groupUnits);
      }
      render();
      return;
    }

    // ── Moving phase (single unit) ──────────
    if (state.phase === 'moving' && state.selectedUnit) {
      const isReachable = state.reachable.some(h => h.c === hex.c && h.r === hex.r);

      if (isReachable) {
        const result = Units.move(state.selectedUnit, hex.c, hex.r);
        if (result.result === 'moved') {
          UI.toast(`Moved to ${coordLabel(hex)}`);
          if (state.selectedUnit.moves > 0) {
            state.reachable = Units.reachableFor(state.selectedUnit);
          } else {
            state.phase = 'idle';
            state.reachable = [];
          }
          UI.showUnit(state.selectedUnit);
        } else if (result.result === 'combat') {
          UI.toast(result.defeated ? '⚔️ Enemy defeated!' : '⚔️ Combat — enemy survives');
          state.phase = 'idle';
          state.reachable = [];
          state.selectedUnit = null;
          UI.showIdle(state.resources);
        }
        render();
        return;
      }

      // Clicked elsewhere — cancel move
      state.phase = 'idle';
      state.reachable = [];
    }

    // ── Shift+click: toggle unit in/out of group
    if (e.shiftKey) {
      if (unit && unit.owner === 'player') {
        toggleGroupMember(unit);
        render();
        return;
      }
      // Shift+click on empty/enemy — ignore
      return;
    }

    // ── Normal selection ──────────────────────
    if (unit && unit.owner === 'player') {
      // If group is active and user clicks a group member, keep group context
      if (state.selectedGroup.length > 0 && state.selectedGroup.includes(unit.id)) {
        // Just refresh group display
        UI.showGroup(getGroupUnits());
        render();
        return;
      }
      // Clear group, select single unit
      state.selectedGroup = [];
      state.selectedUnit = unit;
      state.selectedCity = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showUnit(unit);
      render();
      return;
    }

    if (unit && unit.owner === 'enemy') {
      state.selectedGroup = [];
      state.selectedUnit = unit;
      state.selectedCity = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showUnit(unit);
      render();
      return;
    }

    if (city) {
      state.selectedGroup = [];
      state.selectedUnit = null;
      state.selectedCity = city;
      state.phase = 'idle';
      state.reachable = [];
      UI.showCity(city, state.resources, onBuild, onTrain);
      render();
      return;
    }

    // Clicked empty hex — deselect all
    state.selectedUnit = null;
    state.selectedCity = null;
    state.selectedGroup = [];
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle(state.resources);
    render();
  }

  // ── Group helpers ───────────────────────────
  function toggleGroupMember(unit) {
    const idx = state.selectedGroup.indexOf(unit.id);
    if (idx >= 0) {
      state.selectedGroup.splice(idx, 1);
    } else {
      state.selectedGroup.push(unit.id);
      state.selectedUnit = null;
    }

    if (state.selectedGroup.length === 0) {
      state.phase = 'idle';
      state.reachable = [];
      UI.showIdle(state.resources);
    } else {
      state.phase = 'idle';
      state.reachable = [];
      UI.showGroup(getGroupUnits());
    }
  }

  function getGroupUnits() {
    return state.selectedGroup
      .map(id => Units.getAll().find(u => u.id === id))
      .filter(Boolean);
  }

  // ── Start single-unit move mode ─────────────
  function beginMove() {
    if (!state.selectedUnit || state.selectedUnit.owner !== 'player') return;
    if (state.selectedUnit.moves <= 0) { UI.toast('No moves remaining.'); return; }
    state.phase     = 'moving';
    state.reachable = Units.reachableFor(state.selectedUnit);
    UI.toast('Click a highlighted hex to move');
    render();
  }

  // ── Begin group move ────────────────────────
  function beginGroupMove() {
    const groupUnits = getGroupUnits().filter(u => u.moves > 0);
    if (groupUnits.length === 0) { UI.toast('No units in group have moves remaining.'); return; }

    // Union of all reachable hexes across group members
    const reachSet = new Set();
    const reachArr = [];
    groupUnits.forEach(u => {
      Units.reachableFor(u).forEach(h => {
        const k = hexKey(h.c, h.r);
        if (!reachSet.has(k)) { reachSet.add(k); reachArr.push(h); }
      });
    });

    state.phase     = 'group-moving';
    state.reachable = reachArr;
    UI.toast(`Moving group of ${groupUnits.length} — click a hex`);
    render();
  }

  // Move each unit in the group toward target hex using BFS pathfinding
  function moveGroup(targetC, targetR) {
    const groupUnits = getGroupUnits().filter(u => u.moves > 0);
    let moved = 0;

    // Sort by distance to target so closer units move first (avoid blocking)
    groupUnits.sort((a, b) => hexDist(a.c, a.r, targetC, targetR) - hexDist(b.c, b.r, targetC, targetR));

    groupUnits.forEach(u => {
      // Pathfind one step toward target
      const path = bfsPath(u.c, u.r, targetC, targetR, u.moves,
        (c, r) => !GameMap.isWater(c, r),
        (c, r) => { const o = Units.getAt(c, r); return o && o.owner === 'player'; }
      );
      if (path && path.length > 1) {
        const next = path[1];
        const result = Units.move(u, next.c, next.r);
        if (result.result === 'moved' || result.result === 'combat') moved++;
      }
    });

    UI.toast(`Group moved (${moved} units)`);

    // Refresh reachable or exit group move
    const stillMovable = getGroupUnits().filter(u => u.moves > 0);
    if (stillMovable.length > 0 && state.phase === 'group-moving') {
      // Recompute reachable
      const reachSet = new Set();
      const reachArr = [];
      stillMovable.forEach(u => {
        Units.reachableFor(u).forEach(h => {
          const k = hexKey(h.c, h.r);
          if (!reachSet.has(k)) { reachSet.add(k); reachArr.push(h); }
        });
      });
      state.reachable = reachArr;
    } else {
      state.phase = 'idle';
      state.reachable = [];
      UI.showGroup(getGroupUnits());
    }
  }

  // Simple hex distance approximation (offset coords)
  function hexDist(c1, r1, c2, r2) {
    return Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
  }

  // BFS pathfinding — returns array of hexes from start to goal (inclusive), or null
  function bfsPath(sc, sr, gc, gr, maxMoves, isPassable, isBlocked) {
    if (sc === gc && sr === gr) return [{ c: sc, r: sr }];
    const visited = { [hexKey(sc, sr)]: null };
    const queue = [{ c: sc, r: sr, cost: 0 }];
    let found = false;

    while (queue.length && !found) {
      const cur = queue.shift();
      const nexts = neighbors(cur.c, cur.r, isPassable);
      for (const n of nexts) {
        const k = hexKey(n.c, n.r);
        if (k in visited) continue;
        visited[k] = hexKey(cur.c, cur.r);
        const cost = cur.cost + (TERRAIN_DEF[TERRAIN_MAP[n.r][n.c]]?.move ?? 1);
        if (n.c === gc && n.r === gr) { found = true; break; }
        if (!isBlocked(n.c, n.r) && cost < maxMoves * 3) {
          queue.push({ c: n.c, r: n.r, cost });
        }
      }
    }

    if (!found) return null;

    // Reconstruct path
    const path = [];
    let cur = hexKey(gc, gr);
    while (cur !== null) {
      path.unshift(parseKey(cur));
      cur = visited[cur];
    }
    return path;
  }

  // ── Disband single unit ─────────────────────
  function disbandUnit() {
    if (!state.selectedUnit || state.selectedUnit.owner !== 'player') return;
    Units.remove(state.selectedUnit.id);
    state.selectedUnit = null;
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle(state.resources);
    UI.toast('Unit disbanded.');
    render();
  }

  // ── Disband entire group ────────────────────
  function disbandGroup() {
    const groupUnits = getGroupUnits();
    groupUnits.forEach(u => Units.remove(u.id));
    state.selectedGroup = [];
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle(state.resources);
    UI.toast(`Disbanded ${groupUnits.length} unit(s).`);
    render();
  }

  // ── Clear group selection ───────────────────
  function clearGroup() {
    state.selectedGroup = [];
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle(state.resources);
    render();
  }

  // ── Build building ──────────────────────────
  function onBuild(key) {
    if (!state.selectedCity) return;
    const result = Cities.buildBuilding(state.selectedCity, key, state.resources);
    UI.toast(result.msg);
    UI.updateHUD(state.resources, state.turn);
    UI.showCity(state.selectedCity, state.resources, onBuild, onTrain);
    render();
  }

  // ── Train unit ──────────────────────────────
  function onTrain(type) {
    if (!state.selectedCity) return;
    const result = Cities.trainUnit(state.selectedCity, type, state.resources);
    UI.toast(result.msg);
    UI.updateHUD(state.resources, state.turn);
    UI.showCity(state.selectedCity, state.resources, onBuild, onTrain);
    render();
  }

  // ── End turn ───────────────────────────────
  function endTurn() {
    // 1. Reset player moves
    Units.resetMoves('player');

    // 2. Collect income
    GameMap.collectIncome(Units.getAll(), Cities.getAll(), state.resources);

    // 3. Deduct maintenance — must happen AFTER income so income can offset costs
    const maintMsgs = GameMap.deductMaintenance(Units.getAll(), state.resources);

    // 4. Process city build queues → spawn units
    const spawns = Cities.processTurnEnd();
    spawns.forEach(s => {
      const spawnHex = findSpawnHex(s.c, s.r, s.owner);
      if (spawnHex) Units.spawn(s.type, spawnHex.c, spawnHex.r, s.owner);
    });

    // 5. Enemy AI
    AI.takeTurn();

    // 6. Increment turn
    state.turn++;
    state.phase = 'idle';
    state.reachable = [];
    state.selectedUnit = null;
    // Keep group selection across turns

    UI.updateHUD(state.resources, state.turn);
    if (state.selectedGroup.length > 0) {
      // Refresh group panel (some units may have died)
      state.selectedGroup = state.selectedGroup.filter(id => Units.getAll().some(u => u.id === id));
      if (state.selectedGroup.length > 0) {
        UI.showGroup(getGroupUnits());
      } else {
        UI.showIdle(state.resources);
      }
    } else {
      UI.showIdle(state.resources);
    }

    let msg = `Turn ${state.turn} — income collected, enemy moved`;
    if (maintMsgs.length > 0) msg += `. ⚠️ ${maintMsgs[0]}`;
    UI.toast(msg, 3000);
    render();
  }

  function findSpawnHex(c, r, owner) {
    const candidates = [{ c, r }, ...neighbors(c, r)];
    return candidates.find(h =>
      !GameMap.isWater(h.c, h.r) && !Units.getAt(h.c, h.r)
    ) || null;
  }

  function coordLabel(hex) {
    return String.fromCharCode(65 + hex.c) + (hex.r + 1);
  }

  function render() {
    Renderer.draw({
      selectedUnit:  state.selectedUnit,
      selectedGroup: state.selectedGroup,
      reachable:     state.reachable,
    });
  }

  return { init, beginMove, disbandUnit, beginGroupMove, disbandGroup, clearGroup };
})();

// Boot
window.addEventListener('DOMContentLoaded', Game.init);
