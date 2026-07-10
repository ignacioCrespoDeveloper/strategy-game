// =============================================
//  overview-screen.js — Empire dashboard (default landing)
// =============================================

const OverviewScreen = (() => {
  let _lord      = null;
  let _player    = null;
  let _root      = null;
  let _tickTimer = null;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _stopTicker();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = LordService.getById(lord.id);
    if (LordService.tickHp(_lord)) LordService.save(_lord);
    root.innerHTML = _shell();
    _bindEvents();
    _startTicker();
  }

  function stop() { _stopTicker(); }

  function _stopTicker() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _startTicker() {
    const cities     = CityService.getLordCities(_lord.id);
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
      CityService.getLordCities(_lord.id).forEach(city => {
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
        <div class="ov-body">
          ${_citiesSection()}
          ${_lordsSection()}
        </div>
      </div>
    `;
  }

  // ── Cities section ────────────────────────────────────────────

  function _citiesSection() {
    const cities = CityService.getLordCities(_lord.id);
    const cards  = cities.length
      ? cities.map(_cityCard).join('')
      : `<p class="ov-empty">No cities yet — head to the World Map to claim your first territory.</p>`;

    return `
      <section class="ov-section">
        <div class="ov-section-title">Cities</div>
        <div class="ov-cities-grid">${cards}</div>
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

    return `
      <div class="ov-city-card" data-city-id="${city.id}">
        <div class="ov-cc-art">
          <img class="ov-cc-art-img" src="assets/city/city.webp" alt="City" />
          <div class="ov-cc-art-fade"></div>
          <span class="ov-cc-art-status cvl-${status.id}">${status.label}</span>
        </div>
        <div class="ov-cc-inner">
          <div class="ov-cc-terrain">
            <span class="ov-cc-terrain-icon">${terrain.icon}</span>
            <span class="ov-cc-terrain-name">${terrain.name}</span>
          </div>
          <div class="ov-cc-name">${city.name}</div>
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

  function _lordsSection() {
    const lords = [_lord]; // expand to multiple lords in future
    return `
      <section class="ov-section">
        <div class="ov-section-title">Lords</div>
        <div class="ov-lords-grid">${lords.map(_lordCard).join('')}</div>
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

    let location = 'Wandering';
    if (lord.cityIds && lord.cityIds.length > 0) {
      const city = CityService.getById(lord.cityIds[0]);
      if (city) location = city.name;
    }

    const queueItem    = lord.actionQueue && lord.actionQueue.length > 0 ? lord.actionQueue[0] : null;
    const activeAction = queueItem ? LORD_ACTIONS[queueItem.actionId] : null;
    const actionPct    = queueItem ? Math.floor(LordService.actionProgress(lord) * 100) : 0;
    const actionSecs   = queueItem ? LordService.actionTimeRemaining(lord) : 0;

    const portraitHtml = race.portrait
      ? `<div class="ov-lc-portrait">
           <img class="ov-lc-portrait-img" src="${race.portrait}" alt="${race.name}" />
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
          </div>
          <div class="ov-lc-badges">
            <span class="ov-lc-race">${race.name || ''}</span>
            ${cls ? `<span class="ov-lc-class-badge" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
          </div>
          <div class="ov-lc-meta">
            📍 ${location} · ${activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
          </div>
          ${queueItem ? `<div class="ov-lc-action-row">
            <div class="ov-lc-action-bar"><div class="ov-lc-action-fill" id="ov-lord-fill" style="width:${actionPct}%"></div></div>
            <span class="ov-lc-action-time" id="ov-lord-timer">${TimeService.formatDuration(actionSecs)}</span>
          </div>` : ''}
          <div class="ov-lc-stats">
            <span class="ov-lc-stat" title="Attack">⚔ ${stats.attack}</span>
            <span class="ov-lc-stat" title="Defense">🛡 ${stats.defense}</span>
            <span class="ov-lc-stat" title="Health">❤ ${stats.health}</span>
            <span class="ov-lc-stat" title="Magic">✨ ${stats.magic}</span>
            <span class="ov-lc-stat" title="Speed">💨 ${stats.speed}</span>
          </div>
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

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
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
  }

  return { render, stop };
})();
