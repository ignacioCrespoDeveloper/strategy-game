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
  let _selectedClass   = null;
  let _prisonList      = []; // lords the player currently holds captive — fetched async, see render()
  let _densityInitialized = false; // one-time: default Cities/Lords collapsed for returning players so the dashboard opens on Movements, not everything at once

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _stopTicker();
    _unsubscribeAlerts();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = lord ? LordService.getById(lord.id) : null;
    if (_lord && LordService.tickHp(_lord)) LordService.save(_lord);
    ActivityService.markSeen(_player.id);
    HUD.refresh();
    root.innerHTML = _shell();
    _bindEvents();
    _startTicker();
    _subscribeAlerts();
    _flushSyncEvents();

    // Prison list lives cross-player (who's holding whose lord), so unlike
    // the rest of this dashboard it isn't already sitting in local storage —
    // fetch it once and patch it in when it lands, rather than blocking the
    // initial paint on an extra network round-trip.
    ServerActions.getPrisonList().then(result => {
      if (result.ok) { _prisonList = result.prisoners || []; _rerender(); }
    });
  }

  function stop() { _stopTicker(); _unsubscribeAlerts(); }

  // PvP/activity alerts are now polled globally by HUD.js (so they fire on
  // every screen, not just this one — see hud.js's _pollActivityFeed for why).
  // This screen just reacts by refreshing its own dashboard when notified.
  function _onPvpAlert() {
    _stopTicker();
    _player = PlayerService.getById(_player.id);
    if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
  }
  function _subscribeAlerts()   { EventBus.on('pvp:alert', _onPvpAlert); }
  function _unsubscribeAlerts() { EventBus.off('pvp:alert', _onPvpAlert); }

  // Show any offline-progression notifications queued by App.init's /api/sync call.
  function _flushSyncEvents() {
    const pending = window._pendingSyncEvents;
    if (!pending?.length) return;
    window._pendingSyncEvents = null;

    const LABEL = {
      building_completed:    e => `🏛 ${e.cityName}: ${e.buildingId.replace(/_/g, ' ')} completed`,
      recruitment_completed: e => `⚔ ${e.cityName}: ${e.count}× ${e.unitId.replace(/_/g, ' ')} ready`,
      lord_recovered:        e => `💚 ${e.lordName} has recovered`,
      lord_action_done:      e => e.destX != null ? `🗺 ${e.lordName} arrived at (${e.destX}, ${e.destY})` : null,
      pvp_resolved:          e => {
        const icon = e.report?.winner === 'attacker' ? '⚔' : e.report?.winner === 'draw' ? '🤝' : '☠';
        const lbl  = e.report?.winner === 'attacker' ? 'PvP Victory' : e.report?.winner === 'draw' ? 'PvP Draw' : 'PvP Defeat';
        return `${icon} ${lbl} while offline — see Activity`;
      },
    };

    // Deduplicate and show at most 3 toasts so we don't flood the screen
    const shown = new Set();
    let count   = 0;
    for (const ev of pending) {
      if (count >= 3) break;
      const fn  = LABEL[ev.type];
      const msg = fn ? fn(ev) : null;
      if (!msg || shown.has(msg)) continue;
      shown.add(msg);
      setTimeout(() => _toast(msg), count * 800);
      count++;
    }
    if (pending.length > 3) {
      setTimeout(() => _toast(`+${pending.length - 3} more updates while offline`), count * 800);
    }
  }

  function _stopTicker() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _startTicker() {
    const cities     = CityService.getPlayerCities(_player.id);
    const allLords   = LordService.getByPlayer(_player.id);
    const hasAction  = allLords.some(l => l.actionQueue.length > 0);
    const hasConstr  = cities.some(c => c.constructionQueue.length > 0);
    const feed       = ActivityService.get(_player.id);
    const hasThreats = feed.some(e => e.type === 'pvp_threat' && e.etaAt && e.etaAt > TimeService.now());
    const hasDown    = allLords.some(l => LordService.isDown(l));
    const hasRaiding = allLords.some(l => LordService.isStanced(l) && l.stance.id === 'raiding');
    if (!hasAction && !hasConstr && !hasThreats && !hasDown && !hasRaiding) return;

    _tickTimer = setInterval(() => {
      let needsRerender = false;

      // Check ALL lords for completed actions (not just _lord)
      const activeLords = LordService.getByPlayer(_player.id).filter(l => l.actionQueue.length > 0);
      for (const lord of activeLords) {
        const completed = LordService.tickActions(lord);
        if (completed.length > 0) {
          // Server dispatcher resolves outcomes (PvP, position, XP).
          // Client picks up results on the next /api/sync poll.
          if (_lord && lord.id === _lord.id) _lord = LordService.getById(lord.id);
          needsRerender = true;
        } else {
          // Update movement panel row timer in-place (IDs added in _movementsPanel)
          const fill = document.getElementById(`ov-mv-fill-${lord.id}`);
          const time = document.getElementById(`ov-mv-time-${lord.id}`);
          if (fill) fill.style.transform = `scaleX(${LordService.actionProgress(lord)})`;
          if (time) time.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(lord));
          // Update portrait activity overlay timer for this lord
          const actCd = document.getElementById(`ov-lord-act-cd-${lord.id}`);
          if (actCd) actCd.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(lord));
          // Also update lord card bars if this is _lord
          if (_lord && lord.id === _lord.id) {
            const cardFill  = document.getElementById('ov-lord-fill');
            const cardTimer = document.getElementById('ov-lord-timer');
            if (cardFill)  cardFill.style.width  = `${Math.floor(LordService.actionProgress(lord) * 100)}%`;
            if (cardTimer) cardTimer.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(lord));
          }
        }
      }

      // Raiding lords have no actionQueue item (it's a stance), so they're
      // skipped by the loop above — tick their countdown separately. Actual
      // completion (payout) is server-authoritative (see catch-up.js); this
      // just keeps the on-screen timer honest and triggers a re-render once
      // it hits zero so the next sync picks up the result.
      const raidingLords = LordService.getByPlayer(_player.id).filter(l => LordService.isStanced(l) && l.stance.id === 'raiding');
      for (const lord of raidingLords) {
        const secs    = Math.max(0, Math.floor((lord.stance.finishAt - TimeService.now()) / 1000));
        const totalMs = lord.stance.finishAt - lord.stance.startedAt;
        const pct     = totalMs > 0 ? Math.min(1, (TimeService.now() - lord.stance.startedAt) / totalMs) : 0;
        const fill  = document.getElementById(`ov-mv-fill-${lord.id}`);
        const time  = document.getElementById(`ov-mv-time-${lord.id}`);
        const actCd = document.getElementById(`ov-lord-act-cd-${lord.id}`);
        if (fill)  fill.style.transform = `scaleX(${pct})`;
        if (time)  time.textContent = TimeService.formatDuration(secs);
        if (actCd) actCd.textContent = TimeService.formatDuration(secs);
        if (secs <= 0) needsRerender = true;
      }

      // City production (gold + population) — tick all cities so income
      // accumulates even when individual city screens aren't opened.
      CityService.getPlayerCities(_player.id).forEach(city => {
        ProductionService.tick(city, _lord);
      });

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

      // Tick downed lords — clear expired downtime or update countdown in-place
      LordService.getByPlayer(_player.id).forEach(lord => {
        if (LordService.tickDowntime(lord)) {
          needsRerender = true;
        } else if (LordService.isDown(lord)) {
          const cdEl = document.getElementById(`ov-lord-down-cd-${lord.id}`);
          if (cdEl) cdEl.textContent = TimeService.formatDuration(Math.ceil(LordService.getDowntimeRemaining(lord) / 1000));
        }
      });

      // Update threat countdown timers in-place (banner + movements panel rows)
      const threats = ActivityService.get(_player.id).filter(e => e.type === 'pvp_threat' && e.etaAt);
      threats.forEach((t, i) => {
        const now2      = TimeService.now();
        const remaining = Math.max(0, Math.ceil((t.etaAt - now2) / 1000));
        if (remaining === 0) { needsRerender = true; return; }
        const pct       = t.at ? Math.min(100, Math.floor(((now2 - t.at) / (t.etaAt - t.at)) * 100)) : 0;
        const formatted = TimeService.formatDuration(remaining);
        const bannerEl  = document.getElementById(`ov-threat-eta-${i}`);
        if (bannerEl) bannerEl.textContent = formatted;
        const incTime = document.getElementById(`ov-inc-time-${i}`);
        if (incTime) incTime.textContent = formatted;
        const incFill = document.getElementById(`ov-inc-fill-${i}`);
        if (incFill) incFill.style.transform = `scaleX(${pct / 100})`;
      });

      if (needsRerender) {
        _stopTicker();
        if (_lord) _lord = LordService.getById(_lord.id);
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      }
    }, 1000);
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _incomingAttackBanner() {
    const feed = ActivityService.get(_player.id);
    const now  = TimeService.now();
    const threats = feed.filter(e => e.type === 'pvp_threat' && !e.dismissed);
    if (threats.length === 0) return '';
    return threats.map((t, i) => {
      const remaining = t.etaAt ? Math.max(0, Math.ceil((t.etaAt - now) / 1000)) : null;
      const etaHtml   = remaining !== null
        ? `Arrives in: <span class="ov-iab-countdown" id="ov-threat-eta-${i}">${TimeService.formatDuration(remaining)}</span>`
        : (t.detail || '');
      return `
        <div class="ov-incoming-attack-banner">
          <span class="ov-iab-icon">⚔</span>
          <div class="ov-iab-text">
            <div class="ov-iab-title">${t.title}</div>
            <div class="ov-iab-detail">${etaHtml}</div>
          </div>
          <button class="ov-iab-dismiss" data-threat-id="${t.id}" title="Descartar">✕</button>
        </div>`;
    }).join('');
  }

  function _dismissThreat(entryId) {
    const pid       = _player.id;
    const localFeed = StorageService.get('activity_feed') || {};
    const entries   = localFeed[pid] || [];
    const entry     = entries.find(e => e.id === entryId);
    if (entry) {
      entry.dismissed = true;
      StorageService.set('activity_feed', localFeed);
      // StorageService.set writes localStorage synchronously and debounces Supabase —
      // no need for a separate Supabase upsert here. The poll only ever ADDS new entries
      // (never updates existing ones), so the dismissed flag cannot be overwritten by polling.
    }
    _rerender();
  }

  function _shell() {
    const cities = CityService.getPlayerCities(_player.id);
    const lords  = LordService.getByPlayer(_player.id);
    const showOnboarding = cities.length === 0 || lords.length === 0;

    // First render only: a returning player (past onboarding) already knows
    // what's in their empire, so open on what changed (Movements) rather than
    // every section at once. A brand-new player has little to browse yet, so
    // Cities/Lords stay open to reinforce what they just built. Manual toggles
    // after this are preserved across re-renders (no re-init).
    if (!_densityInitialized) {
      _densityInitialized = true;
      if (!showOnboarding) {
        _citiesCollapsed = true;
        _lordsCollapsed  = true;
      }
    }

    return `
      <div class="ov-screen">
        ${_incomingAttackBanner()}
        <div class="ov-body">
          ${showOnboarding
            ? `${_onboardingSection(cities, lords)}${_citiesSection()}${_lordsSection()}${_prisonSection()}`
            : `${_movementsPanel()}${_citiesSection()}${_lordsSection()}${_prisonSection()}`
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

  function _classCardHtml(cls) {
    const mods = Object.entries(cls.modifiers).map(([stat, val]) => {
      const meta = LORD_STAT_META[stat] || {};
      return `<span class="lc-mod">${meta.icon || stat} +${val}</span>`;
    }).join('');
    const isSelected = _selectedClass === cls.id;
    return `
      <div class="lc-class-card${isSelected ? ' lc-class-card--selected' : ''}"
           data-class-id="${cls.id}" style="--cls-color:${cls.color}">
        <div class="lc-class-icon">${cls.icon}</div>
        <div class="lc-class-name">${cls.name}</div>
        <div class="lc-class-mods">${mods}</div>
        <div class="lc-class-passive">${cls.passive.icon} ${cls.passive.name}</div>
      </div>`;
  }

  function _recruitModal() {
    const playerRace = RACES[_player?.race] || {};
    const raceField  = `<div class="form-input form-input--locked">
      ${playerRace.icon || ''} ${playerRace.name || '—'}
    </div>`;

    const playerCities = _player ? CityService.getPlayerCities(_player.id) : [];
    const cityOptions  = playerCities.map(c =>
      `<option value="${c.id}">${c.name} (${c.x}, ${c.y})</option>`
    ).join('');

    const classCards = Object.values(LORD_CLASSES).map(_classCardHtml).join('');

    return `
      <div class="modal-overlay hidden" id="recruit-modal" role="dialog" aria-modal="true" aria-labelledby="recruit-modal-title">
        <div class="modal-card modal-card--wide">
          <h2 class="modal-title" id="recruit-modal-title">Recruit a Lord</h2>
          <div class="form-group">
            <label class="form-label">Name</label>
            <div class="lc-name-row">
              <input class="form-input" type="text" id="rl-name" placeholder="Lord's name" maxlength="30" autocomplete="off" />
              <button class="btn-dice" id="rl-name-dice" type="button" title="Random name">🎲</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Race</label>
            ${raceField}
          </div>
          <div class="form-group">
            <label class="form-label">Class</label>
            <div class="lc-class-grid" id="lc-class-grid">${classCards}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Starting City</label>
            <select class="form-input" id="rl-city">
              <option value="">— Choose City —</option>
              ${cityOptions}
            </select>
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
    const lords   = LordService.getByPlayer(_player.id);
    const active  = lords.filter(l => l.actionQueue.length > 0 || LordService.isStanced(l));
    const now     = TimeService.now();
    const threats = ActivityService.get(_player.id).filter(e => e.type === 'pvp_threat' && (!e.etaAt || e.etaAt > now));
    if (active.length === 0 && threats.length === 0) return '';

    // Incoming attacks (defender view) — mirrored row for each pvp_threat
    const incomingRows = threats.map((t, i) => {
      const remaining = t.etaAt ? Math.max(0, Math.ceil((t.etaAt - now) / 1000)) : null;
      const pct       = t.etaAt && t.at ? Math.min(100, Math.floor(((now - t.at) / (t.etaAt - t.at)) * 100)) : 0;
      return `
        <div class="ov-mv-row ov-mv-row--incoming">
          <span class="ov-mv-lord">${t.lordName || '?'}</span>
          <span class="ov-mv-status">⚔ INCOMING ATTACK</span>
          ${remaining !== null ? `
            <div class="ov-mv-bar-wrap">
              <div class="ov-mv-bar"><div class="ov-mv-fill ov-mv-fill--incoming" id="ov-inc-fill-${i}" style="transform:scaleX(${pct / 100})"></div></div>
              <span class="ov-mv-time" id="ov-inc-time-${i}">${TimeService.formatDuration(remaining)}</span>
            </div>` : `<span class="ov-mv-time">${t.detail || ''}</span>`}
        </div>`;
    }).join('');

    const rows = active.map(lord => {
      const qItem    = lord.actionQueue[0];
      const actionDef = qItem ? LORD_ACTIONS[qItem.actionId] : null;
      const stanceObj = LordService.getStance(lord);
      const stanceDef = STANCE_DEFS[stanceObj?.id] || STANCE_DEFS.idle;
      const isRaidingRow = !qItem && LordService.isStanced(lord) && stanceObj.id === 'raiding';

      let pct, secs;
      if (qItem) {
        pct  = Math.floor(LordService.actionProgress(lord) * 100);
        secs = LordService.actionTimeRemaining(lord);
      } else if (isRaidingRow) {
        const totalMs = stanceObj.finishAt - stanceObj.startedAt;
        pct  = totalMs > 0 ? Math.floor(Math.min(1, (TimeService.now() - stanceObj.startedAt) / totalMs) * 100) : 0;
        secs = Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000));
      } else {
        pct = 0; secs = 0;
      }

      const isAttacking = qItem?.intent === 'attack';
      let icon  = '⏸';
      let label = 'Idle';
      if (qItem && actionDef) {
        icon  = actionDef.icon || '⏳';
        label = actionDef.name;
        if (qItem.actionId === 'move_lord' && qItem.destX != null) {
          if (isAttacking) {
            icon  = '⚔';
            label = `ATTACKING → (${qItem.destX}, ${qItem.destY})`;
          } else {
            icon  = '🚶';
            label = `Moving → (${qItem.destX}, ${qItem.destY})`;
          }
        } else if (qItem.actionId === 'scout') {
          icon  = '🕵';
          label = lord.x != null ? `Scouting @ (${lord.x}, ${lord.y})` : 'Scouting';
        } else if (qItem.actionId === 'search_area') {
          icon  = '🔍';
          label = lord.x != null ? `Questing @ (${lord.x}, ${lord.y})` : 'Questing';
        }
      } else if (isRaidingRow) {
        icon  = stanceDef.icon || '🏴';
        label = `Raiding @ (${lord.x}, ${lord.y})`;
      } else if (LordService.isStanced(lord)) {
        icon  = stanceDef.icon || '🛡';
        label = stanceDef.name || 'Stance';
      }

      return `
        <div class="ov-mv-row${isAttacking ? ' ov-mv-row--attack' : ''}${isRaidingRow ? ' ov-mv-row--raiding' : ''}">
          <span class="ov-mv-lord">${lord.name}</span>
          <span class="ov-mv-status">${icon} ${label}</span>
          ${qItem || isRaidingRow ? `
            <div class="ov-mv-bar-wrap">
              <div class="ov-mv-bar"><div class="ov-mv-fill${isAttacking ? ' ov-mv-fill--attack' : ''}${isRaidingRow ? ' ov-mv-fill--raiding' : ''}" id="ov-mv-fill-${lord.id}" style="transform:scaleX(${pct / 100})"></div></div>
              <span class="ov-mv-time" id="ov-mv-time-${lord.id}">${TimeService.formatDuration(secs)}</span>
            </div>` : ''}
        </div>`;
    }).join('');

    return `
      <section class="ov-section ov-mv-section">
        <div class="ov-section-row">
          <div class="ov-section-title">🗺 Active Movements</div>
          <button class="ov-section-toggle" id="ov-toggle-movements">${_movementsOpen ? '▲' : '▼'}</button>
        </div>
        ${_movementsOpen ? `<div class="ov-mv-list">${incomingRows}${rows}</div>` : ''}
      </section>`;
  }

  // ── City tier image helper ────────────────────────────────────

  function _cityTierImg(level) {
    if (level >= 4) return 'assets/city/tier4.jpg';
    if (level >= 3) return 'assets/city/tier3.jpg';
    if (level >= 2) return 'assets/city/tier2.jpg';
    return 'assets/city/tier1.webp';
  }

  // ── Cities section ────────────────────────────────────────────

  function _citiesSection() {
    const cities     = CityService.getPlayerCities(_player.id);
    const cards      = cities.length ? cities.map(_cityCard).join('') : '';
    const atLimit    = cities.length >= 5;
    const foundCost  = CityService.getFoundCost(cities.length);
    const coins      = PlayerService.getById(_player.id)?.coins || 0;
    const canAfford  = foundCost === 0 || coins >= foundCost;
    const costLabel  = foundCost === 0 ? 'Free' : `💰 ${foundCost.toLocaleString()}`;

    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">
            Cities
            <span class="ov-limit-badge">${cities.length}/5</span>
            ${!atLimit ? `<span class="ov-cost-hint">${costLabel} to found</span>` : ''}
          </div>
          <button class="ov-section-toggle" id="ov-toggle-cities">${_citiesCollapsed ? '▼' : '▲'}</button>
        </div>
        ${!_citiesCollapsed ? `
          <div class="ov-cities-grid">
            ${cards}
            ${!atLimit ? `
              <div class="ov-add-card${canAfford ? '' : ' ov-add-card--locked'}" id="ov-found-city-btn"
                   data-cost="${foundCost}" title="Found a new city — costs ${costLabel}">
                <span class="ov-add-cost">${costLabel}</span>
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
    const slotInfo   = CityStatsService.getSlotInfo(city);
    const prodRates  = ProductionService.getRates(city, _lord);
    const growth     = CityStatsService.getPopulationGrowthRate(city, stats, prodRates);
    const status     = CityStatsService.getCityStatus(stats, growth);
    const buildItem  = city.constructionQueue.length > 0 ? city.constructionQueue[0] : null;
    const buildDef   = buildItem ? BUILDING_DEFS[buildItem.buildingId] : null;
    const buildPct   = buildItem ? Math.floor(ConstructionService.progress(city) * 100) : 0;
    const buildSecs  = buildItem ? ConstructionService.timeRemaining(city) : 0;
    const tierImg    = _cityTierImg(slotInfo.level);
    const goldRate   = ProductionService.getGoldRate(city);

    const tierName = `Tier ${slotInfo.level}`;

    const growthSymbol = growth > 0 ? '▲' : growth < 0 ? '▼' : '─';
    const growthClass  = growth > 0 ? 'ov-cc-grow--up' : growth < 0 ? 'ov-cc-grow--down' : 'ov-cc-grow--stable';
    const growthLabel  = growth !== 0 ? ` ${growth > 0 ? '+' : ''}${growth}/hr` : '';

    return `
      <div class="ov-city-card" data-city-id="${city.id}">
        <div class="ov-cc-art">
          <img class="ov-cc-art-img" src="${tierImg}" alt="City" loading="lazy" />
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
            <div class="ov-cc-stat">
              <span class="ov-cc-stat-label">Gold/hr</span>
              <span class="ov-cc-stat-value ov-cc-gold-rate">+${goldRate}💰</span>
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

  // Dampened per stack (count^0.8) to match battle-engine.js's _stackDamageMult —
  // otherwise this overvalues numerous cheap units relative to what they actually deal.
  function _lordArmyPower(lordId) {
    const army = ArmyService.get(lordId);
    return Math.round(army.units.reduce((sum, u) => sum + _unitPower(UNIT_DEFS[u.unitId]) * Math.pow(u.count, 0.8), 0));
  }

  // Lords the player currently holds captive — only rendered when non-empty,
  // same "nothing to show, nothing to render" convention as _movementsPanel().
  function _prisonSection() {
    if (_prisonList.length === 0) return '';
    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">🔒 Prison <span class="ov-limit-badge">${_prisonList.length}</span></div>
        </div>
        <div class="ov-prison-list">
          ${_prisonList.map(p => `
            <div class="ov-prison-row" data-lord-id="${p.lordId}" data-owner-id="${p.ownerId}">
              <span class="ov-prison-name">${p.lordName}</span>
              <span class="ov-prison-owner">Lv ${p.level} · ${p.ownerUsername}</span>
              <button class="ov-prison-release-btn">Release</button>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function _lordsSection() {
    const lords       = LordService.getByPlayer(_player.id);
    const atLimit     = lords.length >= 5;
    const recruitCost = LordService.getRecruitCost(lords.length);
    const coins       = PlayerService.getById(_player.id)?.coins || 0;
    const canAfford   = coins >= recruitCost;
    const costLabel   = `💰 ${recruitCost.toLocaleString()}`;

    return `
      <section class="ov-section">
        <div class="ov-section-row">
          <div class="ov-section-title">
            Lords
            <span class="ov-limit-badge">${lords.length}/5</span>
            ${!atLimit ? `<span class="ov-cost-hint">${costLabel} to recruit</span>` : ''}
          </div>
          <button class="ov-section-toggle" id="ov-toggle-lords">${_lordsCollapsed ? '▼' : '▲'}</button>
        </div>
        ${!_lordsCollapsed ? `
          <div class="ov-lords-grid">
            ${lords.map(_lordCard).join('')}
            ${!atLimit ? `
              <div class="ov-add-card${canAfford ? '' : ' ov-add-card--locked'}" id="ov-recruit-lord-btn"
                   data-cost="${recruitCost}" title="Recruit a new lord — costs ${costLabel}">
                <span class="ov-add-cost">${costLabel}</span>
                <span class="ov-add-icon">+</span>
                <span class="ov-add-label">Recruit Lord</span>
              </div>` : ''}
          </div>` : ''}
      </section>
    `;
  }

  function _lordCard(lord) {
    const race        = RACES[lord.race] || {};
    const cls         = LORD_CLASSES[lord.classId];
    const stats       = LordService.getEffectiveStats(lord);
    const maxHp       = stats.health;
    const lordIsDown  = LordService.isDown(lord);
    const downReason  = lord.downtimeReason || 'defeated';
    const downRemSecs = lordIsDown ? Math.ceil(LordService.getDowntimeRemaining(lord) / 1000) : 0;
    const curHp       = lordIsDown ? 0 : Math.min(lord.currentHp ?? maxHp, maxHp);
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
    const isAttacking  = queueItem?.intent === 'attack';

    // Stance
    const stanceObj = LordService.getStance(lord);
    const stanceDef = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
    const isStanced = LordService.isStanced(lord);
    const isRaiding = !lordIsDown && isStanced && stanceObj.id === 'raiding';
    // Raiding gets the full activity-overlay treatment below (like
    // attacking/questing/moving) instead of the small badge — showing both
    // would be redundant, same reason those three never show the badge either.
    const stanceBadge = isStanced && stanceObj.id !== 'raiding'
      ? `<span class="ov-lc-stance-badge">${stanceDef.icon} ${stanceDef.name}</span>`
      : '';
    const raidSecs = isRaiding ? Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000)) : 0;

    const isQuesting = !lordIsDown && queueItem?.actionId === 'search_area';
    const isScouting = !lordIsDown && queueItem?.actionId === 'scout';
    const isMoving   = !lordIsDown && queueItem?.actionId === 'move_lord' && !isAttacking;

    const activityOverlay = isAttacking ? `
        <div class="ov-lord-activity-overlay ov-lord-activity-overlay--attack">
          <div class="ov-lord-activity-icon">&#9876;</div>
          <div class="ov-lord-activity-label">Attacking</div>
          <div class="ov-lord-activity-dest">(${queueItem.destX}, ${queueItem.destY})</div>
          <div class="ov-lord-activity-cd" id="ov-lord-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
        </div>` :
      isQuesting ? `
        <div class="ov-lord-activity-overlay ov-lord-activity-overlay--quest">
          <div class="ov-lord-activity-icon">&#128506;</div>
          <div class="ov-lord-activity-label">Questing</div>
          <div class="ov-lord-activity-cd" id="ov-lord-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
        </div>` :
      isScouting ? `
        <div class="ov-lord-activity-overlay ov-lord-activity-overlay--scout">
          <div class="ov-lord-activity-icon">&#128373;</div>
          <div class="ov-lord-activity-label">Scouting</div>
          <div class="ov-lord-activity-cd" id="ov-lord-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
        </div>` :
      isMoving ? `
        <div class="ov-lord-activity-overlay ov-lord-activity-overlay--move">
          <div class="ov-lord-activity-icon">&#128694;</div>
          <div class="ov-lord-activity-label">Marching</div>
          <div class="ov-lord-activity-dest">(${queueItem.destX}, ${queueItem.destY})</div>
          <div class="ov-lord-activity-cd" id="ov-lord-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
        </div>` :
      isRaiding ? `
        <div class="ov-lord-activity-overlay ov-lord-activity-overlay--raiding">
          <div class="ov-lord-activity-icon">🏴</div>
          <div class="ov-lord-activity-label">Raiding</div>
          <div class="ov-lord-activity-dest">(${lord.x}, ${lord.y})</div>
          <div class="ov-lord-activity-cd" id="ov-lord-act-cd-${lord.id}">${TimeService.formatDuration(raidSecs)}</div>
        </div>` : '';

    const cardModifier = lordIsDown   ? ' ov-lord-card--down'
      : isAttacking ? ' ov-lord-card--attacking'
      : isQuesting  ? ' ov-lord-card--questing'
      : isScouting  ? ' ov-lord-card--scouting'
      : isMoving    ? ' ov-lord-card--marching'
      : isRaiding   ? ' ov-lord-card--raiding'
      : '';

    const portraitSrc  = pickLordPortrait(lord.race, lord.classId, lord.id) || lord.portrait || race.portrait;
    const portraitHtml = portraitSrc
      ? `<div class="ov-lc-portrait">
           <img class="ov-lc-portrait-img" src="${portraitSrc}" alt="${lord.name}" loading="lazy" />
           <div class="ov-lc-portrait-fade"></div>
           <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
         </div>`
      : `<div class="ov-lc-portrait ov-lc-portrait--icon">
           <span>${race.icon || '👤'}</span>
           <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
         </div>`;

    return `
      <div class="ov-lord-card${cardModifier}" data-lord-id="${lord.id}">
        ${lordIsDown && lord.capturedByPlayerId ? `
          <div class="ov-lord-down-overlay">
            <div class="ov-lord-down-icon">⛓</div>
            <div class="ov-lord-down-label ov-lord-down-label--captured">CAPTURED</div>
            <div class="ov-lord-captor">by ${lord.capturedByUsername || 'Unknown'}</div>
            <button class="ov-lord-ransom-btn" data-lord-id="${lord.id}">💰 Pay Ransom (${lordRansomCost(lord.level)})</button>
          </div>` : lordIsDown ? `
          <div class="ov-lord-down-overlay">
            <div class="ov-lord-down-icon">${downReason === 'captured' ? '⛓' : '💀'}</div>
            <div class="ov-lord-down-label ov-lord-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
            <div class="ov-lord-down-cd" id="ov-lord-down-cd-${lord.id}">${TimeService.formatDuration(downRemSecs)}</div>
            <button class="ov-lord-revive-btn" data-lord-id="${lord.id}">⚡ ${Math.max(1, Math.ceil(downRemSecs / 60))}💎 Revive</button>
          </div>` : ''}
        ${activityOverlay}
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
          <div class="ov-lc-meta${isAttacking ? ' ov-lc-meta--attack' : ''}">
            📍 ${location} · ${isAttacking ? `⚔ ATTACKING (${queueItem.destX},${queueItem.destY})` : isScouting ? '🕵 Scouting' : isQuesting ? '🔍 Questing' : activeAction ? `${activeAction.icon} ${activeAction.name}` : isRaiding ? '🏴 RAIDING' : 'Idle'}
          </div>
          ${queueItem ? `<div class="ov-lc-action-row">
            <div class="ov-lc-action-bar"><div class="ov-lc-action-fill${isAttacking ? ' ov-lc-action-fill--attack' : ''}" id="ov-lord-fill" style="width:${actionPct}%"></div></div>
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

  // ── Events ────────────────────────────────────────────────────

  function _rerender() {
    _stopTicker();
    if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
  }

  function _bindEvents() {
    // Threat dismiss buttons
    document.querySelectorAll('.ov-iab-dismiss[data-threat-id]').forEach(btn => {
      btn.addEventListener('click', () => _dismissThreat(btn.dataset.threatId));
    });

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
    A11y.makeClickable(_root, '.ov-city-card[data-city-id]');

    document.querySelectorAll('.ov-lord-revive-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        e.preventDefault();
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord || !LordService.isDown(lord)) return;
        btn.disabled = true;
        const result = await ServerActions.reviveLord(lord.id);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _stopTicker();
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      });
    });

    document.querySelectorAll('.ov-lord-ransom-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        e.preventDefault();
        btn.disabled = true;
        const result = await ServerActions.ransomLord(btn.dataset.lordId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _toast('🔓 Ransom paid — your lord is free.');
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _stopTicker();
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      });
    });

    document.querySelectorAll('.ov-prison-release-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.ov-prison-row');
        if (!row) return;
        btn.disabled = true;
        const result = await ServerActions.releaseLord(row.dataset.lordId, row.dataset.ownerId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _toast('🔓 Lord released.');
        _prisonList = _prisonList.filter(p => p.lordId !== row.dataset.lordId);
        _rerender();
      });
    });

    document.querySelectorAll('.ov-lord-card[data-lord-id]').forEach(card => {
      card.addEventListener('click', () => {
        _stopTicker();
        const lord = LordService.getById(card.dataset.lordId);
        if (lord) App.navigate('lord-screen', { lord, player: _player });
      });
    });
    A11y.makeClickable(_root, '.ov-lord-card[data-lord-id]');

    document.getElementById('ov-found-city-btn')?.addEventListener('click', e => {
      const cost  = parseInt(e.currentTarget.dataset.cost || '0', 10);
      const coins = PlayerService.getById(_player.id)?.coins || 0;
      if (cost > 0 && coins < cost) {
        _toast(`Not enough gold — founding this city costs 💰 ${cost.toLocaleString()}.`);
        return;
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
    document.getElementById('ov-recruit-lord-btn')?.addEventListener('click', e => {
      const cost  = parseInt(e.currentTarget.dataset.cost || '0', 10);
      const coins = PlayerService.getById(_player.id)?.coins || 0;
      if (cost > 0 && coins < cost) {
        _toast(`Not enough gold — recruiting a lord costs 💰 ${cost.toLocaleString()}.`);
        return;
      }
      _openRecruitModal();
    });

    document.getElementById('rl-cancel')?.addEventListener('click', () => {
      document.getElementById('recruit-modal').classList.add('hidden');
    });

    document.querySelectorAll('.lc-class-card[data-class-id]').forEach(card => {
      card.addEventListener('click', () => {
        _selectedClass = card.dataset.classId;
        document.querySelectorAll('.lc-class-card').forEach(c => c.classList.remove('lc-class-card--selected'));
        card.classList.add('lc-class-card--selected');
      });
    });
    A11y.makeClickable(document.getElementById('recruit-modal'), '.lc-class-card[data-class-id]');

    document.getElementById('recruit-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('recruit-modal').classList.add('hidden');
    });
    document.getElementById('recruit-modal')?.addEventListener('keydown', e => {
      if (e.key === 'Escape') document.getElementById('recruit-modal').classList.add('hidden');
    });

    document.getElementById('rl-confirm')?.addEventListener('click', _onRecruitConfirm);
    document.getElementById('rl-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _onRecruitConfirm();
    });
    // Dice button: randomize lord name from player race.
    document.getElementById('rl-name-dice')?.addEventListener('click', () => {
      const raceId = _player?.race || _lord?.race || 'human';
      const nameEl = document.getElementById('rl-name');
      if (nameEl) nameEl.value = randomRaceName(raceId, 'lords');
    });
  }

  function _openRecruitModal() {
    _selectedClass = null;
    const raceId = _player?.race || _lord?.race || '';
    document.getElementById('rl-name').value = raceId ? randomRaceName(raceId, 'lords') : '';
    document.querySelectorAll('.lc-class-card').forEach(c => c.classList.remove('lc-class-card--selected'));
    const cityEl = document.getElementById('rl-city');
    if (cityEl) cityEl.value = '';
    document.getElementById('rl-error').textContent = '';
    document.getElementById('recruit-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('rl-name').focus(), 50);
  }

  async function _onRecruitConfirm() {
    const name    = document.getElementById('rl-name').value;
    const classId = _selectedClass;
    const cityId  = document.getElementById('rl-city')?.value || null;
    const errorEl = document.getElementById('rl-error');
    const btn     = document.getElementById('rl-confirm');
    errorEl.textContent = '';
    if (!classId) { errorEl.textContent = 'Please choose a class.'; return; }
    if (!cityId) { errorEl.textContent = 'Please choose a starting city.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Recruiting…'; }

    const portrait = pickLordPortrait(_player?.race, classId);
    const result = await ServerActions.createLord(name, classId, cityId, portrait);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Server error';
      if (btn) { btn.disabled = false; btn.textContent = 'Create Lord'; }
      return;
    }

    const freshPlayer = PlayerService.getById(_player.id);
    if (freshPlayer) _player = freshPlayer;
    if (!_lord && result.lord) _lord = result.lord;

    document.getElementById('recruit-modal').classList.add('hidden');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Lord'; }
    HUD.show(_player, _lord);
    Nav.show(_player, _lord, 'home');
    _rerender();
  }

  function _toast(msg) { ToastService.show(msg); }

  return { render, stop };
})();
