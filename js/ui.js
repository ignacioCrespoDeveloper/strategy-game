// =============================================
//  ui.js — panel rendering (bottom panel)
// =============================================

const UI = (() => {

  // ── Shared state for tooltip access ─────────
  let _currentCity      = null;
  let _currentResources = null;

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
            ${_bar('HP',       unit.hp,       unit.maxHp, 'tw-bar-hp')}
            ${_bar('Ataque',   unit.atk,      100,        'tw-bar-atk')}
            ${_bar('Defensa',  unit.def,      100,        'tw-bar-def')}
            ${_bar('Velocidad',unit.maxMoves, 5,          'tw-bar-spd')}
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
    _currentCity      = city;
    _currentResources = resources;
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
            <span class="tw-subtitle">Edificios · <span style="color:var(--text-muted);font-size:9px">Hover para info</span></span>
          </div>
          <div class="tw-cards-row">
            ${city.owner !== 'player'
              ? `<p class="tw-hint" style="align-self:center;padding:8px">Conquista esta ciudad para gestionarla.</p>`
              : _buildingCards(city, resources)}
          </div>
        </div>

        ${city.owner === 'player' ? _recruitCol(city, resources) : ''}
      </div>
    `;
    showPanel('panel-city');
  }

  // ── Building cards ───────────────────────────
  function _buildingCards(city, resources) {
    const bKeys = Object.keys(BUILDING_TYPES);
    return bKeys.map((key, i) => {
      const def    = BUILDING_TYPES[key];
      const lvl    = city.buildings[i];
      const atMax  = lvl >= def.maxLevel;
      const next   = atMax ? null : def.cost[lvl];
      const canAf  = next ? Object.entries(next).every(([k, v]) => (resources[k] || 0) >= v) : false;

      // Requirement check
      let isLocked = false, lockReason = '';
      if (def.requires) {
        for (const [reqKey, reqLvl] of Object.entries(def.requires)) {
          const reqIdx = bKeys.indexOf(reqKey);
          if (city.buildings[reqIdx] < reqLvl) {
            isLocked   = true;
            lockReason = `${BUILDING_TYPES[reqKey].name} Lv${reqLvl}`;
          }
        }
      }

      const classes = [
        'tw-build-card',
        `cat-${def.category}`,
        lvl > 0  ? 'built'  : '',
        atMax    ? 'maxed'  : '',
        isLocked ? 'locked' : '',
      ].filter(Boolean).join(' ');

      const lvlRoman = ['', 'I', 'II', 'III', 'IV', 'V'][lvl] || lvl;

      let btnHtml = '';
      if (!isLocked) {
        if (atMax) {
          btnHtml = `<button class="tw-build-upgrade-btn maxed" disabled>Máx. ✓</button>`;
        } else {
          btnHtml = `<button class="tw-build-upgrade-btn" onclick="UI._onBuild('${key}')" ${!canAf ? 'disabled' : ''}>
            ${lvl === 0 ? '➕ Construir' : '⬆ Mejorar'}
          </button>`;
        }
      }

      return `<div class="${classes}" data-bkey="${key}">
        <div class="tw-build-icon-area">
          <span class="tw-build-icon-glyph">${def.icon}</span>
          ${lvl > 0 ? `<div class="tw-build-lvl-badge">${lvlRoman}</div>` : ''}
          ${isLocked ? `<div class="tw-build-lock-overlay">🔒</div>` : ''}
        </div>
        <div class="tw-build-footer">
          <div class="tw-build-name">${def.name}</div>
          <div class="tw-build-effect-line">
            ${isLocked
              ? `<span class="tw-req-hint">Req: ${lockReason}</span>`
              : lvl > 0
                ? def.effect[lvl - 1]
                : '<span style="color:var(--text-dim)">Sin construir</span>'}
          </div>
          ${btnHtml}
        </div>
      </div>`;
    }).join('');
  }

  // ── Recruit column ───────────────────────────
  function _recruitCol(city, resources) {
    const bKeys   = Object.keys(BUILDING_TYPES);
    const barrLvl = city.buildings[bKeys.indexOf('barracks')];

    let inner = '';
    if (barrLvl === 0) {
      inner = `<p class="tw-hint">Construye Barracas para reclutar.</p>`;
    } else {
      const unlocked = BARRACKS_UNLOCK[barrLvl] || [];
      inner = unlocked.map(uType => {
        const uDef = UNIT_TYPES[uType];
        const canA = Object.entries(uDef.cost).every(([k, v]) => (resources[k] || 0) >= v);
        return `<button class="tw-recruit-btn" onclick="UI._onTrain('${uType}')" ${!canA ? 'disabled' : ''}>
          <span class="tw-rbt-icon">${uDef.icon}</span>
          <span class="tw-rbt-name">${uDef.name}</span>
          <span class="tw-rbt-cost ${canA ? '' : 'unaffordable'}">${_formatCost(uDef.cost)}</span>
        </button>`;
      }).join('');
    }

    return `<div class="tw-recruit-col">
      <div class="tw-section-label">Reclutar</div>
      ${inner}
    </div>`;
  }

  // ── Unit card (army panel) ────────────────────
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

  // ── Shared helpers ───────────────────────────
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

  // ── Tooltip system ────────────────────────────
  let _ttTimer = null;

  function _initTooltip() {
    const tt = document.getElementById('tw-tooltip');

    document.body.addEventListener('mouseover', e => {
      const unitCard = e.target.closest('[data-uid]');
      const bldCard  = e.target.closest('[data-bkey]');
      if (!unitCard && !bldCard) return;
      clearTimeout(_ttTimer);
      if (unitCard) _ttTimer = setTimeout(() => _showUnitTooltip(unitCard, tt),     180);
      if (bldCard)  _ttTimer = setTimeout(() => _showBuildingTooltip(bldCard, tt), 180);
    });

    document.body.addEventListener('mouseout', e => {
      if (!e.target.closest('[data-uid]') && !e.target.closest('[data-bkey]')) return;
      clearTimeout(_ttTimer);
      tt.style.display = 'none';
    });
  }

  function _positionTooltip(tt, triggerRect) {
    tt.style.visibility = 'hidden';
    tt.style.display    = 'block';
    const ttW = tt.offsetWidth, ttH = tt.offsetHeight;
    let left = triggerRect.left + triggerRect.width / 2 - ttW / 2;
    let top  = triggerRect.top - ttH - 8;
    left = Math.max(8, Math.min(left, window.innerWidth  - ttW - 8));
    top  = Math.max(8, Math.min(top,  window.innerHeight - ttH - 8));
    tt.style.left       = left + 'px';
    tt.style.top        = top  + 'px';
    tt.style.visibility = 'visible';
  }

  // Unit card tooltip
  function _showUnitTooltip(card, tt) {
    const uid  = parseInt(card.dataset.uid, 10);
    const unit = Units.getAll().find(u => u.id === uid);
    if (!unit) return;

    const def   = UNIT_TYPES[unit.type];
    const hpPct = Math.round((unit.hp / unit.maxHp) * 100);
    const hpCol = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';
    const maint = _maintStr(def.maintenance);

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
    _positionTooltip(tt, card.getBoundingClientRect());
  }

  // Building card tooltip
  const CAT_COLORS = {
    military: '#7a1414',
    economy:  '#7a5800',
    food:     '#1e5a14',
    industry: '#2c3548',
    culture:  '#461459',
  };
  const CAT_LABELS = {
    military: 'Militar',
    economy:  'Economía',
    food:     'Alimentos',
    industry: 'Industria',
    culture:  'Cultura',
  };

  function _showBuildingTooltip(card, tt) {
    const bkey = card.dataset.bkey;
    const def  = BUILDING_TYPES[bkey];
    if (!def) return;

    const city   = _currentCity;
    const res    = _currentResources;
    const bKeys  = Object.keys(BUILDING_TYPES);
    const lvl    = city ? city.buildings[bKeys.indexOf(bkey)] : 0;
    const atMax  = lvl >= def.maxLevel;
    const next   = !atMax ? def.cost[lvl] : null;
    const canAf  = next ? Object.entries(next).every(([k, v]) => (res?.[k] || 0) >= v) : false;

    // Prerequisite check
    let reqText = '';
    if (def.requires && city) {
      for (const [reqKey, reqLvl] of Object.entries(def.requires)) {
        const reqIdx  = bKeys.indexOf(reqKey);
        const cityLvl = city.buildings[reqIdx];
        if (cityLvl < reqLvl) reqText = `Requiere: ${BUILDING_TYPES[reqKey].name} Lv${reqLvl}`;
      }
    }

    const catColor = CAT_COLORS[def.category] || '#1a1200';
    const catLabel = CAT_LABELS[def.category] || def.category;
    const lvlRoman = ['', 'I', 'II', 'III', 'IV', 'V'][lvl] || String(lvl);

    tt.innerHTML = `
      <div class="tt-name" style="border-bottom-color:${catColor}40">
        <span class="tt-icon">${def.icon}</span>
        <div>
          ${def.name}
          ${lvl > 0 ? `<span class="tt-lv-badge">Lv ${lvlRoman}</span>` : ''}
          <div class="tt-cat" style="color:${catColor};filter:brightness(1.6)">${catLabel}</div>
        </div>
      </div>
      <div class="tt-desc">${def.desc}</div>
      ${lvl > 0 ? `
        <div class="tt-divider"></div>
        <div class="tt-section-label">Activo</div>
        <div class="tt-effect active">${def.effect[lvl - 1]}</div>
      ` : ''}
      ${!atMax && next ? `
        <div class="tt-divider"></div>
        <div class="tt-section-label">${lvl === 0 ? 'Construir' : `Mejorar → Lv ${lvlRoman === '' ? 'I' : (['I','II','III','IV','V'][lvl] || lvl + 1)}`}</div>
        <div class="tt-effect">${def.effect[lvl]}</div>
        <div class="tt-cost-row">
          <span class="tt-cost-label">Costo</span>
          <span class="tt-cost ${canAf ? 'can-afford' : 'cant-afford'}">${_formatCost(next)}</span>
        </div>
      ` : atMax ? `
        <div class="tt-divider"></div>
        <div class="tt-effect" style="color:var(--gold)">✓ Nivel máximo</div>
      ` : ''}
      ${reqText ? `<div class="tt-req">🔒 ${reqText}</div>` : ''}
    `;
    _positionTooltip(tt, card.getBoundingClientRect());
  }

  // ── Init ─────────────────────────────────────
  function init() {
    _initTooltip();
  }

  return { init, showPanel, showIdle, showUnit, showCity, showArmy, showGroup, updateHUD, toast };
})();
