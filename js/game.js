// =============================================
//  game.js — main controller, input handling
// =============================================

const Game = (() => {
  let state = {
    selectedUnit:  null,
    selectedCity:  null,
    reachable:     [],
    phase:         'idle',   // 'idle' | 'moving'
    resources:     { gold: 50, iron: 10, food: 20, wood: 10 },
    turn:          1,
  };

  function init() {
    GameMap.init();
    Cities.init();
    Units.init();

    Renderer.init(document.getElementById('mapCanvas'));

    // Input
    document.getElementById('mapCanvas').addEventListener('click', onMapClick);
    document.getElementById('end-turn-btn').addEventListener('click', endTurn);

    UI.updateHUD(state.resources, state.turn);
    UI.showIdle(state.resources);
    render();
  }

  // ── Click handler ───────────────────────────
  function onMapClick(e) {
    const rect = e.target.getBoundingClientRect();
    const hex  = pixelToHex(
      e.clientX - rect.left,
      e.clientY - rect.top,
      Renderer.getScale()
    );
    if (!hex) return;

    const unit = Units.getAt(hex.c, hex.r);
    const city = Cities.getAt(hex.c, hex.r);

    // ── Moving phase: try to move selected unit
    if (state.phase === 'moving' && state.selectedUnit) {
      const isReachable = state.reachable.some(h => h.c === hex.c && h.r === hex.r);

      if (isReachable) {
        const result = Units.move(state.selectedUnit, hex.c, hex.r);
        if (result.result === 'moved') {
          UI.toast(`Moved to ${coordLabel(hex)}`);
          // Stay in moving mode if moves remain
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

    // ── Normal selection ──────────────────────
    // Clicked own unit
    if (unit && unit.owner === 'player') {
      state.selectedUnit = unit;
      state.selectedCity = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showUnit(unit);
      render();
      return;
    }

    // Clicked enemy unit
    if (unit && unit.owner === 'enemy') {
      state.selectedUnit = unit;
      state.selectedCity = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showUnit(unit);
      render();
      return;
    }

    // Clicked city
    if (city) {
      state.selectedUnit = null;
      state.selectedCity = city;
      state.phase = 'idle';
      state.reachable = [];
      UI.showCity(city, state.resources, onBuild, onTrain);
      render();
      return;
    }

    // Clicked empty hex — deselect
    state.selectedUnit = null;
    state.selectedCity = null;
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle(state.resources);
    render();
  }

  // ── Start move mode (called by unit panel button)
  function beginMove() {
    if (!state.selectedUnit || state.selectedUnit.owner !== 'player') return;
    if (state.selectedUnit.moves <= 0) { UI.toast('No moves remaining.'); return; }
    state.phase     = 'moving';
    state.reachable = Units.reachableFor(state.selectedUnit);
    UI.toast('Click a highlighted hex to move');
    render();
  }

  // ── Disband unit
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

  // ── Build building
  function onBuild(key) {
    if (!state.selectedCity) return;
    const result = Cities.buildBuilding(state.selectedCity, key, state.resources);
    UI.toast(result.msg);
    UI.updateHUD(state.resources, state.turn);
    UI.showCity(state.selectedCity, state.resources, onBuild, onTrain);
    render();
  }

  // ── Train unit
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

    // 3. Process city build queues → spawn units
    const spawns = Cities.processTurnEnd();
    spawns.forEach(s => {
      // Find free hex near city to place unit
      const spawnHex = findSpawnHex(s.c, s.r, s.owner);
      if (spawnHex) Units.spawn(s.type, spawnHex.c, spawnHex.r, s.owner);
    });

    // 4. Enemy AI
    AI.takeTurn();

    // 5. Increment turn
    state.turn++;
    state.phase = 'idle';
    state.reachable = [];
    state.selectedUnit = null;

    UI.updateHUD(state.resources, state.turn);
    UI.showIdle(state.resources);
    UI.toast(`Turn ${state.turn} — income collected, enemy moved`);
    render();
  }

  // Find an empty adjacent hex to spawn a unit
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
      selectedUnit: state.selectedUnit,
      reachable:    state.reachable,
    });
  }

  return { init, beginMove, disbandUnit };
})();

// Boot
window.addEventListener('DOMContentLoaded', Game.init);
