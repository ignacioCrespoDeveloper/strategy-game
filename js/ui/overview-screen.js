// =============================================
//  overview-screen.js — Empire dashboard (default landing)
// =============================================

const OverviewScreen = (() => {
  let _lord            = null;
  let _player          = null;
  let _root            = null;
  let _tickTimer       = null;
  let _movementsOpen   = true;
  let _citiesCollapsed = false;
  let _lordsCollapsed  = false;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _stopTicker();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = lord ? LordService.getById(lord.id) : null;
    if (_lord && LordService.tickHp(_lord)) LordService.save(_lord);
    ActivityService.markSeen(_player.id);
    HUD.refresh();
    root.innerHTML = _shell();
    _bindEvents();
    _startTicker();
  }

  function stop() { _stopTicker(); }

  function _stopTicker() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _startTicker() {
    const cities    = CityService.getPlayerCities(_player.id);
    const hasAction = _lord && _lord.actionQueue.length > 0;
    const hasConstr = cities.some(c => c.constructionQueue.length > 0);
    if (!hasAction && !hasConstr) return;

    _tickTimer = setInterval(() => {
      let needsRerender = false;

      // Lord action
      if (_lord && _lord.actionQueue.length > 0) {
        const completed = LordService.tickActions(_lord);
        if (completed.length > 0) {
          _lord = LordService.getById(_lord.id);
          needsRerender = true;
        } else {
          const fill  = document.getElementById('ov-lord-fill');
          const timer = document.getElementById('ov-lord-timer');
          if (fill)  fill.style.width  = `${Math.floor(LordService.actionProgress(_lord) * 100)}%`;
          if (timer) timer.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(_lord));
        }
      }

      // City construction
      CityService.getPlayerCities(_player.id).forEach(city => {
        if (city.constructionQueue.length === 0) return;
        const completed = ConstructionService.tick(city);
        if (completed.length > 0) {
          needsRerender = true;
        } else {
          const fill  = document.getElementById(`ov-city-fill-${city.id}`);
          const timer = document.getElementById(`ov-city-timer-${city.id}`);
          if (fill)  fill.style.width  = `${Math.floor(ConstructionService.progress(city) * 100)}%`;
          if (timer) timer.textContent = TimeService.formatDuration(ConstructionService.timeRemaining(city));
        }
      });

      if (needsRerender) {
        _stopTicker();
        if (_lord) _lord = LordService.getById(_lord.id);
        if (_root) {
          _root.innerHTML = _shell();
          _bindEvents();
          _startTicker();
        }
      }
    }, 1000);
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const cities = CityService.getPlayerCities(_player.id);
    const lords  = LordService.getByPlayer(_player.id);
    const showOnboarding = cities.length === 0 || lords.length === 0;

    return `
      <div class="ov-screen">
        <div class="ov-body">
          ${showOnboarding
            ? `${_onboardingSection(cities, lords)}${_citiesSection()}${_lordsSection()}`
            : `${_movementsPanel()}${_citiesSection()}${_lordsSection()}`
          }
        </div>
      </div>

      ${_recruitModal()}
    `;
  }

  // ── Onboarding ────────────────────────────────────────────────

  function _onboardingSection(cities, lords) {
    const step1Done = cities.length > 0;
    const step2Done = lords.length > 0;

    return `
      <section class="ov-section ov-onboarding">
        <div class="ov-onboarding-title">⚔ Getting Started</div>
        <div class="ov-onboarding-steps">

          <div class="ov-step ${step1Done ? 'ov-step--done' : 'ov-step--active'}">
            <div class="ov-step-num">${step1Done ? '✓' : '1'}</div>
            <div class="ov-step-body">
              <div class="ov-step-label">Found your first city</div>
              <div class="ov-step-desc">Choose a location on the world map to establish your settlement.</div>
              ${!step1Done ? `<button class="btn-primary ov-step-btn" id="ov-onboard-city-btn">🗺 Open World Map</button>` : ''}
            </div>
          </div>

          <div class="ov-step ${step2Done ? 'ov-step--done' : (step1Done ? 'ov-step--active' : 'ov-step--pending')}">
            <div class="ov-step-num">${step2Done ? '✓' : '2'}</div>
            <div class="ov-step-body">
              <div class="ov-step-label">Recruit your first Lord</div>
              <div class="ov-step-desc">A lord commands your armies and explores the world on your behalf.</div>
              ${step1Done && !step2Done ? `<button class="btn-primary ov-step-btn" id="ov-onboard-lord-btn">🎖 Recruit Lord</button>` : ''}
            </div>
          </div>

        </div>
      </section>
    `;
  }

  // ── Recruit modal ─────────────────────────────────────────────

  function _recruitModal() {
    const raceField = _lord
      ? `<div class="form-input form-input--locked">
           ${(() => { const r = RACES[_lord.race] || {}; return `${r.icon || ''} ${r.name || '—'}`; })()}
         </div>`
      : `<select class="form-input" id="rl-race">
           <option value="">— Choose Race —</option>
           ${Object.values(RACES).map(r => `<option value="${r.id}">${r.icon} ${r.name}</option>`).join('')}
         </select>`;

    return `
      <div class="modal-overlay hidden" id="recruit-modal">
        <div class="modal-card">
          <h2 class="modal-title">Recruit a Lord</h2>
          <div class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" type="text" id="rl-name" placeholder="Lord's name" maxlength="30" autocomplete="off" />
          </div>
          <div class="rl-selects">
            <div class="form-group">
              <label class="form-label">Race</label>
              ${raceField}
            </div>
            <div class="form-group">
              <label class="form-label">Class</label>
              <select class="form-input" id="rl-class">
                <option value="">— Choose Class —</option>
                ${Object.values(LORD_CLASSES).map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <p class="form-error" id="rl-error"></p>
          <div class="modal-actions">
            <button class="btn-secondary" id="rl-cancel">Cancel</button>
            <button class="btn-primary"   id="rl-confirm">Recruit</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Movements panel ───────────────────────────────────────────

  function _movementsPanel() {
    const lords  = LordService.getByPlayer(_player.id);
    const active = lords.filter(l => l.actionQueue.length > 0 || LordService.isStanced(l));
    if (active.length === 0) return '';

    const rows = active.map(lord => {
      const qItem    = lord.actionQueue[0];
      const actionDef = qItem ? LORD_ACTIONS[qItem.actionId] : null;
      const pct      = qItem ? Math.floor(LordService.actionProgress(lord) * 100) : 0;
      const secs     = qItem ? LordService.actionTimeRemaining(lord) : 0;
      const stanceDef = STANCE_DEFS[LordService.getStance(lord)?.id] || STANCE_DEFS.idle;

      let icon  = '⏸';
      let label = 'Idle';
      if (qItem && actionDef) {
        icon  = actionDef.icon || '⏳';
        label = actionDef.name;
        if (qItem.actionId === 'move_lord' && qItem.destX != null) {
          icon  = '🚶';
          label = `Moviéndose → (${qItem.destX}, ${qItem.destY})`;
        }
      } else if (LordService.isStanced(lord)) {
        icon  = stanceDef.icon || '🛡';
        label = stanceDef.name || 'Stance';
      }

      return `
        <div class="ov-mv-row">
          <span class="ov-mv-lord">${lord.name}</span>
          <span class="ov-mv-status">${icon} ${label}</span>
          ${qItem ? `
            <div class="ov-mv-bar-wrap">
              <div class="ov-mv-bar"><div class="ov-mv-fill" style="width:${pct}%"></div></div>
              <span class="ov-mv-time">${TimeService.formatDuration(secs)}</span>
            </div>` : ''}
        </div>`;
    }).join('');

    return `
      <section class="ov-section ov-mv-section">
        <div class="ov-section-row">
          <div class="ov-section-title">🗺 Movimientos Activos</div>
          <button class="ov-section-toggle" id="ov-toggle-movements">${_movementsOpen ? '▲' : '▼'}</button>
        </div>
        ${_movementsOpen ? `<div class="ov-mv-list">${rows}</div>` : ''}
      </section>`;
  }

  // ── City tier image helper ────────────────────────────────────

  function _cityTierImg(thLevel) {
    if (thLevel >= 16) return 'assets/city/tier4.jpg';
    if (thLevel >= 11) return 'assets/city/tier3.jpg';
    if (thLevel >= 6)  return 'assets/city/tier2.jpg';
    return 'assets/city/tier1.webp';
  }

  // ── Cities section ────────────────────────────────────────────

  function _citiesSection() {
    const cities     = CityService.getPlayerCities(_player.id);
    const cards      = cities.length ? cities.map(_cityCard).join('') : '';
    const atLimit    = cities.length >= 5;
    const coins      = PlayerService.getById(_player.id)?.coins || 0;
    const canAfford  = cities.length === 0 || coins >= 25000;

    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">
            Cities
            <span class="ov-limit-badge">${cities.length}/5</span>
            <span class="ov-cost-hint">💰 25,000 to found</span>
          </div>
          <button class="ov-section-toggle" id="ov-toggle-cities">${_citiesCollapsed ? '▼' : '▲'}</button>
        </div>
        ${!_citiesCollapsed ? `
          <div class="ov-cities-grid">
            ${cards}
            ${!atLimit ? `
              <div class="ov-add-card${canAfford ? '' : ' ov-add-card--locked'}" id="ov-found-city-btn" title="Found a new city — costs 25,000 gold">
                <span class="ov-add-cost">💰 25,000</span>
                <span class="ov-add-icon">+</span>
                <span class="ov-add-label">Found City</span>
              </div>` : ''}
          </div>` : ''}
      </section>
    `;
  }

  function _cityCard(city) {
    const terrain    = WorldService.getTerrain(city.x, city.y);
    const stats      = CityStatsService.getStats(city);
    const status     = CityStatsService.getCityStatus(stats);
    const thLevel    = city.buildings.town_hall || 0;
    const slotInfo   = CityStatsService.getSlotInfo(city);
    const prodRates  = ProductionService.getRates(city, _lord);
    const growth     = CityStatsService.getPopulationGrowthRate(city, stats, prodRates);
    const buildItem  = city.constructionQueue.length > 0 ? city.constructionQueue[0] : null;
    const buildDef   = buildItem ? BUILDING_DEFS[buildItem.buildingId] : null;
    const buildPct   = buildItem ? Math.floor(ConstructionService.progress(city) * 100) : 0;
    const buildSecs  = buildItem ? ConstructionService.timeRemaining(city) : 0;
    const tierImg    = _cityTierImg(thLevel);

    let tierName = 'Tier I';
    if      (thLevel >= 16) tierName = 'Tier IV';
    else if (thLevel >= 11) tierName = 'Tier III';
    else if (thLevel >= 6)  tierName = 'Tier II';

    const growthSymbol = growth > 0 ? '▲' : growth < 0 ? '▼' : '─';
    const growthClass  = growth > 0 ? 'ov-cc-grow--up' : growth < 0 ? 'ov-cc-grow--down' : 'ov-cc-grow--stable';
    const growthLabel  = growth !== 0 ? ` ${growth > 0 ? '+' : ''}${growth}/hr` : '';

    return `
      <div class="ov-city-card" data-city-id="${city.id}">
        <div class="ov-cc-art">
          <img class="ov-cc-art-img" src="${tierImg}" alt="City" />
          <div class="ov-cc-art-fade"></div>
        </div>
        <div class="ov-cc-inner">
          <div class="ov-cc-terrain">
            <span class="ov-cc-terrain-icon">${terrain.icon}</span>
            <span class="ov-cc-terrain-name">${terrain.name}</span>
          </div>
          <div class="ov-cc-name-row">
            <span class="ov-cc-name">${city.name}</span>
            <span class="cvl-status-badge cvl-${status.id}">${status.label}</span>
          </div>
          <div class="ov-cc-coords">(${city.x}, ${city.y})</div>
          <div class="ov-cc-divider"></div>
          <div class="ov-cc-stats">
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Population</span>
              <span class="ov-cc-stat-value">
                ${Math.floor(city.population)}
                <span class="ov-cc-grow ${growthClass}">${growthSymbol}${growthLabel}</span>
              </span>
            </div>
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Tier</span>
              <span class="ov-cc-stat-value">${tierName}</span>
            </div>
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Slots</span>
              <span class="ov-cc-stat-value">${slotInfo.usedSlots}/${slotInfo.maxSlots}</span>
            </div>
          </div>
          ${buildItem ? `<div class="ov-cc-construction">
            <div class="ov-cc-constr-label">
              <span>🔨 ${buildDef?.name || buildItem.buildingId} → Lv ${buildItem.targetLevel}</span>
              <span class="ov-cc-constr-time" id="ov-city-timer-${city.id}">${TimeService.formatDuration(buildSecs)}</span>
            </div>
            <div class="ov-cc-constr-bar"><div class="ov-cc-constr-fill" id="ov-city-fill-${city.id}" style="width:${buildPct}%"></div></div>
          </div>` : ''}
          <div class="ov-cc-enter">Enter City →</div>
        </div>
      </div>
    `;
  }

  // ── Lords section ─────────────────────────────────────────────

  function _unitPower(def) {
    if (!def) return 0;
    const s = def.combatStats || {};
    return (s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0);
  }

  function _lordArmyPower(lordId) {
    const army = ArmyService.get(lordId);
    return army.units.reduce((sum, u) => sum + _unitPower(UNIT_DEFS[u.unitId]) * u.count, 0);
  }

  function _lordsSection() {
    const lords      = LordService.getByPlayer(_player.id);
    const atLimit    = lords.length >= 5;
    const coins      = PlayerService.getById(_player.id)?.coins || 0;
    const canAfford  = lords.length === 0 || coins >= 15000;
    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">
            Lords
            <span class="ov-limit-badge">${lords.length}/5</span>
            <span class="ov-cost-hint">💰 15,000 to recruit</span>
          </div>
          <button class="ov-section-toggle" id="ov-toggle-lords">${_lordsCollapsed ? '▼' : '▲'}</button>
        </div>
        ${!_lordsCollapsed ? `
          <div class="ov-lords-grid">
            ${lords.map(_lordCard).join('')}
            ${!atLimit ? `
              <div class="ov-add-card${canAfford ? '' : ' ov-add-card--locked'}" id="ov-recruit-lord-btn" title="Recruit a new lord — costs 15,000 gold">
                <span class="ov-add-cost">💰 15,000</span>
                <span class="ov-add-icon">+</span>
                <span class="ov-add-label">Recruit Lord</span>
              </div>` : ''}
          </div>` : ''}
      </section>
    `;
  }

  function _lordCard(lord) {
    const race    = RACES[lord.race] || {};
    const cls     = LORD_CLASSES[lord.classId];
    const stats   = LordService.getEffectiveStats(lord);
    const maxHp   = stats.health;
    const curHp   = Math.min(lord.currentHp ?? maxHp, maxHp);
    const hpPct   = Math.min(100, Math.floor((curHp / maxHp) * 100));
    const xp      = lord.xp || 0;
    const xpNext  = lord.xpToNext || 100;
    const xpPct   = Math.min(100, Math.floor((xp / xpNext) * 100));
    const power   = _lordArmyPower(lord.id);

    let location = 'Wandering';
    if (lord.x != null) {
      const cityAtPos = CityService.getPlayerCities(_player.id).find(c => c.x === lord.x && c.y === lord.y);
      location = cityAtPos ? cityAtPos.name : `(${lord.x}, ${lord.y})`;
    }

    const queueItem    = lord.actionQueue && lord.actionQueue.length > 0 ? lord.actionQueue[0] : null;
    const activeAction = queueItem ? LORD_ACTIONS[queueItem.actionId] : null;
    const actionPct    = queueItem ? Math.floor(LordService.actionProgress(lord) * 100) : 0;
    const actionSecs   = queueItem ? LordService.actionTimeRemaining(lord) : 0;

    // Stance
    const stanceObj = LordService.getStance(lord);
    const stanceDef = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
    const isStanced = LordService.isStanced(lord);
    const stanceBadge = isStanced
      ? `<span class="ov-lc-stance-badge">${stanceDef.icon} ${stanceDef.name}</span>`
      : '';

    const portraitSrc  = cls?.portrait || race.portrait;
    const portraitHtml = portraitSrc
      ? `<div class="ov-lc-portrait">
           <img class="ov-lc-portrait-img" src="${portraitSrc}" alt="${lord.name}" />
           <div class="ov-lc-portrait-fade"></div>
           <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
         </div>`
      : `<div class="ov-lc-portrait ov-lc-portrait--icon">
           <span>${race.icon || '👤'}</span>
           <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
         </div>`;

    return `
      <div class="ov-lord-card" data-lord-id="${lord.id}">
        ${portraitHtml}
        <div class="ov-lc-body">
          <div class="ov-lc-top">
            <span class="ov-lc-name">${lord.name}</span>
            ${power > 0 ? `<span class="ov-lc-power">⚔ ${power}</span>` : ''}
          </div>
          <div class="ov-lc-badges">
            <span class="ov-lc-race">${race.name || ''}</span>
            ${cls ? `<span class="ov-lc-class-badge" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
            ${stanceBadge}
          </div>
          <div class="ov-lc-meta">
            📍 ${location} · ${activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
          </div>
          ${queueItem ? `<div class="ov-lc-action-row">
            <div class="ov-lc-action-bar"><div class="ov-lc-action-fill" id="ov-lord-fill" style="width:${actionPct}%"></div></div>
            <span class="ov-lc-action-time" id="ov-lord-timer">${TimeService.formatDuration(actionSecs)}</span>
          </div>` : ''}
          <div class="ov-lc-bars">
            <div class="ov-lc-bar-row">
              <span class="ov-lc-bar-label">HP</span>
              <div class="ov-lc-bar"><div class="ov-lc-fill ov-lc-fill-hp" style="width:${hpPct}%"></div></div>
              <span class="ov-lc-bar-val">${curHp}/${maxHp}</span>
            </div>
            <div class="ov-lc-bar-row">
              <span class="ov-lc-bar-label">XP</span>
              <div class="ov-lc-bar"><div class="ov-lc-fill ov-lc-fill-xp" style="width:${xpPct}%"></div></div>
              <span class="ov-lc-bar-val">${xp}/${xpNext}</span>
            </div>
          </div>
          <div class="ov-lc-enter">Manage →</div>
        </div>
      </div>
    `;
  }

  // ── Intelligence tab ──────────────────────────────────────────

  const _INTEL_GROUPS = [
    { type: 'enemy_lord',     label: 'Enemy Lords',     icon: '👑' },
    { type: 'enemy_city',     label: 'Enemy Cities',    icon: '🏰' },
    { type: 'bandit_camp',    label: 'Bandit Camps',    icon: '🏕' },
    { type: 'mercenary_camp', label: 'Mercenary Camps', icon: '⚔' },
    { type: 'resources',      label: 'Resources',       icon: '💎' },
    { type: 'ruins',          label: 'Ruins & Relics',  icon: '🏛' },
  ];

  function _timeAgo(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60)            return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60)            return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)           return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function _intelRecordRow(record) {
    const discoverer = LordService.getById(record.discoveredBy);
    const agoLabel   = _timeAgo(TimeService.now() - record.discoveredAt);
    const tierColors = { vague: '#777788', clear: '#c8a020', precise: '#40c0ff' };
    const tierColor  = tierColors[record.qualityTier] || '#777788';
    const details    = record.data
      ? Object.entries(record.data).filter(([k, v]) => k !== 'summary' && v).map(([k, v]) => `<span class="ov-intel-detail">${k}: ${v}</span>`).join('')
      : '';
    return `
      <div class="ov-intel-row" data-record-id="${record.id}">
        <div class="ov-intel-row-body">
          <div class="ov-intel-row-top">
            <span class="ov-intel-tier" style="color:${tierColor}">${record.qualityTier}</span>
            <span class="ov-intel-coords">📍 (${record.tileX}, ${record.tileY})</span>
            ${discoverer ? `<span class="ov-intel-by">by ${discoverer.name}</span>` : ''}
            <span class="ov-intel-ago">${agoLabel}</span>
          </div>
          <div class="ov-intel-summary">${record.data?.summary || ''}</div>
          ${details ? `<div class="ov-intel-details">${details}</div>` : ''}
        </div>
        <button class="ov-intel-dismiss" data-record-id="${record.id}" title="Dismiss">✕</button>
      </div>
    `;
  }

  // ── Activity feed ─────────────────────────────────────────────

  function _activityFeedSection() {
    const feed = ActivityService.get(_player.id);
    if (feed.length === 0) return '';

    const _TYPE_CSS = {
      battle_victory: 'af-victory',
      battle_defeat:  'af-defeat',
      battle_draw:    'af-draw',
      discovery:      'af-discovery',
      lord_moved:     'af-move',
      action_complete:'af-action',
    };

    const items = feed.slice(0, 30).map(e => {
      const css  = _TYPE_CSS[e.type] || '';
      const date = _timeAgo(TimeService.now() - e.at);
      return `
        <div class="af-entry ${css}">
          <span class="af-icon">${e.icon}</span>
          <div class="af-body">
            <span class="af-title">${e.title}</span>
            ${e.detail ? `<span class="af-detail">${e.detail}</span>` : ''}
          </div>
          <div class="af-meta">
            ${e.lordName ? `<span class="af-lord">${e.lordName}</span>` : ''}
            <span class="af-time">${date}</span>
          </div>
        </div>`;
    }).join('');

    return `
      <section class="ov-section ov-activity-feed">
        <h2 class="ov-section-title">📋 Actividad Reciente</h2>
        <div class="af-list">${items}</div>
      </section>`;
  }

  function _intelligenceSection() {
    IntelligenceService.expireOld(_player.id);
    const records = IntelligenceService.getPlayerRecords(_player.id);

    if (records.length === 0) {
      return `
        <section class="ov-section">
          <div class="ov-section-title">Kingdom Intelligence</div>
          <div class="ov-intel-empty">
            <div class="ov-intel-empty-icon">🔍</div>
            <div class="ov-intel-empty-text">No intelligence reports yet</div>
            <div class="ov-intel-empty-sub">Send lords to Search Area on tiles. All intel is shared across every lord in your kingdom.</div>
          </div>
        </section>
      `;
    }

    const byType = {};
    records.forEach(r => { if (!byType[r.type]) byType[r.type] = []; byType[r.type].push(r); });

    const groupsHtml = _INTEL_GROUPS
      .filter(g => byType[g.type]?.length > 0)
      .map(g => `
        <div class="ov-intel-group">
          <div class="ov-intel-group-title">${g.icon} ${g.label} (${byType[g.type].length})</div>
          <div class="ov-intel-group-rows">${byType[g.type].map(_intelRecordRow).join('')}</div>
        </div>
      `).join('');

    return `
      <section class="ov-section">
        <div class="ov-section-title">Kingdom Intelligence <span class="ov-intel-count">${records.length} record${records.length !== 1 ? 's' : ''}</span></div>
        ${groupsHtml}
      </section>
    `;
  }

  // ── Events ────────────────────────────────────────────────────

  function _rerender() {
    _stopTicker();
    if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
  }

  function _bindEvents() {
    // Section collapse toggles
    document.getElementById('ov-toggle-movements')?.addEventListener('click', () => {
      _movementsOpen = !_movementsOpen;
      _rerender();
    });
    document.getElementById('ov-toggle-cities')?.addEventListener('click', () => {
      _citiesCollapsed = !_citiesCollapsed;
      _rerender();
    });
    document.getElementById('ov-toggle-lords')?.addEventListener('click', () => {
      _lordsCollapsed = !_lordsCollapsed;
      _rerender();
    });

    document.querySelectorAll('.ov-city-card[data-city-id]').forEach(card => {
      card.addEventListener('click', () => {
        _stopTicker();
        const city = CityService.getById(card.dataset.cityId);
        if (city) App.navigate('city', { city, lord: _lord, player: _player });
      });
    });

    document.querySelectorAll('.ov-lord-card[data-lord-id]').forEach(card => {
      card.addEventListener('click', () => {
        _stopTicker();
        const lord = LordService.getById(card.dataset.lordId);
        if (lord) App.navigate('lord-screen', { lord, player: _player });
      });
    });

    document.getElementById('ov-found-city-btn')?.addEventListener('click', () => {
      const isFirst = CityService.getPlayerCities(_player.id).length === 0;
      if (!isFirst) {
        const coins = PlayerService.getById(_player.id)?.coins || 0;
        if (coins < 25000) { _toast('Not enough gold — founding a city costs 💰 25,000.'); return; }
      }
      _stopTicker();
      App.navigate('map', { player: _player, lord: _lord });
    });

    // Onboarding step buttons
    document.getElementById('ov-onboard-city-btn')?.addEventListener('click', () => {
      _stopTicker();
      App.navigate('map', { player: _player, lord: _lord });
    });

    document.getElementById('ov-onboard-lord-btn')?.addEventListener('click', () => {
      _openRecruitModal();
    });

    // Recruit lord button (in lords section)
    document.getElementById('ov-recruit-lord-btn')?.addEventListener('click', () => {
      const isFirst = LordService.getByPlayer(_player.id).length === 0;
      if (!isFirst) {
        const coins = PlayerService.getById(_player.id)?.coins || 0;
        if (coins < 15000) { _toast('Not enough gold — recruiting a lord costs 💰 15,000.'); return; }
      }
      _openRecruitModal();
    });

    document.getElementById('rl-cancel')?.addEventListener('click', () => {
      document.getElementById('recruit-modal').classList.add('hidden');
    });

    document.getElementById('recruit-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('recruit-modal').classList.add('hidden');
    });

    document.getElementById('rl-confirm')?.addEventListener('click', _onRecruitConfirm);
    document.getElementById('rl-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _onRecruitConfirm();
    });

    document.querySelectorAll('.ov-intel-dismiss[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        IntelligenceService.removeRecord(_player.id, btn.dataset.recordId);
        _rerender();
      });
    });
  }

  function _openRecruitModal() {
    document.getElementById('rl-name').value  = '';
    document.getElementById('rl-class').value = '';
    const raceEl = document.getElementById('rl-race');
    if (raceEl) raceEl.value = '';
    document.getElementById('rl-error').textContent = '';
    document.getElementById('recruit-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('rl-name').focus(), 50);
  }

  function _onRecruitConfirm() {
    const name    = document.getElementById('rl-name').value;
    const raceEl  = document.getElementById('rl-race');
    const raceId  = raceEl ? raceEl.value : (_lord?.race || '');
    const classId = document.getElementById('rl-class').value;
    const errorEl = document.getElementById('rl-error');
    errorEl.textContent = '';

    const result = LordService.create(_player.id, name, raceId, classId);
    if (!result.ok) { errorEl.textContent = result.error; return; }

    // Keep local state up to date — first lord sets player.lordId
    const freshPlayer = PlayerService.getById(_player.id);
    if (freshPlayer) _player = freshPlayer;
    if (!_lord && result.lord) _lord = result.lord;

    document.getElementById('recruit-modal').classList.add('hidden');
    HUD.show(_player, _lord);
    Nav.show(_player, _lord, 'home');
    _rerender();
  }

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  return { render, stop };
})();
