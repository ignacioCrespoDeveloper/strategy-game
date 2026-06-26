// =============================================
//  ui.js — panel rendering (bottom panel)
// =============================================

const UI = (() => {

  // ── Panel visibility ─────────────────────────
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

  function showIdle() { showPanel('panel-idle'); }

  // ── Enemy/allied unit panel ──────────────────
  function showUnit(unit) {
    const def      = UNIT_TYPES[unit.type];
    const isPlayer = unit.owner === 'player';
    const maintStr = _maintStr(def.maintenance);

    document.getElementById('bp-unit-content').innerHTML = `
      <div class="tw-panel">
        <div class="tw-portrait">
          <div class="tw-port-label">${isPlayer ? 'Aliado' : 'Enemigo'}</div>
          <div class="tw-port-frame">${def.icon}</div>
          <div class="tw-port-nameplate">
            <div class="tw-port-title">${def.name}</div>
            <div class="tw-port-sub">${unit.hp}/${unit.maxHp} HP</div>
            ${maintStr ? `<div class="tw-port-sub" style="margin-top:4px;color:var(--warn)">⚔ ${maintStr}/t</div>` : ''}
          </div>
        </div>
        <div class="tw-body">
          <div class="tw-header">
            <span class="tw-title">${def.name}</span>
            <span class="tw-subtitle">${isPlayer ? 'Unidad aliada' : 'Unidad enemiga'}</span>
          </div>
          <div class="tw-stats-block">
            ${_bar('HP',      unit.hp,       unit.maxHp, 'tw-bar-hp')}
            ${_bar('Ataque',  unit.atk,      100,        'tw-bar-atk')}
            ${_bar('Defensa', unit.def,      100,        'tw-bar-def')}
            ${_bar('Velocidad', unit.maxMoves, 5,        'tw-bar-spd')}
          </div>
          <div class="tw-pips">
            <span class="tw-pips-label">Movimientos</span>
            ${Array.from({length: unit.maxMoves}, (_, i) =>
              `<div class="tw-pip ${i < unit.moves ? 'on' : ''}"></div>`
            ).join('')}
          </div>
          <div class="tw-tags">
            ${def.abilities.map(a => `<span class="tw-tag">${a}</span>`).join('')}
            ${unit.moves === 0 ? '<span class="tw-tag red">Agotado</span>' : ''}
          </div>
          <div class="tw-desc">${def.desc} · Vista: ${def.sight} hex</div>
        </div>
      </div>
    `;
    showPanel('panel-unit');
  }

  // ── Army panel ───────────────────────────────
  function showArmy(units) {
    const movable      = units.filter(u => u.moves > 0);
    const anyExhausted = units.some(u => u.moves === 0);
    const anyMovable   = movable.length > 0;
    const isLocked     = anyExhausted && anyMovable;
    const canSplit     = units.length > 1;
    const minMoves     = anyMovable ? Math.min(...movable.map(u => u.moves)) : 0;

    const totalMaint = {};
    units.forEach(u => {
      Object.entries(UNIT_TYPES[u.type].maintenance).forEach(([k, v]) => {
        totalMaint[k] = (totalMaint[k] || 0) + v;
      });
    });
    const maintStr    = _maintStr(totalMaint);
    const statusText  = !anyMovable ? 'Agotado' : isLocked ? 'Bloqueado' : `Vel. ${minMoves}`;
    const statusColor = !anyMovable ? 'var(--text-dim)' : isLocked ? 'var(--warn)' : 'var(--accent-green)';

    let hintText = '', hintActive = false;
    if (!anyMovable)   { hintText = 'Sin movimientos. Termina el turno.'; }
    else if (isLocked) { hintText = 'Unidades mixtas — usa → en una tropa individual.'; }
    else               { hintText = 'Click en hex iluminado para mover.'; hintActive = true; }

    document.getElementById('bp-army-content').innerHTML = `
      <div class="tw-panel">
        <div class="tw-portrait">
          <div class="tw-port-label">Ejército</div>
          <div class="tw-port-frame">⚔</div>
          <div class="tw-port-nameplate">
            <div class="tw-port-title">${units.length} unidad${units.length !== 1 ? 'es' : ''}</div>
            <div class="tw-port-sub" style="color:${statusColor}">${statusText}</div>
            ${maintStr ? `<div class="tw-port-sub" style="margin-top:5px;color:var(--warn)">⚔ ${maintStr}/t</div>` : ''}
          </div>
        </div>

        <div class="tw-body">
          <div class="tw-header">
            <span class="tw-title">Selección</span>
            <span class="tw-subtitle">${movable.length}/${units.length} con movimiento</span>
          </div>
          <div class="tw-cards-row">
            ${units.map(u => _unitCard(u, canSplit)).join('')}
          </div>
          <div class="tw-action-bar">
            <div class="tw-action-hint ${hintActive ? 'active' : ''}">${hintText}</div>
            <div class="tw-btn-wrap">
              <button class="tw-round-btn danger" onclick="Game.disbandGroup()" title="Disolver ejército">✕</button>
              <span class="tw-btn-label">Disolver</span>
            </div>
          </div>
        </div>
      </div>
    `;
    showPanel('panel-group');
  }

  function showGroup(units) { showArmy(units); }

  // ── City panel ───────────────────────────────
  function showCity(city, resources, onBuild, onTrain) {
    UI._onBuild = onBuild;
    UI._onTrain = onTrain;

    const ownerLabel = city.owner === 'player' ? 'Tuya' :
                       city.owner === 'enemy'  ? 'Enemiga' : 'Neutral';

    document.getElementById('bp-city-content').innerHTML = `
      <div class="tw-panel">
        <div class="tw-portrait">
          <div class="tw-port-label">Ciudad</div>
          <div class="tw-port-frame">🏰</div>
          <div class="tw-port-nameplate">
            <div class="tw-port-title">${city.name}</div>
            <div class="tw-port-sub">${ownerLabel}</div>
            ${city.queue.length
              ? `<div style="width:100%;margin-top:5px">
                  ${city.queue.map(q => `
                    <div class="queue-row">
                      <span class="queue-icon">${UNIT_TYPES[q.key]?.icon || '🔨'}</span>
                      <span class="queue-label">${UNIT_TYPES[q.key]?.name || q.key}</span>
                      <span class="queue-turns">${q.turnsLeft}t</span>
                    </div>`).join('')}
                </div>`
              : '<div class="tw-hint" style="margin-top:5px">Cola vacía</div>'}
          </div>
        </div>

        <div class="tw-body">
          <div class="tw-header">
            <span class="tw-title">${city.name}</span>
            <span class="tw-subtitle">Edificios</span>
          </div>
          <div class="tw-cards-row">
            ${city.owner !== 'player'
              ? `<p class="tw-hint" style="align-self:center;padding:8px">Conquista esta ciudad para gestionarla.</p>`
              : _buildingCards(city, resources)}
          </div>
          ${city.owner === 'player' ? `
            <div class="tw-action-bar">
              <div class="tw-action-hint">Mejora edificios ↑</div>
            </div>` : ''}
        </div>

        ${city.owner === 'player' ? _recruitCol(city, resources) : ''}
      </div>
    `;
    showPanel('panel-city');
  }

  // ── Helpers: unit card with data-uid for tooltip ─
  function _unitCard(u, canSplit) {
    const def    = UNIT_TYPES[u.type];
    const hpPct  = Math.round((u.hp / u.maxHp) * 100);
    const hpCol  = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';
    const exh    = u.moves === 0;
    const showSp = canSplit && u.moves > 0;
    return `<div class="tw-unit-card ${exh ? 'exhausted' : ''}" data-uid="${u.id}">
      <div class="tw-card-port">
        ${exh ? '<div class="tw-card-badge">Agot.</div>' : ''}
        ${def.icon}
        ${showSp ? `<button class="tw-card-split" onclick="Game.splitUnit(${u.id})" title="Mover solo">→</button>` : ''}
      </div>
      <div class="tw-card-hp">
        <div class="tw-card-hp-fill" style="width:${hpPct}%;background:${hpCol}"></div>
      </div>
      <div class="tw-card-footer">
        <div class="tw-card-name">${def.name}</div>
        <div class="tw-card-pips">
          ${Array.from({length: u.maxMoves}, (_, i) =>
            `<div class="tw-cpip ${i < u.moves ? 'on' : ''}"></div>`
          ).join('')}
        </div>
      </div>
    </div>`;
  }

  function _buildingCards(city, resources) {
    return Object.keys(BUILDING_TYPES).map((key, i) => {
      const def   = BUILDING_TYPES[key];
      const lvl   = city.buildings[i];
      const atMax = lvl >= def.maxLevel;
      const next  = atMax ? null : def.cost[lvl];
      const canAf = next ? Object.entries(next).every(([k, v]) => (resources[k] || 0) >= v) : false;

      return `<div class="tw-build-card ${lvl > 0 ? 'built' : ''} ${atMax ? 'maxed' : ''}">
        <div class="tw-build-icon-area">
          ${def.icon}
          ${lvl > 0 ? `<div class="tw-build-lvl-badge">Lv${lvl}</div>` : ''}
        </div>
        <div class="tw-build-info">
          <div class="tw-build-name">${def.name}</div>
          <div class="tw-build-effect">${lvl > 0 ? def.effect[lvl - 1] : def.desc}</div>
        </div>
        ${atMax
          ? `<button class="tw-build-upgrade-btn" disabled>Máx.</button>`
          : `<button class="tw-build-upgrade-btn" onclick="UI._onBuild('${key}')" ${!canAf ? 'disabled' : ''}>
              ${lvl === 0 ? '➕ Construir' : '⬆ Mejorar'}
              <span class="tw-build-cost">${_formatCost(next)}</span>
            </button>`}
      </div>`;
    }).join('');
  }

  function _recruitCol(city, resources) {
    const bKeys   = Object.keys(BUILDING_TYPES);
    const barrLvl = city.buildings[bKeys.indexOf('barracks')];

    let inner = '';
    if (barrLvl === 0) {
      inner = `<p class="tw-hint">Construye Barracas para reclutar.</p>`;
    } else {
      const unlocked = BARRACKS_UNLOCK[barrLvl] || [];
      if (!unlocked.length) {
        inner = `<p class="tw-hint">Sin unidades disponibles.</p>`;
      } else {
        inner = unlocked.map(uType => {
          const uDef = UNIT_TYPES[uType];
          const cost = uDef.cost;
          const canA = Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
          return `<button class="tw-recruit-btn" onclick="UI._onTrain('${uType}')" ${!canA ? 'disabled' : ''}>
            <span class="tw-rbt-icon">${uDef.icon}</span>
            <span class="tw-rbt-name">${uDef.name}</span>
            <span class="tw-rbt-cost ${canA ? '' : 'unaffordable'}">${_formatCost(cost)}</span>
          </button>`;
        }).join('');
      }
    }

    return `<div class="tw-recruit-col">
      <div class="tw-section-label">Reclutar</div>
      ${inner}
    </div>`;
  }

  function _bar(label, val, max, cls) {
    const pct = Math.min(100, Math.round((val / max) * 100));
    return `<div class="tw-stat-row">
      <span class="tw-stat-label">${label}</span>
      <div class="tw-stat-bar-wrap">
        <div class="tw-stat-bar ${cls}" style="width:${Math.max(2, pct)}%"></div>
      </div>
      <span class="tw-stat-val">${val}</span>
    </div>`;
  }

  function _maintStr(maint) {
    return Object.entries(maint)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`)
      .join(' ');
  }

  function _formatCost(cost) {
    if (!cost) return '';
    const icons = { gold: '💰', iron: '⚙️', food: '🌾', wood: '🌲' };
    return Object.entries(cost)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${icons[k] || ''}${v}`)
      .join(' ');
  }

  // ── HUD ──────────────────────────────────────
  function updateHUD(resources, turn) {
    const income = GameMap.calcIncome(Cities.getAll());
    const maint  = GameMap.getTotalMaintenance(Units.getAll());
    const RES    = ['gold', 'iron', 'food', 'wood'];

    RES.forEach(r => {
      document.getElementById(`r-${r}`).textContent = resources[r] || 0;
      const net   = (income[r] || 0) - (maint[r] || 0);
      const netEl = document.getElementById(`rn-${r}`);
      if (netEl) {
        if (net === 0) {
          netEl.textContent = '';
          netEl.className   = 'res-net zero';
        } else {
          netEl.textContent = (net > 0 ? '+' : '') + net;
          netEl.className   = 'res-net ' + (net > 0 ? 'pos' : 'neg');
        }
      }
    });

    document.getElementById('turn-num').textContent = turn;
  }

  // ── Toast ─────────────────────────────────────
  function toast(msg, duration = 2200) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── Unit card tooltip (fixed-position, event delegation) ──
  let _ttTimer = null;

  function _initTooltip() {
    const tt = document.getElementById('tw-tooltip');

    document.body.addEventListener('mouseover', e => {
      const card = e.target.closest('[data-uid]');
      if (!card) return;
      clearTimeout(_ttTimer);
      _ttTimer = setTimeout(() => _showTooltip(card, tt), 180);
    });

    document.body.addEventListener('mouseout', e => {
      const card = e.target.closest('[data-uid]');
      if (!card) return;
      clearTimeout(_ttTimer);
      tt.style.display = 'none';
    });
  }

  function _showTooltip(card, tt) {
    const uid  = parseInt(card.dataset.uid, 10);
    const unit = Units.getAll().find(u => u.id === uid);
    if (!unit) return;

    const def    = UNIT_TYPES[unit.type];
    const hpPct  = Math.round((unit.hp / unit.maxHp) * 100);
    const hpCol  = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';
    const maint  = _maintStr(def.maintenance);

    tt.innerHTML = `
      <div class="tt-name"><span class="tt-icon">${def.icon}</span>${def.name}</div>
      <div class="tt-stat-row">
        <span class="tt-stat-label">Vida</span>
        <div class="tt-stat-bar-wrap"><div class="tt-stat-bar" style="width:${hpPct}%;background:${hpCol}"></div></div>
        <span class="tt-stat-val">${unit.hp}/${unit.maxHp}</span>
      </div>
      <div class="tt-stat-row">
        <span class="tt-stat-label">Ataque</span>
        <div class="tt-stat-bar-wrap"><div class="tt-stat-bar" style="width:${Math.min(100,unit.atk)}%;background:#e05030"></div></div>
        <span class="tt-stat-val">${unit.atk}</span>
      </div>
      <div class="tt-stat-row">
        <span class="tt-stat-label">Defensa</span>
        <div class="tt-stat-bar-wrap"><div class="tt-stat-bar" style="width:${Math.min(100,unit.def)}%;background:#4a80c0"></div></div>
        <span class="tt-stat-val">${unit.def}</span>
      </div>
      <div class="tt-stat-row">
        <span class="tt-stat-label">Velocidad</span>
        <div class="tt-stat-bar-wrap"><div class="tt-stat-bar" style="width:${unit.maxMoves / 5 * 100}%;background:var(--gold)"></div></div>
        <span class="tt-stat-val">${unit.maxMoves}</span>
      </div>
      ${def.abilities.length ? `
        <div class="tt-divider"></div>
        <div class="tt-tags">${def.abilities.map(a => `<span class="tt-tag">${a}</span>`).join('')}</div>` : ''}
      ${maint ? `<div class="tt-maint">Upkeep: ${maint}/t</div>` : ''}
    `;

    // Position: show invisible first to measure, then place above card
    tt.style.visibility = 'hidden';
    tt.style.display    = 'block';

    const cardRect = card.getBoundingClientRect();
    const ttW      = tt.offsetWidth;
    const ttH      = tt.offsetHeight;
    let left = cardRect.left + cardRect.width / 2 - ttW / 2;
    let top  = cardRect.top - ttH - 8;

    left = Math.max(8, Math.min(left, window.innerWidth  - ttW - 8));
    top  = Math.max(8, Math.min(top,  window.innerHeight - ttH - 8));

    tt.style.left       = left + 'px';
    tt.style.top        = top  + 'px';
    tt.style.visibility = 'visible';
  }

  // ── Init ─────────────────────────────────────
  // Called once from game.js after DOM ready
  function init() {
    _initTooltip();
  }

  return { init, showPanel, showIdle, showUnit, showCity, showArmy, showGroup, updateHUD, toast };
})();
