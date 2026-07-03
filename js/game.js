// =============================================
//  game.js â€” main controller, input handling
// =============================================

const Game = (() => {
  let state = {
    selectedUnit:       null,
    selectedCity:       null,
    selectedGroup:      [],
    reachable:          [],
    phase:              'idle',
    resources:          { gold: 150, iron: 10, food: 20, wood: 10 },
    turn:               1,
    lord:               null,   // the chosen LegendaryLord â€” campaign identity
    enemyFactionId:     null,
    relations:          {},   // { factionId: 'war'|'neutral'|'non_aggression'|'trade'|'alliance' }
    exploredHexes:      new Set(),
    discoveredFactions: new Set(),
  };

  // ── City capture menus ─────────────────────────────────────────────
  // Keyed by lord.captureStyle. Each entry is the options array shown in
  // the City Capture Decision panel. Add a new key for each future lord style.
  const CAPTURE_MENUS = {
    standard: null, // null = auto-execute 'occupy', no panel shown

    plague: [
      {
        id:    'occupy',
        icon:  '🏰',
        label: 'Ocupar',
        desc:  'Toma la ciudad. Funciona como un asentamiento normal bajo tu control.',
        color: '#4a6a3a',
      },
      {
        id:    'loot',
        icon:  '💰',
        label: 'Saquear',
        desc:  'Extrae oro y comida. Reduce la población. La ciudad no te pertenece.',
        color: '#7a6a20',
      },
      {
        id:        'infect',
        icon:      '☠',
        label:     'Infectar',
        desc:      'La ciudad cae bajo la plaga. Solo las ciudades Completamente Infectadas (Etapa 3) cuentan para tu victoria.',
        color:     '#3a6b2a',
        highlight: true,
      },
    ],
  };

  // ── Victory checks ────────────────────────────────────────────────
  // Keyed by lord.victoryCondition.checkId. Each function returns true when
  // the victory condition is met. Add a new key for each future lord.
  const VICTORY_CHECKS = {
    five_infected_cities: () =>
      Cities.getAll().filter(c => c.owner === 'player' && c.infectionStage === 3).length >= 5,
  };

  // Returns the numeric effect value for a trait key, or defaultVal if not present
  // Reads from state.lord.traits â€” every lord-specific bonus flows through here.
  function _traitEffect(key, defaultVal) {
    if (!state.lord || !state.lord.traits) return defaultVal;
    for (const tid of state.lord.traits) {
      const t = (typeof TRAITS !== 'undefined') && TRAITS[tid];
      if (t && t.effect && key in t.effect) return t.effect[key];
    }
    return defaultVal;
  }

  function getPlayerColor()        { return state.lord ? state.lord.color : '#4a9eff'; }
  function getLeader()             { return state.lord; }
  function getFaction()            { return state.lord; }
  function getRelations()          { return state.relations; }
  function getDiscoveredFactions() { return state.discoveredFactions; }
  function getEnemyFaction()       { return state.enemyFactionId ? FACTIONS.find(f => f.id === state.enemyFactionId) || null : null; }

  function computeVisible() {
    const vis = new Set();
    const addReach = (c, r, range) => {
      vis.add(hexKey(c, r));
      bfsReach(c, r, range, () => true, () => false).forEach(h => vis.add(hexKey(h.c, h.r)));
    };
    Units.byOwner('player').forEach(u => addReach(u.c, u.r, u.sight || 2));
    Cities.getAll().filter(ci => ci.owner === 'player').forEach(ci => addReach(ci.c, ci.r, 3));
    return vis;
  }

  function updateExploration() {
    const vis = computeVisible();
    vis.forEach(k => state.exploredHexes.add(k));
    Cities.getAll().forEach(city => {
      if (!city.factionId || city.owner === 'player') return;
      const k = hexKey(city.c, city.r);
      if (vis.has(k) && !state.discoveredFactions.has(city.factionId)) {
        state.discoveredFactions.add(city.factionId);
        if (!state.relations[city.factionId]) state.relations[city.factionId] = 'neutral';
        const f = FACTIONS.find(f => f.id === city.factionId);
        if (f) {
          UI.toast(`ðŸ”­ Â¡FacciÃ³n descubierta: ${f.name}!`, 4000);
          UI.updateLeaderPanel(state.lord);
        }
      }
    });
    return vis;
  }

  function _spawnGarrison(city) {
    const types = Cities.getGarrisonTypes ? Cities.getGarrisonTypes(city) : ['militia', 'militia'];
    types.forEach(type => {
      const u = Units.spawn(type, city.c, city.r, city.owner);
      u.isGarrison = true;
    });
  }

  function _getLeaderHex() {
    const lu = Units.getLeaderUnit ? Units.getLeaderUnit() : null;
    return lu ? { c: lu.c, r: lu.r } : null;
  }

  function isLeaderWithArmy() {
    const army = getArmyUnits();
    if (!army.length) return false;
    const lh = _getLeaderHex();
    return !!(lh && lh.c === army[0].c && lh.r === army[0].r);
  }

  // Picks a free adjacent hex for a broken army (given by `owner`) to fall
  // back to â€” land, no other owner's units present. Null if boxed in.
  function _findRetreatHex(c, r, owner) {
    const options = neighbors(c, r, (nc, nr) => !GameMap.isWater(nc, nr))
      .filter(n => Units.getAllAt(n.c, n.r).every(u => u.owner === owner));
    if (!options.length) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  // Relocates a defeated army to a fallback hex and exhausts its turn.
  // Standalone so Phase 2 pursuit/morale can trigger a retreat outside moveArmy.
  function _executeRetreat(units, hex) {
    units.forEach(u => { u.c = hex.c; u.r = hex.r; u.moves = 0; });
  }

  function openDiplomacy() {
    const otherFactions = FACTIONS.filter(f =>
      f.id !== (state.lord && state.lord.id) && state.discoveredFactions.has(f.id)
    );
    UI.showDiplomacyPanel(otherFactions, state.relations);
  }

  function openLeaderDialog(factionId) {
    if (!state.discoveredFactions.has(factionId)) return;
    const kingdom = KINGDOMS.find(k => k.id === factionId);
    if (!kingdom) return;
    const syntheticLeader = { name: kingdom.name, title: `Ruler of ${kingdom.name}`, traits: [], skills: {} };
    const diplomaticTarget = Object.assign({}, kingdom, { leaders: [syntheticLeader] });
    const relation = state.relations[factionId] || 'neutral';
    UI.showLeaderDialog(diplomaticTarget, relation);
  }

  function setRelation(factionId, newRel, cost) {
    cost = cost || 0;
    if (cost > 0 && (state.resources.gold || 0) < cost) {
      UI.toast(`Necesitas ${cost} ðŸ’° para esta acciÃ³n.`); return;
    }
    if (cost > 0) state.resources.gold -= cost;
    state.relations[factionId] = newRel;
    const f = FACTIONS.find(f => f.id === factionId);
    const fname = f ? f.name : factionId;
    const suf = cost ? ` (-${cost}ðŸ’°)` : '';
    const msgs = {
      war:           `âš” Â¡Guerra declarada contra ${fname}!`,
      neutral:       `ðŸ•Š RelaciÃ³n normalizada con ${fname}.${suf}`,
      non_aggression:`ðŸ›¡ Pacto de No AgresiÃ³n con ${fname}.${suf}`,
      trade:         `ðŸ’¹ Tratado Comercial con ${fname}.${suf}`,
      alliance:      `ðŸ’™ Alianza Militar con ${fname}.${suf}`,
    };
    UI.toast(msgs[newRel] || `RelaciÃ³n cambiada con ${fname}.`, 4000);
    UI.updateHUD(state.resources, state.turn);
    UI.updateLeaderPanel(state.lord);
    UI.closeLeaderDialog();
    render();
  }

  function _resolveEvent(choice) {
    const eff = choice.effect || {};
    const res = state.resources;
    ['gold', 'food', 'wood', 'iron'].forEach(k => {
      if (eff[k]) res[k] = Math.max(0, (res[k] || 0) + eff[k]);
    });
    if (eff.popLoss) {
      Cities.getAll().filter(c => c.owner === 'player')
        .forEach(city => { city.pop = Math.max(10, (city.pop || 0) - eff.popLoss); });
    }
    if (eff.popGrowth) {
      Cities.getAll().filter(c => c.owner === 'player')
        .forEach(city => { city.pop = (city.pop || 0) + eff.popGrowth; });
    }
    if (eff.unitHpLoss) {
      Units.byOwner('player').forEach(u => {
        u.hp = Math.max(1, Math.floor(u.hp * (1 - eff.unitHpLoss / 100)));
      });
    }
    UI.updateHUD(state.resources, state.turn);
    UI.updateEmpirePanel(Cities.getAll(), GameMap.getPlayerNodes());
    if (choice.result) UI.toast(choice.result, 4000);
    render();
  }

  function init(lord) {
    state.lord      = lord || null;
    // Set starting resources from the chosen lord (each lord plays differently from turn 1)
    if (lord && lord.startingResources) {
      state.resources = { ...lord.startingResources };
    }

    // Show the game UI (was hidden while pre-game screen showed)
    document.getElementById('hud').style.display    = '';
    document.getElementById('layout').style.display = '';

    // Tint HUD logo with lord color
    if (lord) {
      const logo = document.querySelector('.hud-logo');
      logo.style.color = lord.color;
      logo.title = `${lord.name} â€” ${lord.title}`;
    }

    GameMap.init();
    Cities.init();
    Units.init();

    Renderer.init(document.getElementById('mapCanvas'));
    UI.init();

    const mapCanvas = document.getElementById('mapCanvas');
    mapCanvas.addEventListener('click', onMapClick);
    document.getElementById('end-turn-btn').addEventListener('click', endTurn);

    // Mouse wheel zoom (toward cursor)
    mapCanvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = mapCanvas.getBoundingClientRect();
      Renderer.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
      render();
    }, { passive: false });

    // Arrow-key camera pan (smooth via rAF inside Renderer)
    const PAN_DIRS = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down',
                       a:'left', d:'right', w:'up', s:'down' };
    document.addEventListener('keydown', e => {
      const dir = PAN_DIRS[e.key];
      if (dir) { e.preventDefault(); Renderer.setPanFlag(dir, true); }
    });
    document.addEventListener('keyup', e => {
      const dir = PAN_DIRS[e.key];
      if (dir) Renderer.setPanFlag(dir, false);
    });

    // Auto-select a random starting city
    state.phase = 'idle';
    const allCities = Cities.getAll();
    _onCityChosen(allCities[Math.floor(Math.random() * allCities.length)]);
  }

  function _onCityChosen(city) {
    // Player claims capital (lord's faction is separate from world kingdoms)
    Cities.setOwner(city.c, city.r, 'player');

    // All kingdoms become potential rivals (player is an independent lord, not one of them)
    const otherFactions = FACTIONS;

    // Sort remaining neutral cities by distance from player (furthest first)
    const playerPx = hexCenter(city.c, city.r);
    const sorted = Cities.getAll()
      .filter(ci => ci.owner === 'neutral')
      .map(ci => {
        const p = hexCenter(ci.c, ci.r);
        return { ci, d: Math.hypot(p.x - playerPx.x, p.y - playerPx.y) };
      })
      .sort((a, b) => b.d - a.d)
      .map(x => x.ci);

    // Enemy (first other faction) takes the 2 furthest cities
    const enemyFaction = otherFactions[0] || null;
    state.enemyFactionId = enemyFaction ? enemyFaction.id : null;
    let aiCity = null;
    sorted.slice(0, 2).forEach((ci, i) => {
      Cities.setOwner(ci.c, ci.r, 'enemy');
      if (enemyFaction) Cities.setFaction(ci.c, ci.r, enemyFaction.id);
      if (i === 0) aiCity = ci;
    });

    // Remaining 2 factions split the rest of the cities
    const neutralFactions = otherFactions.slice(1);
    sorted.slice(2).forEach((ci, i) => {
      const f = neutralFactions[i % neutralFactions.length];
      if (f) {
        Cities.setOwner(ci.c, ci.r, 'faction');
        Cities.setFaction(ci.c, ci.r, f.id);
      }
    });

    // Only the enemy faction is known at start; others discovered via exploration
    state.relations          = {};
    state.discoveredFactions = new Set();
    if (enemyFaction) {
      state.relations[enemyFaction.id] = 'war';
      state.discoveredFactions.add(enemyFaction.id);
    }

    // Spawn the lord as the commander unit at the capital
    const lu = Units.spawn('commander', city.c, city.r, 'player');
    lu.isLeader = true;

    // Spawn the lord's starting army at the capital
    if (state.lord && state.lord.startingUnits) {
      state.lord.startingUnits.forEach(type => {
        if (UNIT_TYPES[type]) Units.spawn(type, city.c, city.r, 'player');
      });
    }

    // Spawn garrison for all non-player cities
    Cities.getAll().filter(ci => ci.owner !== 'player').forEach(ci => _spawnGarrison(ci));

    state.phase         = 'idle';
    state.selectedGroup = [];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    state.reachable     = [];

    UI.updateHUD(state.resources, state.turn);
    UI.updateEmpirePanel(Cities.getAll(), GameMap.getPlayerNodes());
    UI.updateLeaderPanel(state.lord);
    UI.showIdle();

    Renderer.centerOn(city.c, city.r);
    const aiName = aiCity ? aiCity.name : '???';
    UI.toast(`${city.name} es tu capital. ${enemyFaction ? enemyFaction.name : 'El enemigo'} parte desde ${aiName}.`, 5000);
    render();
  }

  // â”€â”€ Click handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function onMapClick(e) {
    const rect = e.target.getBoundingClientRect();
    const cam  = Renderer.getCamera();
    const hex  = pixelToHex(e.clientX - rect.left, e.clientY - rect.top, Renderer.getScale(), cam.x, cam.y);
    if (!hex) return;

    const unit = Units.getAt(hex.c, hex.r);
    const city = Cities.getAt(hex.c, hex.r);

    // â”€â”€ City selection phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (state.phase === 'city-select') {
      if (city) _onCityChosen(city);
      return;
    }

    // â”€â”€ Army moving phase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (state.phase === 'army-moving') {
      const isReachable = state.reachable.some(h => h.c === hex.c && h.r === hex.r);
      if (isReachable) {
        moveArmy(hex.c, hex.r);
        render();
        return;
      }
      // Not reachable â€” cancel move, then fall through to re-select
      state.phase    = 'idle';
      state.reachable = [];
    }

    // â”€â”€ Player army â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (unit && unit.owner === 'player') {
      selectArmy(unit.c, unit.r);
      return;
    }

    // â”€â”€ Enemy army (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (unit && unit.owner === 'enemy') {
      const enemyArmy = Units.getAllAt(unit.c, unit.r).filter(u => u.owner === 'enemy');
      state.selectedGroup = [];
      state.selectedUnit  = enemyArmy[0] || null;
      state.selectedCity  = null;
      state.phase = 'idle';
      state.reachable = [];
      UI.showArmy(enemyArmy);
      render();
      return;
    }

    // â”€â”€ City â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Empty hex â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const allHere = Units.getAllAt(c, r).filter(u => u.owner === 'player');
    state.selectedGroup = allHere.map(u => u.id);
    state.selectedUnit  = null;
    state.selectedCity  = null;
    const cityHere = Cities.getAt(c, r);
    UI.showArmy(allHere, state.resources, cityHere, onRecruit);
    beginArmyMove();
  }

  const ARMY_MAX = 10;

  // â”€â”€ Recruit unit into army â”€â”€
  function onRecruit(type) {
    const army = getArmyUnits();
    if (!army.length) return;
    const { c, r } = army[0];
    const def = UNIT_TYPES[type];
    if (!def) return;

    if (Units.getAllAt(c, r).filter(u => u.owner === 'player').length >= ARMY_MAX) {
      UI.toast(`MÃ¡ximo ${ARMY_MAX} unidades por ejÃ©rcito.`); return;
    }

    const cost = def.cost || {};
    const canAf = Object.entries(cost).every(([k, v]) => (state.resources[k] || 0) >= v);
    if (!canAf) { UI.toast('Recursos insuficientes.'); return; }

    Object.entries(cost).forEach(([k, v]) => { state.resources[k] -= v; });

    const trainTime = def.trainTime || 0;
    if (trainTime > 0) {
      // Requires a player city at this hex to train
      const cityHere = Cities.getAt(c, r);
      if (!cityHere || cityHere.owner !== 'player') {
        Object.entries(cost).forEach(([k, v]) => { state.resources[k] += v; });
        UI.toast('Las unidades entrenadas requieren estar en una ciudad.');
        return;
      }
      cityHere.queue.push({ type: 'unit', key: type, turnsLeft: trainTime });
      UI.updateHUD(state.resources, state.turn);
      UI.toast(`${def.name} en entrenamiento â€” ${trainTime} turno${trainTime > 1 ? 's' : ''}.`);
      UI.showArmy(getArmyUnits(), state.resources, cityHere, onRecruit);
      render();
      return;
    }

    Units.spawn(type, c, r, 'player');
    state.selectedGroup = Units.getAllAt(c, r).filter(u => u.owner === 'player').map(u => u.id);
    UI.updateHUD(state.resources, state.turn);
    UI.toast(`${def.name} reclutado.`);
    UI.showArmy(getArmyUnits(), state.resources, Cities.getAt(c, r), onRecruit);
    render();
  }

  // â”€â”€ Capture city/resource when unit lands â”€â”€
  // Shared post-capture cleanup for player and AI captures.
  function _afterCityCapture(cityResult, city, isPlayer) {
    Units.getAllAt(city.c, city.r)
      .filter(u => u.isGarrison && u.owner === cityResult.prev)
      .forEach(u => Units.remove(u.id));
    if (isPlayer) {
      if (city.factionId && !state.discoveredFactions.has(city.factionId)) {
        state.discoveredFactions.add(city.factionId);
        if (!state.relations[city.factionId]) state.relations[city.factionId] = 'neutral';
        UI.updateLeaderPanel(state.lord);
      }
    } else {
      _spawnGarrison(city);
    }
    UI.updateHUD(state.resources, state.turn);
  }

  function tryCapture(unit) {
    const resResult = GameMap.processCapture(unit.c, unit.r, unit.owner);
    if (unit.owner === 'player' && resResult) {
      UI.toast(`${RESOURCE_DEF[resResult.type].icon} Recurso capturado`);
      UI.updateHUD(state.resources, state.turn);
    }
    const targetCity = Cities.getAt(unit.c, unit.r);
    if (!targetCity || targetCity.owner === unit.owner) return;

    if (unit.owner === 'player') {
      const captureStyle = (state.lord && state.lord.captureStyle) || 'standard';
      const options = CAPTURE_MENUS[captureStyle];
      if (!options) {
        _executeCapture('occupy', targetCity.c, targetCity.r);
      } else {
        UI.showCaptureDecision(targetCity, options, { c: unit.c, r: unit.r });
      }
    } else {
      const cityResult = Cities.captureAt(unit.c, unit.r, unit.owner);
      if (cityResult) _afterCityCapture(cityResult, Cities.getAt(unit.c, unit.r), false);
    }
  }

  function executeCaptureDecision(hex, decisionId) {
    _executeCapture(decisionId, hex.c, hex.r);
    UI.closeCaptureDecision();
    render();
  }

  function _executeCapture(decisionId, c, r) {
    const city = Cities.getAt(c, r);
    if (!city) return;
    if (decisionId === 'occupy') {
      const cityResult = Cities.captureAt(c, r, 'player');
      if (cityResult) {
        _afterCityCapture(cityResult, city, true);
        _spawnGarrison(city);
        UI.toast(`🏰 ${cityResult.name} conquistada.`);
      }
    } else if (decisionId === 'loot') {
      const loot = Cities.lootCity(c, r);
      if (loot) {
        Object.entries(loot).forEach(([k, v]) => { state.resources[k] = (state.resources[k] || 0) + v; });
        UI.toast(`💰 Saqueo: +${loot.gold}💰 +${loot.food}🌾. La ciudad sufre.`, 4000);
        UI.updateHUD(state.resources, state.turn);
      }
    } else if (decisionId === 'infect') {
      const cityResult = Cities.infectCity(c, r);
      if (cityResult) {
        _afterCityCapture(cityResult, city, true);
        UI.toast(`☠ ${cityResult.name} ha sido infectada. La plaga comienza a corromperla...`, 5000);
      }
    }
  }

  function _checkVictory() {
    const checkId = state.lord && state.lord.victoryCondition && state.lord.victoryCondition.checkId;
    if (!checkId) return;
    const check = VICTORY_CHECKS[checkId];
    if (check && check()) UI.showVictoryScreen(state.lord);
  }

  function getArmyUnits() {
    return state.selectedGroup
      .map(id => Units.getAll().find(u => u.id === id))
      .filter(Boolean);
  }

  // â”€â”€ Army movement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function beginArmyMove() {
    const allUnits     = getArmyUnits();
    const anyMovable   = allUnits.some(u => u.moves > 0);
    const anyExhausted = allUnits.some(u => u.moves === 0);

    if (!anyMovable) {
      state.phase = 'idle';
      state.reachable = [];
      _refreshArmyPanel(allUnits);
      render();
      return;
    }

    if (anyExhausted) {
      state.phase = 'idle';
      state.reachable = [];
      _refreshArmyPanel(allUnits);
      render();
      return;
    }

    // All units have moves â€” enter army-move mode
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

  // Refresh army panel with current context
  function _refreshArmyPanel(units) {
    const u = units[0];
    const city = u ? Cities.getAt(u.c, u.r) : null;
    UI.showArmy(units, state.resources, city, onRecruit);
  }

  // â”€â”€ Extract single unit to move alone â”€â”€â”€â”€â”€â”€â”€
  function splitUnit(unitId) {
    const unit = Units.getAll().find(u => u.id === unitId);
    if (!unit || unit.moves === 0) return;
    state.selectedGroup = [unitId];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    _refreshArmyPanel([unit]);
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

    const alreadyThere = Units.getAllAt(next.c, next.r).filter(u => u.owner === 'player').length;
    if (alreadyThere > 0 && alreadyThere + movable.length > ARMY_MAX) {
      UI.toast(`FusiÃ³n bloqueada â€” superarÃ­a el mÃ¡ximo de ${ARMY_MAX} unidades.`);
      return;
    }

    // Check for enemy army at target hex before moving
    const enemiesAtTarget = Units.getAllAt(next.c, next.r).filter(u => u.owner !== 'player');
    if (enemiesAtTarget.length > 0) {
      const terrain = TERRAIN_MAP[next.r]?.[next.c] || 'plains';

      // Snapshot HP before battle (resolveBattle clones internally)
      const attSnap = movable.map(u => ({ id: u.id, type: u.type, hp: u.hp }));
      const defSnap = enemiesAtTarget.map(u => ({ id: u.id, type: u.type, hp: u.hp }));

      // Leader commander bonus: +ATK if leader unit is on this hex
      const _lh = _getLeaderHex();
      const isLeaderHere = _lh && _lh.c === anchor.c && _lh.r === anchor.r;
      const atkBonus     = isLeaderHere ? _traitEffect('commanderAtkBonus', 0) : 0;

      const result = Combat.resolveBattle(movable, enemiesAtTarget, terrain,
        { attackerAtkMult: 1 + atkBonus });

      // Apply HP results to survivors
      result.survivingAtt.forEach(({ id, hp }) => {
        const u = Units.getAll().find(u => u.id === id);
        if (u) u.hp = hp;
      });
      result.survivingDef.forEach(({ id, hp }) => {
        const u = Units.getAll().find(u => u.id === id);
        if (u) u.hp = hp;
      });

      // Remove killed units
      const deadAttIds = movable.filter(u => !result.survivingAtt.find(s => s.id === u.id)).map(u => u.id);
      const deadDefIds = enemiesAtTarget.filter(u => !result.survivingDef.find(s => s.id === u.id)).map(u => u.id);
      [...deadAttIds, ...deadDefIds].forEach(id => Units.remove(id));

      // Award XP to survivors (estratega trait boosts XP mult, cruel adds per-kill bonus)
      const xpMult    = _traitEffect('combatXpMult', 1.0);
      const killBonus = _traitEffect('killXpBonus', 0);
      if (result.survivingAtt.length > 0) {
        const attKills = defSnap.length - result.survivingDef.length;
        const baseXP   = result.winner === 'attacker' ? 60 : 15;
        const xpEach   = Math.round((baseXP + attKills * (20 + killBonus)) / result.survivingAtt.length * xpMult);
        const levelUps = [];
        result.survivingAtt.forEach(s => {
          const u = Units.getAll().find(u => u.id === s.id);
          if (u && Units.awardXP(s.id, xpEach) && u.owner === 'player')
            levelUps.push(UNIT_TYPES[u.type].name);
        });
        if (levelUps.length) UI.toast('â˜… Â¡Nivel! ' + levelUps.join(', '), 3500);
      }
      if (result.survivingDef.length > 0) {
        const defKills = attSnap.length - result.survivingAtt.length;
        const baseXP   = result.winner === 'defender' ? 60 : 15;
        const xpEach   = Math.round((baseXP + defKills * 20) / result.survivingDef.length);
        result.survivingDef.forEach(s => Units.awardXP(s.id, xpEach));
      }

      // Sort surviving defenders into garrison (defends the city tile, never
      // retreats) vs field units (can fall back to an adjacent hex).
      const survivingDefUnits = result.survivingDef.map(s => Units.getAll().find(u => u.id === s.id)).filter(Boolean);
      const defGarrison = survivingDefUnits.filter(u => u.isGarrison);
      const defField     = survivingDefUnits.filter(u => !u.isGarrison);
      const survivingAttUnits = result.survivingAtt.map(s => Units.getAll().find(u => u.id === s.id)).filter(Boolean);

      let defRetreated = false, attRetreated = false;
      let defenderHoldsHex = defGarrison.length > 0;

      if (result.winner === 'attacker') {
        if (result.defBroken && defField.length > 0) {
          const hex = _findRetreatHex(next.c, next.r, defField[0].owner);
          if (hex) { _executeRetreat(defField, hex); defRetreated = true; }
          else defenderHoldsHex = true;
        }
      } else if (result.attBroken && survivingAttUnits.length > 0) {
        const hex = _findRetreatHex(anchor.c, anchor.r, 'player');
        if (hex) { _executeRetreat(survivingAttUnits, hex); attRetreated = true; }
      }

      // Leader risk: if present and battle lost, 35% chance of retreating to nearest city
      if (isLeaderHere && result.winner === 'defender') {
        if (Math.random() < 0.35) {
          const lu = Units.getLeaderUnit();
          if (lu) {
            const safeCities = Cities.getAll().filter(ci => ci.owner === 'player');
            if (safeCities.length > 0) {
              const nearest = safeCities.reduce((best, ci) => {
                const d = Math.hypot(ci.c - lu.c, ci.r - lu.r);
                return d < best.d ? { ci, d } : best;
              }, { ci: safeCities[0], d: Infinity });
              lu.c = nearest.ci.c; lu.r = nearest.ci.r;
            }
          }
          UI.toast(`â˜  ${state.lord ? state.lord.name : 'El general'} ha sido rechazado y se retira.`, 5000);
        }
      }

      // Record battle event in the log
      UI.addBattleEvent({
        turn: state.turn,
        terrain,
        winner: result.winner,
        attBroken: result.attBroken,
        defBroken: result.defBroken,
        attRetreated,
        defRetreated,
        casualties: result.casualties,
        attackers: attSnap.map(u => {
          const def = UNIT_TYPES[u.type];
          return { name: def.name, icon: def.icon, maxHp: def.hp, startHp: u.hp,
                   endHp: result.survivingAtt.find(s => s.id === u.id)?.hp ?? 0 };
        }),
        defenders: defSnap.map(u => {
          const def = UNIT_TYPES[u.type];
          return { name: def.name, icon: def.icon, maxHp: def.hp, startHp: u.hp,
                   endHp: result.survivingDef.find(s => s.id === u.id)?.hp ?? 0 };
        }),
      });

      if (result.winner === 'attacker' && !defenderHoldsHex) {
        // Advance victorious units onto the captured/cleared hex
        movable.filter(u => Units.getAll().find(uu => uu.id === u.id)).forEach(u => {
          u.c = next.c; u.r = next.r;
          u.moves = Math.max(0, u.moves - 1);
        });
        // Leader unit stays at its position (it's a physical unit that moves independently)
        tryCapture({ c: next.c, r: next.r, owner: 'player' });
        UI.toast(defRetreated ? 'âš” Â¡Victoria! El enemigo se retira.' : 'âš” Â¡Victoria! EjÃ©rcito enemigo aniquilado.');
      } else if (result.winner === 'attacker') {
        // Won the fight but the defender still holds the hex (garrison or boxed-in retreat)
        movable.forEach(u => { u.moves = 0; });
        UI.toast('âš” Victoria tÃ¡ctica â€” el enemigo resiste, sin vÃ­a de retirada.');
      } else {
        movable.forEach(u => { u.moves = 0; });
        UI.toast(attRetreated ? 'â˜  Derrota. Tu ejÃ©rcito se retira.' : 'â˜  Derrota. Tu ejÃ©rcito ha sido aniquilado.');
      }

      state.selectedGroup = state.selectedGroup.filter(id => Units.getAll().some(u => u.id === id));
      state.phase    = 'idle';
      state.reachable = [];
      _refreshArmyPanel(getArmyUnits());
      return;
    }

    movable.forEach(u => {
      const result = Units.move(u, next.c, next.r);
      if (result.result === 'moved') anyMoved = true;
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
      _refreshArmyPanel(army);
    }
  }

  // â”€â”€ Deselect / close panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function deselect() {
    state.selectedGroup = [];
    state.selectedUnit  = null;
    state.selectedCity  = null;
    state.phase    = 'idle';
    state.reachable = [];
    UI.showIdle();
    render();
  }

  // â”€â”€ Raise new army from city â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function raiseArmy(type) {
    const city = state.selectedCity;
    if (!city) return;
    const def  = UNIT_TYPES[type];
    if (!def)  return;

    const cost = def.cost || {};
    if (!Object.entries(cost).every(([k, v]) => (state.resources[k] || 0) >= v)) {
      UI.toast('Recursos insuficientes.'); return;
    }

    Object.entries(cost).forEach(([k, v]) => { state.resources[k] -= v; });
    UI._closeRaiseArmyModal();

    const trainTime = def.trainTime || 0;
    if (trainTime > 0) {
      city.queue.push({ type: 'unit', key: type, turnsLeft: trainTime });
      UI.updateHUD(state.resources, state.turn);
      UI.toast(`${def.name} en entrenamiento â€” ${trainTime} turno${trainTime > 1 ? 's' : ''}.`);
      UI.showCity(city, state.resources, onBuild, onTrain);
      render();
      return;
    }

    Units.spawn(type, city.c, city.r, 'player');
    UI.updateHUD(state.resources, state.turn);
    UI.toast(`EjÃ©rcito levantado â€” ${def.name}`);
    state.selectedCity = null;
    selectArmy(city.c, city.r);
    render();
  }

  // â”€â”€ Disband army â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function disbandGroup() {
    const units = getArmyUnits();
    units.forEach(u => Units.remove(u.id));
    state.selectedGroup = [];
    state.phase = 'idle';
    state.reachable = [];
    UI.showIdle();
    UI.toast(`EjÃ©rcito disuelto (${units.length} unidad${units.length !== 1 ? 'es' : ''}).`);
    render();
  }

  // â”€â”€ Nearest player army to a city â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function armyNearCity(city, range = 2) {
    return Units.byOwner('player').find(u =>
      Math.max(Math.abs(u.c - city.c), Math.abs(u.r - city.r)) <= range
    );
  }

  // â”€â”€ Build building â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function onBuild(key) {
    if (!state.selectedCity) return;
    const result = Cities.buildBuilding(state.selectedCity, key, state.resources);
    UI.toast(result.msg);
    if (result.ok) Renderer.markTerrainDirty();
    UI.updateHUD(state.resources, state.turn);
    UI.updateEmpirePanel(Cities.getAll(), GameMap.getPlayerNodes());
    UI.showCity(state.selectedCity, state.resources, onBuild, onTrain);
    render();
  }

  // â”€â”€ Train unit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function onTrain(type) {
    if (!state.selectedCity) return;
    const city = state.selectedCity;
    const result = Cities.trainUnit(city, type, state.resources);
    UI.toast(result.msg);
    UI.updateHUD(state.resources, state.turn);
    UI.showCity(city, state.resources, onBuild, onTrain);
    render();
  }

  // â”€â”€ End turn â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function endTurn() {
    Units.resetMoves('player');
    GameMap.collectIncome(Units.getAll(), Cities.getAll(), state.resources);
    const maintMsgs = GameMap.deductMaintenance(Units.getAll(), state.resources);
    // Building upkeep
    Cities.getAll().filter(c => c.owner === 'player').forEach(city => {
      Object.entries(Cities.getTotalBuildingMaintenance(city)).forEach(([k, v]) => {
        state.resources[k] = Math.max(0, (state.resources[k] || 0) - v);
      });
    });
    const healMsgs  = GameMap.healUnits(Units.getAll(), Cities.getAll());

    // Spawn trained units + process infection stage advances
    const { spawns, infectionEvents } = Cities.processTurnEnd();
    spawns.forEach(s => {
      const spawnHex = findSpawnHex(s.c, s.r, s.owner);
      if (spawnHex) Units.spawn(s.type, spawnHex.c, spawnHex.r, s.owner);
    });
    infectionEvents.forEach(ev => {
      const stageLabels = ['', 'Recién Infectada', 'Corrompida', '☠ Completamente Infectada'];
      UI.toast(`☠ ${ev.name}: ${stageLabels[ev.stage] || `Etapa ${ev.stage}`}`, 5000);
    });

    // Passive XP per turn for all player units (staying in the field)
    Units.byOwner('player').forEach(u => Units.awardXP(u.id, 3));

    // Trait: Mercader â€” +gold per player city
    const goldPerCity = _traitEffect('goldPerCity', 0);
    if (goldPerCity > 0) {
      const n = Cities.getAll().filter(c => c.owner === 'player').length;
      state.resources.gold = (state.resources.gold || 0) + goldPerCity * n;
    }

    // Trait: Piadoso â€” +pop growth per player city
    const popBonus = _traitEffect('popGrowthBonus', 0);
    if (popBonus > 0) {
      Cities.getAll().filter(c => c.owner === 'player').forEach(city => { city.pop += popBonus; });
    }

    // Leader city bonus: +gold and +pop when leader unit is in or adjacent to a player city
    const leaderUnit = Units.getLeaderUnit ? Units.getLeaderUnit() : null;
    if (leaderUnit) {
      Cities.getAll().filter(ci => ci.owner === 'player').forEach(city => {
        if (city.c === leaderUnit.c && city.r === leaderUnit.r) {
          state.resources.gold = (state.resources.gold || 0) + 5;
          city.pop = (city.pop || 0) + 5;
        } else if (neighbors(leaderUnit.c, leaderUnit.r).some(n => n.c === city.c && n.r === city.r)) {
          state.resources.gold = (state.resources.gold || 0) + 2;
        }
      });
    }

    // Leader ages one year per turn
    if (state.lord) state.lord.age = (state.lord.age || 30) + 1;

    // Trade / alliance income: +3 gold per active partner
    const tradeGold = Object.entries(state.relations)
      .filter(([fid, rel]) => (rel === 'trade' || rel === 'alliance') && state.discoveredFactions.has(fid))
      .length * 3;
    if (tradeGold > 0) state.resources.gold = (state.resources.gold || 0) + tradeGold;

    AI.takeTurn();

    state.turn++;
    state.phase     = 'idle';
    state.reachable = [];
    state.selectedUnit = null;

    // Clean up dead units from army selection
    state.selectedGroup = state.selectedGroup.filter(id => Units.getAll().some(u => u.id === id));

    UI.updateHUD(state.resources, state.turn);
    UI.updateEmpirePanel(Cities.getAll(), GameMap.getPlayerNodes());
    if (state.selectedGroup.length > 0) {
      _refreshArmyPanel(getArmyUnits());
    } else {
      UI.showIdle();
    }

    let msg = `Turno ${state.turn} â€” ingresos cobrados`;
    if (maintMsgs.length > 0) msg += `. âš ï¸ ${maintMsgs[0]}`;
    if (healMsgs.length > 0)  msg += `. ðŸ’Š ${healMsgs[0]}`;
    UI.toast(msg, 3500);
    render();

    // Victory check
    _checkVictory();

    // Random event (25% chance per turn, delayed so toast is visible first)
    if (Math.random() < 0.25 && typeof EVENTS !== 'undefined' && EVENTS.length) {
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      setTimeout(() => UI.showEvent(ev, _resolveEvent), 2000);
    }
  }

  // Spawn at city hex (stacking allowed â€” joins existing army)
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

  // BFS pathfinding â€” returns array of hexes from start to goal, or null
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
      phase:         state.phase,
      leaderHex:     _getLeaderHex(),
      visibleHexes:  updateExploration(),
      exploredHexes: state.exploredHexes,
    });
  }

  function getHouse() { return null; }

  return {
    init, disbandGroup, armyNearCity, deselect, splitUnit, raiseArmy,
    getPlayerColor, getLeader, getFaction, getHouse, isLeaderWithArmy,
    getRelations, getDiscoveredFactions, getEnemyFaction,
    openDiplomacy, openLeaderDialog, setRelation,
    executeCaptureDecision,
  };
})();

// Boot â€” show kingdom/house/leader screen first, then init the game
window.addEventListener('DOMContentLoaded', () => {
  PreGame.show((kingdom, house, leader) => Game.init(kingdom, house, leader));
});

