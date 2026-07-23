// =============================================
//  lord-screen.js — Full-screen lord management
// =============================================

const LordScreen = (() => {
  let _lord            = null;
  let _player          = null;
  let _activeTab       = 'overview';
  let _tickTimer       = null;
  let _resolvingSearch = false;
  let _mountPickerOpen = false;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player, openTab, autoAttackRecordId }) {
    _player          = player;
    _lord            = LordService.getById(lord.id);
    _activeTab       = openTab || 'overview';
    _mountPickerOpen = false;

    _migrateLord();
    if (LordService.tickHp(_lord)) {
      LordService.save(_lord);
      _lord = LordService.getById(_lord.id);
    }

    // If lord has no position, place them at the player's first city.
    if (_lord.x == null) {
      const firstCity = CityService.getPlayerCities(_player.id)[0];
      if (firstCity) LordService.setPosition(_lord.id, firstCity.x, firstCity.y);
      _lord = LordService.getById(_lord.id);
    }

    DiscoveryService.expireOld(_player.id);

    const completed = LordService.tickActions(_lord);
    if (completed.length > 0) {
      LordService.save(_lord); // persist cleared actionQueue before re-reading
      _lord = LordService.getById(_lord.id);
      completed.forEach(c => {
        if (c.actionId === 'search_area') {
          _resolveSearch();
        } else if (c.actionId === 'scout') {
          _resolveScout();
        } else if (c.actionId === 'move_lord') {
          if (c.intent === 'attack') {
            _toast('⚔ Attack dispatched — resolving on server…');
            // Server dispatcher resolves the battle within ~5 s.
            // Pull fresh state after that so the Battles tab shows the result.
            setTimeout(async () => {
              await ServerActions.syncNow();
              _lord = LordService.getById(_lord.id);
              _renderTab();
            }, 6000);
          } else {
            _toast(`📍 Arrived at (${c.destX}, ${c.destY}).`);
            ActivityService.log(_player.id, {
              type: 'lord_moved', icon: '📍',
              title: `${_lord.name} arrived at (${c.destX}, ${c.destY})`,
              detail: '', lordName: _lord.name,
            });
          }
        } else {
          _toast(`✓ ${c.name} completed!`);
        }
        if (c.leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
      });
    }

    root.innerHTML = _shell();
    _renderTab();
    _bindEvents();
    _startCountdown();
    if (autoAttackRecordId) {
      _activeTab = 'quests';
      _renderTab();
      _claimDiscovery(autoAttackRecordId);
    }
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
    if (_lord.talentId     === undefined) { _lord.talentId = null;                 changed = true; }
    if (_lord.mountId      === undefined) { _lord.mountId  = null;                 changed = true; }
    if (_lord.currentHp    == null) { _lord.currentHp    = LordService.getEffectiveStats(_lord).health; changed = true; }
    if (_lord.hpRegenAt    == null) { _lord.hpRegenAt    = TimeService.now();      changed = true; }
    if (!_lord.stance)             { _lord.stance        = { id: 'idle', startedAt: null, finishAt: null }; changed = true; }

    if (changed) LordService.save(_lord);
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const race       = RACES[_lord?.race] || {};
    const cls        = LORD_CLASSES[_lord?.classId];
    const lordIsDown = LordService.isDown(_lord);
    return `
      <div class="ls-fullscreen">

        <div class="ls-body">

          <aside class="ls-left" id="ls-left">
            ${_leftPanelHtml()}
          </aside>

          <div class="ls-right">
            <nav class="ls-tabs">
              <button class="ls-tab ${_activeTab === 'overview'  ? 'ls-tab--active' : ''}" data-tab="overview">📍 Overview</button>
              <button class="ls-tab ${_activeTab === 'army'      ? 'ls-tab--active' : ''}" data-tab="army" ${lordIsDown ? 'disabled title="Lord is incapacitated"' : ''}>⚔ Army</button>
              <button class="ls-tab ${_activeTab === 'discovery' ? 'ls-tab--active' : ''}" data-tab="discovery" id="ls-tab-discovery" ${lordIsDown ? 'disabled title="Lord is incapacitated"' : ''}>🗺 Quests${(() => { const n = DiscoveryService.getUnseenCount(_player.id); return n > 0 ? `<span class="ls-tab-badge">${n}</span>` : ''; })()}</button>
              <button class="ls-tab ${_activeTab === 'talents'   ? 'ls-tab--active' : ''}" data-tab="talents" ${(_lord.level || 1) < 5 ? 'title="Unlocks at level 5"' : ''}>✨ Talents${(_lord.level || 1) >= 5 && !_lord.talentId ? '<span class="ls-tab-badge ls-tab-badge--gold">!</span>' : ''}</button>
              <button class="ls-tab ${_activeTab === 'mount'     ? 'ls-tab--active' : ''}" data-tab="mount" ${(_lord.level || 1) < 5 ? 'title="Unlocks at level 5"' : ''}>🐎 Mount${(_lord.level || 1) >= 5 && !_lord.mountId ? '<span class="ls-tab-badge ls-tab-badge--gold">!</span>' : ''}</button>
              <button class="ls-tab ${_activeTab === 'battles'   ? 'ls-tab--active' : ''}" data-tab="battles">🗡 Battles${(() => { const n = BattleHistoryService.getForLord(_lord.id).length; return n > 0 ? `<span class="ls-tab-badge ls-tab-badge--neutral">${n}</span>` : ''; })()}</button>
            </nav>
            <div class="ls-content" id="ls-content"></div>
          </div>

        </div>
      </div>

      <div class="unit-req-overlay hidden" id="unit-req-overlay">
        <div class="unit-req-panel">
          <div class="unit-req-header">
            <span class="unit-req-title">🗂 Unit Roster</span>
            <button class="unit-req-close" id="unit-req-close">✕</button>
          </div>
          <div class="unit-req-body" id="unit-req-body"></div>
        </div>
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

    const effective = LordService.getEffectiveStats(_lord);
    const maxHp     = effective.health;
    const curHp     = Math.min(_lord.currentHp ?? maxHp, maxHp);
    const hpPct     = Math.min(100, Math.floor((curHp / maxHp) * 100));
    const mods      = cls?.modifiers || {};

    // Portrait — class portrait takes priority over race portrait
    const lordIsDown    = LordService.isDown(_lord);
    const downReason    = _lord.downtimeReason || 'defeated';
    const downRemSecs   = lordIsDown ? Math.ceil(LordService.getDowntimeRemaining(_lord) / 1000) : 0;
    const downReviveCost = lordIsDown ? _creditCost(downRemSecs) : 0;
    const downOverlay    = lordIsDown ? `
      <div class="lsl-portrait-down-overlay">
        <div class="lsl-portrait-down-icon">${downReason === 'captured' ? '⛓' : '💀'}</div>
        <div class="lsl-portrait-down-label lsl-portrait-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
        <div class="lsl-portrait-down-cd" id="ls-lord-down-cd">${TimeService.formatDuration(downRemSecs)}</div>
        <button class="ls-finish-btn ls-revive-btn" id="ls-revive-now">⚡ ${downReviveCost}💎 Revive</button>
      </div>` : '';

    const lsQueueItem  = _lord.actionQueue?.[0] ?? null;
    const lsIsAttacking = lsQueueItem?.intent === 'attack';
    const lsIsQuesting  = !lordIsDown && lsQueueItem?.actionId === 'search_area';
    const lsIsMoving    = !lordIsDown && lsQueueItem?.actionId === 'move_lord' && !lsIsAttacking;
    const lsActionSecs  = lsQueueItem ? LordService.actionTimeRemaining(_lord) : 0;

    const activityOverlay = lsIsAttacking ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--attack">
        <div class="ov-lord-activity-icon">&#9876;</div>
        <div class="ov-lord-activity-label">Atacando</div>
        <div class="ov-lord-activity-dest">(${lsQueueItem.destX}, ${lsQueueItem.destY})</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` :
    lsIsQuesting ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--quest">
        <div class="ov-lord-activity-icon">&#128506;</div>
        <div class="ov-lord-activity-label">En Quest</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` :
    lsIsMoving ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--move">
        <div class="ov-lord-activity-icon">&#128694;</div>
        <div class="ov-lord-activity-label">Marchando</div>
        <div class="ov-lord-activity-dest">(${lsQueueItem.destX}, ${lsQueueItem.destY})</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` : '';

    const portraitSrc  = pickLordPortrait(_lord.race, _lord.classId, _lord.id) || _lord.portrait || race.portrait;
    const portraitHtml = portraitSrc
      ? `<div class="lsl-portrait-area lsl-portrait-area--image${lordIsDown ? ' lsl-portrait-area--down' : ''}">
           <img class="lsl-portrait-img" src="${portraitSrc}" alt="${_lord.name}" />
           <div class="lsl-portrait-fade"></div>
           <div class="lsl-portrait-glow" style="background:radial-gradient(ellipse at 50% 80%, ${race.portraitGlow || 'rgba(200,147,58,0.25)'} 0%, transparent 70%)"></div>
           ${downOverlay}${activityOverlay}
           <div class="lsl-portrait-level">Lv ${level}</div>
           <div class="lsl-portrait-nameplate">
             <span class="lsl-portrait-lord-name">${_lord.name}</span>
             <div class="lsl-portrait-badges">
               <span class="lsl-portrait-race-name">${race.name}</span>
               ${cls ? `<span class="lsl-portrait-class-name" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
             </div>
           </div>
         </div>`
      : `<div class="lsl-portrait-area${lordIsDown ? ' lsl-portrait-area--down' : ''}">
           <div class="lsl-portrait">${race.icon || '👤'}</div>
           ${downOverlay}${activityOverlay}
           <div class="lsl-portrait-level">Lv ${level}</div>
         </div>`;

    // Stat bars
    const talentPoints = _lord.talentPoints || 0;
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
            ${talentPoints > 0 ? `<button class="lsh-stat-plus" data-stat-key="${key}" title="Spend 1 talent point on ${meta.label}">+</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Chosen talent (replaces passive trait display)
    const chosenTalent = (typeof TALENT_POOL !== 'undefined' && _lord.talentId)
      ? TALENT_POOL[_lord.talentId]
      : null;
    const passiveHtml = chosenTalent ? `
      <div class="cvl-divider"></div>
      <div class="lsh-section">
        <div class="lsh-section-title">Talent</div>
        <div class="lsh-passive-card">
          <div class="lsh-passive-icon">${chosenTalent.icon}</div>
          <div class="lsh-passive-body">
            <div class="lsh-passive-name">${chosenTalent.name}</div>
            <div class="lsh-passive-desc">${chosenTalent.description}</div>
          </div>
        </div>
      </div>
    ` : '';

    // Mount slot — always shown (locked / empty "+" / equipped), click opens the Mount tab.
    const mountUnlocked = (_lord.level || 1) >= 5;
    const chosenMount   = (typeof MOUNT_POOL !== 'undefined' && _lord.mountId)
      ? MOUNT_POOL[_lord.mountId]
      : null;
    const mountSlotHtml = !mountUnlocked ? `
      <div class="lm-slot-card lm-slot-card--locked lm-slot-card--sm">
        <div class="lm-slot-plus">+</div>
        <div class="lm-slot-label">🔒 Unlocks at level 5</div>
      </div>`
      : chosenMount ? `
      <div class="lm-slot-card lm-slot-card--filled lm-slot-card--sm" style="border-color:${chosenMount.color}50" data-action="open-mount-tab">
        <div class="lm-slot-icon">${_mountVisual(chosenMount, 'lm-slot-icon-glyph')}</div>
        <div class="lm-slot-body">
          <div class="lm-slot-name" style="color:${chosenMount.color}">${chosenMount.name}</div>
          <div class="lm-stat-chips">${_mountEffectChips(chosenMount.effects)}</div>
        </div>
      </div>`
      : `
      <div class="lm-slot-card lm-slot-card--empty lm-slot-card--sm" data-action="open-mount-tab">
        <div class="lm-slot-plus">+</div>
        <div class="lm-slot-label">Equip a mount</div>
      </div>`;
    const mountHtml = `
      <div class="cvl-divider"></div>
      <div class="lsh-section">
        <div class="lsh-section-title">Mount</div>
        ${mountSlotHtml}
      </div>
    `;


    return `
      ${portraitHtml}

      <div class="lsl-info">
        ${portraitSrc ? '' : `
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
        <div class="lsh-section-title">
          Statistics
          ${talentPoints > 0 ? `<span class="lsh-pts-badge">${talentPoints} pt${talentPoints !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="lsh-stat-list">${statBarsHtml}</div>
      </div>

      ${passiveHtml}
      ${mountHtml}

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
    if (left) {
      left.innerHTML = _leftPanelHtml();
      document.querySelectorAll('.lsh-stat-plus[data-stat-key]').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const result = await ServerActions.spendTalents(_lord.id, { statKey: btn.dataset.statKey, statPoints: 1 });
          if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
        });
      });
      document.querySelector('#ls-left [data-action="open-mount-tab"]')?.addEventListener('click', () => {
        _activeTab       = 'mount';
        _mountPickerOpen = !_lord.mountId;
        document.querySelectorAll('.ls-tab').forEach(b => b.classList.toggle('ls-tab--active', b.dataset.tab === 'mount'));
        _renderTab();
        _startCountdown();
      });
    }
    document.getElementById('ls-revive-now')?.addEventListener('click', _reviveNow);

    // Force back to overview while downed
    if (LordService.isDown(_lord) && (_activeTab === 'army' || _activeTab === 'discovery')) {
      _activeTab = 'overview';
    }

    switch (_activeTab) {
      case 'overview':
        content.innerHTML = _overviewTabHtml();
        document.getElementById('lov-finish-lord')?.addEventListener('click', _finishLordActionNow);
        document.getElementById('lov-search-btn')?.addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          const result = await ServerActions.lordSearch(_lord.id);
          if (!result.ok) { e.currentTarget.disabled = false; _toast(result.error || 'Server error'); return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        document.getElementById('lov-scout-btn')?.addEventListener('click', async (e) => {
          e.currentTarget.disabled = true;
          const result = await ServerActions.lordScout(_lord.id);
          if (!result.ok) { e.currentTarget.disabled = false; _toast(result.error || 'Server error'); return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        document.getElementById('lov-move-btn')?.addEventListener('click', () => {
          _stopCountdown();
          App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id), mode: 'move-lord' });
        });
        // Stance picker — toggle Ambush / Raid selection
        document.querySelectorAll('.lov-stance-pick-btn[data-pick]').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.lov-stance-pick-btn').forEach(b => b.classList.remove('lov-stance-pick-btn--active'));
            btn.classList.add('lov-stance-pick-btn--active');
            const def    = STANCE_DEFS[btn.dataset.pick];
            const descEl = document.getElementById('lov-stance-desc');
            if (descEl && def) descEl.textContent = def.description;
            const startBtn = document.getElementById('lov-stance-start');
            if (startBtn) { startBtn.disabled = false; startBtn.dataset.stance = btn.dataset.pick; }
          });
        });
        document.getElementById('lov-stance-start')?.addEventListener('click', () => {
          const startBtn = document.getElementById('lov-stance-start');
          const stanceId = startBtn?.dataset?.stance;
          const secs     = Number(document.getElementById('lov-stance-dur')?.value || 3600);
          if (!stanceId) { _toast('Select a stance first.'); return; }
          const result   = LordService.enterStance(_lord, stanceId, secs);
          if (!result.ok) { _toast(result.error); return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        document.querySelector('.lov-stance-exit-btn')?.addEventListener('click', () => {
          LordService.exitStance(_lord);
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        break;
      case 'army':
        content.innerHTML = _armyHtml();
        _bindArmyEvents();
        break;
      case 'discovery':
        DiscoveryService.markLogSeen(_player.id);
        _refreshDiscoveryBadge();
        content.innerHTML = _discoveriesHtml();
        _bindDiscoveryEvents();
        break;
      case 'talents':
        content.innerHTML = _talentsTabHtml();
        _bindTalentsEvents();
        break;
      case 'mount':
        content.innerHTML = _mountTabHtml();
        _bindMountEvents();
        break;
      case 'battles':
        content.innerHTML = _battlesTabHtml();
        _bindBattlesTabEvents();
        break;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _unitPower(def) {
    if (!def) return 0;
    const s = def.combatStats || {};
    return (s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0);
  }

  function _armyPower(lordId) {
    const army = ArmyService.get(lordId);
    return army.units.reduce((sum, u) => sum + _unitPower(UNIT_DEFS[u.unitId]) * u.count, 0);
  }

  // Applies a discoveries[] response (from either /api/scan/tile or
  // /api/lord/scout-resolve — same shape) into IntelligenceService, deduping
  // by entity (lordId/cityId) and upgrading tier rather than stacking
  // duplicate records. Shared by the Scout action; search_area no longer
  // calls this — Scout is now the sole deliberate intel-gathering action.
  // Returns the resulting intel records (with their real qualityTier) so the
  // caller can build an accurate report — re-deriving the tier separately
  // could disagree with what buildRecord actually computed (rogue override,
  // prior-tier progression, etc.).
  function _applyIntelDiscoveries(discoveries) {
    const applied = [];
    (discoveries || []).forEach(disc => {
      const entityId = disc.rawData?.cityId || disc.rawData?.lordId || null;
      const existing = entityId
        ? IntelligenceService.getByType(_player.id, disc.type)
            .find(r => r.data && (r.data.cityId === entityId || r.data.lordId === entityId))
        : null;
      const alreadyKnown = !!existing;

      const intelRec = IntelligenceService.buildRecord(_lord, {
        type:        disc.type,
        tileX:       disc.tileX,
        tileY:       disc.tileY,
        ttl:         disc.ttl,
        currentTier: existing?.qualityTier ?? null,
        rawData:     disc.rawData,
      });

      if (!alreadyKnown) {
        IntelligenceService.addRecord(_player.id, intelRec);
      } else if (existing.qualityTier !== 'precise') {
        IntelligenceService.removeRecord(_player.id, existing.id);
        IntelligenceService.addRecord(_player.id, intelRec);
      }
      applied.push(intelRec);
    });
    return applied;
  }

  function _refreshDiscoveryBadge() {
    const btn = document.getElementById('ls-tab-discovery');
    if (!btn) return;
    const existing = btn.querySelector('.ls-tab-badge');
    const n = DiscoveryService.getUnseenCount(_player.id);
    if (n > 0 && !existing) {
      btn.insertAdjacentHTML('beforeend', `<span class="ls-tab-badge">${n}</span>`);
    } else if (n > 0 && existing) {
      existing.textContent = n;
    } else if (existing) {
      existing.remove();
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
      const isAttacking = queueItem.intent === 'attack';
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status ${isAttacking ? 'lov-status--attacking' : 'lov-status--traveling'}">
          ${isAttacking ? '⚔ ATACANDO — llegando a ('+queueItem.destX+', '+queueItem.destY+')' : '🗺 Traveling to ('+queueItem.destX+', '+queueItem.destY+')'}
        </div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill${isAttacking ? ' lov-fill--attack' : ''}" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          ${isAttacking ? '' : `<button class="ls-finish-btn" id="lov-finish-lord">⚡ ${cost}💎</button>`}
        </div>
      `;
    } else if (queueItem.actionId === 'search_area') {
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status lov-status--searching">🗺 Quest in progress…</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          <button class="ls-finish-btn" id="lov-finish-lord">⚡ ${cost}💎</button>
        </div>
      `;
    } else if (queueItem.actionId === 'scout') {
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status lov-status--scouting">🕵 Scouting in progress…</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          <button class="ls-finish-btn" id="lov-finish-lord">⚡ ${cost}💎</button>
        </div>
      `;
    }

    // ── Location card ─────────────────────────────────────────────
    let terrainHtml;
    if (_lord.x == null) {
      terrainHtml = `<p class="lov-pos-none">No position — claim a city to place your lord on the map.</p>`;
    } else {
      const terrain     = WorldService.getTerrain(_lord.x, _lord.y);
      const isSearching = busy && queueItem.actionId === 'search_area'; // action id kept for compat
      const isScouting  = busy && queueItem.actionId === 'scout';
      const isTraveling = busy && queueItem.actionId === 'move_lord';

      // Pending quests on this tile
      const tileDiscs = DiscoveryService.getActive(_player.id)
        .filter(r => r.tileX === _lord.x && r.tileY === _lord.y);
      const discCountHtml = tileDiscs.length > 0
        ? `<div class="lov-lc-disc">🗺 ${tileDiscs.length} pending quest${tileDiscs.length > 1 ? 's' : ''} on this tile</div>`
        : `<div class="lov-lc-disc lov-lc-disc--none">🗺 No quests here yet</div>`;

      // Search action
      let searchHtml;
      if (isSearching) {
        searchHtml = `<span class="lov-lc-busy">🗺 Quest in progress on this tile…</span>`;
      } else if (isScouting) {
        searchHtml = `<span class="lov-lc-busy">🕵 Scouting this tile…</span>`;
      } else if (!busy) {
        searchHtml = `
          <div class="lov-lc-btns">
            <button class="lov-search-btn" id="lov-search-btn">🗺 Send on Quest</button>
            <button class="lov-scout-btn" id="lov-scout-btn" title="Gather intel on this tile's enemy lord and city. Safe without an army; risks an ambush if scouting with one.">🕵 Scout</button>
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

    // ── Stance (own section, after Army) ─────────────────────────
    const stanceObj  = LordService.getStance(_lord);
    const stanceDef  = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
    const isInStance = LordService.isStanced(_lord);
    let stanceHtml;
    if (isInStance) {
      const sRemain   = Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000));
      const totalMs   = stanceObj.finishAt - stanceObj.startedAt;
      const elapsedMs = TimeService.now() - stanceObj.startedAt;
      const sPct      = totalMs > 0 ? Math.min(100, Math.floor((elapsedMs / totalMs) * 100)) : 0;
      stanceHtml = `
        <div class="lov-status lov-status--stanced">${stanceDef.icon} Stance: ${stanceDef.name}</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-stance-fill" style="width:${sPct}%"></div></div>
          <span class="lov-timer" id="lov-stance-timer">${TimeService.formatDuration(sRemain)}</span>
        </div>
        <div class="lov-stance-desc-inline">${stanceDef.description}</div>
        <button class="lov-stance-exit-btn">✕ Salir</button>
      `;
    } else {
      stanceHtml = `
        <div class="lov-stance-picker" id="lov-stance-picker">
          <div class="lov-stance-pick-row">
            <button class="lov-stance-pick-btn" data-pick="ambush"${busy ? ' disabled' : ''}>${STANCE_DEFS.ambush.icon} Ambush</button>
            <button class="lov-stance-pick-btn" data-pick="raid"${busy ? ' disabled' : ''}>${STANCE_DEFS.raid.icon} Raid</button>
            <select class="lov-stance-dur-sel" id="lov-stance-dur"${busy ? ' disabled' : ''}>
              <option value="3600">1h</option>
              <option value="7200">2h</option>
              <option value="14400">4h</option>
            </select>
            <button class="lov-stance-start-btn" id="lov-stance-start" disabled>Start</button>
          </div>
          <div class="lov-stance-pick-desc" id="lov-stance-desc">${busy ? 'Not available while the lord is busy' : 'Select a stance'}</div>
        </div>
      `;
    }

    // ── Army ──────────────────────────────────────────────────────
    // Army Power is the single capacity stat — both the informational
    // "how strong is my army" number AND the one the server actually
    // enforces for recruiting (server/actions/recruit.js). There is
    // deliberately no separate weight-based "CP" or stack-count "slot
    // limit" any more — two differently-scaled numbers the UI could never
    // keep in sync with was exactly the confusion this replaces.
    const army         = ArmyService.get(_lord.id);
    const totalUpkeep  = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
    const totalPower   = _armyPower(_lord.id);
    const maxPower     = LordService.getArmyPowerCap(_lord);
    const overPower    = totalPower > maxPower;
    const armyHtml    = army.units.length === 0
      ? `<p class="lov-pos-none">No troops mustered — recruit from the Army tab.</p>`
      : `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: false })}</div>
        <div class="la-army-total">
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
          <div class="lov-section-row">
            <div class="lov-section-title">Army</div>
            <span class="lov-army-power${overPower ? ' lov-army-power--over' : ''}" title="Army Power — the capacity that gates recruiting">⚔ ${totalPower} / ${maxPower} PWR</span>
          </div>
          ${armyHtml}
        </div>
        <div class="lov-section-divider"></div>
        <div class="lov-section">
          <div class="lov-section-title">Stance</div>
          ${stanceHtml}
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
    return CityService.getPlayerCities(_player.id).find(c => c.x === _lord.x && c.y === _lord.y) || null;
  }

  // ── Shared unit card builder ───────────────────────────────────

  function _cardTierClass(category) {
    if (category === 'mercenary') return 'la-unit-card--merc';
    if (category === 'elite' || category === 'cavalry') return 'la-unit-card--elite';
    if (category === 'monster') return 'la-unit-card--monster';
    if (category === 'legendary') return 'la-unit-card--legendary';
    return '';
  }

  function _buildUnitCard(def, { removable = false, currentHp, maxHp, modelIdx = 0 } = {}) {
    const tierClass = _cardTierClass(def.category);
    const hpMax  = maxHp     ?? def.combatStats.hp;
    const hpCur  = currentHp ?? hpMax;
    const hpPct  = Math.min(100, Math.max(0, Math.round((hpCur / hpMax) * 100)));
    const hpColor = hpPct > 60 ? '#4caf50' : hpPct > 30 ? '#ff9800' : '#f44336';
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
      ? `<button class="la-uc-remove" data-unit-id="${def.id}" data-model-idx="${modelIdx}" title="Dismiss 1">×</button>`
      : '';

    return `
      <div class="la-uc-wrap">
        <div class="la-unit-card${tierClass ? ' ' + tierClass : ''}">
          <div class="la-uc-top">
            <div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:${hpPct}%;background:${hpColor}"></div></div>
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
      const def   = UNIT_DEFS[stack.unitId];
      if (!def) return [];
      const maxHp = def.combatStats.hp;
      return Array.from({ length: stack.count }, (_, idx) => {
        // Front model (idx 0) may be damaged; models behind it are fresh
        const currentHp = idx === 0 ? (stack.currentHp ?? maxHp) : maxHp;
        return _buildUnitCard(def, { ...opts, currentHp, maxHp, modelIdx: idx });
      });
    }).join('');
  }

  // ── Unit Requirements panel ───────────────────────────────────

  function _unitRequirementsHtml() {
    const city       = _getLordCurrentCity();
    const raceRoster = UNIT_ROSTER[_lord.race];
    const race       = RACES[_lord.race];

    if (!raceRoster) {
      return `<p class="ur-empty">No unit roster defined for ${race?.name || _lord.race}.</p>`;
    }

    const cityNote = city
      ? `Requirements for <strong>${city.name}</strong>`
      : '<em>Your lord is not in a city — building levels are unavailable.</em>';

    const sections = Object.entries(raceRoster).map(([buildingId, levelMap]) => {
      const bldDef       = BUILDING_DEFS[buildingId];
      const currentLevel = city ? (city.buildings[buildingId] || 0) : -1;
      const allMinLevels = Object.keys(levelMap).map(Number);
      const maxRequired  = Math.max(...allMinLevels);

      const levelEntries = Object.entries(levelMap)
        .map(([lvl, unitIds]) => ({ minLevel: Number(lvl), unitIds }))
        .sort((a, b) => a.minLevel - b.minLevel);

      const unitsHtml = levelEntries.map(({ minLevel, unitIds }) =>
        unitIds.map(unitId => {
          const def      = UNIT_DEFS[unitId];
          if (!def) return '';
          const unlocked = currentLevel >= minLevel;
          const portrait = def.image
            ? `<img src="${def.image}" class="ur-unit-img" alt="${def.name}" loading="lazy">`
            : `<div class="ur-unit-img ur-unit-img--icon">${def.icon}</div>`;
          const tierClass = _cardTierClass(def.category);

          return `
            <div class="ur-unit-row ${unlocked ? 'ur-unit--unlocked' : 'ur-unit--locked'}">
              <div class="ur-unit-portrait ur-portrait${tierClass ? '--' + tierClass.replace('la-unit-card--','') : ''}">${portrait}</div>
              <div class="ur-unit-body">
                <div class="ur-unit-name">${def.name}</div>
                <div class="ur-unit-req-line">
                  ${unlocked
                    ? `<span class="ur-tag ur-tag--unlocked">✓ Desbloqueado</span>`
                    : `<span class="ur-tag ur-tag--locked">🔒 Requiere ${bldDef?.name || buildingId} Lv ${minLevel}</span>`}
                  ${!unlocked && currentLevel > 0
                    ? `<span class="ur-tag ur-tag--progress">Tienes Lv ${currentLevel}</span>`
                    : ''}
                </div>
                <div class="ur-unit-stats">
                  <span title="Attack">⚔ ${def.combatStats.attack}</span>
                  <span title="Defense">🛡 ${def.combatStats.defense}</span>
                  <span title="HP">❤ ${def.combatStats.hp}</span>
                  <span title="Speed">💨 ${def.combatStats.speed}</span>
                </div>
                <div class="ur-unit-cost">💰 ${def.goldCost} · ⏱ ${TimeService.formatDuration(def.recruitTime)} · 💸 ${def.upkeep}/24h</div>
              </div>
              <div class="ur-unit-status-icon">${unlocked ? '✓' : '🔒'}</div>
            </div>
          `;
        }).join('')
      ).join('');

      const bldStatusClass = currentLevel < 0 ? '' :
                             currentLevel === 0 ? 'ur-bld--missing' :
                             currentLevel < maxRequired ? 'ur-bld--partial' : 'ur-bld--complete';

      const bldLevelLabel = currentLevel < 0 ? '—'
                          : currentLevel === 0 ? 'No construido'
                          : `Lv ${currentLevel} / ${bldDef?.maxLevel || '?'}`;

      return `
        <div class="ur-building-group">
          <div class="ur-building-header ${bldStatusClass}">
            <span class="ur-bld-icon">${bldDef?.icon || '🏛'}</span>
            <div class="ur-bld-name-wrap">
              <span class="ur-bld-name">${bldDef?.name || buildingId}</span>
              <span class="ur-bld-desc">${bldDef?.description?.split('.')[0] || ''}</span>
            </div>
            <span class="ur-bld-level">${bldLevelLabel}</span>
          </div>
          <div class="ur-units">${unitsHtml}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="ur-city-note">${cityNote}</div>
      ${sections}
    `;
  }

  function _armyHtml() {
    const army        = ArmyService.get(_lord.id);
    const city        = _getLordCurrentCity();
    const player      = PlayerService.getById(_player.id);
    const isTraveling = _lord.actionQueue.length > 0 && _lord.actionQueue[0].actionId === 'move_lord';

    // Army Power is the single capacity stat — see the identical note in
    // _overviewTabHtml(). It's both informational (shown as a badge) and
    // the real, server-enforced recruit limit (server/actions/recruit.js
    // and hire-merc.js both gate on this exact same calculation).
    const currentPower = _armyPower(_lord.id);
    const maxPower      = LordService.getArmyPowerCap(_lord);
    const overPower      = currentPower > maxPower;

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
      const totalUpkeep = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
      armyListHtml = `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: true })}</div>
        <div class="la-army-total">
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
              <div class="la-bar"><div class="la-fill" id="la-recruit-fill" style="transform:scaleX(${pct / 100})"></div></div>
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
          const def        = UNIT_DEFS[unitId];
          if (!def) return '';
          const canAfford  = (player.coins || 0) >= def.goldCost;
          const unitPower  = _unitPower(def);
          const wouldExceedPower = currentPower + unitPower > maxPower;
          const disabled   = busy || !canAfford || wouldExceedPower;
          const btnLabel   = busy ? 'Training…' : wouldExceedPower ? '⚠ Power Limit' : canAfford ? 'Recruit' : 'No gold';
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

    // ── Mercenaries (from active camp discoveries) ──────────────
    const mercDiscoveries = RecruitmentService.getAvailableFromDiscoveries(_player.id);
    let mercHtml = '';
    if (mercDiscoveries.length > 0) {
      const cityQueue  = city ? (city.recruitmentQueue || []) : [];
      const cityBusy   = cityQueue.length > 0;
      const mercGroups = mercDiscoveries.map(record => {
        const discDef = DISCOVERY_DEFS[record.definitionId];
        const cards   = (CAMP_DEFS[record.definitionId]?.mercenaryRoster || []).map(unitId => {
          const def        = UNIT_DEFS[unitId];
          if (!def) return '';
          const canAfford  = (player.coins || 0) >= def.goldCost;
          const unitPower  = _unitPower(def);
          const wouldExceedPower = currentPower + unitPower > maxPower;
          const disabled   = !canAfford || wouldExceedPower;
          const btnLabel   = wouldExceedPower ? '⚠ Power Limit' : canAfford ? 'Hire' : 'No gold';
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
        <div class="la-section-header-row">
          <div class="la-section-title">Army</div>
          <span class="la-army-power${overPower ? ' la-army-power--over' : ''}" title="Army Power — the capacity that gates recruiting">⚔ ${currentPower} / ${maxPower} PWR</span>
        </div>
        ${armyListHtml}
        <div class="la-section-divider"></div>
        <div class="la-section-header-row">
          <div class="la-section-title">Recruit</div>
          <button class="ur-open-btn" id="ur-open-btn">📋 View Requirements</button>
        </div>
        ${recruitSectionHtml}
        ${mercHtml}
      </div>
    `;
  }

  function _bindArmyEvents() {
    // Unit requirements panel
    document.getElementById('ur-open-btn')?.addEventListener('click', () => {
      const body    = document.getElementById('unit-req-body');
      const overlay = document.getElementById('unit-req-overlay');
      if (!body || !overlay) return;
      body.innerHTML = _unitRequirementsHtml();
      overlay.classList.remove('hidden');
    });

    // Finish recruitment instantly
    document.getElementById('la-finish-recruit')?.addEventListener('click', _finishRecruitmentNow);

    // Dismiss unit from army — click once to arm, click again within 3s to confirm
    document.querySelectorAll('.la-uc-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!btn.classList.contains('la-uc-remove--confirm')) {
          btn.classList.add('la-uc-remove--confirm');
          btn.title = 'Click again to confirm dismissal';
          clearTimeout(btn._confirmTimer);
          btn._confirmTimer = setTimeout(() => {
            btn.classList.remove('la-uc-remove--confirm');
            btn.title = 'Dismiss 1';
          }, 3000);
          return;
        }
        clearTimeout(btn._confirmTimer);
        btn.disabled = true;
        const unitId   = btn.dataset.unitId;
        const modelIdx = parseInt(btn.dataset.modelIdx || '0', 10);
        const result   = await ServerActions.disbandUnit(_lord.id, unitId, modelIdx);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        const def = UNIT_DEFS[unitId];
        if (def) _toast(`${def.icon} ${def.name} dismissed.`);
        _renderTab();
      });
    });

    // City recruitment
    document.querySelectorAll('.la-recruit-btn[data-unit-id]:not(.la-hire-btn):not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const city = _getLordCurrentCity();
        if (!city) { _toast('Must be at your city to recruit.'); return; }
        btn.disabled = true;
        const result = await ServerActions.recruit(_lord.id, city.id, btn.dataset.unitId, 1);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _renderTab();
        _startCountdown();
      });
    });

    // Mercenary instant hire
    document.querySelectorAll('.la-hire-btn[data-unit-id]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const unitId = btn.dataset.unitId;
        const def    = UNIT_DEFS[unitId];
        if (!def) return;
        btn.disabled = true;
        const result = await ServerActions.hireMerc(_lord.id, unitId);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        _toast(`${def.icon} ${def.name} hired!`);
        _renderTab();
      });
    });
  }

  // ── Discovery tab ─────────────────────────────────────────────

  function _timeAgo(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)          return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)          return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)          return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function _discoveriesHtml() {
    const log = DiscoveryService.getLog(_player.id);

    if (log.length === 0) {
      return `
        <div class="la-placeholder">
          <div class="la-placeholder-icon">🗺</div>
          <div class="la-placeholder-text">No quests yet</div>
          <div class="la-placeholder-sub">Use <strong>Send on Quest</strong> to explore this tile.</div>
        </div>`;
    }

    const _CATEGORY_LABELS = {
      nothing: 'Exploration', resource: 'Resource', combat: 'Combat',
      event: 'Event', trade: 'Trade', legendary: 'Legendary', intelligence: 'Intelligence',
    };
    const _TIER_ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

    const entries = log.map((entry, idx) => {
      const def       = DISCOVERY_DEFS[entry.definitionId];
      const isNothing = !def || def.category === 'nothing';
      const isCombat  = def && _ACTION_CATEGORIES.has(def.category);
      const terrain   = TERRAIN_TYPES[entry.terrain] || { icon: '🌍', name: entry.terrain || 'Unknown' };
      const ago       = _timeAgo(TimeService.now() - entry.loggedAt);
      const icon      = def ? def.icon : '❓';
      const name      = isNothing ? 'Nothing Found' : (def ? def.name : 'Quest');
      const code      = `RPT-${String(log.length - idx).padStart(3, '0')}`;

      // ── Outcome kind — drives the badge, left-accent border, and card colour ──
      let kind, kindLabel;
      if (entry.wasAttack) {
        const won = entry.combatOutcome === 'victory';
        kind      = won ? 'win' : 'loss';
        kindLabel = won ? 'Victory' : 'Defeat';
      } else if (isCombat) {
        kind = 'camp'; kindLabel = 'Camp Found';
      } else if (isNothing) {
        kind = 'nothing'; kindLabel = 'Nothing';
      } else {
        kind = 'found'; kindLabel = 'Found';
      }

      const categoryLabel = _CATEGORY_LABELS[def?.category] || 'Unknown';
      const tierLabel      = def?.tier ? _TIER_ROMAN[def.tier] || def.tier : '—';

      // ── Quote / scout report ──
      const quoteHtml = entry.narrative ? `<blockquote class="qd-quote">${entry.narrative}</blockquote>` : '';

      // ── Outcome / spoils body ──
      let bodyHtml = '';
      if (entry.wasAttack) {
        const won = entry.combatOutcome === 'victory';
        const cls = won ? 'qd-banner--win' : 'qd-banner--loss';
        const sub = won
          ? 'The camp has been cleared and its spoils taken.'
          : 'Your forces were repelled. The camp still stands.';
        const canViewReport = entry.lordId && entry.lordId === _lord.id;
        bodyHtml = `
          <div class="qd-banner ${cls}">
            <span class="qd-banner-icon">${won ? '⚔' : '☠'}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${kindLabel}</div>
              <div class="qd-banner-sub">${sub}</div>
            </div>
          </div>
          ${canViewReport
            ? `<button class="qd-battle-link" data-view-battles="1">📜 View Battle Report</button>`
            : `<div class="qd-hint">Full battle report in the Battles tab.</div>`}`;
      } else if (isCombat) {
        const defDesc      = def?.description || '';
        const activeRecord = entry.recordId ? DiscoveryService.getActive(_player.id).find(r => r.id === entry.recordId) : null;
        const campPreview  = activeRecord?.campDetails ? _campPreviewHtml(activeRecord.campDetails) : '';
        bodyHtml = `
          <div class="qd-banner qd-banner--camp">
            <span class="qd-banner-icon">${icon}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${name}</div>
              ${defDesc ? `<div class="qd-banner-sub">${defDesc}</div>` : ''}
            </div>
          </div>
          ${campPreview}
          <div class="qd-hint">📍 Visible on the map at (${entry.tileX}, ${entry.tileY}). Move your lord there and attack when ready.</div>`;
      } else if (!isNothing && entry.rewards && entry.rewards.length > 0) {
        const rows = entry.rewards
          .filter(r => _RES_ICONS[r.type] && r.amount > 0)
          .map(r => `
            <div class="qd-spoils-row">
              <span class="qd-spoils-icon">${_RES_ICONS[r.type]}</span>
              <span class="qd-spoils-name">${r.type}</span>
              <span class="qd-spoils-value">+${r.amount}</span>
            </div>`)
          .join('');
        if (rows) {
          bodyHtml = `
            <div class="qd-spoils">
              <div class="qd-spoils-label">Spoils of the Quest</div>
              <div class="qd-spoils-list">${rows}</div>
            </div>`;
        }
      } else if (isNothing) {
        bodyHtml = `
          <div class="qd-banner qd-banner--nothing">
            <span class="qd-banner-icon">—</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">Nothing Found</div>
              <div class="qd-banner-sub">The area yielded no discoveries this time. Try again later or explore a different tile.</div>
            </div>
          </div>`;
      }

      return `
        <details class="qd-card qd-card--${kind}">
          <summary class="qd-row">
            <span class="qd-row-icon">${icon}</span>
            <div class="qd-row-body">
              <span class="qd-row-title">${name}</span>
              <span class="qd-row-sub">${terrain.icon} ${terrain.name} · (${entry.tileX ?? '?'}, ${entry.tileY ?? '?'})${entry.lordName ? ` · ${entry.lordName}` : ''}</span>
            </div>
            <span class="qd-pill qd-pill--${kind}">${kindLabel}</span>
            <span class="qd-row-time">${ago}</span>
          </summary>
          <div class="qd-panel">
            <div class="qd-panel-header">
              <div class="qd-panel-heading">
                <span class="qd-dossier-code">Field Report · ${code}</span>
                <h3 class="qd-panel-title">${icon} ${name}</h3>
                <div class="qd-panel-byline">${entry.lordName ? `Scouted by <strong>${entry.lordName}</strong> · ` : ''}${terrain.icon} ${terrain.name} · (${entry.tileX ?? '?'}, ${entry.tileY ?? '?'})</div>
              </div>
              <span class="qd-pill qd-pill--lg qd-pill--${kind}">${kindLabel}</span>
            </div>
            ${quoteHtml}
            <div class="qd-stats">
              <div class="qd-stat"><span class="qd-stat-label">Category</span><span class="qd-stat-value">${categoryLabel}</span></div>
              <div class="qd-stat"><span class="qd-stat-label">Tier</span><span class="qd-stat-value">${tierLabel}</span></div>
              <div class="qd-stat"><span class="qd-stat-label">Reported</span><span class="qd-stat-value">${ago}</span></div>
            </div>
            ${bodyHtml}
            <button class="qd-dismiss" data-log-id="${entry.id}">✕ Dismiss report</button>
          </div>
        </details>`;
    }).join('');

    return `
      <div class="disc-tab-body">
        <div class="disc-section-label">📋 Quest History</div>
        <div class="disc-log-list">${entries}</div>
      </div>`;
  }

  const _RES_ICONS = { gold: '💰', wood: '🪵', stone: '⛏', iron: '⚒', food: '🌾', xp: '⭐' };
  const _ACTION_CATEGORIES = new Set(['combat']);

  function _campPreviewHtml(cd) {
    if (!cd) return '';
    const campDef = CAMP_DEFS[cd.type] || {};
    const chips = cd.defenders.map(d => {
      const def = UNIT_DEFS[d.unitId];
      return `<span class="camp-unit-chip">${def?.icon || '⚔'} ${def?.name || d.unitId} ×${d.count}</span>`;
    }).join('');
    return `
      <div class="camp-preview">
        <div class="camp-preview-header">
          <span class="camp-level-badge">Level ${cd.level}</span>
          <span class="camp-type-label">${campDef.icon || '⚔'} ${campDef.displayName || cd.type}</span>
        </div>
        <div class="camp-unit-chips">${chips}</div>
      </div>`;
  }

  // ── Battles tab ───────────────────────────────────────────────

  // ── Talents tab ───────────────────────────────────────────────

  function _talentsTabHtml() {
    const level        = _lord.level || 1;
    const points       = _lord.talentPoints || 0;
    const chosenId     = _lord.talentId;
    const chosenTalent = chosenId ? TALENT_POOL[chosenId] : null;
    const effective    = LordService.getEffectiveStats(_lord);

    // Section 1 — Talent selection
    let talentSectionHtml = '';
    if (level < 5) {
      talentSectionHtml = `
        <div class="lt-locked-notice">
          <div class="lt-locked-icon">🔒</div>
          <div class="lt-locked-text">Talent selection unlocks at <strong>level 5</strong>.</div>
          <div class="lt-locked-hint">Level up your lord to choose a permanent talent.</div>
        </div>`;
    } else if (chosenTalent) {
      talentSectionHtml = `
        <div class="lt-chosen-card" style="border-color:${chosenTalent.color}30">
          <div class="lt-chosen-icon" style="color:${chosenTalent.color}">${chosenTalent.icon}</div>
          <div class="lt-chosen-body">
            <div class="lt-chosen-name" style="color:${chosenTalent.color}">${chosenTalent.name}</div>
            <div class="lt-chosen-category">${chosenTalent.category === 'combat' ? '⚔ Combat' : '🗺 Strategic'}</div>
            <div class="lt-chosen-desc">${chosenTalent.description}</div>
          </div>
          <div class="lt-chosen-badge">Permanent</div>
        </div>`;
    } else {
      // Group by category
      const combatTalents    = Object.values(TALENT_POOL).filter(t => t.category === 'combat');
      const strategicTalents = Object.values(TALENT_POOL).filter(t => t.category === 'strategic');

      const renderCards = (talents) => talents.map(t => `
        <div class="lt-talent-card" style="border-color:${t.color}40">
          <div class="lt-talent-header">
            <span class="lt-talent-icon" style="color:${t.color}">${t.icon}</span>
            <span class="lt-talent-name">${t.name}</span>
          </div>
          <div class="lt-talent-desc">${t.description}</div>
          <div class="lt-talent-hint">${t.hint}</div>
          <button class="lt-choose-btn" data-talent-id="${t.id}" style="border-color:${t.color};color:${t.color}">Choose</button>
        </div>`).join('');

      talentSectionHtml = `
        <div class="lt-group-label">⚔ Combat Talents</div>
        <div class="lt-talent-grid">${renderCards(combatTalents)}</div>
        <div class="lt-group-label">🗺 Strategic Talents</div>
        <div class="lt-talent-grid">${renderCards(strategicTalents)}</div>`;
    }

    return `
      <div class="lt-container">
        <div class="lt-section">
          <div class="lt-section-title">✨ Talent</div>
          ${talentSectionHtml}
        </div>
      </div>`;
  }

  async function _bindTalentsEvents() {
    document.querySelectorAll('.lt-choose-btn[data-talent-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.spendTalents(_lord.id, { talentId: btn.dataset.talentId });
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _lord = LordService.getById(_lord.id);
        _renderTab();
      });
    });

    document.querySelectorAll('.lt-stat-btn[data-stat-key]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.spendTalents(_lord.id, { statKey: btn.dataset.statKey, statPoints: 1 });
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _lord = LordService.getById(_lord.id);
        _renderTab();
      });
    });
  }

  // Small chip row for a mount's flat stat bonuses, e.g. "+2 ⚔  +2 💨".
  function _mountEffectChips(effects) {
    return Object.entries(effects || {})
      .map(([key, val]) => {
        const meta = LORD_STAT_META[key];
        if (!meta || !val) return '';
        return `<span class="lm-stat-chip">+${val} ${meta.icon}</span>`;
      }).join('');
  }

  // Mount artwork if set (MOUNT_POOL[id].image), else a large icon fallback.
  function _mountVisual(m, iconClass) {
    return m.image
      ? `<img src="${m.image}" class="lm-mount-img" alt="${m.name}" loading="lazy">`
      : `<span class="${iconClass}" style="color:${m.color}">${m.icon}</span>`;
  }

  function _mountTabHtml() {
    const level     = _lord.level || 1;
    const unlocked  = level >= 5;
    const chosenId  = _lord.mountId;
    const chosen    = chosenId ? MOUNT_POOL[chosenId] : null;
    const picking   = unlocked && _mountPickerOpen;
    const coins     = _player?.coins || 0;

    let slotHtml = '';
    if (!unlocked) {
      slotHtml = `
        <div class="lm-slot-card lm-slot-card--locked">
          <div class="lm-slot-plus">+</div>
          <div class="lm-slot-label">🔒 Unlocks at level 5</div>
        </div>`;
    } else if (chosen && !picking) {
      slotHtml = `
        <div class="lm-slot-card lm-slot-card--filled" style="border-color:${chosen.color}50" data-action="open-picker">
          <div class="lm-slot-icon">${_mountVisual(chosen, 'lm-slot-icon-glyph')}</div>
          <div class="lm-slot-body">
            <div class="lm-slot-name" style="color:${chosen.color}">${chosen.name}</div>
            <div class="lm-stat-chips">${_mountEffectChips(chosen.effects)}</div>
          </div>
          <button class="lm-change-btn">Change</button>
        </div>`;
    } else if (!picking) {
      slotHtml = `
        <div class="lm-slot-card lm-slot-card--empty" data-action="open-picker">
          <div class="lm-slot-plus">+</div>
          <div class="lm-slot-label">Equip a mount</div>
        </div>`;
    }

    const pickerHtml = picking ? `
      <div class="lm-mount-grid">
        ${Object.values(MOUNT_POOL).map(m => {
          const isEquipped = m.id === chosenId;
          const canAfford  = isEquipped || coins >= (m.cost || 0);
          const disabled   = isEquipped || !canAfford;
          const btnLabel   = isEquipped ? 'Equipped' : canAfford ? 'Equip' : 'No gold';
          return `
          <div class="lm-mount-card" style="border-color:${m.color}40">
            <div class="lm-mount-visual">${_mountVisual(m, 'lm-mount-icon-lg')}</div>
            <div class="lm-mount-header">
              <span class="lm-mount-name" style="color:${m.color}">${m.name}</span>
              <span class="lm-mount-cost${canAfford ? '' : ' lm-mount-cost--short'}">💰${m.cost || 0}</span>
            </div>
            <div class="lm-stat-chips">${_mountEffectChips(m.effects)}</div>
            <button class="lm-choose-btn" data-mount-id="${m.id}" style="border-color:${m.color};color:${m.color}" ${disabled ? 'disabled' : ''}>${btnLabel}</button>
          </div>`;
        }).join('')}
      </div>
      <button class="lm-cancel-btn">Cancel</button>
    ` : '';

    return `
      <div class="lm-container">
        <div class="lm-section">
          <div class="lm-section-title">🐎 Mount</div>
          ${slotHtml}
          ${pickerHtml}
        </div>
      </div>`;
  }

  function _bindMountEvents() {
    document.querySelectorAll('.lm-slot-card[data-action="open-picker"]').forEach(el => {
      el.addEventListener('click', () => {
        _mountPickerOpen = true;
        _renderTab();
      });
    });

    document.querySelector('.lm-change-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      _mountPickerOpen = true;
      _renderTab();
    });

    document.querySelector('.lm-cancel-btn')?.addEventListener('click', () => {
      _mountPickerOpen = false;
      _renderTab();
    });

    document.querySelectorAll('.lm-choose-btn[data-mount-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.spendMount(_lord.id, btn.dataset.mountId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _lord   = LordService.getById(_lord.id);
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        const mount = MOUNT_POOL[btn.dataset.mountId];
        _toast(`${mount?.icon || '🐎'} ${mount?.name || 'Mount'} equipped!`);
        _mountPickerOpen = false;
        _renderTab();
      });
    });
  }

  const _OUTCOME_META = {
    victory: { label: 'Victory', icon: '⚔', css: 'bh-victory' },
    defeat:  { label: 'Defeat',  icon: '☠', css: 'bh-defeat'  },
    draw:    { label: 'Draw',    icon: '🤝', css: 'bh-draw'    },
  };

  const _REASON_LABELS_TAB = {
    eliminated: 'Total Elimination',
    routed:     'Routed',
    retreated:  'Retreat',
    max_rounds: 'Max Duration',
  };

  function _battlesTabHtml() {
    const battles = BattleHistoryService.getForLord(_lord.id);

    if (battles.length === 0) {
      return `
        <div class="bh-empty">
          <div class="bh-empty-icon">🗡</div>
          <p class="bh-empty-msg">No battles recorded yet.</p>
          <p class="bh-empty-hint">Attack a camp from the Quests tab.</p>
        </div>`;
    }

    const rows = battles.map((b, idx) => {
      const om     = _OUTCOME_META[b.outcome] || _OUTCOME_META.defeat;
      const date   = new Date(b.at).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
      const time   = new Date(b.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const resLoot = b.outcome === 'victory'
        ? Object.entries(b.resourceLoot || {}).map(([t, amt]) => `+${amt}${_RES_ICONS[t] || ''} · `).join('')
        : '';
      const loot   = (b.outcome === 'victory' && b.goldEarned > 0 ? `+${b.goldEarned}💰 · ` : '') + resLoot;
      return `
        <div class="bh-entry ${om.css}" data-bh-idx="${idx}">
          <div class="bh-entry-header">
            <span class="bh-outcome-badge ${om.css}">${om.icon} ${om.label}</span>
            <span class="bh-camp-name">${b.campIcon || '⚔'} ${b.campName}</span>
            <span class="bh-date">${date} ${time}</span>
          </div>
          ${b.lordLevel ? `<div class="bh-lord-sub mip-value--muted">${_lord.name} · Lv ${b.lordLevel}</div>` : ''}
          <div class="bh-entry-stats">
            <span>Rounds: <strong>${b.rounds}</strong></span>
            <span>Losses: <strong>${b.modelsLost}</strong></span>
            <span>${loot}+${b.xpEarned}⭐</span>
            <span class="bh-reason">${_REASON_LABELS_TAB[b.reason] || b.reason}</span>
          </div>
          <button class="bh-log-toggle" data-bh-idx="${idx}">📜 View Report</button>
          <div class="bh-log-body hidden" id="bh-log-${idx}">
            ${b.report ? _battleLogHtml(b.report) : '<em>Report unavailable</em>'}
          </div>
        </div>`;
    }).join('');

    return `<div class="bh-list">${rows}</div>`;
  }

  function _battleLogHtml(report) {
    return BattleResultView.inlineReportHtml(report, _lord);
  }

  function _bindBattlesTabEvents() {
    document.querySelectorAll('.bh-log-toggle[data-bh-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(`bh-log-${btn.dataset.bhIdx}`);
        if (body) body.classList.toggle('hidden');
      });
    });
  }

  // ── Quest resolution ──────────────────────────────────────────
  // The discovery roll, XP, and rewards are now all computed server-side
  // in catchUp (via loadAndCatchUp inside quest-resolve). The client just
  // calls the endpoint and presents the result.

  async function _resolveSearch() {
    if (_resolvingSearch) return;
    _resolvingSearch = true;
    try {
    const oldLevel = _lord.level || 1;
    const result   = await ServerActions.questResolve(_lord.id);
    if (!result.ok) {
      _toast(result.error || 'Quest error — please refresh');
      return;
    }

    // Hydrate from server response (XP, coins, resources already applied server-side).
    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    if ((_lord.level || 1) > oldLevel) _toast(`⭐ Level up! Now level ${_lord.level}.`);

    const discoveries = result.discoveries || [];
    if (discoveries.length === 0) {
      _toast('🗺 Quest complete — see Quests tab');
      _refreshDiscoveryBadge();
      _renderTab();
      HUD.refresh();
      return;
    }

    for (const pending of discoveries) {
      _applyQuestResult(pending);
    }
    _refreshDiscoveryBadge();
    _renderTab();
    HUD.refresh();
    } finally {
      _resolvingSearch = false;
    }
  }

  // Called when a 'scout' action completes. /api/lord/scout-resolve does the
  // actual ambush-check + intel-gathering server-side (it has cross-player
  // admin access this client never does) and returns either tiered intel
  // discoveries or a full ambush battle report — never both, being caught
  // replaces the scouting result.
  let _resolvingScout = false;
  async function _resolveScout() {
    if (_resolvingScout) return;
    _resolvingScout = true;
    try {
      const x = _lord.x, y = _lord.y;
      const knownTiers = {};
      if (x != null) {
        IntelligenceService.getByType(_player.id, 'enemy_city')
          .filter(r => r.tileX === x && r.tileY === y)
          .forEach(r => { if (r.data?.cityId) knownTiers[r.data.cityId] = r.qualityTier; });
        IntelligenceService.getByType(_player.id, 'enemy_lord')
          .filter(r => r.tileX === x && r.tileY === y)
          .forEach(r => { if (r.data?.lordId) knownTiers[r.data.lordId] = r.qualityTier; });
      }

      const result = await ServerActions.scoutResolve(_lord.id, knownTiers);
      if (!result.ok) {
        _toast(result.error || 'Scout error — please refresh');
        return;
      }

      if (result.outcome === 'ambushed') {
        // Full PvP battle already resolved+persisted server-side (same
        // pipeline as any other PvP fight) — refresh so HP/downtime/activity
        // feed reflect it immediately instead of waiting for the next poll.
        await ServerActions.syncNow();
        _lord   = LordService.getById(_lord.id);
        _player = PlayerService.getById(_player.id);
        const outcome = result.report?.winner === 'defender' ? 'repelled' : result.report?.winner === 'draw' ? 'draw' : 'caught';
        _toast(outcome === 'repelled' ? '🛡 Ambushed — but you fought them off!' : outcome === 'draw' ? '🤝 Ambushed — battle was a draw' : '☠ Ambushed! No intel gathered — see Battles tab');
        _activeTab = 'battles';
      } else if (result.outcome === 'intel') {
        const applied = _applyIntelDiscoveries(result.discoveries);
        const gained   = applied.length;
        _toast(gained > 0 ? `🕵 Scouting complete — ${gained} report${gained > 1 ? 's' : ''} gathered` : '🕵 Scouting complete — nothing on this tile');

        // Persistent notification with the findings attached — City/Lord
        // name plus a rough "how much do we know" percentage derived from
        // the actual tier IntelligenceService recorded (vague/clear/precise
        // → 33/66/100%), not just an icon and a name.
        const _TIER_PCT = { vague: 33, clear: 66, precise: 100 };
        const cityParts = applied
          .filter(r => r.type === 'enemy_city')
          .map(r => `City: ${r.data?.name || 'Unknown'} (${_TIER_PCT[r.qualityTier] || 0}%)`);
        const lordParts = applied
          .filter(r => r.type === 'enemy_lord')
          .map(r => `Lord: ${r.data?.lordName || 'Unknown'} (${_TIER_PCT[r.qualityTier] || 0}%)`);
        const summary = [...cityParts, ...lordParts].join(' · ');
        ActivityService.log(_player.id, {
          type:  'scout_result',
          icon:  '🕵',
          title: gained > 0 ? 'Scout report ready' : 'Scout complete — nothing found',
          detail: x != null ? `(${x}, ${y})${summary ? ' · ' + summary : ' · tile was empty'}` : '',
          lordName: _lord.name,
        });
      }

      _refreshDiscoveryBadge();
      _renderTab();
      HUD.refresh();
    } finally {
      _resolvingScout = false;
    }
  }

  // Handle one server-resolved quest result — add to log, add record to storage if needed.
  function _applyQuestResult(pending) {
    const { defId, category, record, rewards } = pending;
    const def = DISCOVERY_DEFS?.[defId];
    if (!def) return;

    const terrainId = record?.terrain || (_lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains');
    const narrative = pickQuestNarrative(def, terrainId);

    if (category === 'nothing') {
      DiscoveryService.addLog(_player.id, {
        definitionId: defId,
        tileX: record?.tileX ?? _lord.x, tileY: record?.tileY ?? _lord.y,
        terrain: terrainId, rewards: [], narrative,
        lordId: _lord.id, lordName: _lord.name,
      });
      _toast('🗺 Quest complete — nothing found');
      return;
    }

    if (record && def.intelType) {
      const intelRec = IntelligenceService.buildRecord(_lord, {
        type: def.intelType, tileX: record.tileX, tileY: record.tileY,
        ttl: def.baseDuration || null, rawData: { resourceType: def.name },
      });
      IntelligenceService.addRecord(_player.id, intelRec);
    }

    if (_ACTION_CATEGORIES.has(category)) {
      // Combat discovery: store the record so the player can attack it from the quest log/map.
      const all = StorageService.get('discoveries') || {};
      if (!all[_player.id]) all[_player.id] = [];
      all[_player.id].push(record);
      StorageService.set('discoveries', all);

      DiscoveryService.addLog(_player.id, {
        definitionId: defId, tileX: record.tileX, tileY: record.tileY,
        terrain: record.terrain, rewards: [], recordId: record.id, narrative,
        lordId: _lord.id, lordName: _lord.name,
      });
      ActivityService.log(_player.id, {
        type: 'discovery', icon: def.icon || '🗺',
        title: `${def.name} discovered`, detail: `(${record.tileX}, ${record.tileY})`,
        lordName: _lord.name,
      });
      _toast(`${def.icon} ${def.name} spotted — attack from the map`);
    } else {
      // Non-combat: gold/resources/XP already applied server-side; just show the log.
      DiscoveryService.addLog(_player.id, {
        definitionId: defId, tileX: record.tileX, tileY: record.tileY,
        terrain: record.terrain, rewards, narrative,
        lordId: _lord.id, lordName: _lord.name,
      });
      const rewardStr = rewards.filter(r => r.type !== 'xp').map(r => `+${r.amount} ${r.type}`).join(', ');
      ActivityService.log(_player.id, {
        type: 'discovery', icon: def.icon || '🗺',
        title: `${def.name} claimed`,
        detail: rewardStr || `+${rewards.find(r => r.type === 'xp')?.amount || 0}⭐`,
        lordName: _lord.name,
      });
      _toast(`${def.icon} ${def.name} — see Quests tab`);
    }
  }

  // ── Discovery claim ───────────────────────────────────────────

  function _bindDiscoveryEvents() {
    document.querySelectorAll('.qd-dismiss[data-log-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); // prevent toggling the <details> parent
        DiscoveryService.dismissLog(_player.id, btn.dataset.logId);
        _renderTab();
      });
    });
    document.querySelectorAll('.qd-battle-link[data-view-battles]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        _activeTab = 'battles';
        document.querySelectorAll('.ls-tab').forEach(b => b.classList.toggle('ls-tab--active', b.dataset.tab === 'battles'));
        _renderTab();
      });
    });
  }

  // Called when player clicks "⚔ Attack" on a combat discovery
  async function _claimDiscovery(recordId) {
    // Read the record WITHOUT removing it so it stays available on defeat/draw.
    const record = DiscoveryService.getActive(_player.id).find(r => r.id === recordId);
    if (!record) { _toast('Camp no longer available.'); return; }
    const def = DISCOVERY_DEFS[record.definitionId];
    if (!def || def.category !== 'combat') return;

    // Build encounter dynamically from campDetails stored in the record
    const cd       = record.campDetails;
    const campDef  = CAMP_DEFS[cd?.type] || CAMP_DEFS[def.id] || {};
    const baseLoot = CAMP_LEVEL_LOOT[cd?.level] || CAMP_LEVEL_LOOT[1];
    const mult     = campDef.rewardMultiplier || 1.0;
    const encounter = {
      name:           `${campDef.displayName || 'Bandit Camp'}${cd ? ` (Level ${cd.level})` : ''}`,
      startingMorale: campDef.morale || 55,
      loot: {
        goldMin: Math.round(baseLoot.goldMin * mult), goldMax: Math.round(baseLoot.goldMax * mult),
        resMin:  Math.round((baseLoot.resMin || 0) * mult), resMax: Math.round((baseLoot.resMax || 0) * mult),
      },
      xpReward:       { win: Math.round(baseLoot.xpWin * mult), loss: Math.round(baseLoot.xpLoss * mult) },
      defenders:      cd?.defenders || [{ unitId: 'bandits', count: 2 }, { unitId: 'bandit_archers', count: 1 }],
    };

    const ctx = BattleEngine.buildContext({
      lord:     _lord,
      army:     ArmyService.get(_lord.id),
      encounter,
      terrain:  record.terrain,
    });

    const report = BattleEngine.resolve(ctx);
    report._meta = {
      campName:  encounter.name,
      campIcon:  campDef.icon  || '⚔',
      campLevel: cd?.level     || 1,
      terrain:   record.terrain,
    };

    // Only remove the record if the attacker won — on defeat/draw the camp survives.
    if (report.winner === 'attacker') {
      DiscoveryService.claim(recordId, _player.id);
    }

    DiscoveryService.addLog(_player.id, {
      definitionId:  def.id,
      tileX:         record.tileX,
      tileY:         record.tileY,
      terrain:       record.terrain,
      rewards:       [],
      wasAttack:     true,
      combatOutcome: report.winner === 'attacker' ? 'victory' : 'defeat',
      lordId:        _lord.id,
      lordName:      _lord.name,
    });

    const { leveled, freshLord } = BattleResultView.applyRewards(report, _lord, _player);
    _lord   = freshLord;
    _player = PlayerService.getById(_player.id);

    // Persist post-battle army + lord state to Supabase BEFORE rendering.
    // Must complete before the Revive button appears — otherwise the server
    // won't know the lord is fallen and /api/lord/revive returns 400.
    const postArmy = ArmyService.get(_lord.id);
    await ServerActions.savePveResult(_lord.id, postArmy?.units || [], _lord.currentHp, {
      downtimeUntil:  _lord.downtimeUntil  ?? null,
      downtimeReason: _lord.downtimeReason ?? null,
      actionQueue:    _lord.actionQueue    ?? [],
    });

    if (leveled > 0) _toast(`⭐ Level up! Now level ${freshLord.level}.`);
    const outcomeLabel = report.winner === 'attacker' ? '⚔ Victory' : report.winner === 'draw' ? '🤝 Draw' : '☠ Defeat';
    _toast(`${outcomeLabel} — report in the Battles tab`);
    _activeTab = 'battles';
    _stopCountdown();
    _renderTab();
    _startCountdown();
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

    document.getElementById('unit-req-close')?.addEventListener('click', () => {
      document.getElementById('unit-req-overlay')?.classList.add('hidden');
    });
    document.getElementById('unit-req-overlay')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
    });

    document.querySelectorAll('.ls-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (LordService.isDown(_lord) && (tab === 'army' || tab === 'discovery')) return;
        _activeTab = tab;
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

  async function _reviveNow() {
    const result = await ServerActions.reviveLord(_lord.id);
    if (!result.ok) { _toast(result.error || 'Server error'); return; }
    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    HUD.refresh();
    _stopCountdown();
    _renderTab();
    _startCountdown();
  }

  async function _finishLordActionNow() {
    const lord = LordService.getById(_lord.id);
    if (!lord || lord.actionQueue.length === 0) return;
    if (lord.actionQueue[0].intent === 'attack') {
      _toast('Cannot skip an attack in progress.');
      return;
    }
    _stopCountdown();

    const result = await ServerActions.instantLordAction(_lord.id);
    if (!result.ok) { _toast(result.error || 'Server error'); return; }

    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    const c = result.completedAction;
    if (c) {
      if (c.actionId === 'search_area')        await _resolveSearch();
      else if (c.actionId === 'scout')         await _resolveScout();
      else if (c.actionId === 'move_lord')     _toast(`📍 Arrived at (${c.destX}, ${c.destY}).`);
    }
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
    const hasStance      = LordService.isStanced(_lord);
    const hasDown        = LordService.isDown(_lord);
    if (!hasAction && !hasRecruitment && !hasStance && !hasDown) return;

    _tickTimer = setInterval(async () => {
      let needsRender = false;

      // ─ Lord action tick ─
      if (_lord.actionQueue.length > 0) {
        const completed = LordService.tickActions(_lord);
        if (completed.length > 0) {
          LordService.save(_lord); // persist cleared actionQueue before re-reading
          _lord = LordService.getById(_lord.id);
          for (const c of completed) {
            if (c.actionId === 'search_area') {
              await _resolveSearch();
            } else if (c.actionId === 'scout') {
              await _resolveScout();
            } else if (c.actionId === 'move_lord') {
              if (c.intent === 'attack') {
                _toast('⚔ Attack dispatched — resolving on server…');
                setTimeout(async () => {
                  await ServerActions.syncNow();
                  _lord = LordService.getById(_lord.id);
                  _stopCountdown();
                  _activeTab = 'battles';
                  _renderTab();
                  _startCountdown();
                }, 6000);
              } else {
                _toast(`📍 Arrived at (${c.destX}, ${c.destY}).`);
                ActivityService.log(_player.id, {
                  type:     'lord_moved',
                  icon:     '📍',
                  title:    `${_lord.name} arrived at (${c.destX}, ${c.destY})`,
                  detail:   '',
                  lordName: _lord.name,
                });
              }
            } else {
              _toast(`✓ ${c.name} completed!`);
              ActivityService.log(_player.id, {
                type:     'action_complete',
                icon:     '✓',
                title:    `${c.name} completed`,
                detail:   '',
                lordName: _lord.name,
              });
            }
            if (c.leveled > 0) _toast(`⭐ Level Up! Now Level ${_lord.level}.`);
          }
          await ServerActions.syncNow();
          needsRender = true;
        } else {
          const currId    = _lord.actionQueue[0]?.actionId;
          const remaining = LordService.actionTimeRemaining(_lord);
          const prog      = Math.floor(LordService.actionProgress(_lord) * 100);
          const timerEl   = document.getElementById(`la-timer-${currId}`) || document.getElementById('lov-timer');
          const fillEl    = document.getElementById(`la-fill-${currId}`)  || document.getElementById('lov-fill');
          if (timerEl) timerEl.textContent = TimeService.formatDuration(remaining);
          if (fillEl)  fillEl.style.width  = `${prog}%`;
          // Update portrait activity overlay timer
          const actCd = document.getElementById('ls-act-cd');
          if (actCd) actCd.textContent = TimeService.formatDuration(remaining);
        }
      }

      // ─ Downtime tick ─
      if (LordService.isDown(_lord)) {
        if (LordService.tickDowntime(_lord)) {
          _lord = LordService.getById(_lord.id);
          _toast('Lord has recovered and is ready again.');
          needsRender = true;
        } else {
          const cdEl = document.getElementById('ls-lord-down-cd');
          if (cdEl) cdEl.textContent = TimeService.formatDuration(Math.ceil(LordService.getDowntimeRemaining(_lord) / 1000));
        }
      }

      // ─ Stance tick ─
      if (LordService.isStanced(_lord)) {
        const prevStanceName = STANCE_DEFS[_lord.stance?.id]?.name || 'Stance';
        const expired = LordService.tickStance(_lord);
        if (expired) {
          _lord = LordService.getById(_lord.id);
          _toast(`${prevStanceName} stance ended.`);
          needsRender = true;
        } else {
          const s         = LordService.getStance(_lord);
          const sRemain   = Math.max(0, Math.floor((s.finishAt - TimeService.now()) / 1000));
          const totalMs   = s.finishAt - s.startedAt;
          const elapsedMs = TimeService.now() - s.startedAt;
          const sPct      = totalMs > 0 ? Math.min(100, Math.floor((elapsedMs / totalMs) * 100)) : 0;
          const timerEl   = document.getElementById('lov-stance-timer');
          const fillEl    = document.getElementById('lov-stance-fill');
          if (timerEl) timerEl.textContent = TimeService.formatDuration(sRemain);
          if (fillEl)  fillEl.style.width  = `${sPct}%`;
        }
      }

      // ─ Recruitment tick ─
      const city = _getLordCurrentCity();
      if (city && (city.recruitmentQueue || []).length > 0) {
        const completed = RecruitmentService.tick(city);
        if (completed.length > 0) {
          ServerActions.syncNow(); // persist completion + army update to Supabase
          completed.forEach(c => {
            const uDef = UNIT_DEFS[c.unitId];
            _toast(`${uDef?.icon || '⚔'} ${uDef?.name || c.unitId} ×${c.count} ready!`);
          });
          needsRender = true;
        } else {
          const fillEl  = document.getElementById('la-recruit-fill');
          const timerEl = document.getElementById('la-recruit-timer');
          if (fillEl)  fillEl.style.transform  = `scaleX(${RecruitmentService.progress(city)})`;
          if (timerEl) timerEl.textContent = TimeService.formatDuration(RecruitmentService.timeRemaining(city));
        }
      }

      if (needsRender) {
        _stopCountdown();
        _renderTab();
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
