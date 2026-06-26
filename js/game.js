// =============================================
//  game.js — main controller, input handling
// =============================================

const Game = (() => {
  let state = {
    selectedUnit:  null,   // enemy unit being viewed
    selectedCity:  null,
    selectedGroup: [],     // IDs of units in the selected army
    reachable:     [],
    phase:         'idle', // 'idle' | 'army-moving'
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

    // Arrow-key camera pan (smooth via rAF inside Renderer)
    const PAN_DIRS = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down' };
    document.addEventListener('keydown', e => {
      const dir = PAN_DIRS[e.key];
      if (dir) { e.preventDefault(); Renderer.setPanFlag(dir, true); }
    });
    document.addEventListener('keyup', e => {
      const dir = PAN_DIRS[e.key];
      if (dir) Renderer.setPanFlag(dir, false);
    });

    UI.updateHUD(state.resources, state.turn);
    UI.showIdle();
    render();
  }

  // ── Click handler ───────────────────────────
  function onMapClick(e) {
    const rect = e.target.getBoundingClientRect();
    const cam  = Renderer.getCamera();
    const hex  = pixelToHex(e.clientX - rect.left, e.clientY - rect.top, Renderer.getScale(), cam.x, cam.y);
    if (!hex) return;

    const unit = Units.getAt(hex.c, hex.r);
    const city = Cities.getAt(hex.c, hex.r);

    // ── Army moving phase ───────────────────
    if (state.phase === 'army-moving') {
      const isReachable = state.reachable.some(h => h.c === hex.c && h.r === hex.r);
      if (isReachable) {
        moveArmy(hex.c, hex.r);
        render();
        return;
      }
      // Not reachable — cancel move, then fall through to re-select
      state.phase    = 'idle';
      state.reachable = [];
    }

    // ── Player army ─────────────────────────
    if (unit && unit.owner === 'player') {
      selectArmy(unit.c, unit.r);
      return;
    }

    // ── Enemy unit (view only) ──────────────
    if (unit && unit.owner === 'enemy') {
      state.selectedGroup = [];
      state.selectedUnit  = Units.getAllAt(unit.c, unit.r)[0]; // representative
      state.selectedCity  = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showUnit(unit);
      render();
      return;
    }

    // ── City ────────────────────────────────
    if (city) {
      state.selectedGroup = [];
      state.selectedUnit  = null;
      state.selectedCity  = city;
      state.phase = 'idle';
      state.reachable = [];
      UI.showCity(city, state.resources, onBuild, onTrain);
      render();
      return;
    }

    // ── Empty hex ───────────────────────────
    state.selectedGroup = [];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle();
    render();
  }

  // Select all units at (c,r) as one army and immediately enter move mode
  function selectArmy(c, r) {
    const allHere = Units.getAllAt(c, r);
    state.selectedGroup = allHere.map(u => u.id);
    state.selectedUnit  = null;
    state.selectedCity  = null;
    UI.showArmy(allHere);
    beginArmyMove();
  }

  // ── Capture city/resource when unit lands ──
  function tryCapture(unit) {
    const cityResult = Cities.captureAt(unit.c, unit.r, unit.owner);
    const resResult  = GameMap.processCapture(unit.c, unit.r, unit.owner);
    if (unit.owner === 'player') {
      if (cityResult)     UI.toast(`🏰 ${cityResult.name} conquistada!`);
      else if (resResult) UI.toast(`${RESOURCE_DEF[resResult.type].icon} Recurso capturado`);
    }
    if (cityResult || resResult) UI.updateHUD(state.resources, state.turn);
  }

  function getArmyUnits() {
    return state.selectedGroup
      .map(id => Units.getAll().find(u => u.id === id))
      .filter(Boolean);
  }

  // ── Army movement ───────────────────────────
  function beginArmyMove() {
    const allUnits     = getArmyUnits();
    const anyMovable   = allUnits.some(u => u.moves > 0);
    const anyExhausted = allUnits.some(u => u.moves === 0);

    if (!anyMovable) {
      // Whole army exhausted
      state.phase = 'idle';
      state.reachable = [];
      UI.showArmy(allUnits);
      render();
      return;
    }

    if (anyExhausted) {
      // Mixed — some units exhausted; army locked. Player must split a unit manually.
      state.phase = 'idle';
      state.reachable = [];
      UI.showArmy(allUnits);
      render();
      return;
    }

    // All units have moves — enter army-move mode
    const minMoves = Math.min(...allUnits.map(u => u.moves));
    const anchor   = allUnits[0];
    const reachArr = bfsReach(
      anchor.c, anchor.r, minMoves,
      (c, r) => !GameMap.isWater(c, r),
      () => false
    );
    state.phase     = 'army-moving';
    state.reachable = reachArr;
    render();
  }

  // ── Extract single unit to move alone ───────
  function splitUnit(unitId) {
    const unit = Units.getAll().find(u => u.id === unitId);
    if (!unit || unit.moves === 0) return;
    state.selectedGroup = [unitId];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    UI.showArmy([unit]);
    beginArmyMove();
  }

  // Move the whole army one step toward (targetC, targetR)
  function moveArmy(targetC, targetR) {
    const movable = getArmyUnits().filter(u => u.moves > 0);
    if (movable.length === 0) return;

    const minMoves = Math.min(...movable.map(u => u.moves));
    const anchor   = movable[0];

    const path = bfsPath(anchor.c, anchor.r, targetC, targetR, minMoves,
      (c, r) => !GameMap.isWater(c, r),
      () => false
    );

    if (!path || path.length < 2) return;

    const next = path[1];
    let anyMoved = false;

    movable.forEach(u => {
      const result = Units.move(u, next.c, next.r);
      if (result.result === 'moved' || result.result === 'combat') anyMoved = true;
    });

    if (anyMoved) tryCapture(movable[0]);

    // Update selectedGroup in case some units died in combat
    state.selectedGroup = state.selectedGroup.filter(id => Units.getAll().some(u => u.id === id));

    // Stop if any unit is now exhausted; otherwise refresh reachable
    const army         = getArmyUnits();
    const anyExhausted = army.some(u => u.moves === 0);
    const anyMovable   = army.some(u => u.moves > 0);

    if (!anyExhausted && anyMovable) {
      const newMin    = Math.min(...army.map(u => u.moves));
      const newAnchor = army[0];
      state.reachable = bfsReach(
        newAnchor.c, newAnchor.r, newMin,
        (c, r) => !GameMap.isWater(c, r),
        () => false
      );
    } else {
      state.phase     = 'idle';
      state.reachable = [];
      UI.showArmy(army);
    }
  }

  // ── Deselect / close panel ──────────────────
  function deselect() {
    state.selectedGroup = [];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    state.phase    = 'idle';
    state.reachable = [];
    UI.showIdle();
    render();
  }

  // ── Disband army ────────────────────────────
  function disbandGroup() {
    const units = getArmyUnits();
    units.forEach(u => Units.remove(u.id));
    state.selectedGroup = [];
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle();
    UI.toast(`Ejército disuelto (${units.length} unidad${units.length !== 1 ? 'es' : ''}).`);
    render();
  }

  // ── Nearest player army to a city ──────────
  function armyNearCity(city, range = 2) {
    return Units.byOwner('player').find(u =>
      Math.max(Math.abs(u.c - city.c), Math.abs(u.r - city.r)) <= range
    );
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
    const city     = state.selectedCity;
    const noArmies = Units.byOwner('player').length === 0;
    if (!armyNearCity(city) && !noArmies) {
      UI.toast('Necesitas un ejército cerca de la ciudad para reclutar.');
      return;
    }
    const result = Cities.trainUnit(city, type, state.resources);
    UI.toast(result.msg);
    UI.updateHUD(state.resources, state.turn);
    UI.showCity(city, state.resources, onBuild, onTrain);
    render();
  }

  // ── End turn ───────────────────────────────
  function endTurn() {
    Units.resetMoves('player');
    GameMap.collectIncome(Units.getAll(), Cities.getAll(), state.resources);
    const maintMsgs = GameMap.deductMaintenance(Units.getAll(), state.resources);
    const healMsgs  = GameMap.healUnits(Units.getAll(), Cities.getAll());

    // Spawn trained units
    Cities.processTurnEnd().forEach(s => {
      const spawnHex = findSpawnHex(s.c, s.r, s.owner);
      if (spawnHex) Units.spawn(s.type, spawnHex.c, spawnHex.r, s.owner);
    });

    AI.takeTurn();

    state.turn++;
    state.phase     = 'idle';
    state.reachable = [];
    state.selectedUnit = null;

    // Clean up dead units from army selection
    state.selectedGroup = state.selectedGroup.filter(id => Units.getAll().some(u => u.id === id));

    UI.updateHUD(state.resources, state.turn);
    if (state.selectedGroup.length > 0) {
      UI.showArmy(getArmyUnits());
    } else {
      UI.showIdle();
    }

    let msg = `Turno ${state.turn} — ingresos cobrados`;
    if (maintMsgs.length > 0) msg += `. ⚠️ ${maintMsgs[0]}`;
    if (healMsgs.length > 0)  msg += `. 💊 ${healMsgs[0]}`;
    UI.toast(msg, 3500);
    render();
  }

  // Spawn at city hex (stacking allowed — joins existing army)
  function findSpawnHex(c, r, owner) {
    // Try to spawn at the nearest friendly army within 2 hexes
    if (owner === 'player' || owner === 'enemy') {
      const allies = Units.byOwner(owner);
      let nearest = null, nearestD = Infinity;
      allies.forEach(u => {
        const d = Math.max(Math.abs(u.c - c), Math.abs(u.r - r));
        if (d < nearestD) { nearest = u; nearestD = d; }
      });
      if (nearest && nearestD <= 2) return { c: nearest.c, r: nearest.r };
    }
    // Fallback: city hex or first non-water adjacent
    const candidates = [{ c, r }, ...neighbors(c, r)];
    return candidates.find(h => !GameMap.isWater(h.c, h.r)) || null;
  }

  // BFS pathfinding — returns array of hexes from start to goal, or null
  function bfsPath(sc, sr, gc, gr, maxMoves, isPassable, isBlocked) {
    if (sc === gc && sr === gr) return [{ c: sc, r: sr }];
    const visited = { [hexKey(sc, sr)]: null };
    const queue   = [{ c: sc, r: sr, cost: 0 }];
    let found = false;

    while (queue.length && !found) {
      const cur = queue.shift();
      for (const n of neighbors(cur.c, cur.r, isPassable)) {
        const k = hexKey(n.c, n.r);
        if (k in visited) continue;
        visited[k] = hexKey(cur.c, cur.r);
        const cost = cur.cost + (TERRAIN_DEF[TERRAIN_MAP[n.r][n.c]]?.move ?? 1);
        if (n.c === gc && n.r === gr) { found = true; break; }
        if (!isBlocked(n.c, n.r) && cost < maxMoves * 3) queue.push({ c: n.c, r: n.r, cost });
      }
    }

    if (!found) return null;
    const path = [];
    let cur = hexKey(gc, gr);
    while (cur !== null) { path.unshift(parseKey(cur)); cur = visited[cur]; }
    return path;
  }

  function render() {
    Renderer.draw({
      selectedUnit:  state.selectedUnit,
      selectedGroup: state.selectedGroup,
      reachable:     state.reachable,
    });
  }

  return { init, disbandGroup, armyNearCity, deselect, splitUnit };
})();

// Boot
window.addEventListener('DOMContentLoaded', Game.init);
