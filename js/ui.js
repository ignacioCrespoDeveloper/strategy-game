// =============================================
//  ui.js — panel rendering (bottom panel)
// =============================================

const UI = (() => {

  // ── Shared state ─────────────────────────────
  let _currentCity      = null;
  let _currentResources = null;

  // ── Panel visibility ─────────────────────────
  function showPanel(id) {
    document.querySelectorAll('.panel-section').forEach(el => el.classList.remove('active'));
    const bp = document.getElementById('bottom-panel');
    if (id === 'panel-idle') {
      bp.classList.remove('visible');
      bp.classList.remove('city-mode');
      _cityPanelActive = false;
      const hp = document.getElementById('info-hover-panel');
      if (hp) hp.style.display = 'none';
      _closeRecruitModal();
      _closeRaiseArmyModal();
    } else {
      if (id === 'panel-city') {
        bp.classList.add('city-mode');
        bp.classList.remove('army-mode');
        _closeRecruitModal();
      } else if (id === 'panel-group') {
        bp.classList.add('army-mode');
        bp.classList.remove('city-mode');
        _cityPanelActive = false;
        const hp = document.getElementById('info-hover-panel');
        if (hp) hp.style.display = 'none';
        _closeRaiseArmyModal();
      } else {
        bp.classList.remove('city-mode');
        bp.classList.remove('army-mode');
        _cityPanelActive = false;
        _closeRecruitModal();
        _closeRaiseArmyModal();
      }
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
    const ROLE_LABEL = { infantry:'Infantería', pikemen:'Piqueros', ranged:'Distancia', cavalry:'Caballería', siege:'Asedio' };
    const roleLabel  = ROLE_LABEL[def.role] || '';
    const hpPct      = Math.round((unit.hp / unit.maxHp) * 100);
    const hpCol      = hpPct > 60 ? '#2a8030' : hpPct > 30 ? '#b07020' : '#9a2010';

    document.getElementById('bp-unit-content').innerHTML = `
      <div class="tw-panel">
        <div class="tw-portrait">
          <div class="tw-port-label">${isPlayer ? 'Aliado' : 'Enemigo'}</div>
          <div class="tw-port-frame">${_unitImgHtml(unit.type, def.icon, 'port')}</div>
          <div class="tw-port-nameplate">
            <div class="tw-port-title">${def.name}</div>
            ${roleLabel ? `<div class="tw-port-sub" style="font-style:normal;font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-light)">${roleLabel}</div>` : ''}
            <div class="tw-port-sub">${unit.hp}/${unit.maxHp} HP</div>
            <div class="tw-port-sub" style="color:#f0d060;font-weight:700">★ Nivel ${unit.level||1}</div>
            ${maintStr ? `<div class="tw-port-sub" style="color:var(--warn)">⚔ ${maintStr}/t</div>` : ''}
          </div>
        </div>
        <div class="tw-body tw-body-unit">
          <div class="tw-header">
            <span class="tw-title">${def.name}</span>
            <span class="tw-subtitle">${isPlayer ? 'Unidad aliada' : 'Unidad enemiga'}</span>
          </div>
          <div class="tw-stats-bars">
            ${_statRow('⚔', 'ATK', unit.atk,       130, '#a82818')}
            ${_statRow('🛡', 'DEF', unit.def,        80, '#1848a0')}
            ${_statRow('🔰', 'ARM', unit.arm||0,     50, '#4828a0')}
            ${(def.ap||0) > 0 ? _statRow('⛏', 'AP',  def.ap,      100, '#8a3810') : ''}
            ${_statRow('❤', 'HP',  unit.hp, unit.maxHp, hpCol)}
            ${(def.rng||0) > 0 ? _statRow('🏹', 'RNG', def.rng, 5, '#186840') : ''}
          </div>
          ${_xpBar(unit)}
          ${_specialEffects(def)}
          <div class="tw-pips">
            <span class="tw-pips-label">Movimientos</span>
            ${_renderPips(unit.moves, unit.maxMoves, 'tw-pip')}
            ${unit.moves === 0 ? '<span class="tw-pips-label" style="color:#9a2010;margin-left:4px">Agotado</span>' : ''}
          </div>
        </div>
      </div>
    `;
    showPanel('panel-unit');
  }

  // ── Army panel ───────────────────────────────
  let _armyCity    = null;
  let _onRecruit   = null;

  function showArmy(units, resources, cityHere, onRecruit) {
    if (resources)  _currentResources = resources;
    if (cityHere !== undefined) _armyCity = cityHere || null;
    if (onRecruit)  _onRecruit = onRecruit;
    _disbandConfirming = false;

    const isEnemy      = units.length > 0 && units[0].owner !== 'player';
    const movable      = units.filter(u => u.moves > 0);
    const anyExhausted = units.some(u => u.moves === 0);
    const anyMovable   = movable.length > 0;
    const isLocked     = anyExhausted && anyMovable;
    const canSplit     = !isEnemy && units.length > 1;
    const minMoves     = anyMovable ? Math.min(...movable.map(u => u.moves)) : 0;

    const totalMaint = {};
    units.forEach(u => {
      Object.entries(UNIT_TYPES[u.type].maintenance).forEach(([k, v]) => {
        totalMaint[k] = (totalMaint[k] || 0) + v;
      });
    });
    const maintStr    = _maintStr(totalMaint);
    const statusText  = !anyMovable ? 'Agotado' : isLocked ? 'Bloqueado' : `Vel. ${Math.ceil(minMoves / 2)}`;
    const statusColor = !anyMovable ? 'var(--text-dim)' : isLocked ? 'var(--warn)' : 'var(--accent-green)';

    let hintText = '', hintActive = false;
    if (isEnemy) {
      hintText = `Ejército enemigo — ${units.length} unidad${units.length !== 1 ? 'es' : ''}. Acércate para combatir.`;
    } else if (!anyMovable) {
      hintText = 'Sin movimientos. Termina el turno.';
    } else if (isLocked) {
      hintText = 'Unidades mixtas — usa → en una tropa individual.';
    } else {
      hintText = 'Click en hex iluminado para mover.'; hintActive = true;
    }

    const isLeaderHere = !isEnemy && (typeof Game !== 'undefined') && Game.isLeaderWithArmy ? Game.isLeaderWithArmy() : false;
    const leaderBadge  = (!isEnemy && isLeaderHere)
      ? `<div class="tw-leader-badge">👑 Líder presente</div>` : '';

    const portraitInner = isEnemy
      ? `<div style="font-family:var(--font-head);font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#9a2010;text-align:center;padding:16px 8px">⚔ Enemigo</div>`
      : `<div class="tw-port-actions">
          <div class="tw-btn-wrap">
            <button class="tw-round-btn recruit" onclick="UI._openRecruitModal()" title="Reclutar unidades">+</button>
            <span class="tw-btn-label">Reclutar</span>
          </div>
          <div class="tw-btn-wrap" id="disband-wrap">
            <button class="tw-round-btn disband" id="disband-btn" onclick="UI._onDisbandClick()" title="Disolver ejército">✕</button>
            <span class="tw-btn-label" id="disband-label">Disolver</span>
          </div>
        </div>
        ${leaderBadge}`;

    document.getElementById('bp-army-content').innerHTML = `
      <div class="tw-panel">
        <div class="tw-portrait" style="justify-content:center">
          ${portraitInner}
        </div>
        <div class="tw-body">
          <div class="tw-cards-row">
            ${units.map(u => _unitCard(u, canSplit)).join('')}
          </div>
        </div>
      </div>
    `;
    showPanel('panel-group');
  }

  // ── Recruit modal ─────────────────────────────
  let _currentRecruitTab  = 'normal';
  let _disbandConfirming  = false;

  function _openRecruitModal() {
    let el = document.getElementById('recruit-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'recruit-modal';
      el.className = 'recruit-modal';
      document.body.appendChild(el);
    }
    el.innerHTML = _buildRecruitModal(_currentRecruitTab);
    el.style.display = 'flex';
  }

  function _closeRecruitModal() {
    const el = document.getElementById('recruit-modal');
    if (el) el.style.display = 'none';
  }

  function _switchRecruitTab(tab) {
    _currentRecruitTab = tab;
    const el = document.getElementById('recruit-modal');
    if (!el) return;
    el.innerHTML = _buildRecruitModal(tab);
  }

  function _buildRecruitModal(tab) {
    const city  = _armyCity;
    const loc   = city ? city.name : 'Campo';

    const tabBar = `
      <div class="rm-tabs">
        <button class="rm-tab ${tab === 'normal' ? 'active' : ''}" data-tab="normal"
                onclick="UI._switchRecruitTab('normal')">⚔ Tropas</button>
        <button class="rm-tab ${tab === 'merc' ? 'active' : ''}" data-tab="merc"
                onclick="UI._switchRecruitTab('merc')">💰 Mercenarios</button>
      </div>`;

    return `
      <div class="rm-header">
        <span class="rm-title">Reclutar — ${loc}</span>
        <button class="rm-close" onclick="UI._closeRecruitModal()">✕</button>
      </div>
      ${tabBar}
      <div class="rm-content">${_recruitTabContent(tab)}</div>`;
  }

  function _recruitTabContent(tab) {
    const res  = _currentResources || {};
    const city = _armyCity;

    let types;
    if (tab === 'merc') {
      types = ['merc_inf', 'merc_arch', 'merc_cav'];
    } else {
      const cityUnits = city ? Cities.getTrainableUnits(city) : [];
      types = ['militia', ...cityUnits.filter(t => !t.startsWith('merc_'))];
      types = [...new Set(types)];
    }

    if (!types.length) {
      return `<p class="rm-empty">No hay unidades disponibles.</p>`;
    }

    return `<div class="rm-units-grid">` + types.map(type => {
      const def   = UNIT_TYPES[type];
      if (!def) return '';
      const canAf = Object.entries(def.cost || {}).every(([k, v]) => (res[k] || 0) >= v);
      return `<button class="rm-recruit-slot ${canAf ? '' : 'unaffordable'}"
                      onclick="UI._recruitUnit('${type}')" ${!canAf ? 'disabled' : ''}
                      onmouseenter="UI._showUnitTypeHover('${type}')"
                      onmouseleave="UI._hideHoverPanel()">
        <div class="rm-slot-img">${_unitImgHtml(type, def.icon, 'card')}</div>
        <div class="rm-slot-cost ${canAf ? '' : 'cant'}">${_formatCost(def.cost)}</div>
      </button>`;
    }).join('') + `</div>`;
  }

  function _recruitUnit(type) {
    if (_onRecruit) _onRecruit(type);
    requestAnimationFrame(() => {
      const el = document.getElementById('recruit-modal');
      if (el && el.style.display !== 'none') {
        const content = el.querySelector('.rm-content');
        if (content) content.innerHTML = _recruitTabContent(_currentRecruitTab);
      }
    });
  }

  function showGroup(units) { showArmy(units); }

  // ── City panel — 3-column layout ─────────────
  function showCity(city, resources, onBuild, onTrain) {
    _currentCity      = city;
    _currentResources = resources;
    UI._onBuild = onBuild;
    UI._onTrain = onTrain;
    _closeUpgradePicker();

    document.getElementById('bp-city-content').innerHTML = _cityHtml(city, resources);
    showPanel('panel-city');
    _cityPanelActive = true;
    _showCityDefault(city);
  }

  function _infectionBadge(city) {
    const labels = ['', 'Recién Infectada', 'Corrompida', '☠ Completamente Infectada'];
    const colors = ['', '#4a8a3a', '#7a6a1a', '#3a8a2a'];
    const s = city.infectionStage || 0;
    const thresholds = [null, 3, 5];
    const turnsLeft = s < 3 ? (thresholds[s] || 0) - (city.infectionTurnsAtStage || 0) : 0;
    const progress = s < 3 ? ` · ${turnsLeft}t` : '';
    return `<span class="city-infection-badge" style="background:${colors[s]}22;border-color:${colors[s]}66;color:${colors[s]}">
      ☠ ${labels[s]}${progress}
    </span>`;
  }

  function _cityHtml(city, resources) {
    const typeData  = CITY_TYPES[city.type || 'aldea'];
    const queuedNew = (city.queue || []).filter(q => q.type === 'building' && !q.parentKey).length;
    const usedSlots = Object.values(city.buildings).filter(l => l > 0).length + queuedNew;
    const freeSlots = typeData.slots - usedSlots;
    const isPlayer  = city.owner === 'player';
    const ownerTag  = !isPlayer
      ? `<span class="city-owner-tag">${city.owner === 'enemy' ? '(Enemiga)' : '(Neutral)'}</span>` : '';
    const tierColors = ['#5a4010','#4a6010','#105a40','#405010'];
    const tierColor  = tierColors[typeData.tier] || '#5a4010';
    const infBadge   = city.infectionStage ? _infectionBadge(city) : '';

    return `<div class="city-2col">
      <div class="city-slots-col">
        <div class="city-slots-header">
          <span class="tw-title city-name-compact">${city.name}</span>
          <span class="city-tier-badge city-tier-badge--sm" style="background:${tierColor}22;border-color:${tierColor}66;color:${tierColor}">${typeData.icon} ${typeData.name}</span>
          ${ownerTag}
          ${infBadge}
          <span class="city-slots-count">${usedSlots}/${typeData.slots}</span>
          ${isPlayer ? `<button class="city-army-btn" onclick="UI._openRaiseArmyModal()" title="Levantar Ejército">⚔</button>` : ''}
        </div>
        ${!isPlayer
          ? `<p class="tw-hint" style="padding:8px;align-self:center">Conquista esta ciudad para gestionarla.</p>`
          : _slotsGrid(city, resources, typeData, usedSlots)}
      </div>
    </div>`;
  }

  // ── Slot grid — built + queued buildings ─────
  function _slotsGrid(city, resources, typeData, usedSlots) {
    const queuedBuildings = (city.queue || []).filter(q => q.type === 'building');
    // usedSlots already includes queued new buildings (counted in _cityHtml)
    const freeSlots       = typeData.slots - usedSlots;

    let cards = '';
    Object.entries(city.buildings).forEach(([key, lvl]) => {
      if (!lvl || lvl <= 0) return;
      const def = Cities.getBuildingDef(city, key);
      if (!def) return;
      const queuedUpgrade = queuedBuildings.find(q => q.parentKey === key) || null;
      cards += _buildingCard(key, def, city, resources, queuedUpgrade);
    });

    // New buildings currently under construction (no parent — occupy new slots)
    queuedBuildings.filter(q => !q.parentKey).forEach(q => {
      cards += _buildingQueueCard(q, city);
    });

    for (let i = 0; i < Math.max(0, freeSlots); i++) {
      cards += `<div class="city-slot-empty" onclick="UI._openImgPicker(null)">
        <span class="slot-plus">+</span>
        <span class="slot-empty-label">Construir</span>
      </div>`;
    }

    return `<div class="city-slots-scroll">
      <div class="city-slots-grid">${cards}</div>
    </div>`;
  }

  function _buildingQueueCard(q, city) {
    const def = city ? Cities.getBuildingDef(city, q.key) : BUILDING_TYPES[q.key];
    if (!def) return '';
    const catColors = {
      military:'#7a1414', defense:'#2a1030', food:'#1e5a14',
      industry:'#243448', economy:'#7a5800', civil:'#501870',
    };
    const catColor = catColors[def.category] || '#5a4010';
    return `<div class="city-slot-card building-queued" title="${def.name} — ⏳ ${q.turnsLeft} turno${q.turnsLeft > 1 ? 's' : ''}">
      <div class="slot-cat-bar" style="background:${catColor};opacity:0.45"></div>
      <div class="slot-icon-area" style="opacity:0.55">
        ${def.img
          ? `<img src="assets/buildings/${def.img}.png" class="slot-bld-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="slot-icon" style="display:none">${def.icon}</span>`
          : `<span class="slot-icon">${def.icon}</span>`}
      </div>
      <span class="slot-lvl-badge" style="background:rgba(20,50,100,0.90);color:#88aaee">⏳${q.turnsLeft}</span>
    </div>`;
  }

  // Compact TW-style slot card — only built buildings
  function _buildingCard(key, def, city, resources, queuedUpgrade) {
    const lvl      = city.buildings[key] || 0;
    const atMax    = lvl >= def.maxLevel;
    const lvlRoman = ['', 'I', 'II', 'III', 'IV', 'V'][lvl] || String(lvl);

    const catColors = {
      military:'#7a1414', defense:'#2a1030', food:'#1e5a14',
      industry:'#243448', economy:'#7a5800', civil:'#501870',
    };
    const catColor  = catColors[def.category] || '#5a4010';
    const hasUpgrade = !atMax || (def.upgradesTo?.length > 0);

    return `<div class="city-slot-card built" data-bkey="${key}"
      onclick="UI._onSlotClick('${key}')"
      onmouseenter="UI._showBldHover('${key}')"
      onmouseleave="UI._hideHoverPanel()">
      <div class="slot-cat-bar" style="background:${catColor}"></div>
      <div class="slot-icon-area">
        ${def.img
          ? `<img src="assets/buildings/${def.img}.png" class="slot-bld-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><span class="slot-icon" style="display:none">${def.icon}</span>`
          : `<span class="slot-icon">${def.icon}</span>`}
      </div>
      ${lvl > 0 ? `<span class="slot-lvl-badge">${lvlRoman}</span>` : ''}
      ${queuedUpgrade ? `<span class="slot-queue-overlay">⏳${queuedUpgrade.turnsLeft}</span>` : hasUpgrade ? '<div class="slot-upgrade-dot"></div>' : ''}
    </div>`;
  }

  // ── Upgrade picker (click a slot card) ───────
  function _onSlotClick(key) {
    if (!_currentCity) return;
    const def = Cities.getBuildingDef(_currentCity, key) || BUILDING_TYPES[key];
    if (!def) return;
    const lvl = _currentCity.buildings[key] || 0;
    if (lvl === 0) return;

    // Mark selected card
    document.querySelectorAll('.city-slot-card').forEach(el => el.classList.remove('selected'));
    const card = document.querySelector(`.city-slot-card[data-bkey="${key}"]`);
    if (card) card.classList.add('selected');

    const atMax   = lvl >= def.maxLevel;
    const hasNext = !atMax || def.upgradesTo?.length;
    if (!hasNext && def.fixed) return; // Ayuntamiento at max — no upgrades

    _openImgPicker(key);
  }

  function _openUpgradePicker(key) {
    const city   = _currentCity;
    const def    = Cities.getBuildingDef(city, key) || BUILDING_TYPES[key];
    const res    = _currentResources;
    const terrain = Cities.getTerrainInRadius(city);
    const lvl    = city.buildings[key] || 0;
    const atMax  = lvl >= def.maxLevel;
    const lvlRoman = ['','I','II','III','IV','V'][lvl] || String(lvl);
    const TNAMES   = { plains:'llanura', forest:'bosque', mountain:'montaña', coast:'costa' };

    let optionsHtml = '';

    // Level-up (same building, next level)
    if (!atMax) {
      const nextCost = def.cost[lvl] || {};
      const canAf   = Object.entries(nextCost).every(([k, v]) => (res[k] || 0) >= v);
      const nextRoman = ['I','II','III','IV','V'][lvl] || String(lvl + 1);
      optionsHtml += `<div class="up-option ${canAf ? 'available' : ''}">
        <span class="up-opt-icon">${def.icon}</span>
        <div class="up-opt-body">
          <div class="up-opt-name">${def.name} Lv ${nextRoman}</div>
          <div class="up-opt-effect">${def.effect?.[lvl] || ''}</div>
        </div>
        <button class="up-opt-btn ${canAf ? '' : 'cant'}"
                onclick="UI._buildAndClose('${key}')" ${!canAf ? 'disabled' : ''}>
          ${_formatCost(nextCost)}
        </button>
      </div>`;
    }

    // Branch upgrades (upgradesTo — child buildings)
    if (def.upgradesTo?.length) {
      def.upgradesTo.forEach(nextKey => {
        const nd      = Cities.getBuildingDef(city, nextKey) || BUILDING_TYPES[nextKey];
        if (!nd) return;
        const nc      = nd.cost[0] || {};
        const terOk   = !nd.terrainReq || terrain.has(nd.terrainReq);
        const popOk   = !nd.popReq || (city.pop || 0) >= nd.popReq;
        const canAf   = terOk && popOk && Object.entries(nc).every(([k, v]) => (res[k] || 0) >= v);
        const lockHint = !terOk ? `🔒 Req. ${TNAMES[nd.terrainReq] || nd.terrainReq}`
                       : !popOk ? `🔒 Req. ${nd.popReq} hab.` : '';

        optionsHtml += `<div class="up-option ${canAf && !lockHint ? 'available' : ''} ${lockHint ? 'locked' : ''}">
          <span class="up-opt-icon">${nd.icon}</span>
          <div class="up-opt-body">
            <div class="up-opt-name">${nd.name}</div>
            <div class="up-opt-effect">${nd.effect?.[0] || ''}</div>
          </div>
          ${lockHint
            ? `<span class="up-opt-lock">${lockHint}</span>`
            : `<button class="up-opt-btn ${canAf ? '' : 'cant'}"
                       onclick="UI._buildAndClose('${nextKey}')" ${!canAf ? 'disabled' : ''}>
                 ${_formatCost(nc)}
               </button>`}
        </div>`;
      });
    }

    if (!optionsHtml) {
      optionsHtml = `<div class="up-option" style="justify-content:center;opacity:0.55">
        <span style="font-style:italic;font-size:10px">No hay mejoras disponibles.</span>
      </div>`;
    }

    let el = document.getElementById('upgrade-picker');
    if (!el) {
      el = document.createElement('div');
      el.id = 'upgrade-picker';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="up-header">
        <span class="up-cur-icon">${def.icon}</span>
        <div class="up-cur-info">
          <div class="up-cur-name">${def.name} Lv ${lvlRoman}</div>
          <div class="up-cur-effect">${def.effect?.[lvl - 1] || ''}</div>
        </div>
        <button class="up-close" onclick="UI._closeUpgradePicker()">✕</button>
      </div>
      <div class="up-divider-label">Evoluciones</div>
      <div class="up-options">${optionsHtml}</div>
    `;
    el.style.display = 'block';
  }

  function _buildAndClose(key) {
    _closeUpgradePicker();
    document.querySelectorAll('.city-slot-card').forEach(el => el.classList.remove('selected'));
    if (UI._onBuild) UI._onBuild(key);
  }

  function _closeUpgradePicker() {
    const el = document.getElementById('upgrade-picker');
    if (el) el.style.display = 'none';
    document.querySelectorAll('.city-slot-card').forEach(el => el.classList.remove('selected'));
  }

  // ── Info hover panel (bottom-left, fixed) ─────
  function _getHoverPanel() {
    let el = document.getElementById('info-hover-panel');
    if (!el) {
      el = document.createElement('div');
      el.id = 'info-hover-panel';
      document.body.appendChild(el);
    }
    return el;
  }

  let _cityPanelActive = false;

  function _hideHoverPanel() {
    if (_cityPanelActive && _currentCity) {
      _showCityDefault(_currentCity);
      return;
    }
    const el = document.getElementById('info-hover-panel');
    if (el) el.style.display = 'none';
  }

  function _showCityDefault(city) {
    if (!city) return;
    const typeData = CITY_TYPES[city.type || 'aldea'];
    const income   = GameMap.getCityIncome(city);
    const tierColors = ['#5a4010','#4a6010','#105a40','#405010'];
    const tierColor  = tierColors[typeData.tier] || '#5a4010';
    const incParts = [];
    if (income.gold) incParts.push(`💰+${income.gold}`);
    if (income.iron) incParts.push(`⚙️+${income.iron}`);
    if (income.food) incParts.push(`🌾+${income.food}`);
    if (income.wood) incParts.push(`🌲+${income.wood}`);

    // Faction owner info
    let factionHtml = '';
    if (city.factionId && typeof FACTIONS !== 'undefined') {
      const f = FACTIONS.find(f => f.id === city.factionId);
      if (f) {
        const relations = (typeof Game !== 'undefined' && Game.getRelations) ? Game.getRelations() : {};
        const rel = relations[f.id];
        const relIcon = !rel ? '' : rel === 'war' ? '🔴' : rel === 'alliance' ? '💙' : rel === 'trade' ? '💹' : rel === 'non_aggression' ? '🛡' : '🟡';
        const isPlayer = city.owner === 'player';
        const isNeutralFaction = city.owner === 'faction';
        const treatarBtn = (isNeutralFaction || (city.owner === 'enemy')) && rel
          ? `<button class="city-faction-btn" onclick="Game.openDiplomacy()">⚜ Diplomacia</button>` : '';
        factionHtml = `<div class="city-faction-row" style="color:${f.color}">
          <span>${f.symbol}</span>
          <span>${isPlayer ? 'Tu facción' : f.name}</span>
          ${relIcon ? `<span class="city-rel-badge">${relIcon}</span>` : ''}
          ${treatarBtn}
        </div>`;
      }
    }

    const el = _getHoverPanel();
    el.innerHTML = `
      <div class="ihp-img-area" style="background:rgba(40,20,0,0.20);align-items:center;justify-content:center;display:flex">
        <span style="font-size:52px;line-height:1">${typeData.icon}</span>
      </div>
      <div class="ihp-body">
        <div class="ihp-name-row">
          <span class="ihp-name">${city.name}</span>
          <span class="ihp-cat-badge" style="background:${tierColor}22;border-color:${tierColor}66;color:${tierColor}">${typeData.name}</span>
        </div>
        ${factionHtml}
        <div class="ihp-effect">❤ ${city.hp}/${city.maxHp} &nbsp;|&nbsp; 👥 ${city.pop}</div>
        ${incParts.length ? `<div class="ihp-bonus">${incParts.join('  ')}</div>` : ''}
      </div>`;
    el.style.display = 'flex';
  }

  function _showBldHover(key) {
    const city = _currentCity;
    const def  = (city ? Cities.getBuildingDef(city, key) : null) || BUILDING_TYPES[key];
    if (!def) return;
    const lvl  = city ? (city.buildings[key] || 0) : 0;
    const lvlRoman = ['','I','II','III','IV','V'][lvl] || String(lvl);
    const res  = _currentResources || {};

    const catColor = CAT_COLORS[def.category] || '#5a3810';
    const catLabel = CAT_LABELS[def.category] || def.category;

    const imgHtml = def.img
      ? `<img src="assets/buildings/${def.img}.png" class="ihp-bld-img" onerror="this.style.display='none'">`
      : `<span class="ihp-icon-fb">${def.icon}</span>`;

    const effectText = lvl > 0 ? (def.effect?.[lvl - 1] || '') : (def.effect?.[0] || '');

    let costHtml = '';
    if (lvl < def.maxLevel) {
      const cost = def.cost[lvl] || {};
      const canAf = Object.entries(cost).every(([k, v]) => (res[k] || 0) >= v);
      const lbl = lvl === 0 ? 'Costo' : 'Mejora';
      costHtml = `<div class="ihp-cost-row">
        <span class="ihp-cost-lbl">${lbl}</span>
        <span class="ihp-cost-val ${canAf ? 'can' : 'cant'}">${_formatCost(cost)}</span>
      </div>`;
    } else {
      costHtml = `<div class="ihp-cost-row"><span class="ihp-cost-val maxed">✓ Nivel máximo</span></div>`;
    }

    const bonus = lvl > 0 ? def.bonus?.[lvl - 1] : def.bonus?.[0];
    const bonusHtml = bonus
      ? `<div class="ihp-bonus">${Object.entries(bonus).filter(([,v])=>v>0).map(([k,v])=>`+${v} ${RESOURCE_DEF[k]?.icon||k}`).join('  ')}</div>`
      : '';

    const maint = def?.maintenance || {};
    const maintStr = Object.entries(maint).filter(([, v]) => v > 0)
      .map(([k, v]) => `${RESOURCE_DEF[k]?.icon || k}${v}`).join(' ');
    const buildTime = def.buildTime || 0;

    const el = _getHoverPanel();
    el.innerHTML = `
      <div class="ihp-img-area">${imgHtml}</div>
      <div class="ihp-body">
        <div class="ihp-name-row">
          <span class="ihp-name">${def.name}${lvl > 0 ? ` Lv ${lvlRoman}` : ''}</span>
          <span class="ihp-cat-badge" style="background:${catColor}22;border-color:${catColor}66;color:${catColor}">${catLabel}</span>
        </div>
        ${effectText ? `<div class="ihp-effect">${effectText}</div>` : ''}
        ${bonusHtml}
        ${def.desc ? `<div class="ihp-desc">${def.desc}</div>` : ''}
        ${costHtml}
        ${maintStr ? `<div class="ihp-cost-row"><span class="ihp-cost-lbl">Mant.</span><span class="ihp-cost-val" style="color:var(--warn)">${maintStr}/t</span></div>` : ''}
        ${buildTime > 0 ? `<div class="ihp-cost-row"><span class="ihp-cost-lbl">Tiempo</span><span class="ihp-cost-val">⏱ ${buildTime} turno${buildTime > 1 ? 's' : ''}</span></div>` : ''}
      </div>`;
    el.style.display = 'flex';
  }

  function _unitHoverBody(def, hp, maxHp) {
    const hpVal  = hp !== undefined ? hp : def.hp;
    const hpMax  = maxHp !== undefined ? maxHp : def.hp;
    const hpCol  = (hpVal / hpMax) > 0.6 ? '#2a8030' : (hpVal / hpMax) > 0.3 ? '#b07020' : '#9a2010';
    return `
      <div class="tw-stats-bars ihp-bars">
        ${_statRow('⚔', 'ATK', def.atk,    130, '#a82818')}
        ${_statRow('🛡', 'DEF', def.def,     80, '#1848a0')}
        ${_statRow('🔰', 'ARM', def.arm||0,  50, '#4828a0')}
        ${(def.ap||0) > 0 ? _statRow('⛏', 'AP', def.ap, 100, '#8a3810') : ''}
        ${_statRow('❤', 'HP', hpVal, hpMax, hpCol)}
        ${(def.rng||0) > 0 ? _statRow('🏹', 'RNG', def.rng, 5, '#186840') : ''}
      </div>
      ${_specialEffects(def)}`;
  }

  function _showUnitTypeHover(type) {
    const def = UNIT_TYPES[type];
    if (!def) return;
    const maintStr = _maintStr(def.maintenance);
    const costStr  = _formatCost(def.cost);
    const imgHtml  = def.img
      ? `<img src="assets/units/${def.img}.png" class="ihp-unit-img" onerror="this.style.display='none'">`
      : `<span class="ihp-icon-fb">${def.icon}</span>`;

    const el = _getHoverPanel();
    el.innerHTML = `
      <div class="ihp-img-area ihp-unit-area">${imgHtml}</div>
      <div class="ihp-body">
        <div class="ihp-name-row"><span class="ihp-name">${def.name}</span></div>
        ${_unitHoverBody(def)}
        ${def.desc ? `<div class="ihp-desc">${def.desc}</div>` : ''}
        ${costStr  ? `<div class="ihp-cost-row"><span class="ihp-cost-lbl">Costo</span><span class="ihp-cost-val">${costStr}</span></div>` : ''}
        ${maintStr ? `<div class="ihp-cost-row"><span class="ihp-cost-lbl">Mant.</span><span class="ihp-cost-val">${maintStr}/t</span></div>` : ''}
      </div>`;
    el.style.display = 'flex';
  }

  function _showUnitHover(type, hp, maxHp) {
    const def = UNIT_TYPES[type];
    if (!def) return;
    const maintStr = _maintStr(def.maintenance);
    const imgHtml  = def.img
      ? `<img src="assets/units/${def.img}.png" class="ihp-unit-img" onerror="this.style.display='none'">`
      : `<span class="ihp-icon-fb">${def.icon}</span>`;

    const el = _getHoverPanel();
    el.innerHTML = `
      <div class="ihp-img-area ihp-unit-area">${imgHtml}</div>
      <div class="ihp-body">
        <div class="ihp-name-row"><span class="ihp-name">${def.name}</span></div>
        ${_unitHoverBody(def, hp, maxHp)}
        ${def.desc ? `<div class="ihp-desc">${def.desc}</div>` : ''}
        ${maintStr ? `<div class="ihp-cost-row"><span class="ihp-cost-lbl">Mant.</span><span class="ihp-cost-val">${maintStr}/t</span></div>` : ''}
      </div>`;
    el.style.display = 'flex';
  }

  // ── Image picker (replaces upgrade-picker + building-browser) ──
  let _currentPickerKey = null;
  let _currentPickerCat = 'military';

  function _openImgPicker(key) {
    _currentPickerKey = key;
    let el = document.getElementById('img-picker');
    if (!el) {
      el = document.createElement('div');
      el.id = 'img-picker';
      document.body.appendChild(el);
    }
    el.innerHTML = _imgPickerHtml(key);
    el.style.display = 'flex';
  }

  function _closeImgPicker() {
    const el = document.getElementById('img-picker');
    if (el) el.style.display = 'none';
    _hideHoverPanel();
    document.querySelectorAll('.city-slot-card').forEach(e => e.classList.remove('selected'));
  }

  function _switchPickerCat(cat) {
    _currentPickerCat = cat;
    const el = document.getElementById('img-picker');
    if (!el) return;
    el.innerHTML = _imgPickerHtml(null);
  }

  function _buildFromPicker(key) {
    _closeImgPicker();
    if (UI._onBuild) UI._onBuild(key);
  }

  function _imgPickerHtml(key) {
    const city    = _currentCity;
    const res     = _currentResources || {};
    const terrain = Cities.getTerrainInRadius(city);
    const TNAMES  = { plains:'llanura', forest:'bosque', mountain:'montaña', coast:'costa' };

    const _ipcCard = (bkey, def, canBuild, canAf, locked, lockNote, isBuilt, lvlLabel, costLabel, costClass) => {
      const imgH = def.img
        ? `<img src="assets/buildings/${def.img}.png" class="ipc-bld-img" onerror="this.style.display='none'">`
        : `<span class="ipc-icon-fb">${def.icon}</span>`;
      const stateClass = locked ? 'locked' : (isBuilt && !canBuild ? 'maxed-card' : (canAf ? 'can' : 'cant-af'));
      const clickAttr  = canBuild && !locked ? `onclick="UI._buildFromPicker('${bkey}')"` : '';
      return `<div class="ipc-card ${stateClass}" ${clickAttr}
                   onmouseenter="UI._showBldHover('${bkey}')"
                   onmouseleave="UI._hideHoverPanel()">
        <div class="ipc-img-wrap">${imgH}</div>
        <div class="ipc-label">${lvlLabel}</div>
        <div class="ipc-cost ${costClass}">${costLabel}</div>
      </div>`;
    };

    const cityTree = Cities.getAvailableBuildings(city);

    if (key) {
      const def = cityTree[key];
      if (!def) return `<div class="ipc-header"><button class="ipc-close" onclick="UI._closeImgPicker()">✕</button></div>`;
      const lvl = city.buildings[key] || 0;
      const atMax = lvl >= def.maxLevel;
      const lvlRoman = ['','I','II','III','IV','V'][lvl] || String(lvl);

      let cards = '';
      if (!atMax) {
        const nc = def.cost[lvl] || {};
        const nextRoman = ['I','II','III','IV','V'][lvl] || String(lvl + 1);
        const canAf = Object.entries(nc).every(([k,v]) => (res[k]||0) >= v);
        const bt = def.buildTime || 1;
        cards += _ipcCard(key, def, canAf, canAf, false, '', true,
          `${def.name} Lv ${nextRoman}`, `${_formatCost(nc)} ⏱${bt}t`, canAf ? '' : 'cant');
      }
      if (def.upgradesTo && def.upgradesTo.length) {
        def.upgradesTo.forEach(nk => {
          const nd = cityTree[nk]; if (!nd) return;
          const nc = nd.cost[0] || {};
          const terOk = !nd.terrainReq || terrain.has(nd.terrainReq);
          const popOk = !nd.popReq || (city.pop||0) >= nd.popReq;
          const locked = !terOk || !popOk;
          const canAf  = !locked && Object.entries(nc).every(([k,v]) => (res[k]||0) >= v);
          const lockNote = !terOk ? `🔒 ${TNAMES[nd.terrainReq]||nd.terrainReq}` : `🔒 ${nd.popReq} hab.`;
          const bt = nd.buildTime || 1;
          const costLabel = locked ? lockNote : `${_formatCost(nc)} ⏱${bt}t`;
          cards += _ipcCard(nk, nd, canAf && !locked, canAf, locked, lockNote, false,
            nd.name, costLabel, locked || !canAf ? 'cant' : '');
        });
      }
      if (!cards) cards = `<div class="ipc-empty">Sin evoluciones disponibles.</div>`;

      return `<div class="ipc-header">
          <span class="ipc-title">Evoluciones — ${def.name} Lv ${lvlRoman}</span>
          <button class="ipc-close" onclick="UI._closeImgPicker()">✕</button>
        </div>
        <div class="ipc-grid">${cards}</div>`;
    } else {
      const cat = _currentPickerCat;
      const tabBar = _BB_CATS.map(c => `
        <button class="ipc-tab ${c.key === cat ? 'active' : ''}" onclick="UI._switchPickerCat('${c.key}')">
          ${c.icon} ${c.name}
        </button>`).join('');

      const entries = Object.entries(cityTree).filter(([, d]) => d.category === cat);
      const cards = entries.map(([bkey, def]) => {
        const lvl = city.buildings[bkey] || 0;
        const isBuilt = lvl > 0;
        const atMax = lvl >= def.maxLevel;
        const parentKey = def.upgradesFrom;
        const parentBuilt = !parentKey || (city.buildings[parentKey]||0) > 0 || isBuilt;
        const terOk = !def.terrainReq || terrain.has(def.terrainReq);
        const popOk = !def.popReq || (city.pop||0) >= def.popReq;
        const locked = !parentBuilt || !terOk || !popOk;
        const cost = !atMax ? (def.cost[lvl] || {}) : {};
        const canAf = !atMax && Object.entries(cost).every(([k,v]) => (res[k]||0) >= v);
        const canBuild = !locked && canAf && !atMax;
        const lvlRoman = ['','I','II','III','IV','V'][lvl] || String(lvl);
        let lockNote = '';
        if (!parentBuilt) lockNote = `🔒 Req. ${(cityTree[parentKey] && cityTree[parentKey].name)||parentKey}`;
        else if (!terOk)  lockNote = `🔒 ${TNAMES[def.terrainReq]||def.terrainReq}`;
        else if (!popOk)  lockNote = `🔒 ${def.popReq} hab.`;
        const lvlLabel = isBuilt ? `${def.name} Lv ${lvlRoman}` : def.name;
        const bt = def.buildTime || 1;
        let costLabel, costClass;
        if (atMax && isBuilt) { costLabel = '✓ MAX'; costClass = 'maxed'; }
        else if (locked)       { costLabel = lockNote; costClass = 'cant'; }
        else                   { costLabel = `${_formatCost(cost)} ⏱${bt}t`; costClass = canAf ? '' : 'cant'; }
        return _ipcCard(bkey, def, canBuild, canAf, locked, lockNote, isBuilt, lvlLabel, costLabel, costClass);
      }).join('') || `<div class="ipc-empty">Sin edificios en esta categoría.</div>`;

      return `<div class="ipc-header">
          <span class="ipc-title">Construir — ${city.name}</span>
          <button class="ipc-close" onclick="UI._closeImgPicker()">✕</button>
        </div>
        <div class="ipc-tabs">${tabBar}</div>
        <div class="ipc-grid">${cards}</div>`;
    }
  }

  // ── Building Browser modal ────────────────────
  const _BB_CATS = [
    { key:'civil',    icon:'🏛️', name:'Civil'     },
    { key:'military', icon:'⚔️', name:'Militar'   },
    { key:'defense',  icon:'🧱', name:'Defensa'   },
    { key:'food',     icon:'🌱', name:'Alimentos' },
    { key:'industry', icon:'⛏️', name:'Industria' },
    { key:'economy',  icon:'🏪', name:'Economía'  },
  ];
  let _currentBrowserCat = 'military';

  function _openBuildingBrowser(focusKey) {
    if (!_currentCity) return;
    if (focusKey) {
      const fd = Cities.getBuildingDef(_currentCity, focusKey) || BUILDING_TYPES[focusKey];
      if (fd) _currentBrowserCat = fd.category;
    }
    let el = document.getElementById('building-browser');
    if (!el) {
      el = document.createElement('div');
      el.id = 'building-browser';
      el.className = 'building-browser';
      document.body.appendChild(el);
    }
    el.innerHTML = _bbHtml(_currentCity, _currentResources, _currentBrowserCat);
    el.style.display = 'flex';
  }

  function _closeBuildingBrowser() {
    const el = document.getElementById('building-browser');
    if (el) el.style.display = 'none';
  }

  function _changeBrowserCat(cat) {
    _currentBrowserCat = cat;
    const el = document.getElementById('building-browser');
    if (!el || el.style.display === 'none') return;
    el.innerHTML = _bbHtml(_currentCity, _currentResources, cat);
  }

  function _buildFromBrowser(key) {
    if (UI._onBuild) UI._onBuild(key);
    requestAnimationFrame(() => {
      const el = document.getElementById('building-browser');
      if (el && el.style.display !== 'none') {
        el.innerHTML = _bbHtml(_currentCity, _currentResources, _currentBrowserCat);
      }
    });
  }

  function _bbHtml(city, resources, selectedCat) {
    const sidebar = _BB_CATS.map(c => `
      <button class="bb-cat-btn ${c.key === selectedCat ? 'active' : ''}"
              onclick="UI._changeBrowserCat('${c.key}')">
        <span class="bb-cat-icon">${c.icon}</span> ${c.name}
      </button>`).join('');

    const terrain  = Cities.getTerrainInRadius(city);
    const cityTree = Cities.getAvailableBuildings(city);
    const roots    = Object.entries(cityTree)
      .filter(([, def]) => def.category === selectedCat && !def.upgradesFrom);
    const treeHtml = roots.map(([key]) => _bbNodeHtml(key, city, resources, terrain, cityTree)).join('');

    return `<div class="bb-header">
        <span class="bb-title">Explorar Edificios — ${city.name}</span>
        <button class="bb-close" onclick="UI._closeBuildingBrowser()">✕</button>
      </div>
      <div class="bb-body">
        <div class="bb-sidebar">${sidebar}</div>
        <div class="bb-content">
          <div class="bb-tree">${treeHtml || '<p class="tw-hint" style="padding:12px">Sin edificios en esta categoría.</p>'}</div>
        </div>
      </div>`;
  }

  function _bbNodeHtml(key, city, resources, terrain, cityTree) {
    const tree = cityTree || Cities.getAvailableBuildings(city);
    const def  = tree[key];
    if (!def) return '';
    const lvl     = city.buildings[key] || 0;
    const isBuilt = lvl > 0;
    const atMax   = lvl >= def.maxLevel;

    const parentKey  = def.upgradesFrom;
    const parentBuilt = !parentKey || (city.buildings[parentKey] || 0) > 0 || isBuilt;

    const terrainOk  = !def.terrainReq || terrain.has(def.terrainReq);
    const popOk      = !def.popReq || (city.pop || 0) >= def.popReq;
    const tNames     = { plains:'llanura', forest:'bosque', mountain:'montaña', coast:'costa' };

    const buildCost  = !atMax ? (def.cost[lvl] || {}) : {};
    const canAfford  = Object.entries(buildCost).every(([k, v]) => ((resources || {})[k] || 0) >= v);
    const canBuild   = parentBuilt && terrainOk && popOk && canAfford && !atMax;

    const lvlRoman   = ['','I','II','III','IV','V'][lvl] || String(lvl);
    const nextRoman  = ['I','II','III','IV','V'][lvl] || String(lvl + 1);

    let lockNote = '';
    if (!terrainOk) lockNote = `Req. ${tNames[def.terrainReq] || def.terrainReq} en radio`;
    else if (!popOk) lockNote = `Req. ${def.popReq} hab.`;

    let actionHtml = '';
    if (atMax) {
      actionHtml = `<span class="bb-status maxed">✓ MAX</span>`;
    } else if (!parentBuilt) {
      actionHtml = `<span class="bb-status locked">🔒 Req. ${(tree[parentKey] && tree[parentKey].name) || parentKey}</span>`;
    } else if (lockNote) {
      actionHtml = `<span class="bb-status locked">🔒 ${lockNote}</span>`;
    } else {
      const label = isBuilt ? `⬆ Lv${nextRoman} ${_formatCost(buildCost)}` : `+ Construir ${_formatCost(buildCost)}`;
      actionHtml  = `<button class="bb-build-btn ${canAfford ? '' : 'cant'}"
                       onclick="UI._buildFromBrowser('${key}')" ${!canAfford ? 'disabled' : ''}>
                       ${label}
                     </button>`;
    }

    const children = (def.upgradesTo || [])
      .map(childKey => _bbNodeHtml(childKey, city, resources, terrain, tree))
      .join('');

    return `<div class="bb-node-wrap">
      <div class="bb-node ${isBuilt ? 'built' : ''} ${!parentBuilt || lockNote ? 'inaccessible' : ''}" data-bkey="${key}">
        <span class="bb-node-icon">${def.icon}</span>
        <div class="bb-node-info">
          <div class="bb-node-name">
            ${def.name}
            ${isBuilt ? `<span class="bb-node-lvl-badge">Lv ${lvlRoman}</span>` : ''}
          </div>
          <div class="bb-node-effect">${isBuilt ? (def.effect[lvl - 1] || '') : (def.effect[0] || '')}</div>
        </div>
        <div class="bb-node-action">${actionHtml}</div>
      </div>
      ${children ? `<div class="bb-children">${children}</div>` : ''}
    </div>`;
  }

  // ── Military column ───────────────────────────
  function _militaryCol(city, resources) {
    return `<div class="city-mil-col">
      <div class="tw-section-label">Ejército</div>
      <p class="tw-hint" style="margin-bottom:8px">Levanta un ejército desde esta ciudad para combatir.</p>
      <button class="tw-raise-army-btn" onclick="UI._openRaiseArmyModal()">⚔ Levantar Ejército</button>
    </div>`;
  }

  // ── Disband with confirm ─────────────────────
  function _onDisbandClick() {
    if (!_disbandConfirming) {
      _disbandConfirming = true;
      const btn = document.getElementById('disband-btn');
      const lbl = document.getElementById('disband-label');
      if (btn) {
        btn.style.background    = 'rgba(200,30,10,0.20)';
        btn.style.borderColor   = 'rgba(210,40,20,0.90)';
        btn.style.color         = '#ff4422';
        btn.title               = 'Clic de nuevo para confirmar';
      }
      if (lbl) { lbl.textContent = '¿Seguro?'; lbl.style.color = '#d03020'; }
      setTimeout(() => {
        if (!_disbandConfirming) return;
        _disbandConfirming = false;
        const b = document.getElementById('disband-btn');
        const l = document.getElementById('disband-label');
        if (b) { b.style.background = ''; b.style.borderColor = ''; b.style.color = ''; }
        if (l) { l.textContent = 'Disolver'; l.style.color = ''; }
      }, 3000);
    } else {
      _disbandConfirming = false;
      Game.disbandGroup();
    }
  }

  // ── Raise Army modal (city panel) ─────────────
  function _openRaiseArmyModal() {
    let el = document.getElementById('raise-army-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'raise-army-modal';
      el.className = 'recruit-modal';
      document.body.appendChild(el);
    }
    el.innerHTML = _buildRaiseArmyModal();
    el.style.display = 'flex';
  }

  function _closeRaiseArmyModal() {
    const el = document.getElementById('raise-army-modal');
    if (el) el.style.display = 'none';
  }

  function _doRaiseArmy(type) {
    _closeRaiseArmyModal();
    Game.raiseArmy(type);
  }

  function _buildRaiseArmyModal() {
    const city = _currentCity;
    if (!city) return '';
    const res = _currentResources || {};

    const cityUnits = Cities.getTrainableUnits(city);
    const types = [...new Set(['militia', ...cityUnits.filter(t => !t.startsWith('merc_'))])];

    const slots = types.map(type => {
      const def  = UNIT_TYPES[type];
      if (!def) return '';
      const canAf = Object.entries(def.cost || {}).every(([k, v]) => (res[k] || 0) >= v);
      return `<button class="rm-recruit-slot ${canAf ? '' : 'unaffordable'}"
                      onclick="UI._doRaiseArmy('${type}')" ${!canAf ? 'disabled' : ''}
                      onmouseenter="UI._showUnitTypeHover('${type}')"
                      onmouseleave="UI._hideHoverPanel()">
        <div class="rm-slot-img">${_unitImgHtml(type, def.icon, 'card')}</div>
        <div class="rm-slot-cost ${canAf ? '' : 'cant'}">${_formatCost(def.cost)}</div>
      </button>`;
    }).join('');

    return `
      <div class="rm-header">
        <span class="rm-title">⚔ Levantar Ejército — ${city.name}</span>
        <button class="rm-close" onclick="UI._closeRaiseArmyModal()">✕</button>
      </div>
      <div class="rm-content">
        <p class="rm-section-hint">Selecciona la primera unidad del nuevo ejército.</p>
        <div class="rm-units-grid">${slots}</div>
      </div>`;
  }

  // Close floating panels when clicking outside
  function _initBrowserClickaway() {
    document.addEventListener('click', e => {
      const bb = document.getElementById('building-browser');
      if (bb && bb.style.display !== 'none') {
        if (!bb.contains(e.target) && !e.target.closest('.city-slot-empty')) {
          bb.style.display = 'none';
        }
      }
      const up = document.getElementById('upgrade-picker');
      if (up && up.style.display !== 'none') {
        if (!up.contains(e.target) && !e.target.closest('.city-slot-card')) {
          _closeUpgradePicker();
        }
      }
      const ip = document.getElementById('img-picker');
      if (ip && ip.style.display !== 'none') {
        if (!ip.contains(e.target) && !e.target.closest('.city-slot-card') && !e.target.closest('.city-slot-empty')) {
          _closeImgPicker();
        }
      }
      const rm = document.getElementById('recruit-modal');
      if (rm && rm.style.display !== 'none') {
        if (!rm.contains(e.target) && !e.target.closest('.tw-round-btn.recruit')) {
          _closeRecruitModal();
        }
      }
      const ra = document.getElementById('raise-army-modal');
      if (ra && ra.style.display !== 'none') {
        if (!ra.contains(e.target) && !e.target.closest('.tw-raise-army-btn') && !e.target.closest('.city-army-btn')) {
          _closeRaiseArmyModal();
        }
      }
    }, true);
  }

  // ── Unit card (army panel) ────────────────────
  function _unitCard(u, canSplit) {
    const def   = UNIT_TYPES[u.type];
    const hpPct = Math.round((u.hp / u.maxHp) * 100);
    const hpCol = hpPct > 60 ? '#4aaa44' : hpPct > 30 ? '#e09030' : '#d05040';
    const exh   = u.moves === 0;
    const showSp = canSplit && u.moves > 0;
    return `<div class="tw-unit-card" data-uid="${u.id}"
      onmouseenter="UI._showUnitHover('${u.type}',${u.hp},${u.maxHp})"
      onmouseleave="UI._hideHoverPanel()">
      <div class="tw-card-port">
        ${_unitImgHtml(u.type, def.icon, 'card')}
        ${showSp ? `<button class="tw-card-split" onclick="Game.splitUnit(${u.id})" title="Mover solo">→</button>` : ''}
        <span class="tw-card-level">L${u.level||1}</span>
      </div>
      <div class="tw-card-hp">
        <div class="tw-card-hp-fill" style="width:${hpPct}%;background:${hpCol}"></div>
      </div>
      <div class="tw-card-footer">
        <div class="tw-card-name">${def.name}</div>
        <div class="tw-card-pips">
          ${_renderPips(u.moves, u.maxMoves, 'tw-cpip')}
        </div>
      </div>
    </div>`;
  }

  function _xpBar(unit) {
    const level = unit.level || 1;
    const xp    = unit.xp || 0;
    const thr   = UNIT_XP_THRESHOLDS; // [100, 300, 600]
    const nextXP = thr[level - 1] || null;
    const prevXP = level > 1 ? (thr[level - 2] || 0) : 0;
    const pct    = nextXP ? Math.round(((xp - prevXP) / (nextXP - prevXP)) * 100) : 100;
    const label  = nextXP ? `Nivel ${level} — ${xp}/${nextXP} XP` : `Nivel ${level} MAX`;
    return `<div class="tw-xp-row">
      <span class="tw-xp-label">${label}</span>
      <div class="tw-xp-bar-wrap"><div class="tw-xp-bar" style="width:${pct}%"></div></div>
    </div>`;
  }

  // Each pip represents 2 moves; half-pip = 1 remaining move
  function _renderPips(moves, maxMoves, cls) {
    const total    = Math.ceil(maxMoves / 2);
    const fullOn   = Math.floor(moves / 2);
    const hasHalf  = moves % 2 === 1;
    return Array.from({length: total}, (_, i) => {
      const pipCls = i < fullOn ? 'on' : (i === fullOn && hasHalf ? 'half' : '');
      return `<div class="${cls} ${pipCls}"></div>`;
    }).join('');
  }

  // ── Unit portrait helper ──────────────────────
  function _unitImgHtml(type, fallbackEmoji, context) {
    const def = UNIT_TYPES[type];
    if (!def || !def.img) {
      return `<span class="uport-fallback" style="display:flex">${fallbackEmoji}</span>`;
    }
    const cls = context === 'port' ? 'uport-img-port'
              : context === 'rbt'  ? 'uport-img-rbt'
              : 'uport-img-card';
    return `<img src="assets/units/${def.img}.png" class="${cls}"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <span class="uport-fallback" style="display:none">${fallbackEmoji}</span>`;
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

  function _statRow(icon, label, val, max, color) {
    const pct = Math.min(100, Math.max(3, Math.round((val / max) * 100)));
    return `<div class="tw-srow">
      <span class="tw-srow-icon">${icon}</span>
      <span class="tw-srow-lbl">${label}</span>
      <div class="tw-srow-bar-wrap">
        <div class="tw-srow-bar" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="tw-srow-val">${val}</span>
    </div>`;
  }

  function _specialEffects(def) {
    const ROLE_NAMES = { cavalry:'Caballería', infantry:'Infantería', pikemen:'Piqueros', ranged:'Distancia', siege:'Asedio' };
    const fx = [];
    if (def.firesFirst) {
      fx.push({ icon:'🏹', name:'Dispara Primero', desc:'Ataca antes del combate cuerpo a cuerpo. Sin represalia en la fase de distancia.' });
    }
    if (def.charge) {
      fx.push({ icon:'⚡', name:`Carga +${Math.round(def.charge * 100)}%`, desc:`Bonus de daño en la embestida inicial. Máximo impacto en el primer contacto.` });
    }
    if (def.bonusVs) {
      Object.entries(def.bonusVs).forEach(([role, mult]) => {
        const rn = ROLE_NAMES[role] || role;
        if (mult >= 1.5) {
          fx.push({ icon:'💪', name:`×${mult} vs ${rn}`, desc:`Ventaja táctica dominante frente a ${rn.toLowerCase()}. Formación especializada.` });
        } else {
          fx.push({ icon:'⚠', name:`×${mult} vs ${rn}`, desc:`Muy vulnerable frente a ${rn.toLowerCase()}. Evitar enfrentamiento directo.` });
        }
      });
    }
    if (!fx.length) return '';
    return `<div class="tw-spec-effects">
      ${fx.map(e => `
        <div class="tw-spec-fx">
          <span class="tw-spec-fx-icon">${e.icon}</span>
          <div class="tw-spec-fx-text">
            <span class="tw-spec-fx-name">${e.name}</span>
            <span class="tw-spec-fx-desc">${e.desc}</span>
          </div>
        </div>`).join('')}
    </div>`;
  }

  function _typeBonusBadges(def) {
    const ROLE_NAMES = { cavalry:'Caballería', infantry:'Infantería', pikemen:'Piqueros', ranged:'Distancia', siege:'Asedio' };
    const tags = [];
    if (def.firesFirst) tags.push(`<span class="tw-bonus-tag fires-first">Dispara Primero</span>`);
    if (def.charge) tags.push(`<span class="tw-bonus-tag charge">⚡ Carga +${Math.round(def.charge * 100)}%</span>`);
    if (def.bonusVs) {
      Object.entries(def.bonusVs).forEach(([role, mult]) => {
        const label = ROLE_NAMES[role] || role;
        const cls   = mult >= 1.5 ? 'counter' : mult >= 1.0 ? 'neutral' : 'weak';
        tags.push(`<span class="tw-bonus-tag ${cls}">×${mult} vs ${label}</span>`);
      });
    }
    return tags.length ? `<div class="tw-bonus-tags">${tags.join('')}</div>` : '';
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
    const income    = GameMap.calcIncome(Cities.getAll());
    const maint     = GameMap.getTotalMaintenance(Units.getAll());
    const bldMaint  = Cities.getTotalBuildingMaintenanceForCities(Cities.getAll().filter(c => c.owner === 'player'));
    const RES       = ['gold', 'iron', 'food', 'wood'];

    RES.forEach(r => {
      document.getElementById(`r-${r}`).textContent = resources[r] || 0;
      const net   = (income[r] || 0) - (maint[r] || 0) - (bldMaint[r] || 0);
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
    // [data-utype] hover is now handled via inline onmouseenter → _showUnitTypeHover
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

  const CAT_COLORS = {
    military:'#7a1414', economy:'#7a5800', food:'#1e5a14',
    industry:'#2c3548', culture:'#461459', defense:'#2a1030', civil:'#501870',
  };
  const CAT_LABELS = {
    military:'Militar', economy:'Economía', food:'Alimentos',
    industry:'Industria', culture:'Cultura', defense:'Defensa', civil:'Civil',
  };

  // ── TW-style unit tooltip ─────────────────────
  function _showUnitTooltip(card, tt) {
    const uid  = parseInt(card.dataset.uid, 10);
    const unit = Units.getAll().find(u => u.id === uid);
    if (!unit) return;
    const def   = UNIT_TYPES[unit.type];
    const maint = _maintStr(def.maintenance);

    const statBar = (label, val, max, col) => {
      const pct = Math.round(Math.min(100, (val / max) * 100));
      return `<div class="tt-stat-row">
        <span class="tt-stat-lbl">${label}</span>
        <div class="tt-bar-wrap"><div class="tt-bar-fill" style="width:${Math.max(2,pct)}%;background:${col}"></div></div>
        <span class="tt-stat-num">${val}</span>
      </div>`;
    };

    tt.innerHTML = `
      <div class="tt-unit-card">
        <div class="tt-unit-header">
          <div class="tt-unit-img">${_unitImgHtml(unit.type, def.icon, 'tt')}</div>
          <div class="tt-unit-title-col">
            <div class="tt-unit-name">${def.name}</div>
            <div class="tt-unit-tags">
              ${def.abilities.map(a => `<span class="tt-ability-tag">${a}</span>`).join('')}
              ${unit.moves === 0 ? `<span class="tt-ability-tag red">Agotado</span>` : ''}
            </div>
          </div>
        </div>
        <div class="tt-unit-flavor">${def.desc}</div>
        <div class="tt-divider"></div>
        <div class="tt-unit-stats">
          ${statBar('Vida',    unit.hp,       unit.maxHp, unit.hp/unit.maxHp > 0.6 ? '#4aaa44' : unit.hp/unit.maxHp > 0.3 ? '#e09030' : '#d05040')}
          ${statBar('ATK',    unit.atk,      120,        '#c04020')}
          ${statBar('DEF',    unit.def,      80,         '#2060b0')}
          ${statBar('ARM',    def.arm||0,    50,         '#6040a0')}
          ${(def.ap||0) > 0 ? statBar('AP', def.ap, 100, '#a03020') : ''}
          ${(def.rng||0) > 0 ? statBar('RNG', def.rng, 5, '#208040') : ''}
        </div>
        ${_typeBonusBadges(def)}
        ${maint ? `<div class="tt-divider"></div><div class="tt-unit-maint">Mantenimiento: ${maint}/t</div>` : ''}
      </div>`;
    _positionTooltip(tt, card.getBoundingClientRect());
  }

  // ── Unit TYPE tooltip (recruit cards, no live unit) ──
  function _showUnitTypeTooltip(card, tt) {
    const type = card.dataset.utype;
    const def  = UNIT_TYPES[type];
    if (!def) return;
    const res   = _currentResources || {};
    const maint = _maintStr(def.maintenance);
    const canAf = Object.entries(def.cost || {}).every(([k, v]) => (res[k] || 0) >= v);

    const statBar = (label, val, max, col) => {
      const pct = Math.round(Math.min(100, (val / max) * 100));
      return `<div class="tt-stat-row">
        <span class="tt-stat-lbl">${label}</span>
        <div class="tt-bar-wrap"><div class="tt-bar-fill" style="width:${Math.max(2, pct)}%;background:${col}"></div></div>
        <span class="tt-stat-num">${val}</span>
      </div>`;
    };

    tt.innerHTML = `
      <div class="tt-unit-card">
        <div class="tt-unit-header">
          <div class="tt-unit-img">${_unitImgHtml(type, def.icon, 'tt')}</div>
          <div class="tt-unit-title-col">
            <div class="tt-unit-name">${def.name}</div>
            <div class="tt-unit-tags">
              ${def.abilities.map(a => `<span class="tt-ability-tag">${a}</span>`).join('')}
            </div>
          </div>
        </div>
        <div class="tt-unit-flavor">${def.desc}</div>
        <div class="tt-divider"></div>
        <div class="tt-unit-stats">
          ${statBar('Vida',      def.hp,     100, '#4aaa44')}
          ${statBar('Ataque',   def.atk,    100, '#c04020')}
          ${statBar('Defensa',  def.def,    100, '#2060b0')}
          ${statBar('Velocidad', Math.ceil(def.moves/2), 4, '#9060c0')}
        </div>
        <div class="tt-divider"></div>
        <div class="tt-bld-cost-row">
          <span class="tt-bld-cost-lbl">Costo</span>
          <span class="tt-bld-cost-val ${canAf ? '' : 'cant'}">${_formatCost(def.cost)}</span>
        </div>
        ${maint ? `<div class="tt-unit-maint">Mant.: ${maint}/t</div>` : ''}
      </div>`;
    _positionTooltip(tt, card.getBoundingClientRect());
  }

  // ── TW-style building tooltip ─────────────────
  function _showBuildingTooltip(card, tt) {
    const bkey = card.dataset.bkey;
    const city    = _currentCity;
    const def  = (city ? Cities.getBuildingDef(city, bkey) : null) || BUILDING_TYPES[bkey];
    if (!def) return;
    const res     = _currentResources;
    const lvl     = city ? (city.buildings[bkey] || 0) : 0;
    const atMax   = lvl >= def.maxLevel;
    const next    = !atMax ? (def.cost[lvl] || {}) : {};
    const canAf   = Object.entries(next).every(([k, v]) => (res?.[k] || 0) >= v);
    const catColor  = CAT_COLORS[def.category] || '#5a3810';
    const catLabel  = CAT_LABELS[def.category] || def.category;
    const lvlRoman  = ['','I','II','III','IV','V'][lvl] || String(lvl);
    const nextRoman = ['I','II','III','IV','V'][lvl] || String(lvl + 1);

    const bonus   = (lvl > 0 ? def.bonus?.[lvl - 1] : def.bonus?.[0]) || {};
    const hpBon   = lvl > 0 ? (def.hpBonus?.[lvl - 1] || 0) : 0;

    const statRowBld = (icon, label, val, col) =>
      `<div class="tt-bld-stat"><span class="tt-bld-stat-icon" style="background:${col}">${icon}</span>
       <span class="tt-bld-stat-txt">${label}:</span>
       <span class="tt-bld-stat-val">${val}</span></div>`;

    let statsHtml = '';
    if (bonus.gold)  statsHtml += statRowBld('💰','Oro', `+${bonus.gold}/t`, '#6a4a08');
    if (bonus.food)  statsHtml += statRowBld('🌾','Alimentos',`+${bonus.food}/t`,'#3a6a10');
    if (bonus.pop)   statsHtml += statRowBld('👥','Población',`+${bonus.pop}/t`, '#3a5a8a');
    if (bonus.iron)  statsHtml += statRowBld('⚙️','Hierro',   `+${bonus.iron}/t`,'#4a5060');
    if (bonus.wood)  statsHtml += statRowBld('🌲','Madera',   `+${bonus.wood}/t`,'#2a5a20');
    if (hpBon)       statsHtml += statRowBld('❤️','Fortaleza',`+${hpBon} HP`,   '#5a1010');

    const effect = lvl > 0 ? def.effect[lvl - 1] : (def.effect[0] || '');

    tt.innerHTML = `
      <div class="tt-bld-card">
        <div class="tt-bld-img-area">
          ${def.img
            ? `<img src="assets/buildings/${def.img}.png" class="tt-bld-img" onerror="this.style.display='none'">`
            : `<span class="tt-bld-big-icon">${def.icon}</span>`}
          <div class="tt-bld-badges">
            <span class="tt-bld-cat-badge" style="background:${catColor}22;border-color:${catColor}66;color:${catColor}">${catLabel}</span>
            ${lvl > 0 ? `<span class="tt-bld-lvl-badge">Lv ${lvlRoman}</span>` : ''}
          </div>
        </div>
        <div class="tt-bld-name">${def.name}</div>
        <div class="tt-bld-flavor">"${def.desc}"</div>
        ${statsHtml ? `<div class="tt-divider"></div><div class="tt-bld-stats">${statsHtml}</div>` : ''}
        ${effect ? `<div class="tt-bld-effect-row">${effect}</div>` : ''}
        ${!atMax && Object.keys(next).length ? `
          <div class="tt-divider"></div>
          <div class="tt-bld-cost-row">
            <span class="tt-bld-cost-lbl">${lvl === 0 ? 'Construir' : `→ Lv ${nextRoman}`}</span>
            <span class="tt-bld-cost-val ${canAf ? 'can' : 'cant'}">${_formatCost(next)}</span>
          </div>` : atMax ? `<div class="tt-bld-maxed">✓ Nivel máximo</div>` : ''}
      </div>`;
    _positionTooltip(tt, card.getBoundingClientRect());
  }

  // ── Leader panel (left sidebar) ──────────────
  let _leaderPanelOpen = true;

  function toggleLeaderPanel() {
    const el  = document.getElementById('leader-panel');
    const tab = document.getElementById('leader-tab');
    if (!el) return;
    _leaderPanelOpen = !_leaderPanelOpen;
    el.style.display  = _leaderPanelOpen ? 'flex' : 'none';
    if (tab) tab.style.display = _leaderPanelOpen ? 'none' : 'flex';
  }

  function updateLeaderPanel(lord) {
    const el  = document.getElementById('leader-panel');
    const tab = document.getElementById('leader-tab');
    if (!el) return;
    if (!lord) {
      el.style.display = 'none';
      if (tab) tab.style.display = 'none';
      return;
    }

    const lordColor     = lord.color || '#4a9eff';
    const discoveredSet = (typeof Game !== 'undefined' && Game.getDiscoveredFactions) ? Game.getDiscoveredFactions() : null;

    if (tab) {
      tab.innerHTML = `<span style="color:${lordColor}">${lord.portrait}</span>`;
      tab.style.display = _leaderPanelOpen ? 'none' : 'flex';
    }
    if (!_leaderPanelOpen) { el.style.display = 'none'; return; }

    const traitHtml = (lord.traits || []).map(tid => {
      const t = (typeof TRAITS !== 'undefined') && TRAITS[tid];
      if (!t) return '';
      return `<div class="lp-trait">
        <span class="lp-trait-icon">${t.icon}</span>
        <div class="lp-trait-body">
          <span class="lp-trait-name">${t.name}</span>
          <span class="lp-trait-desc">${t.desc}</span>
        </div>
      </div>`;
    }).join('');

    const skills = lord.skills || {};
    const skillRow = (icon, label, val, color) =>
      `<div class="lp-skill-row">
        <span class="lp-skill-lbl">${icon} ${label}</span>
        <div class="lp-skill-bar"><div class="lp-skill-fill" style="width:${val}%;background:${color}"></div></div>
        <span class="lp-skill-val">${val}</span>
      </div>`;
    const skillsHtml = (skills.military !== undefined || skills.diplomacy !== undefined || skills.stewardship !== undefined) ? `
      <div class="lp-divider"></div>
      <div class="lp-section-label">Habilidades</div>
      <div class="lp-skills">
        ${skills.military    !== undefined ? skillRow('⚔','Militar',    skills.military,    '#c04020') : ''}
        ${skills.diplomacy   !== undefined ? skillRow('⚜','Diplomacia', skills.diplomacy,   '#4a9eff') : ''}
        ${skills.stewardship !== undefined ? skillRow('💰','Gestión',    skills.stewardship, '#c8940c') : ''}
      </div>` : '';

    const relations     = (typeof Game !== 'undefined' && Game.getRelations) ? Game.getRelations() : {};
    const otherFactions = (typeof FACTIONS !== 'undefined')
      ? FACTIONS.filter(f => f.id !== lord.id && (!discoveredSet || discoveredSet.has(f.id)))
      : [];
    const relHtml = Object.keys(relations).length > 0 && otherFactions.length > 0 ? `
      <div class="lp-divider"></div>
      <div class="lp-section-label">Relaciones</div>
      <div class="lp-relations">
        ${otherFactions.map(f => {
          const rel = relations[f.id] || 'neutral';
          return `<div class="lp-rel-row lp-rel-clickable" onclick="Game.openLeaderDialog('${f.id}')" title="Hablar con ${f.name}">
            <span class="lp-rel-sym" style="color:${f.color}">${f.symbol}</span>
            <span class="lp-rel-name">${f.name.split(' ')[0]}</span>
            <span class="lp-rel-icon">${_relIcon(rel)}</span>
            <span class="lp-rel-chat">💬</span>
          </div>`;
        }).join('')}
      </div>
      <button class="lp-dipl-btn" onclick="Game.openDiplomacy()">⚜ Diplomacia</button>
    ` : '';

    const victoryHtml = lord.victoryCondition ? `
      <div class="lp-divider"></div>
      <div class="lp-section-label">${lord.victoryCondition.icon} Victoria</div>
      <div class="lp-victory-short">${lord.victoryCondition.short}</div>
    ` : '';

    el.innerHTML = `
      <button class="lp-close-btn" onclick="UI.toggleLeaderPanel()" title="Ocultar panel">◀</button>
      <div class="lp-portrait" style="border-color:${lordColor}44">
        <div class="lp-symbol" style="color:${lordColor}">${lord.portrait}</div>
      </div>
      <div class="lp-name">${lord.name}</div>
      <div class="lp-title">${lord.title}</div>
      <div class="lp-faction" style="color:${lordColor}">${lord.playstyle}</div>
      ${lord.age ? `<div class="lp-age">Edad ${lord.age}</div>` : ''}
      <div class="lp-divider"></div>
      <div class="lp-section-label">Rasgos</div>
      <div class="lp-traits">${traitHtml}</div>
      ${skillsHtml}
      ${victoryHtml}
      ${relHtml}
    `;
    el.style.display = 'flex';
  }

  // ── Relation helpers (5-state) ────────────────
  function _relIcon(rel) {
    if (rel === 'war')            return '🔴';
    if (rel === 'alliance')       return '💙';
    if (rel === 'trade')          return '💹';
    if (rel === 'non_aggression') return '🛡';
    return '🟡';
  }
  function _relText(rel) {
    if (rel === 'war')            return 'Guerra';
    if (rel === 'alliance')       return 'Alianza';
    if (rel === 'trade')          return 'Comercio';
    if (rel === 'non_aggression') return 'No agresión';
    return 'Neutral';
  }
  function _relClass(rel) {
    if (rel === 'war')      return 'rel-war';
    if (rel === 'alliance') return 'rel-allied';
    if (rel === 'trade' || rel === 'non_aggression') return 'rel-trade';
    return 'rel-neutral';
  }

  // ── Diplomacy overview panel ──────────────────
  function showDiplomacyPanel(factions, relations) {
    let modal = document.getElementById('diplomacy-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'diplomacy-modal';
      document.body.appendChild(modal);
    }

    const cardsHtml = factions.map(f => {
      const rel = relations[f.id] || 'neutral';
      const relIcon  = _relIcon(rel);
      const relText  = _relText(rel);
      const relClass = _relClass(rel);
      return `<div class="dipl-card" onclick="Game.openLeaderDialog('${f.id}')" style="cursor:pointer">
        <div class="dipl-card-symbol" style="color:${f.color}">${f.symbol}</div>
        <div class="dipl-card-info">
          <div class="dipl-card-name" style="color:${f.color}">${f.name}</div>
          <div class="dipl-card-rel ${relClass}">${relIcon} ${relText}</div>
        </div>
        <div class="dipl-card-actions">
          <button class="dipl-btn ally" onclick="event.stopPropagation();Game.openLeaderDialog('${f.id}')">💬 Hablar</button>
        </div>
      </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="dipl-overlay" onclick="UI.closeDiplomacyPanel()"></div>
      <div class="dipl-frame">
        <div class="dipl-header">
          <span>⚜ Relaciones Diplomáticas</span>
          <button class="dipl-close" onclick="UI.closeDiplomacyPanel()">✕</button>
        </div>
        <div class="dipl-body">${cardsHtml}</div>
      </div>`;
    modal.style.display = 'block';
  }

  function closeDiplomacyPanel() {
    const modal = document.getElementById('diplomacy-modal');
    if (modal) modal.style.display = 'none';
  }

  // ── City Capture Decision panel ──────────────
  function showCaptureDecision(city, options, hex) {
    let modal = document.getElementById('capture-decision-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'capture-decision-modal';
      document.body.appendChild(modal);
    }
    const optCards = options.map(opt => `
      <div class="cd-option${opt.highlight ? ' cd-option--highlight' : ''}"
           style="border-color:${opt.color}55;background:${opt.color}18"
           onclick="Game.executeCaptureDecision({c:${hex.c},r:${hex.r}},'${opt.id}')">
        <div class="cd-opt-icon">${opt.icon}</div>
        <div class="cd-opt-label" style="color:${opt.color}">${opt.label}</div>
        <div class="cd-opt-desc">${opt.desc}</div>
      </div>`).join('');
    modal.innerHTML = `
      <div class="cd-overlay"></div>
      <div class="cd-frame">
        <div class="cd-header">
          <div class="cd-city-name">⚔ ${city.name}</div>
          <div class="cd-subtitle">¿Qué harás con esta ciudad?</div>
        </div>
        <div class="cd-options">${optCards}</div>
      </div>`;
    modal.style.display = 'flex';
  }

  function closeCaptureDecision() {
    const el = document.getElementById('capture-decision-modal');
    if (el) el.style.display = 'none';
  }

  // ── Victory screen ────────────────────────────
  function showVictoryScreen(lord) {
    let modal = document.getElementById('victory-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'victory-modal';
      document.body.appendChild(modal);
    }
    const vc = (lord && lord.victoryCondition) || {};
    modal.innerHTML = `
      <div class="victory-overlay"></div>
      <div class="victory-frame">
        <div class="victory-icon">${vc.icon || '👑'}</div>
        <div class="victory-title">¡Victoria!</div>
        <div class="victory-lord" style="color:${lord ? lord.color : '#c8a020'}">${lord ? lord.name : ''}</div>
        <div class="victory-condition">${vc.short || 'Campaña completada.'}</div>
        <div class="victory-desc">${vc.description || ''}</div>
        <button class="victory-btn" onclick="location.reload()">Nueva Campaña</button>
      </div>`;
    modal.style.display = 'flex';
  }

  // ── Leader dialog (talk to individual leader) ──
  const _leaderDialogLines = {
    guerrero: {
      war:     ['Tus ejércitos caerán. No habrá piedad.', 'La guerra es lo único que entiendo. Y aquí la traes.', '¿Pensabas que me acobardaría? Ven entonces.'],
      neutral: ['Nos observamos con respeto mutuo. Por ahora.', 'Aún no hay motivo para el acero. Pero podría haberlo pronto.'],
      alliance: ['Hombro con hombro en el campo de batalla. Así debe ser.', 'Tu causa es mi causa. Mis tropas están a tu servicio.'],
    },
    mercader: {
      war:     ['Esta guerra es costosa. Podríamos llegar a un acuerdo más rentable.', 'Destruirte es malo para el comercio. Reconsidera.'],
      neutral: ['El comercio entre nuestras tierras nos enriquecería a ambos.', 'Tenemos más en común de lo que crees.'],
      alliance: ['Nuestra alianza es la mejor inversión que hemos hecho.', 'Juntos, los mercados del mundo son nuestros.'],
    },
    estratega: {
      war:     ['Has cometido un error de cálculo. Lo pagarás.', 'Predije esta guerra. Y también predigo su resultado.'],
      neutral: ['Te estudio. Tú me estudias. Una danza inteligente.', 'La neutralidad es temporal. Ambos lo sabemos.'],
      alliance: ['Mis planes te incluyen. Confía en mis decisiones.', 'Juntos somos superiores. Las matemáticas no mienten.'],
    },
    piadoso: {
      war:     ['Que los dioses nos perdonen por este conflicto.', 'Lamento que haya llegado a esto. Aún podemos evitar más sangre.'],
      neutral: ['La paz es un don que debemos proteger juntos.', 'Mis oraciones incluyen la seguridad de tu pueblo.'],
      alliance: ['Que los dioses bendigan nuestra unión.', 'Caminaremos juntos bajo su protección.'],
    },
    cruel: {
      war:     ['Voy a destruirte con placer.', 'Tus lamentos serán música para mis oídos.'],
      neutral: ['Aún no he decidido qué hacer contigo.', 'Disfruto de esta incertidumbre. Tú no tanto, imagino.'],
      alliance: ['Eres útil por ahora. Veremos cuánto dura.', 'Traiciona mi confianza y aprenderás lo que soy capaz de hacer.'],
    },
  };

  function _getLeaderDialogLine(leader, relation) {
    const key = (leader.traits || [])[0] || 'estratega';
    const pool = (_leaderDialogLines[key] || _leaderDialogLines.estratega)[relation] ||
                 (_leaderDialogLines[key] || _leaderDialogLines.estratega).neutral;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showLeaderDialog(faction, relation) {
    const leader = (faction.leaders || [])[0];
    if (!leader) return;

    closeDiplomacyPanel();

    let modal = document.getElementById('leader-dialog-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'leader-dialog-modal';
      document.body.appendChild(modal);
    }

    const relIcon  = _relIcon(relation);
    const relText  = _relText(relation);
    const relClass = _relClass(relation);
    const dialogText = _getLeaderDialogLine(leader, relation);

    const traitBadges = (leader.traits || []).map(tid => {
      const t = (typeof TRAITS !== 'undefined') && TRAITS[tid];
      return t ? `<span class="ld-trait-badge">${t.icon} ${t.name}</span>` : '';
    }).join('');

    let actHtml = '';
    if (relation === 'war') {
      actHtml = `<button class="dipl-btn peace" onclick="Game.setRelation('${faction.id}','neutral',100)">🕊 Proponer Paz <small>(-100 💰)</small></button>`;
    } else if (relation === 'neutral') {
      actHtml = `
        <button class="dipl-btn war"  onclick="Game.setRelation('${faction.id}','war',0)">⚔ Declarar Guerra</button>
        <button class="dipl-btn ally" onclick="Game.setRelation('${faction.id}','non_aggression',50)">🛡 No Agresión <small>(-50 💰)</small></button>
        <button class="dipl-btn ally" onclick="Game.setRelation('${faction.id}','alliance',200)">🤝 Proponer Alianza <small>(-200 💰)</small></button>`;
    } else if (relation === 'non_aggression') {
      actHtml = `
        <button class="dipl-btn war"   onclick="Game.setRelation('${faction.id}','war',0)">⚔ Declarar Guerra</button>
        <button class="dipl-btn ally"  onclick="Game.setRelation('${faction.id}','trade',100)">💹 Acuerdo Comercial <small>(-100 💰)</small></button>
        <button class="dipl-btn ally"  onclick="Game.setRelation('${faction.id}','alliance',150)">🤝 Proponer Alianza <small>(-150 💰)</small></button>
        <button class="dipl-btn break" onclick="Game.setRelation('${faction.id}','neutral',0)">💔 Romper Pacto</button>`;
    } else if (relation === 'trade') {
      actHtml = `
        <button class="dipl-btn war"   onclick="Game.setRelation('${faction.id}','war',0)">⚔ Declarar Guerra</button>
        <button class="dipl-btn ally"  onclick="Game.setRelation('${faction.id}','alliance',100)">🤝 Proponer Alianza <small>(-100 💰)</small></button>
        <button class="dipl-btn break" onclick="Game.setRelation('${faction.id}','neutral',0)">💔 Romper Acuerdo</button>`;
    } else if (relation === 'alliance') {
      actHtml = `<button class="dipl-btn break" onclick="Game.setRelation('${faction.id}','neutral',0)">💔 Romper Alianza</button>`;
    }

    modal.innerHTML = `
      <div class="ld-overlay" onclick="UI.closeLeaderDialog()"></div>
      <div class="ld-frame">
        <div class="ld-header" style="border-bottom-color:${faction.color}44">
          <div class="ld-portrait" style="background:${faction.color}1a;border-color:${faction.color}55">
            <span style="color:${faction.color};font-size:28px">${faction.symbol}</span>
          </div>
          <div class="ld-identity">
            <div class="ld-leader-name" style="color:${faction.color}">${leader.name}</div>
            <div class="ld-leader-title">${leader.title}</div>
            <div class="ld-leader-faction">${faction.name}</div>
            ${traitBadges ? `<div class="ld-trait-badges">${traitBadges}</div>` : ''}
          </div>
          <button class="dipl-close" onclick="UI.closeLeaderDialog()">✕</button>
        </div>
        <div class="ld-speech-area">
          <div class="ld-speech-bubble">"${dialogText}"</div>
        </div>
        <div class="ld-footer">
          <div class="dipl-card-rel ${relClass}" style="font-size:9px">${relIcon} ${relText}</div>
          <div class="ld-actions">${actHtml}</div>
        </div>
      </div>`;
    modal.style.display = 'block';
  }

  function closeLeaderDialog() {
    const modal = document.getElementById('leader-dialog-modal');
    if (modal) modal.style.display = 'none';
  }

  // ── Event modal ───────────────────────────────
  function showEvent(ev, cb) {
    let el = document.getElementById('event-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'event-modal';
      document.body.appendChild(el);
    }
    el._evData = ev;
    el._evCb   = cb;
    el.innerHTML = `
      <div class="ev-frame">
        <div class="ev-icon">${ev.icon}</div>
        <div class="ev-title">${ev.title}</div>
        <div class="ev-desc">${ev.desc}</div>
        <div class="ev-choices">
          ${ev.choices.map((c, i) => `
            <button class="ev-choice" onclick="UI._resolveEventChoice(${i})">${c.text}</button>`
          ).join('')}
        </div>
      </div>`;
    el.style.display = 'flex';
  }

  function _resolveEventChoice(idx) {
    const el = document.getElementById('event-modal');
    if (!el) return;
    const ev = el._evData;
    const cb = el._evCb;
    el.style.display = 'none';
    if (ev && cb) cb(ev.choices[idx]);
  }

  // ── Init ─────────────────────────────────────
  function init() {
    _initTooltip();
    _initBrowserClickaway();
  }

  function updateEmpirePanel(cities, nodes) {
    const el = document.getElementById('empire-panel');
    if (!el) return;
    const playerCities = (cities || []).filter(c => c.owner === 'player');
    let html = '';

    if (playerCities.length) {
      html += `<div class="ep-section-label">Ciudades</div>`;
      playerCities.forEach(city => {
        const typeData = CITY_TYPES[city.type || 'aldea'];
        const income   = GameMap.getCityIncome(city);
        const incParts = [];
        if (income.gold) incParts.push(`💰${income.gold}`);
        if (income.iron) incParts.push(`⚙️${income.iron}`);
        if (income.food) incParts.push(`🌾${income.food}`);
        if (income.wood) incParts.push(`🌲${income.wood}`);
        html += `<div class="ep-row">
          <span class="ep-icon">${typeData.icon}</span>
          <div class="ep-city-info">
            <span class="ep-name">${city.name}</span>
            <span class="ep-tier">${typeData.name}</span>
          </div>
          <span class="ep-income">${incParts.map(p=>`<span>${p}</span>`).join('')}</span>
        </div>`;
      });
    }

    if (nodes && nodes.length) {
      html += `<div class="ep-section-label">Recursos</div>`;
      const grouped = {};
      nodes.forEach(n => { grouped[n.type] = (grouped[n.type] || 0) + n.income; });
      Object.entries(grouped).forEach(([type, total]) => {
        const def = RESOURCE_DEF[type];
        html += `<div class="ep-node-row">
          <span class="ep-node-icon">${def?.icon || type}</span>
          <span class="ep-node-label">${def?.label || type}</span>
          <span class="ep-node-val">+${total}/t</span>
        </div>`;
      });
    }

    el.innerHTML = html;
  }

  // ── Battle log ────────────────────────────────
  const _battleLog = [];
  let _battleLogCounter = 0;

  function addBattleEvent(ev) {
    ev._id = ++_battleLogCounter;
    ev._expanded = false;
    _battleLog.unshift(ev);
    if (_battleLog.length > 30) _battleLog.length = 30;
    _renderBattleLog();
  }

  function _toggleBattleEvent(id) {
    const ev = _battleLog.find(e => e._id === id);
    if (ev) { ev._expanded = !ev._expanded; _renderBattleLog(); }
  }

  function _dismissBattleEvent(id) {
    const idx = _battleLog.findIndex(e => e._id === id);
    if (idx !== -1) { _battleLog.splice(idx, 1); _renderBattleLog(); }
  }

  function _renderBattleLog() {
    const el = document.getElementById('battle-log-panel');
    if (!el) return;
    if (!_battleLog.length) { el.innerHTML = ''; return; }

    const TERRAIN_LABEL = { plains:'Llanura', forest:'Bosque', mountain:'Montaña', desert:'Desierto', water:'Agua' };

    const unitRow = u => {
      const dmg    = u.startHp - u.endHp;
      const killed = u.endHp === 0;
      return `<div class="bl-unit${killed ? ' killed' : ''}">
        <span class="bl-unit-icon">${u.icon}</span>
        <span class="bl-unit-name">${u.name}</span>
        ${killed
          ? `<span class="bl-dead">☠</span>`
          : `<span class="bl-dmg">-${dmg}</span><span class="bl-hp">${u.endHp}hp</span>`}
      </div>`;
    };

    const evHtml = ev => {
      const won = ev.winner === 'attacker';
      const retreated = won ? ev.defRetreated : ev.attRetreated;
      const resultLabel = won
        ? (retreated ? '⚔ Victoria — enemigo se retira' : '⚔ Victoria — enemigo aniquilado')
        : (retreated ? '☠ Derrota — te retiras' : '☠ Derrota — aniquilado');
      const survivorsLabel = ev.casualties
        ? `${ev.casualties.att.start - ev.casualties.att.lost}/${ev.casualties.att.start} supervivientes`
        : '';
      const bodyHtml = ev._expanded ? `
        <div class="bl-body">
          <div class="bl-side">
            <div class="bl-side-label">Tus tropas</div>
            ${ev.attackers.map(unitRow).join('')}
          </div>
          <div class="bl-divider"></div>
          <div class="bl-side">
            <div class="bl-side-label">Enemigo</div>
            ${ev.defenders.map(unitRow).join('')}
          </div>
        </div>` : '';

      return `<div class="bl-event">
        <div class="bl-meta" onclick="UI._toggleBattleEvent(${ev._id})">
          <span class="bl-toggle">${ev._expanded ? '▾' : '▸'}</span>
          <span class="bl-turn">T${ev.turn}</span>
          <span class="bl-terrain">${TERRAIN_LABEL[ev.terrain] || ev.terrain}</span>
          <span class="bl-result ${won ? 'win' : 'loss'}">${resultLabel}</span>
          ${survivorsLabel ? `<span class="bl-survivors">${survivorsLabel}</span>` : ''}
          <button class="bl-dismiss" onclick="event.stopPropagation();UI._dismissBattleEvent(${ev._id})">×</button>
        </div>
        ${bodyHtml}
      </div>`;
    };

    el.innerHTML = `<div class="bl-header-bar">⚔ Registro de Batallas</div>` +
      _battleLog.map(evHtml).join('');
  }

  return {
    init, showPanel, showIdle, showUnit, showCity, showArmy, showGroup, updateHUD, toast, updateEmpirePanel, addBattleEvent,
    _toggleBattleEvent, _dismissBattleEvent,
    _openBuildingBrowser, _closeBuildingBrowser, _changeBrowserCat, _buildFromBrowser,
    _onSlotClick, _buildAndClose, _closeUpgradePicker,
    _showBldHover, _showUnitHover, _showUnitTypeHover, _hideHoverPanel,
    _openImgPicker, _closeImgPicker, _switchPickerCat, _buildFromPicker,
    _openRecruitModal, _closeRecruitModal, _switchRecruitTab, _recruitUnit,
    _openRaiseArmyModal, _closeRaiseArmyModal, _doRaiseArmy, _onDisbandClick,
    showEvent, _resolveEventChoice,
    updateLeaderPanel, toggleLeaderPanel,
    showDiplomacyPanel, closeDiplomacyPanel,
    showLeaderDialog, closeLeaderDialog,
    showCaptureDecision, closeCaptureDecision,
    showVictoryScreen,
  };
})();
