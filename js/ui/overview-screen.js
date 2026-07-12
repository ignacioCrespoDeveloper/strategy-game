// =============================================
//  overview-screen.js — Empire dashboard (default landing)
// =============================================

const OverviewScreen = (() => {
  let _lord            = null;
  let _player          = null;
  let _root            = null;
  let _tickTimer       = null;
  let _activeOvTab     = 'empire';
  let _movementsOpen   = true;
  let _citiesCollapsed = false;
  let _lordsCollapsed  = false;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _stopTicker();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = LordService.getById(lord.id);
    if (LordService.tickHp(_lord)) LordService.save(_lord);
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
    const cities     = CityService.getPlayerCities(_player.id);
    const hasAction  = _lord.actionQueue.length > 0;
    const hasConstr  = cities.some(c => c.constructionQueue.length > 0);
    if (!hasAction && !hasConstr) return;

    _tickTimer = setInterval(() => {
      let needsRerender = false;

      // Lord action
      if (_lord.actionQueue.length > 0) {
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
        _lord = LordService.getById(_lord.id);
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
    return `
      <div class="ov-screen">
        <nav class="ov-top-tabs">
          <button class="ov-top-tab ${_activeOvTab === 'empire' ? 'ov-top-tab--active' : ''}" data-ov-tab="empire">Empire</button>
          <button class="ov-top-tab ${_activeOvTab === 'intel'  ? 'ov-top-tab--active' : ''}" data-ov-tab="intel">Intelligence</button>
        </nav>
        <div class="ov-body">
          ${_activeOvTab === 'empire'
            ? `${_movementsPanel()}${_citiesSection()}${_lordsSection()}${_activityFeedSection()}`
            : _intelligenceSection()}
        </div>
      </div>

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
              <div class="form-input form-input--locked">
                ${(() => { const r = RACES[_lord?.race] || {}; return `${r.icon || ''} ${r.name || '—'}`; })()}
              </div>
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
    const cities = CityService.getPlayerCities(_player.id);
    const cards  = cities.length
      ? cities.map(_cityCard).join('')
      : '';

    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">Cities</div>
          <button class="ov-section-toggle" id="ov-toggle-cities">${_citiesCollapsed ? '▼' : '▲'}</button>
        </div>
        ${!_citiesCollapsed ? `
          <div class="ov-cities-grid">
            ${cards}
            <div class="ov-add-card" id="ov-found-city-btn" title="Found a new city">
              <span class="ov-add-icon">+</span>
              <span class="ov-add-label">Found City</span>
            </div>
          </div>` : ''}
      </section>
    `;
  }

  function _cityCard(city) {
    const terrain   = WorldService.getTerrain(city.x, city.y);
    const stats     = CityStatsService.getStats(city);
    const status    = CityStatsService.getCityStatus(stats);
    const bldCount  = Object.values(city.buildings).filter(v => v > 0).length;
    const thLevel   = city.buildings.town_hall || 0;
    const buildItem = city.constructionQueue.length > 0 ? city.constructionQueue[0] : null;
    const buildDef  = buildItem ? BUILDING_DEFS[buildItem.buildingId] : null;
    const buildPct  = buildItem ? Math.floor(ConstructionService.progress(city) * 100) : 0;
    const buildSecs = buildItem ? ConstructionService.timeRemaining(city) : 0;
    const tierImg   = _cityTierImg(thLevel);

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
              <span class="ov-cc-stat-value">${Math.floor(city.population)}</span>
            </div>
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Happiness</span>
              <span class="ov-cc-stat-value">${stats.happiness}%</span>
            </div>
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Town Hall</span>
              <span class="ov-cc-stat-value">Lv ${thLevel}</span>
            </div>
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Buildings</span>
              <span class="ov-cc-stat-value">${bldCount}</span>
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
    const lords = LordService.getByPlayer(_player.id);
    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">Lords</div>
          <div class="ov-section-row-actions">
            <button class="ov-map-btn" id="ov-map-btn">🗺 World Map</button>
            <button class="ov-section-toggle" id="ov-toggle-lords">${_lordsCollapsed ? '▼' : '▲'}</button>
          </div>
        </div>
        ${!_lordsCollapsed ? `
          <div class="ov-lords-grid">
            ${lords.map(_lordCard).join('')}
            <div class="ov-add-card" id="ov-recruit-lord-btn" title="Recruit a new lord">
              <span class="ov-add-icon">+</span>
              <span class="ov-add-label">Recruit Lord</span>
            </div>
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
      _stopTicker();
      App.navigate('map', { player: _player, lord: _lord });
    });

    document.getElementById('ov-map-btn')?.addEventListener('click', () => {
      _stopTicker();
      App.navigate('map', { player: _player, lord: _lord });
    });

    document.getElementById('ov-recruit-lord-btn')?.addEventListener('click', () => {
      document.getElementById('rl-name').value = '';
      document.getElementById('rl-class').value = '';
      document.getElementById('rl-error').textContent = '';
      document.getElementById('recruit-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('rl-name').focus(), 50);
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

    document.querySelectorAll('.ov-top-tab[data-ov-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeOvTab = btn.dataset.ovTab;
        _stopTicker();
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      });
    });

    document.querySelectorAll('.ov-intel-dismiss[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        IntelligenceService.removeRecord(_player.id, btn.dataset.recordId);
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      });
    });
  }

  function _onRecruitConfirm() {
    const name    = document.getElementById('rl-name').value;
    const raceId  = _lord?.race || '';
    const classId = document.getElementById('rl-class').value;
    const errorEl = document.getElementById('rl-error');
    errorEl.textContent = '';

    const result = LordService.create(_player.id, name, raceId, classId);
    if (!result.ok) { errorEl.textContent = result.error; return; }

    document.getElementById('recruit-modal').classList.add('hidden');
    _stopTicker();
    if (_root) {
      _root.innerHTML = _shell();
      _bindEvents();
      _startTicker();
    }
  }

  return { render, stop };
})();
