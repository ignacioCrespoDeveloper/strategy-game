// =============================================
//  overview-screen.js — Empire dashboard (default landing)
// =============================================

const OverviewScreen = (() => {
  let _lord            = null;
  let _player          = null;
  let _root            = null;
  let _tickTimer       = null;
  let _pollTimer       = null;
  let _lastSeenFeedId  = null;
  let _movementsOpen   = true;
  let _citiesCollapsed = false;
  let _lordsCollapsed  = false;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player }) {
    _stopTicker();
    _stopPolling();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = lord ? LordService.getById(lord.id) : null;
    if (_lord && LordService.tickHp(_lord)) LordService.save(_lord);
    ActivityService.markSeen(_player.id);
    HUD.refresh();
    root.innerHTML = _shell();
    _bindEvents();
    _startTicker();
    _startPolling();
    _flushSyncEvents();
  }

  function stop() { _stopTicker(); _stopPolling(); }

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

  function _stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  function _startTicker() {
    const cities     = CityService.getPlayerCities(_player.id);
    const allLords   = LordService.getByPlayer(_player.id);
    const hasAction  = allLords.some(l => l.actionQueue.length > 0);
    const hasConstr  = cities.some(c => c.constructionQueue.length > 0);
    const feed       = ActivityService.get(_player.id);
    const hasThreats = feed.some(e => e.type === 'pvp_threat' && e.etaAt && e.etaAt > TimeService.now());
    const hasDown    = allLords.some(l => LordService.isDown(l));
    if (!hasAction && !hasConstr && !hasThreats && !hasDown) return;

    _tickTimer = setInterval(() => {
      let needsRerender = false;

      // Check ALL lords for completed actions (not just _lord)
      const activeLords = LordService.getByPlayer(_player.id).filter(l => l.actionQueue.length > 0);
      for (const lord of activeLords) {
        const completed = LordService.tickActions(lord);
        if (completed.length > 0) {
          ServerActions.syncNow(); // persist lord action completion to Supabase
          if (_lord && lord.id === _lord.id) _lord = LordService.getById(lord.id);
          const atk = completed.find(c => c.actionId === 'move_lord' && c.intent === 'attack');
          if (atk) {
            const lid = lord.id;
            const dX  = atk.destX;
            const dY  = atk.destY;
            // Give syncNow() a moment to write before the PvP resolve reads
            setTimeout(() => _resolveAttack(lid, dX, dY), 800);
          }
          needsRerender = true;
        } else {
          // Update movement panel row timer in-place (IDs added in _movementsPanel)
          const fill = document.getElementById(`ov-mv-fill-${lord.id}`);
          const time = document.getElementById(`ov-mv-time-${lord.id}`);
          if (fill) fill.style.width = `${Math.floor(LordService.actionProgress(lord) * 100)}%`;
          if (time) time.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(lord));
          // Also update lord card bars if this is _lord
          if (_lord && lord.id === _lord.id) {
            const cardFill  = document.getElementById('ov-lord-fill');
            const cardTimer = document.getElementById('ov-lord-timer');
            if (cardFill)  cardFill.style.width  = `${Math.floor(LordService.actionProgress(lord) * 100)}%`;
            if (cardTimer) cardTimer.textContent = TimeService.formatDuration(LordService.actionTimeRemaining(lord));
          }
        }
      }

      // City construction
      CityService.getPlayerCities(_player.id).forEach(city => {
        if (city.constructionQueue.length === 0) return;
        const completed = ConstructionService.tick(city);
        if (completed.length > 0) {
          ServerActions.syncNow(); // persist building completion to Supabase
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
        if (incFill) incFill.style.width = `${pct}%`;
      });

      if (needsRerender) {
        _stopTicker();
        if (_lord) _lord = LordService.getById(_lord.id);
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      }
    }, 1000);
  }

  // ── PvP attack resolution (fires when attacker's travel timer ends) ──

  async function _resolveAttack(attackingLordId, tX, tY) {
    let token;
    try {
      const { data: { session } } = await SupabaseService.client.auth.getSession();
      token = session?.access_token;
    } catch (_) {}
    if (!token) { _toast('❌ No active session to resolve battle.'); return; }

    _toast('⚔ Resolving combat…');
    let d;
    try {
      const resp = await fetch('/api/pvp/resolve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body:    JSON.stringify({ attackerLordId: attackingLordId, targetTileX: tX, targetTileY: tY }),
      });
      d = await resp.json();
    } catch (e) {
      _toast('❌ Network error: ' + e.message);
      return;
    }

    if (!d.ok) {
      _toast('❌ ' + (d.error || 'Error en el combate'));
      return;
    }

    // Apply army losses locally so the UI refreshes without a reload
    const armiesAll = StorageService.get('armies') || {};
    const myArmy    = armiesAll[attackingLordId] || { lordId: attackingLordId, units: [] };
    (d.report.attacker.unitsStart || []).forEach(({ sourceId }) => {
      if (sourceId === attackingLordId) return;
      const surv  = (d.report.attacker.unitsSurviving || []).find(s => s.sourceId === sourceId);
      const stack = myArmy.units.find(u => u.unitId === sourceId);
      if (!stack) return;
      stack.count = surv?.count ?? 0;
      if (surv && stack.count > 0) stack.currentHp = Math.round(surv.avgHp);
    });
    myArmy.units             = myArmy.units.filter(u => u.count > 0);
    armiesAll[attackingLordId] = myArmy;
    StorageService.set('armies', armiesAll);

    // Apply XP then battle HP in one save.
    // checkLevelUp() heals to full on level-up, so HP must be applied AFTER to
    // ensure the battle result always wins over any level-up heal.
    const freshLord = LordService.getById(attackingLordId);
    if (freshLord) {
      if (d.report.xpEarned > 0) {
        freshLord.xp = (freshLord.xp || 0) + d.report.xpEarned;
        const leveled = LordService.checkLevelUp(freshLord);
        if (leveled > 0) _toast(`⭐ Level up! Now level ${freshLord.level}.`);
      }
      // Always overwrite HP + downtime with battle result (level-up heal must not win)
      const lordUnit = (d.report.attacker.unitsSurviving || []).find(s => s.sourceId === attackingLordId);
      if (lordUnit) {
        freshLord.currentHp      = Math.max(1, Math.round(lordUnit.avgHp));
        freshLord.downtimeUntil  = null;
        freshLord.downtimeReason = null;
      } else {
        freshLord.currentHp      = 0;
        freshLord.downtimeUntil  = TimeService.now() + 3600000;
        freshLord.downtimeReason = 'defeated';
      }
      LordService.save(freshLord);
      if (_lord && _lord.id === attackingLordId) _lord = freshLord;
    }

    // Save to battle history + local activity feed
    const pvpOutcome = d.report.winner === 'attacker' ? 'victory' : d.report.winner === 'draw' ? 'draw' : 'defeat';
    BattleHistoryService.save(attackingLordId, {
      outcome: pvpOutcome, campName: 'Enemy lord', campIcon: '⚔', campLevel: null,
      terrain: d.terrain || null, goldEarned: 0, xpEarned: d.report.xpEarned || 0,
      modelsLost: d.report.attacker.modelsLost, rounds: d.report.rounds,
      reason: d.report.reason, report: d.report,
    });
    _player = PlayerService.getById(_player.id);
    ActivityService.log(_player.id, {
      type: `battle_${pvpOutcome}`,
      icon: pvpOutcome === 'victory' ? '⚔' : pvpOutcome === 'draw' ? '🤝' : '☠',
      title: pvpOutcome === 'victory' ? 'PvP Victory' : pvpOutcome === 'draw' ? 'PvP Draw' : 'PvP Defeat',
      detail: `${d.report.rounds} rounds · casualties: ${d.report.attacker.modelsLost} · +${d.report.xpEarned || 0}⭐`,
      lordName: freshLord?.name || '',
      lordId: attackingLordId,
    });
    HUD.refresh();

    const label = pvpOutcome === 'victory' ? '⚔ PvP Victory' : pvpOutcome === 'draw' ? '🤝 PvP Draw' : '☠ PvP Defeat';
    _toast(`${label} — report in Battles tab`);

    _stopTicker();
    if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
  }

  // ── Supabase activity_feed polling (both attacker and defender) ──

  function _startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(_pollActivityFeed, 10000);
  }

  async function _pollActivityFeed() {
    try {
      const { data: { session } } = await SupabaseService.client.auth.getSession();
      if (!session?.user?.id) return;
      const pid = session.user.id;

      const { data } = await SupabaseService.client
        .from('storage')
        .select('value')
        .eq('player_id', pid)
        .eq('key', 'activity_feed')
        .maybeSingle();

      const remoteEntries = (data?.value?.[pid] || []);
      if (remoteEntries.length === 0) return;

      const latestId = remoteEntries[0]?.id;
      if (latestId === _lastSeenFeedId) return;
      _lastSeenFeedId = latestId;

      // Merge new server entries into local storage
      const localFeed    = StorageService.get('activity_feed') || {};
      const localEntries = localFeed[pid] || [];
      const localIds     = new Set(localEntries.map(e => e.id));
      const newEntries   = remoteEntries.filter(e => !localIds.has(e.id));
      if (newEntries.length === 0) return;

      localFeed[pid] = [...newEntries, ...localEntries].slice(0, 50);
      StorageService.set('activity_feed', localFeed);

      // Show toasts for pvp notifications and re-render
      const pvpNew = newEntries.filter(e => e.type === 'pvp_result' || e.type === 'pvp_threat');
      pvpNew.forEach(e => _toast(`${e.icon} ${e.title}`));

      // Save battle history + sync lord HP for defender (attacker handles both in _resolveAttack)
      newEntries.filter(e => e.type === 'pvp_result' && e.lordId && e.report).forEach(e => {
        const alreadySaved = BattleHistoryService.getForLord(e.lordId).some(b => b.at === e.at);
        if (!alreadySaved) {
          BattleHistoryService.save(e.lordId, {
            outcome: e.outcome || 'defeat', campName: 'Enemy lord', campIcon: '⚔', campLevel: null,
            terrain: e.terrain || null, goldEarned: 0, xpEarned: e.xpEarned || 0,
            modelsLost: e.modelsLost || 0, rounds: e.rounds || 0,
            reason: e.report?.reason || '', report: e.report,
          });
        }
        // Update local lord HP from the battle report.
        // Only apply when this lord was on the defender side — attacker HP is already
        // handled synchronously in _resolveAttack. Detect defender side by checking
        // report.defender.unitsStart (includes eliminated units, unlike unitsSurviving).
        const defStart = e.report?.defender?.unitsStart || [];
        if (defStart.some(u => u.sourceId === e.lordId)) {
          const lordsStorage = StorageService.get('lords') || {};
          const lordRec      = lordsStorage[e.lordId];
          if (lordRec) {
            const defLordUnit = (e.report.defender.unitsSurviving || []).find(s => s.sourceId === e.lordId);
            if (defLordUnit) {
              lordRec.currentHp      = Math.max(1, Math.round(defLordUnit.avgHp));
              lordRec.downtimeUntil  = null;
              lordRec.downtimeReason = null;
            } else {
              lordRec.currentHp      = 0;
              lordRec.downtimeUntil  = TimeService.now() + 3600000;
              lordRec.downtimeReason = e.report?.winner === 'attacker' ? 'captured' : 'defeated';
            }
            lordsStorage[e.lordId] = lordRec;
            StorageService.set('lords', lordsStorage);
          }
        }
      });

      if (pvpNew.length > 0) {
        _stopTicker();
        _player = PlayerService.getById(_player.id);
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      }
    } catch (_) {
      // Non-fatal — polling will retry next interval
    }
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

    return `
      <div class="ov-screen">
        ${_incomingAttackBanner()}
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

    const playerCities = _player ? CityService.getPlayerCities(_player.id) : [];
    const cityOptions  = playerCities.map(c =>
      `<option value="${c.id}">${c.name} (${c.x}, ${c.y})</option>`
    ).join('');

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
              <div class="ov-mv-bar"><div class="ov-mv-fill ov-mv-fill--incoming" id="ov-inc-fill-${i}" style="width:${pct}%"></div></div>
              <span class="ov-mv-time" id="ov-inc-time-${i}">${TimeService.formatDuration(remaining)}</span>
            </div>` : `<span class="ov-mv-time">${t.detail || ''}</span>`}
        </div>`;
    }).join('');

    const rows = active.map(lord => {
      const qItem    = lord.actionQueue[0];
      const actionDef = qItem ? LORD_ACTIONS[qItem.actionId] : null;
      const pct      = qItem ? Math.floor(LordService.actionProgress(lord) * 100) : 0;
      const secs     = qItem ? LordService.actionTimeRemaining(lord) : 0;
      const stanceDef = STANCE_DEFS[LordService.getStance(lord)?.id] || STANCE_DEFS.idle;

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
        }
      } else if (LordService.isStanced(lord)) {
        icon  = stanceDef.icon || '🛡';
        label = stanceDef.name || 'Stance';
      }

      return `
        <div class="ov-mv-row${isAttacking ? ' ov-mv-row--attack' : ''}">
          <span class="ov-mv-lord">${lord.name}</span>
          <span class="ov-mv-status">${icon} ${label}</span>
          ${qItem ? `
            <div class="ov-mv-bar-wrap">
              <div class="ov-mv-bar"><div class="ov-mv-fill${isAttacking ? ' ov-mv-fill--attack' : ''}" id="ov-mv-fill-${lord.id}" style="width:${pct}%"></div></div>
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
    if (level >= 5) return 'assets/city/tier4.jpg';
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
    const status     = CityStatsService.getCityStatus(stats);
    const slotInfo   = CityStatsService.getSlotInfo(city);
    const prodRates  = ProductionService.getRates(city, _lord);
    const growth     = CityStatsService.getPopulationGrowthRate(city, stats, prodRates);
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

  function _lordArmyPower(lordId) {
    const army = ArmyService.get(lordId);
    return army.units.reduce((sum, u) => sum + _unitPower(UNIT_DEFS[u.unitId]) * u.count, 0);
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
      <div class="ov-lord-card${lordIsDown ? ' ov-lord-card--down' : ''}" data-lord-id="${lord.id}">
        ${lordIsDown ? `
          <div class="ov-lord-down-overlay">
            <div class="ov-lord-down-icon">${downReason === 'captured' ? '⛓' : '💀'}</div>
            <div class="ov-lord-down-label ov-lord-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
            <div class="ov-lord-down-cd" id="ov-lord-down-cd-${lord.id}">${TimeService.formatDuration(downRemSecs)}</div>
            <button class="ov-lord-revive-btn" data-lord-id="${lord.id}">⚡ ${Math.max(1, Math.ceil(downRemSecs / 60))}💎 Revive</button>
          </div>` : ''}
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
            📍 ${location} · ${isAttacking ? `⚔ ATTACKING (${queueItem.destX},${queueItem.destY})` : activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
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

    const isBattleEntry = e => e.type === 'pvp_result' || e.type?.startsWith('battle_');

    const items = feed.slice(0, 30).map(e => {
      const css  = _TYPE_CSS[e.type] || '';
      const date = _timeAgo(TimeService.now() - e.at);
      const reportLordId = e.lordId
        || LordService.getByPlayer(_player.id).find(l => l.name === e.lordName)?.id
        || null;
      const reportBtn = isBattleEntry(e) && reportLordId
        ? `<button class="af-report-btn" data-lord-id="${reportLordId}" title="View battle report">📋 Report</button>`
        : '';
      return `
        <div class="af-entry ${css}">
          <span class="af-icon">${e.icon}</span>
          <div class="af-body">
            <span class="af-title">${e.title}</span>
            ${e.detail ? `<span class="af-detail">${e.detail}</span>` : ''}
            ${reportBtn}
          </div>
          <div class="af-meta">
            ${e.lordName ? `<span class="af-lord">${e.lordName}</span>` : ''}
            <span class="af-time">${date}</span>
          </div>
        </div>`;
    }).join('');

    return `
      <section class="ov-section ov-activity-feed">
        <h2 class="ov-section-title">📋 Recent Activity</h2>
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

    document.querySelectorAll('.ov-lord-revive-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord || !LordService.isDown(lord)) return;
        const remSecs = Math.ceil(LordService.getDowntimeRemaining(lord) / 1000);
        const cost    = Math.max(1, Math.ceil(remSecs / 60));
        const result  = PlayerService.spendCredits(_player.id, cost);
        if (!result.ok) { _toast(result.error); return; }
        lord.downtimeUntil  = null;
        lord.downtimeReason = null;
        lord.currentHp      = 1;
        lord.hpRegenAt      = TimeService.now();
        LordService.save(lord);
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _stopTicker();
        if (_root) { _root.innerHTML = _shell(); _bindEvents(); _startTicker(); }
      });
    });

    document.querySelectorAll('.ov-lord-card[data-lord-id]').forEach(card => {
      card.addEventListener('click', () => {
        _stopTicker();
        const lord = LordService.getById(card.dataset.lordId);
        if (lord) App.navigate('lord-screen', { lord, player: _player });
      });
    });

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

    document.getElementById('recruit-modal')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('recruit-modal').classList.add('hidden');
    });

    document.getElementById('rl-confirm')?.addEventListener('click', _onRecruitConfirm);
    document.getElementById('rl-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _onRecruitConfirm();
    });

    document.querySelectorAll('.af-report-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        _stopTicker();
        const lord = LordService.getById(btn.dataset.lordId);
        if (lord) App.navigate('lord-screen', { lord, player: _player, openTab: 'battles' });
      });
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
    const cityEl = document.getElementById('rl-city');
    if (cityEl) cityEl.value = '';
    document.getElementById('rl-error').textContent = '';
    document.getElementById('recruit-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('rl-name').focus(), 50);
  }

  async function _onRecruitConfirm() {
    const name    = document.getElementById('rl-name').value;
    const raceEl  = document.getElementById('rl-race');
    const raceId  = raceEl ? raceEl.value : (_lord?.race || '');
    const classId = document.getElementById('rl-class').value;
    const cityId  = document.getElementById('rl-city')?.value || null;
    const errorEl = document.getElementById('rl-error');
    const btn     = document.getElementById('rl-confirm');
    errorEl.textContent = '';
    if (!cityId) { errorEl.textContent = 'Please choose a starting city.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Recruiting…'; }

    const result = await ServerActions.createLord(name, raceId, classId, cityId);
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
