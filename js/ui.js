// =============================================
//  ui.js — panel rendering (bottom panel)
// =============================================

const UI = (() => {

  function showPanel(id) {
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('active'));
    const bp = document.getElementById('bottom-panel');
    if (id === 'panel-idle') {
      bp.classList.remove('visible');
    } else {
      document.getElementById(id).classList.add('active');
      bp.classList.add('visible');
    }
  }

  // ── Idle: hide the panel ────────────────────
  function showIdle() {
    showPanel('panel-idle');
  }

  // ── Unit panel ──────────────────────────────
  function showUnit(unit) {
    const def      = UNIT_TYPES[unit.type];
    const isPlayer = unit.owner === 'player';
    const hpPct    = Math.round((unit.hp / unit.maxHp) * 100);
    const hpColor  = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';

    // Portrait
    document.getElementById('bp-unit-portrait').innerHTML = `
      <div class="bp-icon ${isPlayer ? 'player' : 'enemy'}">${def.icon}</div>
      <div class="bp-port-name">${def.name}</div>
      <div class="bp-port-sub">${isPlayer ? 'Allied' : 'Enemy'}</div>
      <div class="bp-hp-mini">
        <div class="bp-hp-fill" style="width:${hpPct}%;background:${hpColor}"></div>
      </div>
      <div class="bp-port-stat">${unit.hp} / ${unit.maxHp} HP</div>
    `;

    // Stats
    document.getElementById('bp-unit-stats').innerHTML = `
      ${bpBar('HP',      unit.hp,        unit.maxHp, 'bp-bar-hp')}
      ${bpBar('Attack',  unit.atk,       100,        'bp-bar-atk')}
      ${bpBar('Defense', unit.def,       100,        'bp-bar-def')}
      ${bpBar('Speed',   unit.maxMoves,  5,          'bp-bar-spd')}
      <div class="bp-pips" style="margin-top:6px">
        <span class="bp-pips-label">Moves</span>
        ${Array.from({length: unit.maxMoves}, (_, i) =>
          `<div class="bpip ${i < unit.moves ? 'on' : ''}"></div>`
        ).join('')}
      </div>
      <div class="bp-tags">
        ${def.abilities.map(a => `<span class="tag">${a}</span>`).join('')}
        ${unit.moves === 0 ? '<span class="tag red">Exhausted</span>' : ''}
      </div>
      <div class="bp-desc">${def.desc} · Sight: ${def.sight} hex${def.sight !== 1 ? 'es' : ''}</div>
    `;

    // Actions
    const maint = def.maintenance;
    const maintStr = Object.entries(maint)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');
    document.getElementById('bp-unit-actions').innerHTML = `
      ${isPlayer
        ? (unit.moves > 0
          ? `<div class="bp-move-hint">Click lit hex to move</div>`
          : `<div class="bp-move-hint dim">No moves remaining</div>`)
        : `<div class="bp-move-hint dim">Enemy · view only</div>`}
      ${maintStr ? `<div class="maint-summary" style="margin-top:6px">⚔ ${maintStr}/turn</div>` : ''}
    `;

    showPanel('panel-unit');
  }

  // ── City panel ──────────────────────────────
  function showCity(city, resources, onBuild, onTrain) {
    const ownerLabel = city.owner === 'player' ? 'Yours' :
                       city.owner === 'enemy'  ? 'Enemy' : 'Neutral';
    const badgeCls   = city.owner === 'player' ? 'player' :
                       city.owner === 'enemy'  ? 'enemy'  : 'neutral';

    // Portrait
    document.getElementById('bp-city-portrait').innerHTML = `
      <div class="bp-icon city">🏰</div>
      <div class="bp-port-name">${city.name}</div>
      <span class="bp-port-badge ${badgeCls}">${ownerLabel}</span>
      ${city.queue.length ? `
        <div style="margin-top:8px;width:100%">
          ${city.queue.map(q => `
            <div class="queue-row">
              <span class="queue-icon">${UNIT_TYPES[q.key]?.icon || '🔨'}</span>
              <span class="queue-label">${UNIT_TYPES[q.key]?.name || q.key}</span>
              <span class="queue-turns">${q.turnsLeft}t</span>
            </div>`).join('')}
        </div>` : '<div class="bp-port-stat" style="margin-top:6px">Queue empty</div>'}
    `;

    if (city.owner !== 'player') {
      document.getElementById('bp-city-main').innerHTML =
        '<p class="bp-desc" style="margin-top:8px">Capture this city to manage it.</p>';
      document.getElementById('bp-city-actions').innerHTML = '';
      showPanel('panel-city');
      return;
    }

    // Main: buildings list
    const bKeys = Object.keys(BUILDING_TYPES);
    let mainHtml = '<div class="section-label">Buildings</div>';
    bKeys.forEach((key, i) => {
      const def     = BUILDING_TYPES[key];
      const lvl     = city.buildings[i];
      const atMax   = lvl >= def.maxLevel;
      const next    = atMax ? null : def.cost[lvl];
      const canAff  = next ? Object.entries(next).every(([k, v]) => (resources[k] || 0) >= v) : false;

      mainHtml += `
        <div class="building-compact">
          <span class="b-icon">${def.icon}</span>
          <div class="b-info">
            <div class="b-name">${def.name}${lvl > 0 ? `<span class="b-level">Lv${lvl}</span>` : ''}</div>
            <div class="b-desc">${lvl > 0 ? def.effect[lvl - 1] : def.desc}</div>
          </div>
        </div>
        ${atMax ? '' : `
        <button class="build-btn-sm" onclick="UI._onBuild('${key}')" ${!canAff ? 'disabled' : ''}>
          <span class="bsm-icon">${lvl === 0 ? '➕' : '⬆️'}</span>
          <span class="bsm-label">${lvl === 0 ? 'Build' : 'Upgrade'} → Lv${lvl + 1}: ${def.effect[lvl]}</span>
          <span class="bsm-cost ${canAff ? '' : 'unaffordable'}">${formatCost(next)}</span>
        </button>`}
      `;
    });
    document.getElementById('bp-city-main').innerHTML = mainHtml;

    // Actions: recruit
    const barrIdx    = bKeys.indexOf('barracks');
    const barrLvl    = city.buildings[barrIdx];
    const hasArmy    = Game.armyNearCity(city);
    const noArmies   = Units.byOwner('player').length === 0;
    const canRecruit = hasArmy || noArmies;
    let actHtml      = '<div class="section-label">Recruit</div>';

    if (barrLvl === 0) {
      actHtml += `<p class="bp-desc">Build a Barracks<br>to recruit units.</p>`;
    } else if (!canRecruit) {
      actHtml += `<p class="bp-desc" style="color:var(--warn)">Move an army near<br>this city to recruit.</p>`;
    } else {
      if (noArmies) {
        actHtml += `<p class="bp-desc" style="color:var(--accent-green);margin-bottom:4px">Crea tu primer ejército</p>`;
      }
      const unlocked = BARRACKS_UNLOCK[barrLvl] || [];
      unlocked.forEach(uType => {
        const uDef = UNIT_TYPES[uType];
        const cost = uDef.cost;
        const canA = Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
        actHtml += `
          <button class="recruit-btn" onclick="UI._onTrain('${uType}')" ${!canA ? 'disabled' : ''}>
            <span class="r-icon">${uDef.icon}</span>
            <span class="r-name">${uDef.name}</span>
            <span class="r-cost ${canA ? '' : 'unaffordable'}">${formatCost(cost)}</span>
          </button>`;
      });
    }
    document.getElementById('bp-city-actions').innerHTML = actHtml;

    UI._onBuild = onBuild;
    UI._onTrain = onTrain;
    showPanel('panel-city');
  }

  // ── Army panel ──────────────────────────────
  function showArmy(units) {
    const movable      = units.filter(u => u.moves > 0);
    const minMoves     = movable.length > 0 ? Math.min(...movable.map(u => u.moves)) : 0;
    const anyExhausted = units.some(u => u.moves === 0);
    const anyMovable   = movable.length > 0;
    const isLocked     = anyExhausted && anyMovable;
    // Show split button on movable units whenever army has more than 1 unit
    const canSplit     = units.length > 1;

    // Portrait
    document.getElementById('bp-army-portrait').innerHTML = `
      <div class="bp-icon army">⚔</div>
      <div class="bp-port-name">Ejército</div>
      <div class="bp-port-sub">${units.length} unidad${units.length !== 1 ? 'es' : ''}</div>
      <span class="bp-port-badge ${anyMovable ? (isLocked ? 'neutral' : 'ready') : 'neutral'}" style="margin-top:6px">
        ${!anyMovable ? 'Agotado' : isLocked ? 'Bloqueado' : `Vel. ${minMoves}`}
      </span>
    `;

    // Main: unit list
    const totalMaint = {};
    units.forEach(u => {
      const m = UNIT_TYPES[u.type].maintenance;
      Object.entries(m).forEach(([k, v]) => totalMaint[k] = (totalMaint[k] || 0) + v);
    });
    const maintStr = Object.entries(totalMaint)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');

    document.getElementById('bp-army-main').innerHTML = `
      <div class="section-label">Unidades${isLocked ? ' · algunas agotadas' : ''}</div>
      ${units.map(u => {
        const def     = UNIT_TYPES[u.type];
        const hpPct   = Math.round((u.hp / u.maxHp) * 100);
        const hpCol   = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';
        const showBtn = canSplit && u.moves > 0;
        return `<div class="army-unit-row ${u.moves === 0 ? 'exhausted' : ''}">
          <span class="aur-icon">${def.icon}</span>
          <div class="aur-info">
            <div class="aur-name">${def.name}</div>
            <div class="aur-hp">
              <div class="aur-hp-fill" style="width:${hpPct}%;background:${hpCol}"></div>
            </div>
          </div>
          <div class="aur-pips">
            ${Array.from({length: u.maxMoves}, (_, i) =>
              `<div class="gpip ${i < u.moves ? 'on' : ''}"></div>`
            ).join('')}
          </div>
          ${showBtn ? `<button class="split-btn" onclick="Game.splitUnit(${u.id})" title="Mover esta unidad sola">→</button>` : ''}
        </div>`;
      }).join('')}
      ${maintStr ? `<div class="maint-summary">⚔ ${maintStr}/turno</div>` : ''}
    `;

    // Actions
    document.getElementById('bp-army-actions').innerHTML = `
      ${!anyMovable
        ? `<div class="bp-move-hint dim">Sin movimientos</div>`
        : isLocked
          ? `<div class="bp-move-hint dim">Ejército bloqueado.<br>Usa → para mover<br>una tropa sola.</div>`
          : `<div class="bp-move-hint">Click en hex iluminado para mover</div>`}
      <button class="action-btn danger" style="margin-top:auto" onclick="Game.disbandGroup()">
        Disolver Ejército
      </button>
    `;

    showPanel('panel-group');
  }

  function showGroup(units) { showArmy(units); }

  // ── Helpers ─────────────────────────────────
  function bpBar(label, val, max, cls) {
    const pct = Math.min(100, Math.round((val / max) * 100));
    return `<div class="bp-stat-row">
      <span class="bp-stat-label">${label}</span>
      <div class="bp-stat-bar-wrap">
        <div class="bp-stat-bar ${cls}" style="width:${Math.max(2, pct)}%"></div>
      </div>
      <span class="bp-stat-val">${val}</span>
    </div>`;
  }

  function formatCost(cost) {
    if (!cost) return '';
    const icons = { gold: '💰', iron: '⚙️', food: '🌾', wood: '🌲' };
    return Object.entries(cost).map(([k, v]) => `${icons[k] || ''}${v}`).join(' ');
  }

  function updateHUD(resources, turn) {
    document.getElementById('r-gold').textContent = resources.gold || 0;
    document.getElementById('r-iron').textContent = resources.iron || 0;
    document.getElementById('r-food').textContent = resources.food || 0;
    document.getElementById('r-wood').textContent = resources.wood || 0;
    document.getElementById('turn-num').textContent = turn;
  }

  function toast(msg, duration = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  return { showPanel, showIdle, showUnit, showCity, showArmy, showGroup, updateHUD, toast };
})();
