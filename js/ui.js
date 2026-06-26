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
    resKeys.forEach(t => earned[t] = 0);

    const { player } = zones;
    RESOURCE_SPAWNS.forEach(({ c, r, type }) => {
      if (player.has(hexKey(c, r))) earned[type] += RESOURCE_DEF[type].income;
    });
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

    // Maintenance costs
    const maint = GameMap.getTotalMaintenance(Units.getAll());
    const net   = {};
    resKeys.forEach(t => net[t] = earned[t] - (maint[t] || 0));

    const maintStr = Object.entries(maint).filter(([, v]) => v > 0)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');

    cont.innerHTML = `
      <div class="section-label">Income per turn</div>
      ${resKeys.map(t => {
        const gross = earned[t];
        const netVal = net[t];
        const active = gross > 0 || (maint[t] || 0) > 0;
        const cls = netVal < 0 ? 'deficit' : netVal > 0 ? 'active' : '';
        return `<div class="res-row ${cls}">
          <span class="icon">${RESOURCE_DEF[t].icon}</span>
          <span class="label">${RESOURCE_DEF[t].label}</span>
          <span class="val">${active ? (netVal >= 0 ? '+' : '') + netVal + '/turn' : '—'}</span>
        </div>`;
      }).join('')}
      ${maintStr ? `<div class="maint-summary">⚔️ Upkeep: ${maintStr}/turn</div>` : ''}
      <div class="panel-hint" style="margin-top:6px;font-size:10px">Shift+click units to form a group</div>
    `;
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

    // Maintenance line
    const maint = def.maintenance;
    const maintStr = Object.entries(maint)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');

    document.getElementById('unit-stats').innerHTML += `
      <div class="divider"></div>
      <div class="maint-row">⚔️ Upkeep: <strong>${maintStr}/turn</strong></div>
    `;

    // Actions (player units only)
    const actEl = document.getElementById('unit-actions');
    if (isPlayer) {
      actEl.innerHTML = unit.moves > 0
        ? `<button class="action-btn primary" onclick="Game.beginMove()">Move Unit →</button>`
        : `<button class="action-btn" disabled>No moves remaining</button>`;
      actEl.innerHTML += `<button class="action-btn danger" onclick="Game.disbandUnit()">Disband Unit</button>`;
      actEl.innerHTML += `<div class="panel-hint" style="margin-top:6px;font-size:10px">Shift+click to add to group</div>`;
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

  // ── Group panel ──────────────────────────────
  function showGroup(units) {
    showPanel('panel-group');

    const movable = units.filter(u => u.moves > 0).length;
    const totalMaint = {};
    units.forEach(u => {
      const m = UNIT_TYPES[u.type].maintenance;
      Object.entries(m).forEach(([k, v]) => totalMaint[k] = (totalMaint[k] || 0) + v);
    });
    const maintStr = Object.entries(totalMaint)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');

    document.getElementById('group-info').innerHTML = `
      <div class="group-header-row">
        <span class="group-count">${units.length} unit${units.length !== 1 ? 's' : ''}</span>
        <span class="group-movable">${movable} can move</span>
      </div>
      <div class="group-unit-list">
        ${units.map(u => {
          const def = UNIT_TYPES[u.type];
          const hpPct = Math.round((u.hp / u.maxHp) * 100);
          const exhausted = u.moves === 0;
          return `<div class="group-unit-row ${exhausted ? 'exhausted' : ''}">
            <span class="group-unit-icon">${def.icon}</span>
            <div class="group-unit-info">
              <div class="group-unit-name">${def.name}</div>
              <div class="group-unit-hp-bar">
                <div class="group-unit-hp-fill" style="width:${hpPct}%;background:${hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040'}"></div>
              </div>
            </div>
            <div class="group-unit-moves">
              ${Array.from({length: u.maxMoves}, (_, i) =>
                `<div class="gpip ${i < u.moves ? 'on' : ''}"></div>`
              ).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
      ${maintStr ? `<div class="maint-summary">⚔️ Group upkeep: ${maintStr}/turn</div>` : ''}
    `;

    document.getElementById('group-actions').innerHTML = `
      ${movable > 0
        ? `<button class="action-btn primary" onclick="Game.beginGroupMove()">Move Group →</button>`
        : `<button class="action-btn" disabled>No moves remaining</button>`}
      <button class="action-btn" onclick="Game.clearGroup()">Deselect Group</button>
      <button class="action-btn danger" onclick="Game.disbandGroup()">Disband Group</button>
      <div class="panel-hint" style="margin-top:6px;font-size:10px">Shift+click units to add/remove</div>
    `;
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

  return { showPanel, showIdle, showUnit, showCity, showGroup, updateHUD, toast };
})();
