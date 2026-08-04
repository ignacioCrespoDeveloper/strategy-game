// =============================================
//  city-view.js — Full-screen city management
//
//  OGame-style layout: tabs Overview · Resources ·
//  Infrastructure · Military. Building tabs show a
//  thumbnail grid with level badges; clicking a tile
//  opens a detail panel ABOVE the grid (Improve /
//  Tear down / requirements), mirroring OGame.
// =============================================

const CityView = (() => {
  let _city         = null;
  let _lord         = null;
  let _player       = null;
  let _bldTab       = 'overview';
  let _selectedStat = null;
  let _selectedBld  = null;   // building id shown in the detail panel
  let _tickTimer    = null;

  // Display order matches the HUD: wood → stone → food (food is scarcest).
  const RES = {
    wood:  { icon: gi('wood-pile'), name: 'Wood'  },
    stone: { icon: gi('war-pick'),  name: 'Stone' },
    food:  { icon: gi('wheat'), name: 'Food'  },
  };

  // The Merchant briefly lived here as a 5th tab (2026-08-04) and moved out the
  // same day to the global nav — js/ui/merchant-screen.js. It trades the
  // empire-wide resource pool against the empire-wide gold pile, neither of
  // which belongs to a city, so it does not belong in the city view.
  // Items ARE a city tab, unlike the Merchant: an item is spent on ONE city and
  // its bonus belongs to that city alone, so "which city am I looking at" is
  // the whole decision. The backpack it spends from is empire-wide, which is
  // why the tab shows the same stock from every city.
  const BLD_TABS = [
    { id: 'overview',       label: 'Overview',       icon: gi('histogram') },
    { id: 'resources',      label: 'Resources',      icon: gi('wheat') },
    { id: 'infrastructure', label: 'Infrastructure', icon: gi('capitol') },
    { id: 'military',       label: 'Military',       icon: gi('crossed-swords')  },
    { id: 'items',          label: 'Items',          icon: gi('wooden-crate') },
  ];

  // One tab per building group (the single-tab experiment was reverted).
  // Landmarks live inside the Infrastructure tab.
  const BLD_SECTIONS = {
    resources:      { categories: ['resources'] },
    infrastructure: { categories: ['infrastructure', 'landmarks'] },
    military:       { categories: ['military'] },
  };

  const MAX_QUEUE = 5;

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

    // EventService.tick() ran here until 2026-08-04. City events were deleted
    // with it — see js/data/items.js for what replaced them and why.

    _bldTab      = 'overview';
    _selectedBld = null;

    root.innerHTML = _shell();
    _renderContent();
    _bindShellEvents();
    _startCountdown();
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
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
        <span>${gi('treasure-map')}</span><span>World Map</span>
      </button>
    `;
  }

  // ── Left panel ────────────────────────────────────────────────

  function _cityTierImg(level) {
    if (level >= 4) return 'assets/city/tier4.jpg';
    if (level >= 3) return 'assets/city/tier3.jpg';
    if (level >= 2) return 'assets/city/tier2.jpg';
    return 'assets/city/tier1.webp';
  }

  function _leftPanelHtml() {
    const race    = RACES[_lord?.race] || {};
    const terrain = WorldService.getTerrain(_city.x, _city.y);
    const stats   = CityStatsService.getStats(_city);
    const rates   = ProductionService.getRates(_city);
    // One call owns the badge, the rate and the famine override — see
    // CityStatsService.getGrowthReport. Population is never flat, so there is
    // no third "stagnant" arrow to render.
    const report  = CityStatsService.getGrowthReport(_city, stats, rates);
    const growth  = report.growth;

    const activeItems = _activeItems();

    // Same two lists the status badge scores from — City Status feeds it,
    // City Defenses is deliberately excluded.
    const mainStats  = CityStatsService.STATUS_STATS;
    const extraStats = CityStatsService.DEFENSE_STATS;

    const { level: cityLevel } = CityStatsService.getSlotInfo(_city);
    const tierImg = _cityTierImg(cityLevel);

    return `
      <div class="cvl-artwork">
        <img class="cvl-artwork-img" src="${tierImg}" alt="${_city.name}" />
        <div class="cvl-artwork-glow"></div>
        <div class="cvl-artwork-status cvl-${report.badgeId}" title="${report.title}">${report.badgeLabel}</div>
      </div>

      <div class="cvl-city-header">
        <h1 class="cvl-city-name">${_city.name}</h1>
      </div>
      <div class="cvl-terrain-row">
        <span>${terrain.icon} ${terrain.name}</span>
        <span class="cvl-owner-badge">${race.icon || ''} ${race.name || '—'}</span>
      </div>

      <div class="cvl-divider"></div>

      <div class="cvl-pop-row">
        <span class="cvl-pop-label">${gi('three-friends')} Population</span>
        <span class="cvl-pop-value">${Math.floor(_city.population || 1000)}</span>
        <span class="cvl-pop-growth ${report.cssClass}" title="${report.title}">${report.sign}${Math.abs(growth)}/hr</span>
      </div>
      <div class="cvl-pop-statusfx">
        <span class="cvl-pop-statusfx-src">${report.fed ? `${report.status.label} status` : 'Famine · no food'}</span>
        <span class="cvl-pop-statusfx-val ${report.cssClass}">${report.perDayText}</span>
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

      ${activeItems.length > 0 ? `
        <div class="cvl-divider"></div>
        <div class="cvl-events">
          <div class="cvl-events-title">Active Items</div>
          ${activeItems.map(({ def, entry }) => `
            <div class="cvl-event-row">
              <span class="cvl-event-name">${def.name}</span>
              <span class="cvl-event-val text-success">${_itemBonusLabel(def)} · ${_fmtLeft(entry.expiresAt)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}

    `;
  }

  // ── City items (js/data/items.js) ─────────────────────────────
  //
  // Every item currently live on this city, newest expiry last, each paired
  // with its definition. Expired entries are filtered here as well as on the
  // server: catch-up only prunes them on its next tick, so between an expiry
  // and the next sync the stored array still holds a dead one.
  function _activeItems() {
    const now = TimeService.now();
    return (_city.activeItems || [])
      .filter(e => e && ITEM_DEFS[e.itemId] && (!e.expiresAt || now < e.expiresAt))
      .map(e => ({ entry: e, def: ITEM_DEFS[e.itemId] }))
      .sort((a, b) => (a.entry.expiresAt || 0) - (b.entry.expiresAt || 0));
  }

  // "+20% food" / "+25% all resources" — itemBonusLabel lives in js/data/items.js
  // so the quest log's spoil chips print the identical string.
  const _itemBonusLabel = itemBonusLabel;

  // Coarse "time left" for something measured in days, where formatDuration's
  // "71h 59m 12s" is noise. Days+hours, then hours+minutes, then minutes.
  function _fmtLeft(expiresAt) {
    const secs = Math.max(0, TimeService.secondsUntil(expiresAt || 0));
    const d    = Math.floor(secs / 86400);
    const h    = Math.floor((secs % 86400) / 3600);
    const m    = Math.floor((secs % 3600) / 60);
    if (d > 0) return `${d}d ${h}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${m}m left`;
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
        ${selected ? '<span class="cvl-stat2-filter-icon">' + gi('magnifying-glass') + '</span>' : ''}
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
      banner.querySelectorAll('[data-cancel-build]').forEach(btn => {
        btn.addEventListener('click', () => _cancelBuild(Number(btn.dataset.cancelBuild)));
      });
    } else {
      banner.classList.add('hidden');
    }
  }

  function _sectionBuildings(section) {
    return Object.values(BUILDING_DEFS)
      .filter(d => section.categories.includes(d.category))
      .filter(def => {
        const currentLvl = _city.buildings[def.id] || 0;
        if (currentLvl > 0) return true; // already built — always show
        const { locked } = BuildingUnlockService.check(_city, _lord, def);
        return !locked;
      });
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

    if (_bldTab === 'items') {
      return tabsHtml + _itemsTabHtml();
    }

    const section    = BLD_SECTIONS[_bldTab];
    const buildings  = _sectionBuildings(section);
    const selDef     = _selectedBld ? BUILDING_DEFS[_selectedBld] : null;
    const selVisible = selDef && buildings.some(d => d.id === selDef.id);

    // The detail panel opens BELOW the grid (drops down under the tiles).
    return tabsHtml +
      `<div class="bld3-grid">${buildings.map(def => _tileHtml(def)).join('')}</div>` +
      (selVisible ? _detailHtml(selDef) : '');
  }

  // ── Overview tab (kept as-is, minus iron, plus water) ─────────

  function _overviewTabHtml() {
    const stats    = CityStatsService.getStats(_city);
    const rates    = ProductionService.getRates(_city);
    const report   = CityStatsService.getGrowthReport(_city, stats, rates);
    const growth   = report.growth;
    const { level, usedSlots, maxSlots } = CityStatsService.getSlotInfo(_city);
    const garrison = CityService.getGarrison(_city);
    const terrain  = WorldService.getTerrain(_city.x, _city.y);
    const race     = RACES[_lord?.race] || {};

    const activeItems = _activeItems();

    const slotPct   = maxSlots > 0 ? Math.min(100, Math.round((usedSlots / maxSlots) * 100)) : 0;
    const slotColor = slotPct > 90 ? '#f44336' : slotPct > 70 ? '#ff9800' : '#4caf50';

    // Same two lists the status badge scores from — City Status feeds it,
    // City Defenses is deliberately excluded.
    const mainStats  = CityStatsService.STATUS_STATS;
    const extraStats = CityStatsService.DEFENSE_STATS;

    const trends = CityStatsService.getStatTrends(_city, stats, growth);

    const garrisonTotal = garrison.reduce((s, r) => s + r.count, 0);

    const fmtRate = n => n === 0 ? '—' : (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));

    // Gold economy data
    const cityGoldRate   = ProductionService.getGoldRate(_city);

    // Tier progress. Thresholds are READ OFF SLOT_TABLE, never hand-copied: the
    // literal that used to sit here stopped at tier 5 while the engine still had
    // a tier 6, the same drift building-unlock.js already fixed. Past the last
    // tier the bar runs to a soft "peak" goal half again the top threshold
    // (100k → 150k today), which is the only number the ladder does not supply.
    const TIERS       = EconomyCore.SLOT_TABLE || [];
    const topTier     = TIERS[TIERS.length - 1] || { level: 5, minPop: 100000 };
    const peakPop     = Math.round(topTier.minPop * 1.5);
    const currentPop  = Math.floor(_city.population || 1000);
    const isMaxTier   = level >= topTier.level;
    const tierEnd     = isMaxTier
      ? peakPop
      : (TIERS.find(r => r.level === level + 1)?.minPop || peakPop);
    const isPeakPop   = isMaxTier && currentPop >= peakPop;
    const popToNext   = isPeakPop ? 0 : Math.max(0, tierEnd - currentPop);

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

    // Population is never flat, so there is no "stagnant" case to word — a city
    // is either climbing toward the next tier or losing ground.
    let tierEta = '';
    if (!isPeakPop) {
      tierEta = growth > 0
        ? '~' + _fmtEta(popToNext / growth)
        : (report.fed ? 'Population declining' : 'Starving — no food');
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
              <span class="cvl-status-badge cvl-${report.badgeId}" title="${report.title}">${report.badgeLabel}</span>
            </div>
            <div class="cvov-hero-terrain">${terrain.icon} ${terrain.name} · ${race.icon || ''} ${race.name || '—'}</div>
          </div>
          <div class="cvov-hero-pop">
            <div class="cvov-hero-pop-val">${currentPop.toLocaleString()}</div>
            <div class="cvov-hero-pop-label">Population</div>
            <div class="cvov-hero-pop-growth ${report.cssClass}" title="${report.title}">${report.sign}${Math.abs(growth)}/hr</div>
          </div>
          <div class="cvov-hero-gold">
            <div class="cvov-hero-gold-rate">+${cityGoldRate}${gi('two-coins')}/h</div>
            <div class="cvov-hero-gold-label">Gold / hr</div>
          </div>
        </div>

        <!-- Tier progress -->
        ${isPeakPop ? `
        <div class="cvov-tier-prog cvov-tier-prog--max">
          <span>${gi('round-star')} Peak Population — City fully developed</span>
        </div>
        ` : `
        <div class="cvov-tier-prog">
          <div class="cvov-tp-row">
            <span class="cvov-tp-tiers">${isMaxTier ? `Tier ${topTier.level} → Peak` : `Tier ${level} → Tier ${level + 1}`}</span>
            <span class="cvov-tp-count">${currentPop.toLocaleString()} / ${tierEnd.toLocaleString()}</span>
            <span class="cvov-tp-eta ${growth <= 0 ? 'cvov-tp-eta--warn' : ''}">${tierEta}</span>
          </div>
          <div class="cvov-tp-need">${popToNext.toLocaleString()} more population needed to reach ${isMaxTier ? `peak (${Math.round(peakPop / 1000)}k)` : `Tier ${level + 1}`}</div>
        </div>
        `}

        <div class="cvov-section">
          <div class="cvov-section-title">${gi('brick-wall')} Building Slots</div>
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
          <div class="cvov-section-title">${gi('wooden-crate')} Resources & Production</div>
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
          <div class="cvov-section-title">${gi('histogram')} City Status</div>
          ${mainStats.map(key => _statRowHtml(key, stats[key], trends[key])).join('')}
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">${gi('round-shield')} City Defenses</div>
          ${extraStats.map(key => _statRowHtml(key, stats[key], trends[key])).join('')}
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">${gi('guarded-tower')} Garrison <span class="cvov-garrison-count">${garrisonTotal} / 10</span></div>
          ${garrison.length === 0
            ? '<div class="cvl-garrison-empty">No garrison — build a Guard Post</div>'
            : `<div class="la-unit-cards cvl-garrison-cards">${garrison.flatMap(r => {
                const def = UNIT_DEFS[r.unitId] || {};
                const tierClass = unitTierClass(def);
                const portrait = def.image
                  ? `<img src="${def.image}" class="la-uc-img" alt="${def.name || r.unitId}" loading="lazy">`
                  : `<div class="la-uc-img la-uc-img--fallback">${def.icon || gi('crossed-swords')}</div>`;
                return Array.from({ length: r.count }, () => `
                  <div class="la-unit-card${tierClass ? ' ' + tierClass : ''}" title="${def.name || r.unitId}">
                    <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
                    ${portrait}
                    ${giUnitType(def.category)}
                  </div>`);
              }).join('')}</div>`
          }
        </div>

        ${_city.landmark ? `
        <div class="cvov-section">
          <div class="cvov-section-title">${gi('obelisk')} Landmark</div>
          <div class="cvov-landmark-row">
            <span class="cvov-lm-icon">${BUILDING_DEFS[_city.landmark]?.icon || gi('obelisk')}</span>
            <span class="cvov-lm-name">${BUILDING_DEFS[_city.landmark]?.name || _city.landmark}</span>
            <span class="cvov-lm-level">Lv ${_city.buildings[_city.landmark] || 1}</span>
          </div>
        </div>
        ` : ''}

        ${activeItems.length > 0 ? `
        <div class="cvov-section">
          <div class="cvov-section-title">${gi('wooden-crate')} Active Items</div>
          ${activeItems.map(({ def, entry }) => `
            <div class="cvl-event-row">
              <span class="cvl-event-name">${def.name}</span>
              <span class="cvl-event-val text-success">${_itemBonusLabel(def)} · ${_fmtLeft(entry.expiresAt)}</span>
            </div>
          `).join('')}
        </div>
        ` : ''}

      </div>
    `;
  }

  // ── Items tab ─────────────────────────────────────────────────
  //
  // Two lists, and the split is the point: what is WORKING here (this city's
  // own, with time left) above what is IN STOCK (the empire-wide backpack, the
  // same stock every city sees). Applying is one click and costs nothing but
  // the item — there is no slot limit and nothing to configure, so a confirm
  // step would only be in the way.
  function _itemsTabHtml() {
    const active = _activeItems();
    const held   = Object.entries(_player?.items || {})
      .filter(([id, n]) => ITEM_DEFS[id] && n > 0)
      .map(([id, n]) => ({ def: ITEM_DEFS[id], count: n }))
      .sort((a, b) => (a.def.tier - b.def.tier) || a.def.name.localeCompare(b.def.name));

    // The combined production bonus this city is getting right now — the one
    // number that answers "is stacking these actually doing anything".
    const fx      = EconomyCore.getCityItemEffects(_city, TimeService.now());
    const totals  = Object.entries(fx)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `+${Math.round(v * 100)}% ${k.replace('_production', '')}`)
      .join(' · ');

    const activeHtml = active.length > 0
      ? active.map(({ def, entry }) => `
          <div class="cvit-active-row">
            <span class="cvit-icon">${def.icon}</span>
            <div class="cvit-body">
              <div class="cvit-name">${def.name}</div>
              <div class="cvit-effect">${_itemBonusLabel(def)}</div>
            </div>
            <span class="cvit-timer">${_fmtLeft(entry.expiresAt)}</span>
          </div>`).join('')
      : `<div class="cvit-empty">No items are working in ${_city.name} right now.</div>`;

    const heldHtml = held.length > 0
      ? held.map(({ def, count }) => `
          <div class="cvit-card cvit-card--t${def.tier}">
            <div class="cvit-card-head">
              <span class="cvit-icon">${def.icon}</span>
              <span class="cvit-name">${def.name}</span>
              <span class="cvit-count">×${count}</span>
            </div>
            <div class="cvit-card-summary">${def.summary}</div>
            <div class="cvit-card-desc">${def.description}</div>
            <button class="bld2-btn bld2-btn--ready cvit-apply" data-item="${def.id}">Use in ${_city.name}</button>
          </div>`).join('')
      : `<div class="cvit-empty">Your storehouse is empty. Items are brought back by expeditions — send a lord to search the world map.</div>`;

    return `
      <div class="cvit-wrap">
        <div class="cvov-section">
          <div class="cvov-section-title">${gi('hourglass')} Working in this city</div>
          ${totals ? `<div class="cvit-totals">${totals} while they last</div>` : ''}
          ${activeHtml}
        </div>

        <div class="cvov-section">
          <div class="cvov-section-title">${gi('wooden-crate')} Storehouse</div>
          <div class="cvit-hint">Items are held by your empire, not by a city — spend them wherever they earn the most. There is no limit on how many one city can run at once.</div>
          <div class="cvit-grid">${heldHtml}</div>
        </div>
      </div>
    `;
  }

  // ── Building state (shared by tile + detail panel) ────────────
  // Mirrors server/actions/build.js's effectiveLevel stacking so the
  // displayed cost/duration/max-level state matches what the server will
  // actually do when Improve is clicked.

  function _bldState(def) {
    const currentLvl     = _city.buildings[def.id] || 0;
    const queuedForThis  = _city.constructionQueue.filter(q => q.buildingId === def.id).length;
    const effectiveLevel = currentLvl + queuedForThis;
    const targetLvl      = effectiveLevel + 1;
    const atMax          = effectiveLevel >= def.maxLevel;
    const inQueue        = queuedForThis > 0;
    const queueFull      = _city.constructionQueue.length >= MAX_QUEUE;

    const { locked, reasons } = BuildingUnlockService.check(_city, _lord, def);

    const playerRes  = (_player && _player.resources) ? _player.resources : {};
    const cost       = !atMax ? def.cost(targetLvl) : {};
    // affordable = pure resource check; canAfford additionally requires
    // unlocked + queue space (drives the action button state).
    const affordable = !atMax &&
      Object.entries(cost).every(([res, amt]) => amt <= 0 || Math.floor(playerRes[res] || 0) >= amt);
    const canAfford  = affordable && !locked && !queueFull;
    // Displayed duration matches the server: race construction_speed +
    // Engineering Tomes research + this city's Town Hall
    // (EconomyCore.getBuildTime on both sides).
    const duration   = !atMax ? TimeService.formatDuration(EconomyCore.getBuildTime(
      def, targetLvl,
      RACES[_lord?.race]?.bonuses,
      EconomyCore.getResearchEffects(_player?.research),
      _city.buildings,
    )) : '';

    // When this building has queued upgrade(s): the finishAt of its LAST
    // queued job — what the tile overlay counts down to.
    const queueFinishAt = inQueue
      ? Math.max(..._city.constructionQueue.filter(q => q.buildingId === def.id).map(q => q.finishAt))
      : null;

    return { currentLvl, queuedForThis, effectiveLevel, targetLvl, atMax, inQueue, queueFull, locked, reasons, cost, affordable, canAfford, duration, queueFinishAt };
  }

  // ── Thumbnail grid tile ───────────────────────────────────────

  function _tileHtml(def) {
    const s = _bldState(def);

    let statHighlight = '';
    if (_selectedStat) {
      const checkEffects = def.effects ? def.effects(Math.max(1, s.currentLvl)) : [];
      const impact = checkEffects
        .filter(e => e.stat === _selectedStat)
        .reduce((sum, e) => sum + e.value, 0);
      statHighlight = impact > 0 ? 'bld3-tile--stat-pos' : impact < 0 ? 'bld3-tile--stat-neg' : 'bld3-tile--stat-muted';
    }

    // Crossed-out state: buildable but the next level isn't affordable.
    // (Queued buildings show the busy overlay instead; locked ones dim.)
    const cant = !s.locked && !s.atMax && !s.inQueue && !s.affordable;

    const classes = [
      'bld3-tile',
      _selectedBld === def.id ? 'bld3-tile--selected' : '',
      s.locked   ? 'bld3-tile--locked'   : '',
      s.atMax    ? 'bld3-tile--maxed'    : '',
      s.inQueue  ? 'bld3-tile--inqueue'  : '',
      cant       ? 'bld3-tile--cant'     : '',
      def.isLandmark ? 'bld3-tile--landmark' : '',
      statHighlight,
    ].filter(Boolean).join(' ');

    // Busy overlay (mirrors the lord cards' activity overlays): shown while
    // this building has queued construction, with a live countdown.
    const busyEta = s.inQueue ? Math.max(0, Math.round((s.queueFinishAt - TimeService.now()) / 1000)) : 0;
    const busyOverlay = s.inQueue ? `
      <span class="bld3-tile-busy">
        <span class="bld3-tile-busy-icon">${gi('claw-hammer')}</span>
        <span class="bld3-tile-busy-label">${s.currentLvl === 0 ? 'Building' : 'Upgrading'} → Lv ${s.effectiveLevel}</span>
        <span class="bld3-tile-busy-cd" id="bld3-cd-${def.id}">${TimeService.formatDuration(busyEta)}</span>
      </span>` : '';

    // Can't afford → the tile just gets the diagonal-stripe treatment
    // (same as the locked "Found City"/"Recruit Lord" add-cards, via the
    // bld3-tile--cant class). The exact missing resources are shown in the
    // detail panel when the tile is clicked.

    // Same card grammar as the Overview's city/lord cards: art with a
    // bottom fade on top, name + level row underneath.
    return `
      <button class="${classes}" data-bld="${def.id}" title="${def.name}" aria-label="${def.name}, level ${s.currentLvl}">
        <span class="bld3-tile-art">
          ${def.image
            ? `<img class="bld3-tile-img" src="${def.image}" alt="" loading="lazy" />`
            : `<span class="bld3-tile-icon">${def.icon}</span>`}
          <span class="bld3-tile-art-fade"></span>
          ${def.isLandmark ? '<span class="bld3-tile-lm">' + gi('obelisk') + '</span>' : ''}
          ${busyOverlay}
        </span>
        <span class="bld3-tile-info">
          <span class="bld3-tile-name">${def.name}</span>
          <span class="bld3-tile-level">${s.atMax ? 'MAX' : `Lv ${s.currentLvl}`}</span>
        </span>
      </button>
    `;
  }

  // ── Detail panel (drops down under the grid, OGame-style) ─────

  function _detailHtml(def) {
    const s = _bldState(def);

    const effects   = def.effects ? def.effects(Math.max(1, s.currentLvl)) : [];
    const prodNow   = s.currentLvl > 0 ? def.production(s.currentLvl) : {};
    const prodNext  = !s.atMax ? def.production(s.targetLvl) : {};
    const hasProdNow  = Object.values(prodNow).some(v => v > 0);
    const hasProdNext = Object.values(prodNext).some(v => v > 0);

    // Improve button state
    let btnLabel, btnClass, btnDisabled;
    if (s.atMax) {
      btnLabel = 'Max Level'; btnClass = 'bld2-btn--maxed'; btnDisabled = true;
    } else if (s.locked) {
      btnLabel = gi('padlock') + ' Locked'; btnClass = 'bld2-btn--locked'; btnDisabled = true;
    } else if (s.queueFull) {
      btnLabel = 'Queue Full'; btnClass = 'bld2-btn--busy'; btnDisabled = true;
    } else if (!s.canAfford) {
      btnLabel = 'Need Resources'; btnClass = 'bld2-btn--cant'; btnDisabled = true;
    } else if (s.inQueue) {
      btnLabel = `▲ Queue Lv ${s.targetLvl}`; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    } else {
      btnLabel = s.currentLvl === 0 ? '▶ Build' : '▲ Improve'; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    }

    const canTearDown = s.currentLvl > 0 && def.id !== 'town_hall' && !s.inQueue;

    return `
      <div class="bld3-detail ${def.isLandmark ? 'bld3-detail--landmark' : ''}">
        <div class="bld3-detail-head">
          <span class="bld3-detail-name">${def.isLandmark ? gi('obelisk') + ' ' : ''}${def.name}</span>
          <span class="bld3-detail-level">${s.atMax ? 'Max Level' : `Level ${s.currentLvl}`}${s.inQueue ? ` <span class="bld3-detail-queued">(+${s.queuedForThis} queued)</span>` : ''}</span>
          <button class="bld3-detail-close" id="bld3-close" aria-label="Close details">✕</button>
        </div>
        <div class="bld3-detail-body">
          ${def.image
            ? `<img class="bld3-detail-img" src="${def.image}" alt="${def.name}" />`
            : `<div class="bld3-detail-icon">${def.icon}</div>`}
          <div class="bld3-detail-info">
            <div class="bld3-detail-desc">${def.description}</div>

            ${effects.length > 0 ? `
              <div class="bld2-effects-row">
                ${effects.map(e => {
                  const meta = CityStatsService.META[e.stat];
                  if (!meta) return '';
                  const cls    = e.value >= 0 ? 'eff-pos' : 'eff-neg';
                  const active = _selectedStat === e.stat ? ' eff-active' : '';
                  return `<span class="bld-eff-tag ${cls}${active}" title="${meta.label}">${meta.icon} ${e.value > 0 ? '+' : ''}${e.value}</span>`;
                }).filter(Boolean).join('')}
              </div>
            ` : ''}

            ${(hasProdNow || hasProdNext) ? `
              <div class="bld2-prod-row">
                ${hasProdNow ? `<span class="bld2-prod-cur">${_prodLine(prodNow)}</span>` : ''}
                ${hasProdNow && hasProdNext ? `<span class="bld2-prod-sep">→</span>` : ''}
                ${hasProdNext ? `<span class="bld2-prod-next">Lv ${s.targetLvl}: ${_prodLine(prodNext)}</span>` : ''}
              </div>
            ` : ''}

            ${def.id === 'marketplace' ? (() => {
              // The Marketplace's whole economic effect, spelled out. It used to
              // be the door to the Merchant as well; since that moved to its own
              // tab (2026-08-04) this bonus is all the building does, so leaving
              // it implicit would make the Marketplace read as doing nothing.
              // Percentage comes from EconomyCore, never a literal here.
              const pct = n => Math.round(EconomyCore.MARKETPLACE_GOLD_PCT * 100 * n);
              return `
                <div class="bld2-prod-row">
                  ${s.currentLvl > 0 ? `<span class="bld2-prod-cur">${gi('two-coins')} +${pct(s.currentLvl)}% gold from this city's taxes</span>` : ''}
                  ${s.currentLvl > 0 && !s.atMax ? `<span class="bld2-prod-sep">→</span>` : ''}
                  ${!s.atMax ? `<span class="bld2-prod-next">Lv ${s.targetLvl}: +${pct(s.targetLvl)}%</span>` : ''}
                </div>`;
            })() : ''}

            ${def.buildTimeDivisor ? `
              <div class="bld2-prod-row">
                ${s.currentLvl > 0 ? `<span class="bld2-prod-cur">${gi('claw-hammer')} City builds ${def.buildTimeDivisor(s.currentLvl).toLocaleString()}× faster</span>` : ''}
                ${s.currentLvl > 0 && !s.atMax ? `<span class="bld2-prod-sep">→</span>` : ''}
                ${!s.atMax ? `<span class="bld2-prod-next">Lv ${s.targetLvl}: ${def.buildTimeDivisor(s.targetLvl).toLocaleString()}× faster</span>` : ''}
              </div>
            ` : ''}

            ${(() => {
              // Veterancy line: this building trains units (any race's roster)
              // → +2% attack/defense per level, summed across ALL cities.
              const trains = typeof UNIT_ROSTER !== 'undefined' &&
                Object.values(UNIT_ROSTER).some(r => r[def.id]);
              if (trains) {
                const totalLv = CityService.getPlayerCities(_player.id)
                  .reduce((sum, c) => sum + (c.buildings?.[def.id] || 0), 0);
                return `
                  <div class="bld2-prod-row">
                    <span class="bld2-prod-cur">${gi('crossed-swords')} Veterancy: +${totalLv * 2}% attack & defense for its units (empire-wide)</span>
                    ${!s.atMax ? `<span class="bld2-prod-sep">→</span><span class="bld2-prod-next">+${(totalLv + 1) * 2}%</span>` : ''}
                  </div>`;
              }
              if (def.garrisonRoster) {
                return `
                  <div class="bld2-prod-row">
                    <span class="bld2-prod-cur">${gi('round-shield')} Garrison veterancy: +${((_city.buildings?.guard_post || 0) + (_city.buildings?.fortress || 0)) * 2}% attack & defense (this city)</span>
                  </div>`;
              }
              return '';
            })()}

            ${s.locked ? `
              <div class="bld2-reasons">
                ${s.reasons.map(r => `<div class="bld2-reason">${gi('padlock')} ${r}</div>`).join('')}
              </div>
            ` : !s.atMax ? `
              <div class="bld3-detail-req-title">Required to ${s.currentLvl === 0 ? 'build' : `improve to level ${s.targetLvl}`}:</div>
              <div class="bld2-cost-row">
                ${_costHtml(s.cost)}
                <span class="bld2-duration">${gi('stopwatch')} ${s.duration}</span>
              </div>
            ` : ''}
          </div>
          <div class="bld3-detail-actions">
            <button class="bld2-btn ${btnClass}" data-building="${def.id}" ${btnDisabled ? 'disabled' : ''}>
              ${btnLabel}
            </button>
            ${!s.atMax && !s.locked ? `<div class="bld2-next-hint">→ Lv ${s.targetLvl}</div>` : ''}
            ${canTearDown ? `
              <button class="bld3-teardown-btn" data-demolish="${def.id}">
                ${gi('trash-can')} Tear down
              </button>
            ` : ''}
          </div>
        </div>
        ${def.id === 'library' && s.currentLvl > 0 ? `
          <div class="rs-hint">${gi('open-book')} Books are researched in the <b>Research</b> tab — higher Library levels unlock more of them.</div>
        ` : ''}
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

    // Queued-but-not-yet-started upgrades (position 1+) — each already has a
    // real sequenced startedAt/finishAt from the server, so its ETA is just
    // "time until ITS finishAt", same formula as the front item.
    const upcomingHtml = _city.constructionQueue.slice(1).map((q, i) => {
      const qDef    = BUILDING_DEFS[q.buildingId];
      const etaSecs = Math.max(0, Math.round((q.finishAt - TimeService.now()) / 1000));
      return `
        <div class="cv-queue-item">
          <span class="cv-queue-item-pos">#${i + 2}</span>
          <span class="cv-queue-item-name">${qDef?.name || q.buildingId} → Lv ${q.targetLevel}</span>
          <span class="cv-queue-item-eta">${TimeService.formatDuration(etaSecs)}<span class="cv-queue-clock">${TimeService.formatClock(q.finishAt)}</span></span>
          <button class="x-cancel-btn" data-cancel-build="${i + 1}" title="Cancel &amp; refund resources">✕</button>
        </div>`;
    }).join('');

    return `
      <div class="cv-queue-inner">
        <span class="cv-queue-icon">${gi('claw-hammer')}</span>
        <span class="cv-queue-label">${def?.name || item.buildingId} → Level ${item.targetLevel}</span>
        <div class="cv-queue-bar"><div class="cv-queue-fill" id="cv-q-fill" style="transform:scaleX(${pct / 100})"></div></div>
        <span class="cv-queue-timer" id="cv-q-timer">${TimeService.formatDuration(secs)}</span>
        <!-- Static: the ticker only rewrites #cv-q-timer, and finishAt never
             moves. A Town Hall level can run for days, which is exactly when a
             countdown alone stops being usable. -->
        <span class="cv-queue-clock">${TimeService.formatClock(item.finishAt)}</span>
        <button class="cv-boost-btn ${canBoost ? '' : 'cv-boost-btn--cant'}" id="cv-boost-btn" ${canBoost ? '' : 'disabled'}>
          ${gi('power-lightning')} ${boostCost}${gi('cut-diamond')}
        </button>
        <button class="x-cancel-btn" data-cancel-build="0" title="Cancel &amp; refund resources">✕</button>
      </div>
      ${upcomingHtml ? `<div class="cv-queue-upcoming">${upcomingHtml}</div>` : ''}
      <div class="cv-queue-slots">${_city.constructionQueue.length}/${MAX_QUEUE} queue slots used</div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────

  // Walks EconomyCore.RESOURCE_KEYS, NEVER Object.entries(bundle). A cost is a
  // plain literal, so entry order is declaration order — and the Town Hall
  // declared food first, which is why it alone printed "food · wood · stone".
  function _orderedRes(bundle) {
    const b = bundle || {};
    return EconomyCore.RESOURCE_KEYS
      .filter(k => (b[k] || 0) > 0)
      .map(k => [k, b[k]]);
  }

  function _prodLine(prod) {
    return _orderedRes(prod)
      .map(([res, v]) => `${RES[res]?.icon || res} +${v}/h`)
      .join(' ');
  }

  function _costHtml(cost) {
    return _orderedRes(cost)
      .map(([res, v]) => {
        const has = Math.floor((_player?.resources || {})[res] || 0) >= v;
        return `<span class="${has ? 'bld2-res' : 'bld2-res bld2-res--short'}">${RES[res]?.icon || res} ${v.toLocaleString()}</span>`;
      })
      .join('');
  }

  // ── Event binding ─────────────────────────────────────────────

  function _bindShellEvents() {
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
        _bldTab      = btn.dataset.bldtab;
        _selectedBld = null;
        _renderContent();
      });
    });

    // Grid tile → open detail panel (below the grid; scroll it into view)
    document.querySelectorAll('.bld3-tile[data-bld]').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.bld;
        _selectedBld = _selectedBld === id ? null : id;
        _renderContent();
        if (_selectedBld) {
          document.querySelector('.bld3-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    // Items tab → spend one item on this city
    document.querySelectorAll('.cvit-apply[data-item]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const itemId = btn.dataset.item;
        const result = await ServerActions.applyItem(_city.id, itemId);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _city   = CityService.getById(_city.id);
        _player = PlayerService.getById(_player.id);
        const lp = document.getElementById('cv-left');
        if (lp) lp.innerHTML = _leftPanelHtml();
        _renderContent();
        _toast(`${ITEM_DEFS[itemId]?.name || 'Item'} is now working in ${_city.name}.`);
        // Production rates changed — the HUD prints them.
        EventBus.emit('resources:changed');
        HUD.refresh();
      });
    });

    // Detail panel close
    document.getElementById('bld3-close')?.addEventListener('click', () => {
      _selectedBld = null;
      _renderContent();
    });

    // Improve / Build button
    document.querySelectorAll('.bld2-btn[data-building]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.build(_city.id, btn.dataset.building);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _city   = CityService.getById(_city.id);
        _player = PlayerService.getById(_player.id);
        _renderContent();
        _startCountdown();
        EventBus.emit('resources:changed');
        HUD.refresh();
      });
    });

    // Tear down button
    document.querySelectorAll('.bld3-teardown-btn[data-demolish]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.demolish;
        const def = BUILDING_DEFS[id];
        const lvl = _city.buildings[id] || 0;
        if (!window.confirm(`Tear down ${def?.name || id} to level ${Math.max(0, lvl - 1)}? No resources are refunded.`)) return;
        btn.disabled = true;
        const result = await ServerActions.demolish(_city.id, id);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _city   = CityService.getById(_city.id);
        _player = PlayerService.getById(_player.id);
        const lp = document.getElementById('cv-left');
        if (lp) lp.innerHTML = _leftPanelHtml();
        _renderContent();
        EventBus.emit('resources:changed');
        HUD.refresh();
        _toast(`${def?.name || id} torn down.`);
      });
    });
  }

  async function _instantComplete() {
    if (_city.constructionQueue.length === 0) return;
    const btn = document.getElementById('cv-boost-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = `${gi('hourglass')} Completing…`; }

    const result = await ServerActions.instantBuild(_city.id);

    if (!result.ok) {
      _toast(result.error || 'Failed to instant-complete');
      if (btn) { btn.disabled = false; btn.innerHTML = `${gi('cut-diamond')} Instant`; }
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

  async function _cancelBuild(queueIndex) {
    if (!Number.isInteger(queueIndex)) return;
    const result = await ServerActions.cancelBuild(_city.id, queueIndex);
    if (!result.ok) { _toast(result.error || 'Failed to cancel'); return; }

    _city   = CityService.getById(_city.id);
    _player = PlayerService.getById(_player.id);
    _stopCountdown();
    HUD.refresh();
    const refreshedLeft = document.getElementById('cv-left');
    if (refreshedLeft) refreshedLeft.innerHTML = _leftPanelHtml();
    _renderContent();
    _startCountdown();
    _toast('Construction cancelled — 75% of resources refunded.');
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
      if (fillEl) fillEl.style.transform = `scaleX(${ConstructionService.progress(_city)})`;

      // Patch each busy tile's countdown in place (last queued job per building)
      const finishByBld = {};
      _city.constructionQueue.forEach(q => {
        finishByBld[q.buildingId] = Math.max(finishByBld[q.buildingId] || 0, q.finishAt);
      });
      Object.entries(finishByBld).forEach(([bid, finishAt]) => {
        const el = document.getElementById(`bld3-cd-${bid}`);
        if (el) el.textContent = TimeService.formatDuration(Math.max(0, Math.round((finishAt - TimeService.now()) / 1000)));
      });
    }, 1000);
  }

  function _stopCountdown() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  // Exposed so App can stop this screen's background timer on navigation away.
  function stop() {
    _stopCountdown();
  }

  function _toast(msg) { ToastService.show(msg); }

  return { render, stop };
})();
