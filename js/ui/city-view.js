// =============================================
//  city-view.js — Full-screen city management
// =============================================

const CityView = (() => {
  let _city      = null;
  let _lord      = null;
  let _player    = null;
  let _bldTab    = 'infrastructure';
  let _tickTimer = null;

  const RES = {
    food:  { icon: '🌾', name: 'Food'  },
    wood:  { icon: '🪵', name: 'Wood'  },
    stone: { icon: '⛏',  name: 'Stone' },
    iron:  { icon: '⚒',  name: 'Iron'  },
  };

  const BLD_TABS = [
    { id: 'infrastructure', label: 'Infrastructure', icon: '🏛' },
    { id: 'economy',        label: 'Economy',        icon: '💰' },
    { id: 'military',       label: 'Military',       icon: '⚔'  },
    { id: 'landmarks',      label: 'Landmarks',      icon: '⭐' },
  ];

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { city, lord, player }) {
    _player = player;
    _lord   = lord;
    _city   = CityService.getById(city.id);

    ProductionService.tick(_city, _lord);
    _city = CityService.getById(_city.id);

    const completed = ConstructionService.tick(_city);
    if (completed.length > 0) {
      _city = CityService.getById(_city.id);
      completed.forEach(name => _toast(`✓ ${name} completed!`));
    }

    const eventMessages = EventService.tick(_city);
    if (eventMessages.length > 0) {
      _city = CityService.getById(_city.id);
    }

    root.innerHTML = _shell();
    _renderContent();
    _bindShellEvents();

    eventMessages.forEach(msg => _toast(msg));
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const race = RACES[_lord?.race] || {};
    return `
      <div class="city-view">
        <header class="cv-header">
          <button class="cv-back-btn" id="cv-back">← Overview</button>
          <div class="cv-city-title">
            <span class="cv-city-icon">🏰</span>
            <span class="cv-city-name">${_city.name}</span>
            <span class="cv-city-coords">(${_city.x}, ${_city.y})</span>
          </div>
          <div class="cv-lord-badge">${race.icon || ''} ${_lord?.name || ''}</div>
        </header>

        <div class="cv-body">
          <aside class="cv-left" id="cv-left">
            ${_leftPanelHtml()}
          </aside>
          <div class="cv-right" id="cv-right">
            <div class="cv-queue-banner hidden" id="cv-queue-banner"></div>
            <div id="cv-bld-area"></div>
          </div>
        </div>
      </div>
      <button class="ov-float-map-btn" id="cv-map-btn">
        <span>🗺</span><span>World Map</span>
      </button>
    `;
  }

  // ── Left panel ────────────────────────────────────────────────

  function _leftPanelHtml() {
    const race    = RACES[_lord?.race] || {};
    const terrain = WorldService.getTerrain(_city.x, _city.y);
    const stats   = CityStatsService.getStats(_city);
    const status  = CityStatsService.getCityStatus(stats);
    const rates   = ProductionService.getRates(_city, _lord);
    const growth  = CityStatsService.getPopulationGrowthRate(_city, stats, rates);

    const growthSign  = growth > 0 ? '▲' : growth < 0 ? '▼' : '─';
    const growthClass = growth > 0 ? 'pop-growing' : growth < 0 ? 'pop-declining' : 'pop-stable';

    const now = TimeService.now();
    const uniqueEvents = Object.values(
      (_city.activeModifiers || [])
        .filter(m => !m.expiresAt || now < m.expiresAt)
        .reduce((acc, m) => { if (!acc[m.source]) acc[m.source] = m; return acc; }, {})
    );

    const mainStats  = ['happiness', 'corruption', 'hygiene', 'unemployment', 'religion', 'culture'];
    const extraStats = ['stability', 'security'];

    return `
      <div class="cvl-artwork">
        <div class="cvl-artwork-inner">🏰</div>
        <div class="cvl-artwork-glow"></div>
      </div>

      <div class="cvl-city-header">
        <div class="cvl-city-name">${_city.name}</div>
        <div class="cvl-status-badge cvl-${status.id}">${status.label}</div>
      </div>
      <div class="cvl-terrain-row">
        <span>${terrain.icon} ${terrain.name}</span>
        <span class="cvl-owner-badge">${race.icon || ''} ${_lord?.name || '—'}</span>
      </div>

      <div class="cvl-divider"></div>

      <div class="cvl-pop-row">
        <span class="cvl-pop-label">👥 Population</span>
        <span class="cvl-pop-value">${Math.floor(_city.population || 100)}</span>
        <span class="cvl-pop-growth ${growthClass}">${growthSign}${Math.abs(growth)}/hr</span>
      </div>

      <div class="cvl-divider"></div>
      <div class="cvl-stats2-header">City Status</div>
      <div class="cvl-stats2">
        ${mainStats.map(key => _statRowHtml(key, stats[key])).join('')}
      </div>

      <div class="cvl-divider"></div>
      <div class="cvl-stats2-header">City Defenses</div>
      <div class="cvl-stats2">
        ${extraStats.map(key => _statRowHtml(key, stats[key])).join('')}
      </div>

      ${uniqueEvents.length > 0 ? `
        <div class="cvl-divider"></div>
        <div class="cvl-events">
          <div class="cvl-events-title">Active Effects</div>
          ${uniqueEvents.map(m => `
            <div class="cvl-event-row">
              <span class="cvl-event-name">${(m.source || '').replace('event:', '').replace(/_/g, ' ')}</span>
              <span class="cvl-event-val ${m.value >= 0 ? 'text-success' : 'text-danger'}">${m.value >= 0 ? '+' : ''}${m.value} ${m.stat}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

      ${_city.landmark ? `
        <div class="cvl-divider"></div>
        <div class="cvl-landmark-badge-panel">
          <span class="cvl-lm-icon">⭐</span>
          <span class="cvl-lm-name">${BUILDING_DEFS[_city.landmark]?.name || _city.landmark}</span>
          <span class="cvl-lm-level">Lv ${_city.buildings[_city.landmark] || 1}</span>
        </div>
      ` : ''}
    `;
  }

  function _statRowHtml(key, val) {
    const meta   = CityStatsService.META[key];
    const health = CityStatsService.getStatHealth(key, val);
    return `
      <div class="cvl-stat-row2">
        <span class="cvl-stat2-icon">${meta.icon}</span>
        <div class="cvl-stat2-body">
          <div class="cvl-stat2-top">
            <span class="cvl-stat2-label">${meta.label}</span>
            <span class="cvl-stat2-val">${val}</span>
            <span class="cvl-stat2-health ${health.cssClass}">${health.label}</span>
          </div>
          <div class="cvl-stat2-desc">${meta.desc}</div>
        </div>
      </div>
    `;
  }

  // ── Right panel ───────────────────────────────────────────────

  function _renderContent() {
    _refreshQueueBanner();
    document.getElementById('cv-bld-area').innerHTML = _buildingsHtml();
    _bindContentEvents();
  }

  function _refreshQueueBanner() {
    const banner = document.getElementById('cv-queue-banner');
    if (!banner) return;
    if (_city.constructionQueue.length > 0) {
      banner.innerHTML = _queueBannerHtml();
      banner.classList.remove('hidden');
      document.getElementById('cv-boost-btn')?.addEventListener('click', _instantComplete);
    } else {
      banner.classList.add('hidden');
    }
  }

  function _buildingsHtml() {
    const buildings = Object.values(BUILDING_DEFS).filter(d => d.category === _bldTab);
    const busy      = _city.constructionQueue.length > 0;

    return `
      <div class="bld2-tabs">
        ${BLD_TABS.map(t => `
          <button class="bld2-tab ${_bldTab === t.id ? 'bld2-tab--active' : ''}" data-bldtab="${t.id}">
            <span>${t.icon}</span><span>${t.label}</span>
          </button>
        `).join('')}
      </div>

      ${_bldTab === 'landmarks' ? _landmarkHeaderHtml() : ''}

      <div class="bld2-list">
        ${buildings.map(def => _cardHtml(def, busy)).join('')}
      </div>
    `;
  }

  function _landmarkHeaderHtml() {
    const current = _city.landmark ? BUILDING_DEFS[_city.landmark] : null;
    return `
      <div class="bld2-lm-notice">
        <div class="bld2-lm-notice-title">⭐ City Landmark</div>
        <div class="bld2-lm-notice-body">Each city may construct ONE Landmark. Choose wisely — you cannot switch to a different one.</div>
        ${current ? `
          <div class="bld2-lm-active">
            ${current.icon} <strong>${current.name}</strong> — Level ${_city.buildings[_city.landmark] || 1}
          </div>
        ` : `<div class="bld2-lm-none">No Landmark has been built in this city yet.</div>`}
      </div>
    `;
  }

  function _cardHtml(def, busy) {
    const currentLvl = _city.buildings[def.id] || 0;
    const targetLvl  = currentLvl + 1;
    const atMax      = currentLvl >= def.maxLevel;
    const inQueue    = _city.constructionQueue.some(q => q.buildingId === def.id);
    const isLandmark = !!def.isLandmark;

    const { locked, reasons } = BuildingUnlockService.check(_city, _lord, def);

    const canAfford = !atMax && !locked && !busy && !inQueue && ConstructionService.canAfford(_city, def.id, _city.resources);
    const cost      = !atMax ? def.cost(targetLvl) : {};
    const duration  = !atMax ? TimeService.formatDuration(def.buildTime(targetLvl)) : '';

    const effects   = def.effects ? def.effects(Math.max(1, currentLvl)) : [];
    const prodNow   = currentLvl > 0 ? def.production(currentLvl) : {};
    const prodNext  = !atMax ? def.production(targetLvl) : {};
    const hasProdNow  = Object.values(prodNow).some(v => v > 0);
    const hasProdNext = Object.values(prodNext).some(v => v > 0);

    // Button state
    let btnLabel, btnClass, btnDisabled;
    if (atMax) {
      btnLabel = 'Max Level'; btnClass = 'bld2-btn--maxed'; btnDisabled = true;
    } else if (inQueue) {
      btnLabel = '⚙ Building…'; btnClass = 'bld2-btn--busy'; btnDisabled = true;
    } else if (locked) {
      btnLabel = '🔒 Locked'; btnClass = 'bld2-btn--locked'; btnDisabled = true;
    } else if (busy) {
      btnLabel = 'Queue Busy'; btnClass = 'bld2-btn--busy'; btnDisabled = true;
    } else if (!canAfford) {
      btnLabel = 'Need Resources'; btnClass = 'bld2-btn--cant'; btnDisabled = true;
    } else {
      btnLabel = currentLvl === 0 ? '▶ Build' : '▲ Upgrade'; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    }

    const cardClasses = [
      'bld2-card',
      locked   ? 'bld2-card--locked'   : '',
      atMax    ? 'bld2-card--maxed'    : '',
      inQueue  ? 'bld2-card--inqueue'  : '',
      isLandmark ? 'bld2-card--landmark' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardClasses}">
        ${isLandmark ? '<div class="bld2-lm-banner">⭐ LANDMARK</div>' : ''}

        <div class="bld2-card-main">

          <!-- Left: icon + level -->
          <div class="bld2-icon-col">
            <div class="bld2-icon">${def.icon}</div>
            <div class="bld2-level-block ${atMax ? 'bld2-level--max' : ''}">
              <div class="bld2-level-label">${atMax ? 'MAX' : 'LEVEL'}</div>
              <div class="bld2-level-num">${atMax ? '✓' : currentLvl}</div>
            </div>
          </div>

          <!-- Center: info -->
          <div class="bld2-center-col">
            <div class="bld2-name">${def.name}</div>
            <div class="bld2-desc">${def.description}</div>

            ${effects.length > 0 ? `
              <div class="bld2-effects-row">
                ${effects.map(e => {
                  const meta = CityStatsService.META[e.stat];
                  if (!meta) return '';
                  const cls = e.value >= 0 ? 'eff-pos' : 'eff-neg';
                  return `<span class="bld-eff-tag ${cls}">${meta.icon} ${e.value > 0 ? '+' : ''}${e.value}</span>`;
                }).filter(Boolean).join('')}
              </div>
            ` : ''}

            ${(hasProdNow || hasProdNext) ? `
              <div class="bld2-prod-row">
                ${hasProdNow ? `<span class="bld2-prod-cur">${_prodLine(prodNow)}</span>` : ''}
                ${hasProdNow && hasProdNext ? `<span class="bld2-prod-sep">→</span>` : ''}
                ${hasProdNext ? `<span class="bld2-prod-next">Lv ${targetLvl}: ${_prodLine(prodNext)}</span>` : ''}
              </div>
            ` : ''}

            ${locked ? `
              <div class="bld2-reasons">
                ${reasons.map(r => `<div class="bld2-reason">🔒 ${r}</div>`).join('')}
              </div>
            ` : !atMax ? `
              <div class="bld2-cost-row">
                ${_costHtml(cost)}
                <span class="bld2-duration">⏱ ${duration}</span>
              </div>
            ` : ''}
          </div>

          <!-- Right: action -->
          <div class="bld2-action-col">
            <button class="bld2-btn ${btnClass}" data-building="${def.id}" ${btnDisabled ? 'disabled' : ''}>
              ${btnLabel}
            </button>
            ${!atMax && !locked ? `<div class="bld2-next-hint">→ Lv ${targetLvl}</div>` : ''}
          </div>

        </div>
        ${locked ? '<div class="bld2-locked-veil"></div>' : ''}
      </div>
    `;
  }

  // ── Queue banner ──────────────────────────────────────────────

  function _queueBannerHtml() {
    if (_city.constructionQueue.length === 0) return '';
    const item      = _city.constructionQueue[0];
    const def       = BUILDING_DEFS[item.buildingId];
    const secs      = ConstructionService.timeRemaining(_city);
    const pct       = Math.floor(ConstructionService.progress(_city) * 100);
    const boostCost = Math.max(1, Math.ceil(secs / 60));
    const player    = PlayerService.getById(_player.id);
    const canBoost  = (player?.credits || 0) >= boostCost;
    return `
      <div class="cv-queue-inner">
        <span class="cv-queue-icon">🔨</span>
        <span class="cv-queue-label">${def?.name || item.buildingId} → Level ${item.targetLevel}</span>
        <div class="cv-queue-bar"><div class="cv-queue-fill" id="cv-q-fill" style="width:${pct}%"></div></div>
        <span class="cv-queue-timer" id="cv-q-timer">${TimeService.formatDuration(secs)}</span>
        <button class="cv-boost-btn ${canBoost ? '' : 'cv-boost-btn--cant'}" id="cv-boost-btn" ${canBoost ? '' : 'disabled'}>
          ⚡ ${boostCost}💎
        </button>
      </div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _prodLine(prod) {
    return Object.entries(prod)
      .filter(([, v]) => v > 0)
      .map(([res, v]) => `${RES[res]?.icon || res} +${v}/h`)
      .join(' ');
  }

  function _costHtml(cost) {
    return Object.entries(cost)
      .filter(([, v]) => v > 0)
      .map(([res, v]) => {
        const has = (_city.resources[res] || 0) >= v;
        return `<span class="${has ? 'bld2-res' : 'bld2-res bld2-res--short'}">${RES[res]?.icon || res} ${v}</span>`;
      })
      .join('');
  }

  // ── Event binding ─────────────────────────────────────────────

  function _bindShellEvents() {
    document.getElementById('cv-back')?.addEventListener('click', () => {
      _stopCountdown();
      App.navigate('overview', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });
    document.getElementById('cv-map-btn')?.addEventListener('click', () => {
      _stopCountdown();
      App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });
  }

  function _bindContentEvents() {
    // Category tab switching
    document.querySelectorAll('.bld2-tab[data-bldtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _bldTab = btn.dataset.bldtab;
        _renderContent();
      });
    });

    // Build / upgrade buttons
    document.querySelectorAll('.bld2-btn[data-building]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const result = ConstructionService.enqueue(_city, btn.dataset.building, _city.resources);
        if (!result.ok) { _toast(result.error); return; }
        _city = CityService.getById(_city.id);
        _renderContent();
        _startCountdown();
        EventBus.emit('resources:changed', _city.resources);
        HUD.refresh();
      });
    });
  }

  function _instantComplete() {
    if (_city.constructionQueue.length === 0) return;
    const secs   = ConstructionService.timeRemaining(_city);
    const cost   = Math.max(1, Math.ceil(secs / 60));
    const result = PlayerService.spendCredits(_player.id, cost);
    if (!result.ok) { _toast(result.error); return; }
    _player = PlayerService.getById(_player.id);
    _city.constructionQueue[0].finishAt = TimeService.now() - 1;
    CityService.save(_city);
    const completed = ConstructionService.tick(_city);
    _city = CityService.getById(_city.id);
    completed.forEach(n => _toast(`✓ ${n} completed!`));
    _stopCountdown();
    HUD.refresh();

    const refreshedLeft = document.getElementById('cv-left');
    if (refreshedLeft) refreshedLeft.innerHTML = _leftPanelHtml();
    _renderContent();
    _startCountdown();
  }

  // ── Live countdown ────────────────────────────────────────────

  function _startCountdown() {
    _stopCountdown();
    if (_city.constructionQueue.length === 0) return;

    _tickTimer = setInterval(() => {
      const completed = ConstructionService.tick(_city);
      if (completed.length > 0) {
        completed.forEach(n => _toast(`✓ ${n} completed!`));
        _city = CityService.getById(_city.id);
        const lp = document.getElementById('cv-left');
        if (lp) lp.innerHTML = _leftPanelHtml();
        _renderContent();
        _startCountdown();
        return;
      }
      const timerEl = document.getElementById('cv-q-timer');
      const fillEl  = document.getElementById('cv-q-fill');
      if (!timerEl) { _stopCountdown(); return; }
      timerEl.textContent = TimeService.formatDuration(ConstructionService.timeRemaining(_city));
      if (fillEl) fillEl.style.width = `${Math.floor(ConstructionService.progress(_city) * 100)}%`;
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
