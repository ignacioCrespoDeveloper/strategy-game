// =============================================
//  ui.js — panel rendering (unit, city, idle)
// =============================================

const UI = (() => {
  function showPanel(id) {
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // ── Idle panel ──────────────────────────────
  function showIdle(resources) {
    showPanel('panel-idle');
    const zones  = GameMap.getZones(Units.getAll());
    const cont   = document.getElementById('controlled-resources');
    const resKeys = Object.keys(RESOURCE_DEF);
    const earned  = {};

    // Count what we earn per turn from controlled hexes
    Object.entries(resources).forEach(([k]) => earned[k] = 0);
    resKeys.forEach(t => earned[t] = 0);

    const { player } = zones;
    // hex resources
    RESOURCE_SPAWNS.forEach(({ c, r, type }) => {
      if (player.has(hexKey(c, r))) earned[type] += RESOURCE_DEF[type].income;
    });
    // building bonuses
    Cities.getAll().filter(ci => ci.owner === 'player').forEach(ci => {
      const bKeys = Object.keys(BUILDING_TYPES);
      ci.buildings.forEach((lvl, i) => {
        if (lvl === 0) return;
        const k = bKeys[i];
        if (k === 'market') earned.gold += lvl * 2;
        if (k === 'farm')   earned.food += lvl * 2;
        if (k === 'forge')  earned.iron += lvl;
      });
    });

    cont.innerHTML = resKeys.map(t => {
      const active = earned[t] > 0;
      return `<div class="res-row ${active ? 'active' : ''}">
        <span class="icon">${RESOURCE_DEF[t].icon}</span>
        <span class="label">${RESOURCE_DEF[t].label}</span>
        <span class="val">${active ? '+' + earned[t] + '/turn' : '—'}</span>
      </div>`;
    }).join('');
  }

  // ── Unit panel ──────────────────────────────
  function showUnit(unit) {
    showPanel('panel-unit');
    const def = UNIT_TYPES[unit.type];
    const isPlayer = unit.owner === 'player';

    document.getElementById('unit-panel-title').textContent =
      isPlayer ? 'Your Unit' : 'Enemy Unit';

    const hpPct    = Math.round((unit.hp / unit.maxHp) * 100);
    const atkPct   = Math.round((unit.atk / 100) * 100);
    const defPct   = Math.round((unit.def / 100) * 100);
    const movesPct = Math.round((unit.maxMoves / 5) * 100);

    document.getElementById('unit-stats').innerHTML = `
      <div class="unit-portrait">
        <div class="unit-icon-big ${isPlayer ? '' : 'enemy'}">${def.icon}</div>
        <div>
          <div class="unit-name">${def.name}</div>
          <div class="unit-type">${isPlayer ? 'Allied' : 'Enemy'} · ${unit.type}</div>
        </div>
      </div>

      <div class="stat-block">
        ${statRow('HP',    hpPct,    unit.hp + ' / ' + unit.maxHp, 'bar-hp')}
        ${statRow('Attack', Math.min(atkPct, 100), unit.atk, 'bar-atk')}
        ${statRow('Defense', Math.min(defPct, 100), unit.def, 'bar-def')}
        ${statRow('Speed', Math.min(movesPct, 100), unit.maxMoves + ' hex/turn', 'bar-moves')}
      </div>

      <div class="moves-pips">
        <span class="label">Moves left</span>
        ${Array.from({ length: unit.maxMoves }, (_, i) =>
          `<div class="pip ${i < unit.moves ? 'active' : 'used'}"></div>`
        ).join('')}
      </div>

      <div class="ability-tags">
        ${def.abilities.map(a => `<span class="tag">${a}</span>`).join('')}
        ${unit.moves === 0 ? '<span class="tag red">Exhausted</span>' : ''}
      </div>

      <div class="divider"></div>
      <div class="panel-hint" style="font-size:11px">${def.desc}<br>
        Sight: ${def.sight} hex${def.sight !== 1 ? 'es' : ''}
      </div>
    `;

    // Actions (player units only)
    const actEl = document.getElementById('unit-actions');
    if (isPlayer) {
      actEl.innerHTML = unit.moves > 0
        ? `<button class="action-btn primary" onclick="Game.beginMove()">Move Unit →</button>`
        : `<button class="action-btn" disabled>No moves remaining</button>`;
      actEl.innerHTML += `<button class="action-btn danger" onclick="Game.disbandUnit()">Disband Unit</button>`;
    } else {
      actEl.innerHTML = '';
    }
  }

  function statRow(label, pct, val, cls) {
    return `<div class="stat-row">
      <span class="stat-label">${label}</span>
      <div class="stat-bar-wrap">
        <div class="stat-bar ${cls}" style="width:${Math.max(2, pct)}%"></div>
      </div>
      <span class="stat-val">${val}</span>
    </div>`;
  }

  // ── City panel ──────────────────────────────
  function showCity(city, resources, onBuild, onTrain) {
    showPanel('panel-city');
    document.getElementById('city-panel-title').textContent =
      city.owner === 'player' ? `🏰 ${city.name}` :
      city.owner === 'enemy'  ? `⚔️ ${city.name} (Enemy)` :
                                `🏰 ${city.name} (Neutral)`;

    const ownerLabel = city.owner === 'player' ? 'Yours' :
                       city.owner === 'enemy'  ? 'Enemy' : 'Neutral';

    document.getElementById('city-info').innerHTML = `
      <div class="city-portrait">
        <div class="city-icon-big">🏰</div>
        <div>
          <div class="city-name">${city.name}</div>
          <div class="city-owner">${ownerLabel}</div>
        </div>
      </div>
      ${city.queue.length ? city.queue.map(q => `
        <div class="queue-row">
          <span class="queue-icon">${UNIT_TYPES[q.key]?.icon || '🔨'}</span>
          <span class="queue-label">Training ${UNIT_TYPES[q.key]?.name || q.key}</span>
          <span class="queue-turns">${q.turnsLeft} turn${q.turnsLeft > 1 ? 's' : ''}</span>
        </div>`).join('') : ''}
    `;

    const container = document.getElementById('city-build-list');

    if (city.owner !== 'player') {
      container.innerHTML = '<p class="panel-hint">Capture this city to manage it.</p>';
      return;
    }

    const bKeys = Object.keys(BUILDING_TYPES);
    let html = '<div class="section-label">Buildings</div>';

    bKeys.forEach((key, i) => {
      const def = BUILDING_TYPES[key];
      const lvl = city.buildings[i];
      const atMax = lvl >= def.maxLevel;
      const nextCost = atMax ? null : def.cost[lvl];
      const canAfford = nextCost ? Object.entries(nextCost).every(([k, v]) => (resources[k] || 0) >= v) : false;
      const costStr = nextCost ? formatCost(nextCost) : '';

      html += `
        <div class="building-row">
          <span class="building-icon">${def.icon}</span>
          <div class="building-info">
            <div class="building-name">${def.name} ${lvl > 0 ? '<span class="building-level">Lv.' + lvl + '</span>' : ''}</div>
            <div class="building-desc">${lvl > 0 ? def.effect[lvl - 1] : def.desc}</div>
          </div>
        </div>
        ${atMax ? '' : `
        <button class="build-btn" onclick="UI._onBuild('${key}')" ${!canAfford ? 'disabled title="Not enough resources"' : ''}>
          <span class="btn-icon">${lvl === 0 ? '➕' : '⬆️'}</span>
          <span class="btn-label">${lvl === 0 ? 'Build' : 'Upgrade'}<span class="btn-sub">${def.name} → Lv.${lvl + 1}: ${def.effect[lvl]}</span></span>
          <span class="btn-cost ${canAfford ? '' : 'unaffordable'}">${costStr}</span>
        </button>`}
      `;
    });

    // Recruit units (needs barracks)
    const barrIdx = bKeys.indexOf('barracks');
    const barrLvl = city.buildings[barrIdx];
    if (barrLvl > 0) {
      html += '<div class="divider"></div><div class="section-label">Train Units</div>';
      const unlocked = BARRACKS_UNLOCK[barrLvl] || [];
      unlocked.forEach(uType => {
        const uDef = UNIT_TYPES[uType];
        const cost = uDef.cost;
        const canA = Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
        html += `
          <button class="build-btn" onclick="UI._onTrain('${uType}')" ${!canA ? 'disabled' : ''}>
            <span class="btn-icon">${uDef.icon}</span>
            <span class="btn-label">${uDef.name}<span class="btn-sub">${uDef.desc}</span></span>
            <span class="btn-cost ${canA ? '' : 'unaffordable'}">${formatCost(cost)}</span>
          </button>`;
      });
    } else {
      html += '<div class="divider"></div><p class="panel-hint" style="font-size:11px">Build a Barracks to train units.</p>';
    }

    container.innerHTML = html;

    // Store callbacks
    UI._onBuild = onBuild;
    UI._onTrain = onTrain;
  }

  function formatCost(cost) {
    const icons = { gold: '💰', iron: '⚙️', food: '🌾', wood: '🌲' };
    return Object.entries(cost).map(([k, v]) => `${icons[k] || ''}${v}`).join(' ');
  }

  function updateHUD(resources, turn) {
    document.getElementById('r-gold').textContent = resources.gold  || 0;
    document.getElementById('r-iron').textContent = resources.iron  || 0;
    document.getElementById('r-food').textContent = resources.food  || 0;
    document.getElementById('r-wood').textContent = resources.wood  || 0;
    document.getElementById('turn-num').textContent = turn;
  }

  function toast(msg, duration = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  return { showPanel, showIdle, showUnit, showCity, updateHUD, toast };
})();
