// =============================================
//  city-view.js — Full-screen city management
// =============================================

const CityView = (() => {
  let _city      = null;
  let _lord      = null;
  let _player    = null;
  let _bldTab       = 'overview';
  let _selectedStat = null;
  let _tickTimer    = null;

  const RES = {
    food:  { icon: '🌾', name: 'Food'  },
    wood:  { icon: '🪵', name: 'Wood'  },
    stone: { icon: '⛏',  name: 'Stone' },
    iron:  { icon: '⚒',  name: 'Iron'  },
  };

  const BLD_TABS = [
    { id: 'overview',       label: 'Overview',       icon: '📊' },
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
    _city   = CityService.getById(_city.id);
    _player = PlayerService.getById(_player.id);

    const completed = ConstructionService.tick(_city);
    if (completed.length > 0) {
      _city = CityService.getById(_city.id);
      completed.forEach(name => _toast(`✓ ${name} completed!`));
      ServerActions.syncNow();
    }

    const eventMessages = EventService.tick(_city);
    if (eventMessages.length > 0) {
      _city = CityService.getById(_city.id);
    }

    _bldTab = 'overview';

    root.innerHTML = _shell();
    _renderContent();
    _bindShellEvents();
    _startCountdown();

    eventMessages.forEach(msg => _toast(msg));
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const race = RACES[_lord?.race] || {};
    return `
      <div class="city-view">
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

  function _cityTierImg(thLevel) {
    if (thLevel >= 16) return 'assets/city/tier4.jpg';
    if (thLevel >= 11) return 'assets/city/tier3.jpg';
    if (thLevel >= 6)  return 'assets/city/tier2.jpg';
    return 'assets/city/tier1.webp';
  }

  function _leftPanelHtml() {
    const race    = RACES[_lord?.race] || {};
    const terrain = WorldService.getTerrain(_city.x, _city.y);
    const stats   = CityStatsService.getStats(_city);
    const rates   = ProductionService.getRates(_city, _lord);
    const growth  = CityStatsService.getPopulationGrowthRate(_city, stats, rates);
    const status  = CityStatsService.getCityStatus(stats, growth);

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

    const thLevel = _city.buildings.town_hall || 0;
    const tierImg = _cityTierImg(thLevel);

    return `
      <div class="cvl-artwork">
        <img class="cvl-artwork-img" src="${tierImg}" alt="${_city.name}" />
        <div class="cvl-artwork-glow"></div>
        <div class="cvl-artwork-status cvl-${status.id}">${status.label}</div>
      </div>

      <div class="cvl-city-header">
        <div class="cvl-city-name">${_city.name}</div>
      </div>
      <div class="cvl-terrain-row">
        <span>${terrain.icon} ${terrain.name}</span>
        <span class="cvl-owner-badge">${race.icon || ''} ${race.name || '—'}</span>
      </div>

      <div class="cvl-divider"></div>

      <div class="cvl-pop-row">
        <span class="cvl-pop-label">👥 Population</span>
        <span class="cvl-pop-value">${Math.floor(_city.population || 1000)}</span>
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

    `;
  }

  function _statRowHtml(key, val, trend) {
    const meta     = CityStatsService.META[key];
    const health   = CityStatsService.getStatHealth(key, val);
    const selected = _selectedStat === key;

    let trendHtml = '';
    if (trend) {
      const trendGood = (meta.goodHigh && trend === '▲') || (!meta.goodHigh && trend === '▼');
      const trendBad  = (meta.goodHigh && trend === '▼') || (!meta.goodHigh && trend === '▲');
      const trendCls  = trendGood ? 'cvov-stat-trend--good' : trendBad ? 'cvov-stat-trend--bad' : 'cvov-stat-trend--stable';
      trendHtml = `<span class="cvov-stat-trend ${trendCls}">${trend}</span>`;
    }

    return `
      <div class="cvl-stat-row2 ${selected ? 'cvl-stat-row2--selected' : ''}" data-statkey="${key}">
        <span class="cvl-stat2-icon">${meta.icon}</span>
        <div class="cvl-stat2-body">
          <div class="cvl-stat2-top">
            <span class="cvl-stat2-label">${meta.label}</span>
            <span class="cvl-stat2-val">${val}</span>
            <span class="cvl-stat2-health ${health.cssClass}">${health.label}</span>
            ${trendHtml}
          </div>
          <div class="cvl-stat2-desc">${meta.desc}</div>
        </div>
        ${selected ? '<span class="cvl-stat2-filter-icon">🔍</span>' : ''}
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
    const tabsHtml = `
      <div class="bld2-tabs">
        ${BLD_TABS.map(t => `
          <button class="bld2-tab ${_bldTab === t.id ? 'bld2-tab--active' : ''}" data-bldtab="${t.id}">
            <span>${t.icon}</span><span>${t.label}</span>
          </button>
        `).join('')}
      </div>
    `;

    if (_bldTab === 'overview') {
      return tabsHtml + _overviewTabHtml();
    }

    const buildings = Object.values(BUILDING_DEFS)
      .filter(d => d.category === _bldTab)
      .filter(def => {
        const currentLvl = _city.buildings[def.id] || 0;
        if (currentLvl > 0) return true; // already built — always show
        const { locked } = BuildingUnlockService.check(_city, _lord, def);
        return !locked;
      });
    const busy      = _city.constructionQueue.length > 0;

    return tabsHtml +
      (_bldTab === 'landmarks' ? _landmarkHeaderHtml() : '') +
      `<div class="bld2-list">${buildings.map(def => _cardHtml(def, busy)).join('')}</div>`;
  }

  function _overviewTabHtml() {
    const stats    = CityStatsService.getStats(_city);
    const rates    = ProductionService.getRates(_city, _lord);
    const growth   = CityStatsService.getPopulationGrowthRate(_city, stats, rates);
    const status   = CityStatsService.getCityStatus(stats, growth);
    const { level, usedSlots, maxSlots } = CityStatsService.getSlotInfo(_city);
    const garrison = CityService.getGarrison(_city);
    const terrain  = WorldService.getTerrain(_city.x, _city.y);
    const race     = RACES[_lord?.race] || {};
    const now      = TimeService.now();

    const growthSign  = growth > 0 ? '▲' : growth < 0 ? '▼' : '─';
    const growthClass = growth > 0 ? 'pop-growing' : growth < 0 ? 'pop-declining' : 'pop-stable';

    const uniqueEvents = Object.values(
      (_city.activeModifiers || [])
        .filter(m => !m.expiresAt || now < m.expiresAt)
        .reduce((acc, m) => { if (!acc[m.source]) acc[m.source] = m; return acc; }, {})
    );

    const slotPct   = maxSlots > 0 ? Math.min(100, Math.round((usedSlots / maxSlots) * 100)) : 0;
    const slotColor = slotPct > 90 ? '#f44336' : slotPct > 70 ? '#ff9800' : '#4caf50';

    const mainStats  = ['happiness', 'corruption', 'hygiene', 'unemployment', 'religion', 'culture'];
    const extraStats = ['stability', 'security'];

    const trends = CityStatsService.getStatTrends(_city, stats, growth);

    const garrisonTotal = garrison.reduce((s, r) => s + r.count, 0);

    const fmtRate    = n => n === 0 ? '—' : (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));
    const fmtRateGold = n => { const r = Math.round(n); return (r > 0 ? '+' : '') + r + '/h'; };

    // Gold economy data
    const player         = _player ? PlayerService.getById(_player.id) : null;
    const cityGoldRate   = ProductionService.getGoldRate(_city);
    const empireGoldRate = ProductionService.getNetGoldRate(_player?.id || _city.playerId);
    const goldRateClass  = empireGoldRate >= 0 ? 'cvov-rate-pos' : 'cvov-rate-neg';

    // Tier progress — T5 starts at 100k, peak goal is 150k
    const TIER_THRESHOLDS = [0, 10000, 25000, 50000, 100000, 150000];
    const currentPop  = Math.floor(_city.population || 1000);
    const isMaxTier   = level >= 5;
    const tierStart   = TIER_THRESHOLDS[level - 1] || 0;
    const tierEnd     = TIER_THRESHOLDS[level] || 150000;
    const isPeakPop   = isMaxTier && currentPop >= 150000;
    const popToNext   = isPeakPop ? 0 : Math.max(0, tierEnd - currentPop);
    const tierPct     = isPeakPop ? 100 : Math.min(100, Math.round(
      ((currentPop - tierStart) / (tierEnd - tierStart)) * 100
    ));

    const _fmtEta = hours => {
      if (hours < 1)       return '< 1h';
      if (hours < 24)      return `${Math.round(hours)}h`;
      const days = Math.floor(hours / 24);
      const hrs  = Math.round(hours % 24);
      if (days < 7)        return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
      const weeks = Math.floor(days / 7);
      const remD  = days % 7;
      return remD > 0 ? `${weeks}w ${remD}d` : `${weeks}w`;
    };

    let tierEta = '';
    if (!isPeakPop) {
      if (growth <= 0) {
        tierEta = growth === 0 ? 'Population stagnant' : 'Population declining';
      } else {
        tierEta = '~' + _fmtEta(popToNext / growth);
      }
    }

    return `
      <div class="cvov-container">

        <!-- Hero banner -->
        <div class="cvov-hero">
          <div class="cvov-hero-art">
            ${terrain?.image
              ? `<img class="cvov-hero-terrain-img" src="${terrain.image}" alt="${terrain.name}" />`
              : terrain.icon}
          </div>
          <div class="cvov-hero-body">
            <div class="cvov-hero-name">${_city.name}</div>
            <div class="cvov-hero-meta">
              <span class="cvov-tier-badge">Tier ${level}</span>
              <span class="cvl-status-badge cvl-${status.id}">${status.label}</span>
            </div>
            <div class="cvov-hero-terrain">${terrain.icon} ${terrain.name} · ${race.icon || ''} ${race.name || '—'}</div>
          </div>
          <div class="cvov-hero-pop">
            <div class="cvov-hero-pop-val">${currentPop.toLocaleString()}</div>
            <div class="cvov-hero-pop-label">Population</div>
            <div class="cvov-hero-pop-growth ${growthClass}">${growthSign}${Math.abs(growth)}/hr</div>
          </div>
          <div class="cvov-hero-gold">
            <div class="cvov-hero-gold-rate">+${cityGoldRate}💰/h</div>
            <div class="cvov-hero-gold-label">Gold / hr</div>
          </div>
        </div>

        <!-- Tier progress -->
        ${isPeakPop ? `
        <div class="cvov-tier-prog cvov-tier-prog--max">
          <span>⭐ Peak Population — City fully developed</span>
        </div>
        ` : `
        <div class="cvov-tier-prog">
          <div class="cvov-tp-row">
            <span class="cvov-tp-tiers">${isMaxTier ? `Tier 5 → Peak` : `Tier ${level} → Tier ${level + 1}`}</span>
            <span class="cvov-tp-count">${currentPop.toLocaleString()} / ${tierEnd.toLocaleString()}</span>
            <span class="cvov-tp-eta ${growth <= 0 ? 'cvov-tp-eta--warn' : ''}">${tierEta}</span>
          </div>
          <div class="cvov-tp-need">${popToNext.toLocaleString()} more population needed to reach ${isMaxTier ? 'peak (150k)' : `Tier ${level + 1}`}</div>
        </div>
        `}

        <div class="cvov-section">
          <div class="cvov-section-title">🧱 Building Slots</div>
          <div class="cvov-slots-header">
            <span class="cvov-slots-label">Used: <strong>${usedSlots}</strong> / ${maxSlots}</span>
            <span class="cvov-slots-pct" style="color:${slotColor}">${slotPct}%</span>
          </div>
          <div class="cvov-slots-track">
            <div class="cvov-slots-fill" style="width:${slotPct}%;background:${slotColor}"></div>
          </div>
          <div class="cvov-slots-hint">Tier ${level} city · max ${maxSlots} slots · grow population for more</div>
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">📦 Resources & Production</div>
          <div class="cvov-res-table">
            <div class="cvov-res-thead">
              <span class="cvov-res-th-res">Resource</span>
              <span class="cvov-res-th cvov-res-th-terrain">${terrain.icon} Terrain</span>
              <span class="cvov-res-th">/ hr</span>
              <span class="cvov-res-th">/ day</span>
              <span class="cvov-res-th">/ week</span>
            </div>
            ${Object.entries(RES).map(([key, meta]) => {
              const rate     = rates[key] || 0;
              const day      = rate * 24;
              const week     = rate * 24 * 7;
              const rClass   = rate > 0 ? 'cvov-rate-pos' : rate < 0 ? 'cvov-rate-neg' : 'cvov-rate-zero';
              const terrMult = (TERRAIN_RESOURCE_MODS[terrain?.id] || {})[key];
              const terrPct  = terrMult ? Math.round((terrMult - 1) * 100) : null;
              const terrCls  = terrMult ? (terrMult >= 1 ? 'cvov-terr-pos' : 'cvov-terr-neg') : 'cvov-terr-none';
              const terrVal  = terrPct !== null ? `${terrPct >= 0 ? '+' : ''}${terrPct}%` : '—';
              return `
                <div class="cvov-res-row">
                  <span class="cvov-res-name"><span class="cvov-res-icon">${meta.icon}</span>${meta.name}</span>
                  <span class="cvov-res-terr ${terrCls}">${terrVal}</span>
                  <span class="cvov-res-rate ${rClass}">${fmtRate(rate)}</span>
                  <span class="cvov-res-rate ${rClass}">${fmtRate(day)}</span>
                  <span class="cvov-res-rate ${rClass}">${fmtRate(week)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">📊 City Status</div>
          ${mainStats.map(key => _statRowHtml(key, stats[key], trends[key])).join('')}
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">🛡 City Defenses</div>
          ${extraStats.map(key => _statRowHtml(key, stats[key], trends[key])).join('')}
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">⚔ Garrison <span class="cvov-garrison-count">${garrisonTotal} / 10</span></div>
          ${garrison.length === 0
            ? '<div class="cvl-garrison-empty">No garrison — build a Guard Post</div>'
            : `<div class="cvl-garrison">${garrison.map(r => {
                const def = UNIT_DEFS[r.unitId];
                return `<div class="cvl-garrison-row">
                  <span class="cvl-garrison-icon">${def?.icon || '⚔'}</span>
                  <span class="cvl-garrison-name">${def?.name || r.unitId}</span>
                  <span class="cvl-garrison-count">×${r.count}</span>
                </div>`;
              }).join('')}</div>`
          }
        </div>

        ${_city.landmark ? `
        <div class="cvov-section">
          <div class="cvov-section-title">⭐ Landmark</div>
          <div class="cvov-landmark-row">
            <span class="cvov-lm-icon">${BUILDING_DEFS[_city.landmark]?.icon || '⭐'}</span>
            <span class="cvov-lm-name">${BUILDING_DEFS[_city.landmark]?.name || _city.landmark}</span>
            <span class="cvl-lm-level">Lv ${_city.buildings[_city.landmark] || 1}</span>
          </div>
        </div>
        ` : ''}

        ${uniqueEvents.length > 0 ? `
        <div class="cvov-section">
          <div class="cvov-section-title">⚡ Active Effects</div>
          ${uniqueEvents.map(m => `
            <div class="cvl-event-row">
              <span class="cvl-event-name">${(m.source || '').replace('event:', '').replace(/_/g, ' ')}</span>
              <span class="cvl-event-val ${m.value >= 0 ? 'text-success' : 'text-danger'}">${m.value >= 0 ? '+' : ''}${m.value} ${m.stat}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}

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

    const playerRes = (_player && _player.resources) ? _player.resources : {};
    const canAfford = !atMax && !locked && !busy && !inQueue && ConstructionService.canAfford(_city, def.id, playerRes);
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

    let statHighlight = '';
    if (_selectedStat) {
      const checkEffects = def.effects ? def.effects(Math.max(1, currentLvl)) : [];
      const impact = checkEffects
        .filter(e => e.stat === _selectedStat)
        .reduce((sum, e) => sum + e.value, 0);
      statHighlight = impact > 0 ? 'bld2-card--stat-pos' : impact < 0 ? 'bld2-card--stat-neg' : 'bld2-card--stat-muted';
    }

    const cardClasses = [
      'bld2-card',
      locked     ? 'bld2-card--locked'   : '',
      atMax      ? 'bld2-card--maxed'    : '',
      inQueue    ? 'bld2-card--inqueue'  : '',
      isLandmark ? 'bld2-card--landmark' : '',
      statHighlight,
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
                  const cls     = e.value >= 0 ? 'eff-pos' : 'eff-neg';
                  const active  = _selectedStat === e.stat ? ' eff-active' : '';
                  return `<span class="bld-eff-tag ${cls}${active}" title="${meta.label}">${meta.icon} ${e.value > 0 ? '+' : ''}${e.value}</span>`;
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
        const has = Math.floor((_player?.resources || {})[res] || 0) >= v;
        return `<span class="${has ? 'bld2-res' : 'bld2-res bld2-res--short'}">${RES[res]?.icon || res} ${v}</span>`;
      })
      .join('');
  }

  // ── Event binding ─────────────────────────────────────────────

  function _bindShellEvents() {
    document.getElementById('cv-back')?.addEventListener('click', () => {
      _stopCountdown();
      _selectedStat = null;
      App.navigate('overview', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });
    document.getElementById('cv-map-btn')?.addEventListener('click', () => {
      _stopCountdown();
      _selectedStat = null;
      App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id) });
    });

    // Delegate stat-row clicks on the permanent containers (fires once, survives innerHTML re-renders)
    _bindStatDelegation('#cv-left');
    _bindStatDelegation('#cv-bld-area');
  }

  function _bindStatDelegation(selector) {
    const el = document.querySelector(selector);
    if (!el || el._statDelegated) return;
    el._statDelegated = true;
    el.addEventListener('click', e => {
      const row = e.target.closest('.cvl-stat-row2[data-statkey]');
      if (!row) return;
      const key = row.dataset.statkey;
      _selectedStat = _selectedStat === key ? null : key;
      const lp = document.getElementById('cv-left');
      if (lp) lp.innerHTML = _leftPanelHtml();
      if (_bldTab === 'overview' && _selectedStat) _bldTab = 'infrastructure';
      _renderContent();
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
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.build(_city.id, btn.dataset.building);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _city = CityService.getById(_city.id);
        _renderContent();
        _startCountdown();
        EventBus.emit('resources:changed', _city.resources);
        HUD.refresh();
      });
    });
  }

  async function _instantComplete() {
    if (_city.constructionQueue.length === 0) return;
    const btn = document.getElementById('cv-boost-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Completing…'; }

    const result = await ServerActions.instantBuild(_city.id);

    if (!result.ok) {
      _toast(result.error || 'Failed to instant-complete');
      if (btn) { btn.disabled = false; btn.textContent = '💎 Instant'; }
      return;
    }

    _city   = CityService.getById(_city.id);
    _player = PlayerService.getById(_player.id);
    _stopCountdown();
    HUD.refresh();
    const refreshedLeft = document.getElementById('cv-left');
    if (refreshedLeft) refreshedLeft.innerHTML = _leftPanelHtml();
    _renderContent();
    _startCountdown();
    _toast('✓ Building completed instantly!');
  }

  // ── Live countdown ────────────────────────────────────────────

  function _startCountdown() {
    _stopCountdown();
    if (_city.constructionQueue.length === 0) return;

    _tickTimer = setInterval(() => {
      const completed = ConstructionService.tick(_city);
      if (completed.length > 0) {
        ServerActions.syncNow(); // persist building completion to Supabase
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
