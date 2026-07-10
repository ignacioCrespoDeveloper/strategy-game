// =============================================
//  lord-screen.js — Full-screen lord management
// =============================================

const LordScreen = (() => {
  let _lord      = null;
  let _player    = null;
  let _activeTab = 'overview';
  let _tickTimer = null;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _player    = player;
    _lord      = LordService.getById(lord.id);
    _activeTab = 'overview';

    _migrateLord();
    if (LordService.tickHp(_lord)) {
      LordService.save(_lord);
      _lord = LordService.getById(_lord.id);
    }

    // Position migration for lords created before position tracking.
    if (_lord.x == null && _lord.cityIds && _lord.cityIds.length > 0) {
      const city = CityService.getById(_lord.cityIds[0]);
      if (city) LordService.setPosition(_lord.id, city.x, city.y);
      _lord = LordService.getById(_lord.id);
    }

    DiscoveryService.expireOld(_player.id);

    const completed = LordService.tickActions(_lord);
    if (completed.length > 0) {
      _lord = LordService.getById(_lord.id);
      completed.forEach(c => {
        if (c.actionId === 'search_area') _resolveSearch();
        else _toast(`✓ ${c.name} completed!`);
        if (c.leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
      });
    }

    root.innerHTML = _shell();
    _renderTab();
    _bindEvents();
    _startCountdown();
  }

  // Normalise all legacy lord formats to the current schema.
  function _migrateLord() {
    let changed = false;

    // Legacy: str/agi/int/vit → baseStats
    if (_lord.stats && _lord.stats.str !== undefined && !_lord.baseStats) {
      const s = _lord.stats;
      _lord.baseStats = { health: 50 + (s.vit || 5) * 10, attack: s.str || 5, defense: s.vit || 5, leadership: 5, magic: s.int || 5, speed: s.agi || 5 };
      delete _lord.stats;
      changed = true;
    }

    // Legacy: atk/def/hp/mag/spd → baseStats
    if (_lord.stats && _lord.stats.atk !== undefined && !_lord.baseStats) {
      const s = _lord.stats;
      _lord.baseStats = { health: s.hp || 100, attack: s.atk || 5, defense: s.def || 5, leadership: 5, magic: s.mag || 5, speed: s.spd || 5 };
      delete _lord.stats;
      changed = true;
    }

    if (!_lord.baseStats)           { _lord.baseStats    = { ...LORD_BASE_STATS }; changed = true; }
    if (!_lord.classId)             { _lord.classId      = 'warrior';              changed = true; }
    if (_lord.talentPoints == null) { _lord.talentPoints = 0;                      changed = true; }
    if (_lord.currentHp    == null) { _lord.currentHp    = LordService.getEffectiveStats(_lord).health; changed = true; }
    if (_lord.hpRegenAt    == null) { _lord.hpRegenAt    = TimeService.now();      changed = true; }

    if (changed) LordService.save(_lord);
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const race = RACES[_lord?.race] || {};
    const cls  = LORD_CLASSES[_lord?.classId];
    return `
      <div class="ls-fullscreen">

        <header class="ls-header">
          <button class="ls-back-btn" id="ls-back">← Overview</button>
          <div class="ls-title">
            ${race.portrait
              ? `<img class="ls-header-portrait" src="${race.portrait}" alt="${race.name}" />`
              : `<span class="ls-portrait">${race.icon || '👤'}</span>`}
            <span class="ls-lord-name">${_lord.name}</span>
            <span class="ls-race-badge">${race.name || ''}</span>
            ${cls ? `<span class="ls-class-badge" style="color:${cls.color};border-color:${cls.color}40">${cls.icon} ${cls.name}</span>` : ''}
            <button class="ls-map-btn" id="ls-map-btn">🗺 World Map</button>
          </div>
        </header>

        <div class="ls-body">

          <aside class="ls-left" id="ls-left">
            ${_leftPanelHtml()}
          </aside>

          <div class="ls-right">
            <nav class="ls-tabs">
              <button class="ls-tab ${_activeTab === 'overview'  ? 'ls-tab--active' : ''}" data-tab="overview">📍 Overview</button>
              <button class="ls-tab ${_activeTab === 'army'      ? 'ls-tab--active' : ''}" data-tab="army">⚔ Army</button>
              <button class="ls-tab ${_activeTab === 'discovery' ? 'ls-tab--active' : ''}" data-tab="discovery">🔍 Discovery</button>
            </nav>
            <div class="ls-content" id="ls-content"></div>
          </div>

        </div>
      </div>

      <div class="disc-overlay hidden" id="disc-overlay">
        <div class="disc-popup" id="disc-popup"></div>
      </div>

    `;
  }

  // ── Left panel — RPG hero sheet ───────────────────────────────

  function _leftPanelHtml() {
    const race    = RACES[_lord?.race] || {};
    const cls     = LORD_CLASSES[_lord?.classId];
    const level   = _lord.level || 1;
    const xp      = _lord.xp || 0;
    const xpNext  = _lord.xpToNext || 100;
    const xpPct   = Math.min(100, Math.floor((xp / xpNext) * 100));
    const talent  = _lord.talentPoints || 0;

    const effective = LordService.getEffectiveStats(_lord);
    const maxHp     = effective.health;
    const curHp     = Math.min(_lord.currentHp ?? maxHp, maxHp);
    const hpPct     = Math.min(100, Math.floor((curHp / maxHp) * 100));
    const mods      = cls?.modifiers || {};

    // Portrait
    const portraitHtml = race.portrait
      ? `<div class="lsl-portrait-area lsl-portrait-area--image">
           <img class="lsl-portrait-img" src="${race.portrait}" alt="${race.name}" />
           <div class="lsl-portrait-fade"></div>
           <div class="lsl-portrait-glow" style="background:radial-gradient(ellipse at 50% 80%, ${race.portraitGlow || 'rgba(200,147,58,0.25)'} 0%, transparent 70%)"></div>
           <div class="lsl-portrait-level">Lv ${level}</div>
           <div class="lsl-portrait-nameplate">
             <span class="lsl-portrait-lord-name">${_lord.name}</span>
             <div class="lsl-portrait-badges">
               <span class="lsl-portrait-race-name">${race.name}</span>
               ${cls ? `<span class="lsl-portrait-class-name" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
             </div>
           </div>
         </div>`
      : `<div class="lsl-portrait-area">
           <div class="lsl-portrait">${race.icon || '👤'}</div>
           <div class="lsl-portrait-level">Lv ${level}</div>
         </div>`;

    // Stat bars
    const statBarsHtml = Object.entries(LORD_STAT_META).map(([key, meta]) => {
      const total  = effective[key] ?? LORD_BASE_STATS[key];
      const maxVal = LORD_STAT_MAX[key] || 20;
      const pct    = Math.min(100, Math.floor((total / maxVal) * 100));
      return `
        <div class="lsh-stat-row">
          <div class="lsh-stat-label">
            <span class="lsh-stat-icon">${meta.icon}</span>
            <span class="lsh-stat-name">${meta.label}</span>
          </div>
          <div class="lsh-stat-bar">
            <div class="lsh-stat-fill" style="width:${pct}%;background:${meta.color}"></div>
          </div>
          <div class="lsh-stat-val">
            <span class="lsh-stat-total">${total}</span>
          </div>
        </div>
      `;
    }).join('');

    // Passive trait
    const passiveHtml = cls?.passive ? `
      <div class="cvl-divider"></div>
      <div class="lsh-section">
        <div class="lsh-section-title">Passive Trait</div>
        <div class="lsh-passive-card">
          <div class="lsh-passive-icon">${cls.passive.icon}</div>
          <div class="lsh-passive-body">
            <div class="lsh-passive-name">${cls.passive.name}</div>
            <div class="lsh-passive-desc">${cls.passive.description}</div>
          </div>
        </div>
      </div>
    ` : '';

    // Talent points
    const talentHtml = `
      <div class="cvl-divider"></div>
      <div class="lsh-section">
        <div class="lsh-section-title">Talent Points</div>
        ${talent > 0
          ? `<div class="lsh-talent-available">✦ ${talent} Point${talent !== 1 ? 's' : ''} Available</div>`
          : `<div class="lsh-talent-none">Level up to earn Talent Points</div>`}
        <button class="lsh-talent-tree-btn" disabled>✦ Talent Tree (coming soon)</button>
      </div>
    `;

    return `
      ${portraitHtml}

      <div class="lsl-info">
        ${race.portrait ? '' : `
          <div class="lsl-name">${_lord.name}</div>
          <div class="lsl-race">${race.name || ''}</div>
          ${cls ? `<div class="lsh-class-badge-row"><span class="lsh-class-badge" style="color:${cls.color};border-color:${cls.color}50">${cls.icon} ${cls.name}</span></div>` : ''}
        `}
        <div class="lsl-hp-bar">
          <div class="lsl-hp-fill" style="width:${hpPct}%"></div>
        </div>
        <div class="lsl-bar-label-row">
          <span class="lsl-bar-label-icon">❤</span>
          <span class="lsl-bar-label-val">${curHp} / ${maxHp}</span>
        </div>
        <div class="lsl-xp-bar">
          <div class="lsl-xp-fill" style="width:${xpPct}%"></div>
        </div>
        <div class="lsl-bar-label-row">
          <span class="lsl-bar-label-icon">⭐</span>
          <span class="lsl-bar-label-val">${xp} / ${xpNext} XP</span>
        </div>
      </div>

      ${_positionHtml()}

      <div class="cvl-divider"></div>
      <div class="lsh-section">
        <div class="lsh-section-title">Statistics</div>
        <div class="lsh-stat-list">${statBarsHtml}</div>
      </div>

      ${passiveHtml}
      ${talentHtml}

    `;
  }

  function _positionHtml() {
    if (_lord.x == null) {
      return `
        <div class="cvl-divider"></div>
        <div class="lsl-pos-row lsl-pos--unknown">
          <span class="lsl-pos-icon">📍</span>
          <span class="lsl-pos-label">No Position</span>
        </div>
      `;
    }
    const terrain = WorldService.getTerrain(_lord.x, _lord.y);
    const active  = DiscoveryService.getActive(_player.id)
      .filter(r => r.tileX === _lord.x && r.tileY === _lord.y);
    return `
      <div class="cvl-divider"></div>
      <div class="lsl-pos-row">
        <span class="lsl-pos-icon">📍</span>
        <div class="lsl-pos-body">
          <div class="lsl-pos-coords">(${_lord.x}, ${_lord.y})</div>
          <div class="lsl-pos-terrain">${terrain.icon} ${terrain.name}</div>
        </div>
        ${active.length > 0
          ? `<span class="lsl-pos-disc-count" title="${active.length} discovery here">🔍 ${active.length}</span>`
          : ''}
      </div>
    `;
  }

  // ── Tab rendering ─────────────────────────────────────────────

  function _renderTab() {
    const content = document.getElementById('ls-content');
    if (!content) return;
    const left = document.getElementById('ls-left');
    if (left) left.innerHTML = _leftPanelHtml();

    switch (_activeTab) {
      case 'overview':
        content.innerHTML = _overviewTabHtml();
        document.getElementById('lov-finish-lord')?.addEventListener('click', _finishLordActionNow);
        document.getElementById('lov-search-btn')?.addEventListener('click', () => {
          const result = LordService.enqueueAction(_lord, 'search_area');
          if (!result.ok) { _toast(result.error); return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        document.getElementById('lov-move-btn')?.addEventListener('click', () => {
          _stopCountdown();
          App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id), mode: 'move-lord' });
        });
        break;
      case 'army':
        content.innerHTML = _armyHtml();
        _bindArmyEvents();
        break;
      case 'discovery':
        content.innerHTML = _discoveriesHtml();
        _bindDiscoveryEvents();
        break;
    }
  }

  // ── Overview tab ──────────────────────────────────────────────

  function _overviewTabHtml() {
    const busy      = _lord.actionQueue.length > 0;
    const queueItem = busy ? _lord.actionQueue[0] : null;
    const secs      = busy ? LordService.actionTimeRemaining(_lord) : 0;
    const pct       = busy ? Math.floor(LordService.actionProgress(_lord) * 100) : 0;

    // ── Status ────────────────────────────────────────────────────
    let statusHtml;
    if (!busy) {
      statusHtml = `<div class="lov-status lov-status--idle">⏳ Idle — no active task</div>`;
    } else if (queueItem.actionId === 'move_lord') {
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status lov-status--traveling">🗺 Traveling to (${queueItem.destX}, ${queueItem.destY})</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          <button class="ls-finish-btn" id="lov-finish-lord">⚡ ${cost}💎</button>
        </div>
      `;
    } else if (queueItem.actionId === 'search_area') {
      statusHtml = `<div class="lov-status lov-status--searching">🔍 Searching Area — see location below</div>`;
    }

    // ── Location card ─────────────────────────────────────────────
    let terrainHtml;
    if (_lord.x == null) {
      terrainHtml = `<p class="lov-pos-none">No position — claim a city to place your lord on the map.</p>`;
    } else {
      const terrain     = WorldService.getTerrain(_lord.x, _lord.y);
      const isSearching = busy && queueItem.actionId === 'search_area';
      const isTraveling = busy && queueItem.actionId === 'move_lord';

      // Discoveries already found on this tile
      const tileDiscs = DiscoveryService.getActive(_player.id)
        .filter(r => r.tileX === _lord.x && r.tileY === _lord.y);
      const discCountHtml = tileDiscs.length > 0
        ? `<div class="lov-lc-disc">🔍 ${tileDiscs.length} discover${tileDiscs.length > 1 ? 'ies' : 'y'} on this tile</div>`
        : `<div class="lov-lc-disc lov-lc-disc--none">🔍 No discoveries here yet</div>`;

      // Search action
      let searchHtml;
      if (isSearching) {
        const searchCost = _creditCost(secs);
        searchHtml = `
          <div class="lov-progress-row" style="margin-top:0.4rem">
            <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
            <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
            <button class="ls-finish-btn" id="lov-finish-lord">⚡ ${searchCost}💎</button>
          </div>`;
      } else if (!busy) {
        searchHtml = `
          <div class="lov-lc-btns">
            <button class="lov-search-btn" id="lov-search-btn">🔍 Search Area</button>
            <button class="lov-move-btn" id="lov-move-btn">🗺 Go to Map</button>
          </div>`;
      } else {
        searchHtml = isTraveling
          ? `<span class="lov-lc-busy">Arrive first to search this tile</span>`
          : `<span class="lov-lc-busy">Lord is busy</span>`;
      }

      // Image / fallback
      const imgHtml = terrain.image
        ? `<img src="${terrain.image}" class="lov-lc-img" alt="${terrain.name}" loading="lazy">`
        : `<div class="lov-lc-img lov-lc-img--fallback" style="background:linear-gradient(160deg,${terrain.canvasBorder} 0%,${terrain.canvasBg} 100%)">${terrain.icon}</div>`;

      terrainHtml = `
        <div class="lov-location-card" style="border-color:${terrain.canvasBorder}">
          ${imgHtml}
          <div class="lov-lc-body">
            <div class="lov-lc-header">
              <div class="lov-lc-name">${terrain.icon} ${terrain.name}</div>
              <div class="lov-lc-coords">📍 (${_lord.x}, ${_lord.y})${isTraveling ? ` → (${queueItem.destX}, ${queueItem.destY})` : ''}</div>
            </div>
            <div class="lov-lc-hint">${terrain.searchHint}</div>
            ${discCountHtml}
            ${searchHtml}
          </div>
        </div>
      `;
    }

    // ── Army ──────────────────────────────────────────────────────
    const army        = ArmyService.get(_lord.id);
    const totalUnits  = army.units.reduce((s, u) => s + u.count, 0);
    const totalUpkeep = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
    const armyHtml    = army.units.length === 0
      ? `<p class="lov-pos-none">No troops mustered — recruit from the Army tab.</p>`
      : `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: false })}</div>
        <div class="la-army-total">
          ${totalUnits} / 10 units
          <span class="la-army-upkeep">💸 ${totalUpkeep}/24h upkeep</span>
        </div>
      `;

    return `
      <div class="lov-tab">
        <div class="lov-section">
          <div class="lov-section-title">Status</div>
          ${statusHtml}
        </div>
        <div class="lov-section-divider"></div>
        <div class="lov-section">
          <div class="lov-section-title">Location</div>
          ${terrainHtml}
        </div>
        <div class="lov-section-divider"></div>
        <div class="lov-section">
          <div class="lov-section-title">Army</div>
          ${armyHtml}
        </div>
      </div>
    `;
  }

  // ── Army tab ──────────────────────────────────────────────────

  function _traitBadgesHtml(def) {
    if (!def.traits || def.traits.length === 0) return '';
    const badges = def.traits.map(tid => {
      const t = TRAIT_DEFS[tid];
      if (!t) return '';
      return `<span class="la-unit-trait" title="${t.description}">${t.name}</span>`;
    }).join('');
    return `<div class="la-unit-traits">${badges}</div>`;
  }

  function _abilityBadgesHtml(def) {
    if (!def.abilities || def.abilities.length === 0) return '';
    const badges = def.abilities.map(aid => {
      const a = ABILITY_DEFS[aid];
      if (!a) return '';
      return `<span class="la-unit-ability" title="${a.description}">✦ ${a.name}</span>`;
    }).join('');
    return `<div class="la-unit-abilities">${badges}</div>`;
  }

  function _tagBadgesHtml(def) {
    if (!def.tags || def.tags.length === 0) return '';
    const badges = def.tags.map(tid => {
      const t = TAG_DEFS[tid];
      return `<span class="la-unit-tag">${t ? t.name : tid}</span>`;
    }).join('');
    return `<div class="la-unit-tags">${badges}</div>`;
  }

  function _unitPortraitHtml(def) {
    if (def.image) return `<img src="${def.image}" class="la-recruit-img" alt="${def.name}" loading="lazy">`;
    return `<div class="la-recruit-icon">${def.icon}</div>`;
  }

  function _getLordCurrentCity() {
    if (_lord.x == null) return null;
    return CityService.getLordCities(_lord.id).find(c => c.x === _lord.x && c.y === _lord.y) || null;
  }

  // ── Shared unit card builder ───────────────────────────────────

  function _cardTierClass(category) {
    if (category === 'mercenary') return 'la-unit-card--merc';
    if (category === 'elite' || category === 'cavalry') return 'la-unit-card--elite';
    if (category === 'monster') return 'la-unit-card--monster';
    if (category === 'legendary') return 'la-unit-card--legendary';
    return '';
  }

  function _buildUnitCard(def, { removable = false } = {}) {
    const tierClass = _cardTierClass(def.category);
    const portrait = def.image
      ? `<img src="${def.image}" class="la-uc-img" alt="${def.name}" loading="lazy">`
      : `<div class="la-uc-img la-uc-img--fallback">${def.icon}</div>`;

    const traitsHtml = (def.traits || []).map(tid => {
      const t = TRAIT_DEFS[tid];
      return t ? `<div class="la-tt-row la-tt-row--trait"><b>${t.name}</b> — ${t.description}</div>` : '';
    }).join('');

    const abilitiesHtml = (def.abilities || []).map(aid => {
      const a = ABILITY_DEFS[aid];
      return a ? `<div class="la-tt-row la-tt-row--ability"><b>✦ ${a.name}</b> — ${a.description}</div>` : '';
    }).join('');

    const tagsHtml = (def.tags || []).map(tid => {
      const t = TAG_DEFS[tid];
      return `<span class="la-tt-tag">${t ? t.name : tid}</span>`;
    }).join('');

    const removeBtn = removable
      ? `<button class="la-uc-remove" data-unit-id="${def.id}" title="Dismiss 1">×</button>`
      : '';

    return `
      <div class="la-uc-wrap">
        <div class="la-unit-card${tierClass ? ' ' + tierClass : ''}">
          <div class="la-uc-top">
            <div class="la-uc-hpbar"><div class="la-uc-hpfill"></div></div>
          </div>
          ${portrait}
          ${removeBtn}
        </div>
        <div class="la-uc-tooltip">
          <div class="la-tt-name">${def.name}${def.category === 'mercenary' ? ' <span class="la-merc-badge">Merc</span>' : ''}</div>
          <div class="la-tt-stats">
            <span title="Attack">⚔ ${def.combatStats.attack}</span>
            <span title="Defense">🛡 ${def.combatStats.defense}</span>
            <span title="HP">❤ ${def.combatStats.hp}</span>
            <span title="Speed">💨 ${def.combatStats.speed}</span>
          </div>
          <div class="la-tt-cost">💰${def.goldCost} · 💸${def.upkeep}/24h</div>
          ${traitsHtml ? `<div class="la-tt-section">${traitsHtml}</div>` : ''}
          ${abilitiesHtml ? `<div class="la-tt-section">${abilitiesHtml}</div>` : ''}
          ${tagsHtml ? `<div class="la-tt-tags">${tagsHtml}</div>` : ''}
        </div>
      </div>
    `;
  }

  function _armyCardsHtml(army, opts = {}) {
    return army.units.flatMap(stack => {
      const def = UNIT_DEFS[stack.unitId];
      if (!def) return [];
      return Array.from({ length: stack.count }, () => _buildUnitCard(def, opts));
    }).join('');
  }

  const ARMY_LIMIT = 10;

  function _armyHtml() {
    const army        = ArmyService.get(_lord.id);
    const city        = _getLordCurrentCity();
    const player      = PlayerService.getById(_player.id);
    const isTraveling = _lord.actionQueue.length > 0 && _lord.actionQueue[0].actionId === 'move_lord';
    const totalUnits  = army.units.reduce((s, u) => s + u.count, 0);
    const atLimit     = totalUnits >= ARMY_LIMIT;

    // ── Current Army ───────────────────────────────────────────
    let armyListHtml;
    if (army.units.length === 0) {
      armyListHtml = `
        <div class="la-placeholder" style="padding:1rem 0">
          <div class="la-placeholder-icon">⚔</div>
          <div class="la-placeholder-text">No troops mustered</div>
          <div class="la-placeholder-sub">Recruit from your city or hire mercenaries in the field.</div>
        </div>
      `;
    } else {
      const total       = army.units.reduce((s, u) => s + u.count, 0);
      const totalUpkeep = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
      armyListHtml = `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: true })}</div>
        <div class="la-army-total">
          ${total} / 10 units
          <span class="la-army-upkeep">💸 ${totalUpkeep}/24h upkeep</span>
        </div>
      `;
    }

    // ── Recruitment (city-based) ───────────────────────────────
    let recruitSectionHtml;
    if (isTraveling) {
      recruitSectionHtml = `<p class="la-recruit-note">Cannot recruit while traveling.</p>`;
    } else if (!city) {
      recruitSectionHtml = `<p class="la-recruit-note">Your lord must be standing inside one of your cities to recruit.</p>`;
    } else {
      const queue    = city.recruitmentQueue || [];
      const busy     = queue.length > 0;

      let queueHtml = '';
      if (busy) {
        const job  = queue[0];
        const uDef = UNIT_DEFS[job.unitId];
        const pct  = Math.floor(RecruitmentService.progress(city) * 100);
        const secs = RecruitmentService.timeRemaining(city);
        const recruitCost = _creditCost(secs);
        queueHtml = `
          <div class="la-recruit-queue">
            <div class="la-recruit-queue-label">${uDef?.icon || '⚔'} Training ${uDef?.name || job.unitId} ×${job.count}</div>
            <div class="la-progress-row">
              <div class="la-bar"><div class="la-fill" id="la-recruit-fill" style="width:${pct}%"></div></div>
              <span class="la-timer" id="la-recruit-timer">${TimeService.formatDuration(secs)}</span>
              <button class="ls-finish-btn" id="la-finish-recruit">⚡ ${recruitCost}💎</button>
            </div>
          </div>
        `;
      }

      const available = RecruitmentService.getAvailableFromCity(_lord, city);
      let cardsHtml;
      if (available.length === 0) {
        cardsHtml = `<p class="la-recruit-note">No units unlocked yet — build Barracks, Archery Range or Stables.</p>`;
      } else {
        cardsHtml = available.map(({ unitId }) => {
          const def       = UNIT_DEFS[unitId];
          if (!def) return '';
          const canAfford = (player.coins || 0) >= def.goldCost;
          const disabled  = busy || !canAfford || atLimit;
          const btnLabel  = busy ? 'Training…' : atLimit ? 'Army Full' : canAfford ? 'Recruit' : 'No gold';
          return `
            <div class="la-recruit-card ${busy ? 'la-recruit-card--busy' : ''}">
              ${_unitPortraitHtml(def)}
              <div class="la-recruit-body">
                <div class="la-recruit-name">${def.name}</div>
                <div class="la-recruit-stats">⚔${def.combatStats.attack} 🛡${def.combatStats.defense} ❤${def.combatStats.hp} 💨${def.combatStats.speed}</div>
                <div class="la-recruit-cost">💰${def.goldCost} · ⏱${TimeService.formatDuration(def.recruitTime)}</div>
                <div class="la-recruit-upkeep">💸 ${def.upkeep}/24h upkeep</div>
                ${_traitBadgesHtml(def)}
                ${_abilityBadgesHtml(def)}
                ${_tagBadgesHtml(def)}
              </div>
              <button class="la-recruit-btn bld-btn--ready" data-unit-id="${unitId}"
                      ${disabled ? 'disabled' : ''}>
                ${btnLabel}
              </button>
            </div>
          `;
        }).join('');
      }
      recruitSectionHtml = `${queueHtml}${cardsHtml}`;
    }

    // ── Mercenaries (from negotiated discoveries) ──────────────
    const mercDiscoveries = RecruitmentService.getAvailableFromDiscoveries(_player.id);
    let mercHtml = '';
    if (mercDiscoveries.length > 0) {
      const cityQueue  = city ? (city.recruitmentQueue || []) : [];
      const cityBusy   = cityQueue.length > 0;
      const mercGroups = mercDiscoveries.map(record => {
        const discDef = DISCOVERY_DEFS[record.definitionId];
        const cards   = record.mercenaryUnits.map(unitId => {
          const def       = UNIT_DEFS[unitId];
          if (!def) return '';
          const canAfford = (player.coins || 0) >= def.goldCost;
          const disabled  = !canAfford || atLimit;
          const btnLabel  = atLimit ? 'Army Full' : canAfford ? 'Hire' : 'No gold';
          return `
            <div class="la-recruit-card">
              ${_unitPortraitHtml(def)}
              <div class="la-recruit-body">
                <div class="la-recruit-name">${def.name} <span class="la-merc-badge">Mercenary</span></div>
                <div class="la-recruit-stats">⚔${def.combatStats.attack} 🛡${def.combatStats.defense} ❤${def.combatStats.hp} 💨${def.combatStats.speed}</div>
                <div class="la-recruit-cost">💰${def.goldCost} · Instant</div>
                <div class="la-recruit-upkeep">💸 ${def.upkeep}/24h upkeep</div>
                ${_traitBadgesHtml(def)}
                ${_tagBadgesHtml(def)}
              </div>
              <button class="la-recruit-btn la-hire-btn" data-unit-id="${unitId}"
                      ${disabled ? 'disabled' : ''}>
                ${btnLabel}
              </button>
            </div>
          `;
        }).join('');
        return `<div class="la-merc-group"><div class="la-merc-group-title">${discDef?.icon || '⚔'} ${discDef?.name || record.definitionId}</div>${cards}</div>`;
      }).join('');

      mercHtml = `
        <div class="la-section-divider"></div>
        <div class="la-section-title">Mercenaries</div>
        ${mercGroups}
      `;
    }

    return `
      <div class="la-army-tab">
        <div class="la-section-title">Army</div>
        ${armyListHtml}
        <div class="la-section-divider"></div>
        <div class="la-section-title">Recruit</div>
        ${recruitSectionHtml}
        ${mercHtml}
      </div>
    `;
  }

  function _bindArmyEvents() {
    // Finish recruitment instantly
    document.getElementById('la-finish-recruit')?.addEventListener('click', _finishRecruitmentNow);

    // Dismiss unit from army
    document.querySelectorAll('.la-uc-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const def = UNIT_DEFS[btn.dataset.unitId];
        ArmyService.removeUnits(_lord.id, btn.dataset.unitId, 1);
        if (def) _toast(`${def.icon} ${def.name} dismissed.`);
        _renderTab();
      });
    });

    // City recruitment
    document.querySelectorAll('.la-recruit-btn[data-unit-id]:not(.la-hire-btn):not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const city = _getLordCurrentCity();
        if (!city) { _toast('Must be at your city to recruit.'); return; }
        const result = RecruitmentService.enqueue(_lord, city, btn.dataset.unitId, 1);
        if (!result.ok) { _toast(result.error); return; }
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _renderTab();
        _startCountdown();
      });
    });

    // Mercenary instant hire
    document.querySelectorAll('.la-hire-btn[data-unit-id]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const unitId    = btn.dataset.unitId;
        const def       = UNIT_DEFS[unitId];
        if (!def) return;
        const p         = PlayerService.getById(_player.id);
        if ((p.coins || 0) < def.goldCost) { _toast('Not enough gold.'); return; }
        PlayerService.update(_lord.playerId, { coins: p.coins - def.goldCost });
        ArmyService.addUnits(_lord.id, unitId, 1);
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _toast(`${def.icon} ${def.name} hired!`);
        _renderTab();
      });
    });
  }

  // ── Discovery tab ─────────────────────────────────────────────

  function _discoveriesHtml() {
    const active = DiscoveryService.getActive(_player.id);

    if (active.length === 0) {
      return `
        <div class="la-placeholder">
          <div class="la-placeholder-icon">🔍</div>
          <div class="la-placeholder-text">No Active Discoveries</div>
          <div class="la-placeholder-sub">Use <strong>Search Area</strong> to explore tiles and uncover hidden opportunities.</div>
        </div>
      `;
    }

    const _CLAIM_LABELS = {
      combat:    '⚔ Fight',
      resource:  '📦 Collect',
      event:     '📜 Explore',
      trade:     '🤝 Trade',
      legendary: '✨ Claim',
    };

    const rows = active.map(record => {
      const def      = DISCOVERY_DEFS[record.definitionId];
      if (!def) return '';
      const catMeta  = DISCOVERY_CATEGORY_META[def.category] || DISCOVERY_CATEGORY_META.event;
      const terrain  = TERRAIN_TYPES[record.terrain] || { icon: '?', name: record.terrain };
      const expiry   = DiscoveryService.formatExpiry(record);
      const isExpiring = record.expiresAt && (record.expiresAt - TimeService.now()) < 12 * 3600 * 1000;

      // Combat discoveries with a mercenary roster get Attack/Negotiate choice
      const canNegotiate = def.category === 'combat' && MERCENARY_ROSTER[def.id];
      let actionHtml;
      if (record.negotiated) {
        const unitNames = (record.mercenaryUnits || []).map(id => UNIT_DEFS[id]?.name || id).join(', ');
        actionHtml = `
          <div class="disc-negotiated-row">
            <span class="disc-negotiated-badge">🤝 Negotiated — hire ${unitNames} in Army tab</span>
            <button class="disc-dismiss-btn" data-record-id="${record.id}">✕ Dismiss</button>
          </div>
        `;
      } else if (canNegotiate) {
        actionHtml = `
          <div class="disc-action-row">
            <button class="disc-claim-btn" data-record-id="${record.id}">⚔ Fight</button>
            <button class="disc-negotiate-btn" data-record-id="${record.id}">🤝 Negotiate</button>
          </div>
        `;
      } else {
        const claimLabel = _CLAIM_LABELS[def.category] || '✓ Claim';
        actionHtml = `<button class="disc-claim-btn" data-record-id="${record.id}">${claimLabel}</button>`;
      }

      return `
        <div class="disc-row">
          <div class="disc-row-icon">${def.icon}</div>
          <div class="disc-row-body">
            <div class="disc-row-top">
              <span class="disc-row-name">${def.name}</span>
              <span class="disc-cat-badge ${catMeta.cssClass}">${catMeta.icon} ${catMeta.label}</span>
            </div>
            <div class="disc-row-meta">
              ${terrain.icon} ${terrain.name}
              · <span class="disc-coords">(${record.tileX}, ${record.tileY})</span>
              · <span class="${isExpiring ? 'disc-expiry--soon' : 'disc-expiry'}">⏱ ${expiry}</span>
            </div>
            <div class="disc-row-desc">${def.description}</div>
          </div>
          ${actionHtml}
        </div>
      `;
    }).join('');

    return `
      <div class="disc-log-header">
        <span>${active.length} active discover${active.length === 1 ? 'y' : 'ies'}</span>
      </div>
      <div class="disc-list">${rows}</div>
    `;
  }

  // ── Discovery result popup ────────────────────────────────────

  function _resolveSearch() {
    const result = DiscoveryService.search(_lord, _player.id);
    _showDiscoveryPopup(result);
  }

  function _showDiscoveryPopup(result) {
    const { def, record } = result;
    const catMeta = DISCOVERY_CATEGORY_META[def.category] || {};
    const found   = def.category !== 'nothing';
    const terrain = _lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y) : null;
    const expiry  = record ? DiscoveryService.formatExpiry(record) : null;

    const popupEl = document.getElementById('disc-popup');
    const overlay = document.getElementById('disc-overlay');
    if (!popupEl || !overlay) return;

    popupEl.innerHTML = `
      <div class="disc-popup-header">
        <span class="disc-popup-title">🔍 Area Searched</span>
        ${terrain ? `<span class="disc-popup-tile">${terrain.icon} ${terrain.name} (${_lord.x}, ${_lord.y})</span>` : ''}
      </div>
      <div class="disc-popup-icon ${found ? 'disc-popup-icon--found' : 'disc-popup-icon--empty'}">${def.icon}</div>
      <div class="disc-popup-name">${def.name}</div>
      ${found ? `<div class="disc-cat-badge ${catMeta.cssClass}">${catMeta.icon} ${catMeta.label}</div>` : ''}
      <div class="disc-popup-desc">${def.description}</div>
      ${expiry ? `<div class="disc-popup-expiry">⏱ Lasts ${expiry}</div>` : ''}
      <button class="disc-popup-close" id="disc-popup-close">Continue</button>
    `;

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => popupEl.classList.add('disc-popup--visible'));

    document.getElementById('disc-popup-close')?.addEventListener('click', _closeDiscoveryPopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeDiscoveryPopup(); }, { once: true });
  }

  function _closeDiscoveryPopup() {
    const overlay = document.getElementById('disc-overlay');
    const popup   = document.getElementById('disc-popup');
    if (!overlay || !popup) return;
    popup.classList.remove('disc-popup--visible');
    setTimeout(() => {
      overlay.classList.add('hidden');
      _renderTab();
      _startCountdown();
    }, 260);
  }

  // ── Discovery claim ───────────────────────────────────────────

  function _bindDiscoveryEvents() {
    document.querySelectorAll('.disc-claim-btn[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => _claimDiscovery(btn.dataset.recordId));
    });
    document.querySelectorAll('.disc-negotiate-btn[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => _negotiateDiscovery(btn.dataset.recordId));
    });
    document.querySelectorAll('.disc-dismiss-btn[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const result = DiscoveryService.claim(btn.dataset.recordId, _player.id);
        if (result.ok) { _toast('Discovery dismissed.'); _renderTab(); }
      });
    });
  }

  function _negotiateDiscovery(recordId) {
    const result = DiscoveryService.negotiate(recordId, _player.id);
    if (!result.ok) { _toast(result.error); return; }
    const names = result.mercenaryUnits.map(id => UNIT_DEFS[id]?.name || id).join(', ');
    _toast(`🤝 Negotiated! Hire ${names} in the Army tab.`);
    _renderTab();
  }

  function _claimDiscovery(recordId) {
    const result = DiscoveryService.claim(recordId, _player.id);
    if (!result.ok) { _toast(result.error); return; }

    const _RES_TYPES_CITY = ['food', 'wood', 'stone', 'iron'];
    let xpGained = 0;
    let cityForRes = null;
    result.rewards.forEach(r => {
      if (r.type === 'xp') xpGained += r.amount;
      if (r.type === 'gold') {
        const p = PlayerService.getById(_player.id);
        PlayerService.update(_player.id, { coins: (p.coins || 0) + r.amount });
        _player = PlayerService.getById(_player.id);
      }
      if (_RES_TYPES_CITY.includes(r.type)) {
        if (!cityForRes) cityForRes = _getLordCurrentCity() || (_lord.cityIds?.[0] ? CityService.getById(_lord.cityIds[0]) : null);
        if (cityForRes) {
          cityForRes.resources[r.type] = (cityForRes.resources[r.type] || 0) + r.amount;
          CityService.save(cityForRes);
        }
      }
    });

    if (xpGained > 0) {
      _lord.xp = (_lord.xp || 0) + xpGained;
      const leveled = LordService.checkLevelUp(_lord);
      LordService.save(_lord);
      _lord = LordService.getById(_lord.id);
      if (leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
    }

    HUD.refresh();
    _showClaimPopup(result.def, result.rewards);
  }

  const _RES_ICONS = { gold: '💰', wood: '🪵', stone: '⛏', iron: '⚒', food: '🌾', xp: '⭐' };

  function _showClaimPopup(def, rewards) {
    const combat = rewards.find(r => r.type === 'combat');
    const won    = combat?.outcome === 'victory';

    const rewardsHtml = rewards
      .filter(r => _RES_ICONS[r.type] && r.amount > 0)
      .map(r => `<div class="disc-claim-reward">${_RES_ICONS[r.type]} +${r.amount} ${r.type.charAt(0).toUpperCase() + r.type.slice(1)}</div>`)
      .join('');

    const bodyHtml = combat ? `
      <div class="disc-popup-icon ${won ? 'disc-popup-icon--found' : 'disc-popup-icon--empty'}">${won ? '⚔' : '💀'}</div>
      <div class="disc-popup-name ${won ? '' : 'disc-popup-name--defeat'}">${won ? 'Victory!' : 'Defeat'}</div>
      <div class="disc-popup-desc">${won
        ? 'Your lord cut through the enemy and claimed their spoils.'
        : 'Overwhelmed by numbers, your lord retreated — but lives to fight again.'}</div>
    ` : `
      <div class="disc-popup-icon disc-popup-icon--found">${def.icon}</div>
      <div class="disc-popup-name">Collected!</div>
      <div class="disc-popup-desc">${def.description}</div>
    `;

    const popupEl = document.getElementById('disc-popup');
    const overlay = document.getElementById('disc-overlay');
    if (!popupEl || !overlay) return;

    popupEl.innerHTML = `
      <div class="disc-popup-header">
        <span class="disc-popup-title">${def.icon} ${def.name}</span>
      </div>
      ${bodyHtml}
      <div class="disc-claim-rewards">${rewardsHtml}</div>
      <button class="disc-popup-close" id="disc-popup-close">Continue</button>
    `;

    overlay.classList.remove('hidden');
    requestAnimationFrame(() => popupEl.classList.add('disc-popup--visible'));
    document.getElementById('disc-popup-close')?.addEventListener('click', _closeDiscoveryPopup);
    overlay.addEventListener('click', e => { if (e.target === overlay) _closeDiscoveryPopup(); }, { once: true });
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    document.getElementById('ls-back')?.addEventListener('click', () => {
      _stopCountdown();
      App.navigate('overview', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });
    document.getElementById('ls-map-btn')?.addEventListener('click', () => {
      _stopCountdown();
      App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });

    document.querySelectorAll('.ls-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        document.querySelectorAll('.ls-tab').forEach(b => b.classList.remove('ls-tab--active'));
        btn.classList.add('ls-tab--active');
        _renderTab();
        _startCountdown();
      });
    });
  }

  // ── Finish Now (credits) ─────────────────────────────────────

  function _creditCost(secs) {
    return Math.max(1, Math.ceil(secs / 60));
  }

  function _finishLordActionNow() {
    const secs = LordService.actionTimeRemaining(_lord);
    const cost = _creditCost(secs);
    const result = PlayerService.spendCredits(_player.id, cost);
    if (!result.ok) { _toast(result.error); return; }

    const lord = LordService.getById(_lord.id);
    if (!lord || lord.actionQueue.length === 0) return;
    lord.actionQueue[0].finishAt = TimeService.now() - 1;
    LordService.save(lord);

    const completed = LordService.tickActions(lord);
    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    completed.forEach(c => {
      if (c.actionId === 'search_area')  _resolveSearch();
      else if (c.actionId === 'move_lord') _toast(`📍 Arrived at (${c.destX}, ${c.destY}).`);
      if (c.leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
    });
    HUD.refresh();
    _stopCountdown();
    _renderTab();
    _startCountdown();
  }

  function _finishRecruitmentNow() {
    const city = _getLordCurrentCity();
    if (!city || (city.recruitmentQueue || []).length === 0) return;
    const secs = RecruitmentService.timeRemaining(city);
    const cost = _creditCost(secs);
    const result = PlayerService.spendCredits(_player.id, cost);
    if (!result.ok) { _toast(result.error); return; }

    city.recruitmentQueue[0].finishAt = TimeService.now() - 1;
    CityService.save(city);

    const completed = RecruitmentService.tick(city);
    _player = PlayerService.getById(_player.id);
    completed.forEach(c => {
      const uDef = UNIT_DEFS[c.unitId];
      _toast(`${uDef?.icon || '⚔'} ${uDef?.name || c.unitId} ×${c.count} ready!`);
    });
    HUD.refresh();
    _stopCountdown();
    _renderTab();
    _startCountdown();
  }

  // ── Live countdown ────────────────────────────────────────────

  function _startCountdown() {
    _stopCountdown();
    const hasAction      = _lord.actionQueue.length > 0;
    const currentCity    = _getLordCurrentCity();
    const hasRecruitment = currentCity && (currentCity.recruitmentQueue || []).length > 0;
    if (!hasAction && !hasRecruitment) return;

    _tickTimer = setInterval(() => {
      let needsRender = false;

      // ─ Lord action tick ─
      if (_lord.actionQueue.length > 0) {
        const completed = LordService.tickActions(_lord);
        if (completed.length > 0) {
          _lord = LordService.getById(_lord.id);
          completed.forEach(c => {
            if (c.actionId === 'search_area') _resolveSearch();
            else if (c.actionId === 'move_lord') _toast(`📍 Arrived at (${c.destX}, ${c.destY}).`);
            else _toast(`✓ ${c.name} completed!`);
            if (c.leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
          });
          needsRender = true;
        } else {
          const currId    = _lord.actionQueue[0]?.actionId;
          const remaining = LordService.actionTimeRemaining(_lord);
          const prog      = Math.floor(LordService.actionProgress(_lord) * 100);
          const timerEl   = document.getElementById(`la-timer-${currId}`) || document.getElementById('lov-timer');
          const fillEl    = document.getElementById(`la-fill-${currId}`)  || document.getElementById('lov-fill');
          if (timerEl) timerEl.textContent = TimeService.formatDuration(remaining);
          if (fillEl)  fillEl.style.width  = `${prog}%`;
        }
      }

      // ─ Recruitment tick ─
      const city = _getLordCurrentCity();
      if (city && (city.recruitmentQueue || []).length > 0) {
        const completed = RecruitmentService.tick(city);
        if (completed.length > 0) {
          completed.forEach(c => {
            const uDef = UNIT_DEFS[c.unitId];
            _toast(`${uDef?.icon || '⚔'} ${uDef?.name || c.unitId} ×${c.count} ready!`);
          });
          needsRender = true;
        } else {
          const fillEl  = document.getElementById('la-recruit-fill');
          const timerEl = document.getElementById('la-recruit-timer');
          if (fillEl)  fillEl.style.width  = `${Math.floor(RecruitmentService.progress(city) * 100)}%`;
          if (timerEl) timerEl.textContent = TimeService.formatDuration(RecruitmentService.timeRemaining(city));
        }
      }

      if (needsRender) {
        _stopCountdown();
        const discOpen = document.getElementById('disc-overlay') &&
                         !document.getElementById('disc-overlay').classList.contains('hidden');
        if (!discOpen) _renderTab();
        _startCountdown();
      }
    }, 1000);
  }

  function _stopCountdown() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  return { render };
})();
