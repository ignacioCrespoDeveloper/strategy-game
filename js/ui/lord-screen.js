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
            _toast('Attack dispatched — resolving on server…');
            // Server dispatcher resolves the battle within ~5 s.
            // Pull fresh state after that so the Battles tab shows the result.
            setTimeout(async () => {
              await ServerActions.syncNow();
              _lord = LordService.getById(_lord.id);
              _renderTab();
            }, 6000);
          } else {
            _toast(`Arrived at (${c.destX}, ${c.destY}).`);
            ActivityService.log(_player.id, {
              type: 'lord_moved', icon: gi('position-marker'),
              title: `${_lord.name} arrived at (${c.destX}, ${c.destY})`,
              detail: '', lordName: _lord.name,
            });
          }
        } else {
          _toast(`✓ ${c.name} completed!`);
        }
        if (c.leveled > 0) _toast(`Level Up! Now Level ${_lord.level}.`);
      });
    }

    root.innerHTML = _shell();
    _renderTab();
    _bindEvents();
    _startCountdown();
    if (autoAttackRecordId) {
      _activeTab = 'discovery';
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
              <button class="ls-tab ${_activeTab === 'overview'  ? 'ls-tab--active' : ''}" data-tab="overview">${gi('position-marker')} Overview</button>
              <button class="ls-tab ${_activeTab === 'army'      ? 'ls-tab--active' : ''}" data-tab="army" ${lordIsDown ? 'disabled title="Lord is incapacitated"' : ''}>${gi('crossed-swords')} Army</button>
              <button class="ls-tab ${_activeTab === 'discovery' ? 'ls-tab--active' : ''}" data-tab="discovery" id="ls-tab-discovery" ${lordIsDown ? 'disabled title="Lord is incapacitated"' : ''}>${gi('magnifying-glass')} Quests${(() => { const n = DiscoveryService.getUnseenCount(_player.id, _lord.id); return n > 0 ? `<span class="ls-tab-badge">${n}</span>` : ''; })()}</button>
              <button class="ls-tab ${_activeTab === 'talents'   ? 'ls-tab--active' : ''}" data-tab="talents" ${(_lord.level || 1) < 5 ? 'title="Unlocks at level 5"' : ''}>${gi('magic-swirl')} Talents${(_lord.level || 1) >= 5 && !_lord.talentId ? '<span class="ls-tab-badge ls-tab-badge--gold">!</span>' : ''}</button>
              <button class="ls-tab ${_activeTab === 'mount'     ? 'ls-tab--active' : ''}" data-tab="mount" ${(_lord.level || 1) < 5 ? 'title="Unlocks at level 5"' : ''}>${gi('horse-head')} Mount${(_lord.level || 1) >= 5 && !_lord.mountId ? '<span class="ls-tab-badge ls-tab-badge--gold">!</span>' : ''}</button>
              <button class="ls-tab ${_activeTab === 'battles'   ? 'ls-tab--active' : ''}" data-tab="battles">${gi('plain-dagger')} Battles${(() => { const n = BattleHistoryService.getForLord(_lord.id).length; return n > 0 ? `<span class="ls-tab-badge ls-tab-badge--neutral">${n}</span>` : ''; })()}</button>
            </nav>
            <div class="ls-content" id="ls-content"></div>
          </div>

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
    const downOverlay    = lordIsDown && _lord.capturedByPlayerId ? `
      <div class="lsl-portrait-down-overlay">
        <div class="lsl-portrait-down-icon">${gi('manacles')}</div>
        <div class="lsl-portrait-down-label lsl-portrait-down-label--captured">CAPTURED</div>
        <div class="lsl-captor">by ${_lord.capturedByUsername || 'Unknown'}</div>
        <button class="ls-finish-btn ls-ransom-btn" id="ls-ransom-now">${gi('two-coins')} Pay Ransom (${lordRansomCost(_lord.level)})</button>
      </div>` : lordIsDown ? `
      <div class="lsl-portrait-down-overlay">
        <div class="lsl-portrait-down-icon">${downReason === 'captured' ? gi('manacles') : gi('death-skull')}</div>
        <div class="lsl-portrait-down-label lsl-portrait-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
        <div class="lsl-portrait-down-cd" id="ls-lord-down-cd">${TimeService.formatDuration(downRemSecs)}</div>
        <button class="ls-finish-btn ls-revive-btn" id="ls-revive-now">${gi('power-lightning')} ${downReviveCost}${gi('cut-diamond')} Revive</button>
      </div>` : '';

    const lsQueueItem  = _lord.actionQueue?.[0] ?? null;
    const lsIsAttacking = lsQueueItem?.intent === 'attack';
    const lsIsQuesting  = !lordIsDown && lsQueueItem?.actionId === 'search_area';
    const lsIsScouting  = !lordIsDown && lsQueueItem?.actionId === 'scout';
    const lsIsMoving    = !lordIsDown && lsQueueItem?.actionId === 'move_lord' && !lsIsAttacking;
    const lsActionSecs  = lsQueueItem ? LordService.actionTimeRemaining(_lord) : 0;

    const activityOverlay = lsIsAttacking ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--attack">
        <div class="ov-lord-activity-icon">&#9876;</div>
        <div class="ov-lord-activity-label">Attacking</div>
        <div class="ov-lord-activity-dest">(${lsQueueItem.destX}, ${lsQueueItem.destY})</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` :
    lsIsQuesting ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--quest">
        <div class="ov-lord-activity-icon">&#128506;</div>
        <div class="ov-lord-activity-label">Questing</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` :
    lsIsScouting ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--scout">
        <div class="ov-lord-activity-icon">&#128373;</div>
        <div class="ov-lord-activity-label">Scouting</div>
        <div class="ov-lord-activity-cd" id="ls-act-cd">${TimeService.formatDuration(lsActionSecs)}</div>
      </div>` :
    lsIsMoving ? `
      <div class="lsl-portrait-activity-overlay lsl-portrait-activity-overlay--move">
        <div class="ov-lord-activity-icon">&#128694;</div>
        <div class="ov-lord-activity-label">Marching</div>
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
           <div class="lsl-portrait-level" title="Level ${level}">${level}</div>
           <div class="lsl-portrait-nameplate">
             <span class="lsl-portrait-lord-name">${_lord.name}</span>
             <div class="lsl-portrait-badges">
               <span class="lsl-portrait-race-name">${race.name}</span>
               ${cls ? `<span class="lsl-portrait-class-name" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
             </div>
           </div>
         </div>`
      : `<div class="lsl-portrait-area${lordIsDown ? ' lsl-portrait-area--down' : ''}">
           <div class="lsl-portrait">${race.icon || gi('person')}</div>
           ${downOverlay}${activityOverlay}
           <div class="lsl-portrait-level" title="Level ${level}">${level}</div>
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
        <div class="lm-slot-label">${gi('padlock')} Unlocks at level 5</div>
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
          <span class="lsl-bar-label-icon">${gi('hearts')}</span>
          <span class="lsl-bar-label-val">${curHp} / ${maxHp}</span>
        </div>
        <div class="lsl-xp-bar">
          <div class="lsl-xp-fill" style="width:${xpPct}%"></div>
        </div>
        <div class="lsl-bar-label-row">
          <span class="lsl-bar-label-icon">${gi('round-star')}</span>
          <span class="lsl-bar-label-val">${xp} / ${xpNext} XP</span>
        </div>
      </div>

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
    document.getElementById('ls-ransom-now')?.addEventListener('click', _ransomNow);

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
        // Stance picker — toggle Ambush / Raid / Raiding selection. Duration
        // options are rebuilt per-stance since Raiding offers longer presets
        // (1h/4h/8h/24h) than Ambush/Raid's 1h/2h/4h.
        document.querySelectorAll('.lov-stance-pick-btn[data-pick]').forEach(btn => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.lov-stance-pick-btn').forEach(b => b.classList.remove('lov-stance-pick-btn--active'));
            btn.classList.add('lov-stance-pick-btn--active');
            const def    = STANCE_DEFS[btn.dataset.pick];
            const descEl = document.getElementById('lov-stance-desc');
            if (descEl && def) descEl.textContent = def.description;
            const durSel = document.getElementById('lov-stance-dur');
            if (durSel && def) {
              durSel.innerHTML = def.durations.map(s => `<option value="${s}">${TimeService.formatDuration(s)}</option>`).join('');
            }
            const startBtn = document.getElementById('lov-stance-start');
            if (startBtn) { startBtn.disabled = false; startBtn.dataset.stance = btn.dataset.pick; }
          });
        });
        document.getElementById('lov-stance-start')?.addEventListener('click', async () => {
          const startBtn = document.getElementById('lov-stance-start');
          const stanceId = startBtn?.dataset?.stance;
          const secs     = Number(document.getElementById('lov-stance-dur')?.value || 3600);
          if (!stanceId) { _toast('Select a stance first.'); return; }

          if (stanceId === 'raiding') {
            // Server-authoritative — real gold/resources at stake, and the
            // server is the only place that can validate "no city on this
            // tile" (a regular client's RLS can't see other players' cities).
            startBtn.disabled = true;
            const result = await ServerActions.raidStart(_lord.id, secs);
            if (!result.ok) { _toast(result.error || 'Server error'); startBtn.disabled = false; return; }
            _lord = LordService.getById(_lord.id);
            _renderTab();
            _startCountdown();
            return;
          }

          const result = LordService.enterStance(_lord, stanceId, secs);
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
        document.getElementById('lov-raid-cancel-btn')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          if (!confirm('Cancel raiding? Everything earned so far will be lost.')) return;
          btn.disabled = true;
          const result = await ServerActions.raidCancel(_lord.id);
          if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
        });
        document.getElementById('lov-raid-finish-btn')?.addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          const result = await ServerActions.raidInstant(_lord.id);
          if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
          _toast(`Raid complete: +${result.goldEarned || 0} gold`);
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _startCountdown();
          HUD.refresh();
        });
        break;
      case 'army':
        content.innerHTML = _armyHtml();
        _bindArmyEvents();
        break;
      case 'discovery':
        DiscoveryService.markLogSeen(_player.id, _lord.id);
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

  // PWR comes from EconomyCore.getUnitPower/getArmyPower — the single
  // source of truth shared with the server's recruit/hire gates (linear
  // per-model cost + combat-trait tax). Rounded here (not just at display
  // time) so every caller — display, the recruit-button pre-check, etc. —
  // sees the same whole-number PWR value.
  function _unitPower(def) {
    return EconomyCore.getUnitPower(def);
  }

  function _armyPower(lordId) {
    const army = ArmyService.get(lordId);
    return Math.round(EconomyCore.getArmyPower(army.units, UNIT_DEFS));
  }

  // Display-only mirror of server/tick/catch-up.js's _raidHourlyRewards —
  // the server is what actually pays out (at completion, never here), this
  // is purely for showing an "earned so far" preview while a raid is active.
  function _raidHourlyRewardsPreview(lord) {
    const lvl  = lord.level || 1;
    const gold = Math.round(25 + lvl * 5);
    const res  = Math.round(15 + lvl * 3);
    return { gold, food: res, wood: res, stone: res };
  }

  // Army power if `addCount` more of `unitId` were added to this lord's army.
  // Mirrors server/actions/recruit.js's _projectedArmyPower via the same
  // EconomyCore helper — the server is the authoritative gate and this is
  // only the client-side pre-check that disables the Recruit/Hire button.
  function _projectedArmyPower(lordId, unitId, addCount) {
    const army = ArmyService.get(lordId);
    return EconomyCore.getProjectedArmyPower(army.units, UNIT_DEFS, unitId, addCount);
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
    const n = DiscoveryService.getUnseenCount(_player.id, _lord.id);
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

    // Stances (raiding, ambush) don't go through actionQueue, so `busy` alone
    // would call a raiding lord "Idle" — computed here (not just in the
    // Stance section below) so Status can tell the two apart too.
    const stanceObj  = LordService.getStance(_lord);
    const stanceDef  = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
    const isInStance = LordService.isStanced(_lord);
    const isRaiding  = isInStance && stanceObj.id === 'raiding';

    // ── Status ────────────────────────────────────────────────────
    let statusHtml;
    if (isRaiding) {
      const sRemain = Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000));
      const totalMs   = stanceObj.finishAt - stanceObj.startedAt;
      const elapsedMs = TimeService.now() - stanceObj.startedAt;
      const sPct      = totalMs > 0 ? Math.min(100, Math.floor((elapsedMs / totalMs) * 100)) : 0;
      statusHtml = `
        <div class="lov-status lov-status--stanced">${STANCE_DEFS.raiding.icon} Raiding — earnings below</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-status-stance-fill" style="width:${sPct}%"></div></div>
          <span class="lov-timer" id="lov-status-stance-timer">${TimeService.formatDuration(sRemain)}</span>
        </div>
      `;
    } else if (!busy) {
      statusHtml = `<div class="lov-status lov-status--idle">${gi('hourglass')} Idle — no active task</div>`;
    } else if (queueItem.actionId === 'move_lord') {
      const isAttacking = queueItem.intent === 'attack';
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status ${isAttacking ? 'lov-status--attacking' : 'lov-status--traveling'}">
          ${isAttacking ? gi('crossed-swords') + ' ATTACKING — arriving at ('+queueItem.destX+', '+queueItem.destY+')' : gi('compass') + ' Traveling to ('+queueItem.destX+', '+queueItem.destY+')'}
        </div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill${isAttacking ? ' lov-fill--attack' : ''}" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          ${isAttacking ? '' : `<button class="ls-finish-btn" id="lov-finish-lord">${gi('power-lightning')} ${cost}${gi('cut-diamond')}</button>`}
        </div>
      `;
    } else if (queueItem.actionId === 'search_area') {
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status lov-status--searching">${gi('magnifying-glass')} Quest in progress…</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          <button class="ls-finish-btn" id="lov-finish-lord">${gi('power-lightning')} ${cost}${gi('cut-diamond')}</button>
        </div>
      `;
    } else if (queueItem.actionId === 'scout') {
      const cost = _creditCost(secs);
      statusHtml = `
        <div class="lov-status lov-status--scouting">${gi('spy')} Scouting in progress…</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-fill" style="width:${pct}%"></div></div>
          <span class="lov-timer" id="lov-timer">${TimeService.formatDuration(secs)}</span>
          <button class="ls-finish-btn" id="lov-finish-lord">${gi('power-lightning')} ${cost}${gi('cut-diamond')}</button>
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
        ? `<div class="lov-lc-disc">${gi('magnifying-glass')} ${tileDiscs.length} pending quest${tileDiscs.length > 1 ? 's' : ''} on this tile</div>`
        : `<div class="lov-lc-disc lov-lc-disc--none">${gi('magnifying-glass')} No quests here yet</div>`;

      // Search action
      let searchHtml;
      if (isSearching) {
        searchHtml = `<span class="lov-lc-busy">${gi('magnifying-glass')} Quest in progress on this tile…</span>`;
      } else if (isScouting) {
        searchHtml = `<span class="lov-lc-busy">${gi('spy')} Scouting this tile…</span>`;
      } else if (!busy) {
        searchHtml = `
          <div class="lov-lc-btns">
            <button class="lov-search-btn" id="lov-search-btn">${gi('magnifying-glass')} Send on Quest</button>
            <button class="lov-scout-btn" id="lov-scout-btn" title="Gather intel on this tile's enemy lord and city. Safe without an army; risks an ambush if scouting with one.">${gi('spy')} Scout</button>
            <button class="lov-move-btn" id="lov-move-btn">${gi('treasure-map')} Go to Map</button>
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
              <div class="lov-lc-coords">${gi('position-marker')} (${_lord.x}, ${_lord.y})${isTraveling ? ` → (${queueItem.destX}, ${queueItem.destY})` : ''}</div>
            </div>
            <div class="lov-lc-hint">${terrain.searchHint}</div>
            ${discCountHtml}
            ${searchHtml}
          </div>
        </div>
      `;
    }

    // ── Stance (own section, after Army) ─────────────────────────
    // stanceObj/stanceDef/isInStance computed above, alongside Status.
    let stanceHtml;
    if (isInStance && stanceObj.id === 'raiding') {
      // Raiding is server-authoritative (real gold/resources at stake) — its
      // own status block instead of the generic ✕ Exit button, since exiting
      // here has two very different costs: Cancel is free but forfeits
      // everything earned so far, Finish Now pays credits to collect the
      // full reward immediately. See server/actions/raid-{cancel,instant}.js.
      const sRemain    = Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000));
      const totalMs    = stanceObj.finishAt - stanceObj.startedAt;
      const elapsedMs  = TimeService.now() - stanceObj.startedAt;
      const sPct       = totalMs > 0 ? Math.min(100, Math.floor((elapsedMs / totalMs) * 100)) : 0;
      const rates      = _raidHourlyRewardsPreview(_lord);
      const elapsedHrs = Math.max(0, elapsedMs / 3_600_000);
      const goldSoFar  = Math.floor(rates.gold * elapsedHrs);
      const resSoFar   = Math.floor(rates.food * elapsedHrs); // all 4 resource types share the same rate
      const finishCost = Math.max(1, Math.ceil(sRemain / 60));
      stanceHtml = `
        <div class="lov-status lov-status--stanced">${STANCE_DEFS.raiding.icon} Raiding</div>
        <div class="lov-progress-row">
          <div class="lov-bar"><div class="lov-fill" id="lov-stance-fill" style="width:${sPct}%"></div></div>
          <span class="lov-timer" id="lov-stance-timer">${TimeService.formatDuration(sRemain)}</span>
        </div>
        <div class="lov-raid-earnings">
          Earned so far (paid only when the raid ends): <b>+${goldSoFar}${gi('two-coins')}</b> · <b>+${resSoFar}</b> of each resource
        </div>
        <div class="lov-raid-warn">${gi('hazard-sign')} Any enemy lord with an army that arrives here will trigger an automatic fight. Losing forfeits the raid and everything earned.</div>
        <div class="lov-raid-btn-row">
          <button class="lov-raid-cancel-btn" id="lov-raid-cancel-btn">✕ Cancel (forfeit)</button>
          <button class="lov-raid-finish-btn" id="lov-raid-finish-btn">${gi('cut-diamond')} Finish Now — ${finishCost}</button>
        </div>
      `;
    } else if (isInStance) {
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
        <button class="lov-stance-exit-btn">✕ Exit</button>
      `;
    } else {
      stanceHtml = `
        <div class="lov-stance-picker" id="lov-stance-picker">
          <div class="lov-stance-pick-row">
            <button class="lov-stance-pick-btn" data-pick="ambush"${busy ? ' disabled' : ''}>${STANCE_DEFS.ambush.icon} Ambush</button>
            <button class="lov-stance-pick-btn" data-pick="raiding"${busy ? ' disabled' : ''}>${STANCE_DEFS.raiding.icon} Raiding</button>
            <select class="lov-stance-dur-sel" id="lov-stance-dur"${busy ? ' disabled' : ''}></select>
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
    const totalPower   = _armyPower(_lord.id);
    const maxPower     = LordService.getArmyPowerCap(_lord);
    const overPower    = totalPower > maxPower;
    const armyHtml    = army.units.length === 0
      ? `<p class="lov-pos-none">No troops mustered — recruit from the Army tab.</p>`
      : `<div class="la-unit-cards">${_armyCardsHtml(army, { removable: false })}</div>`;

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
            <span class="lov-army-power${overPower ? ' lov-army-power--over' : ''}" title="Army Power — the capacity that gates recruiting">${gi('crossed-swords')} ${totalPower} / ${maxPower} PWR</span>
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
          ${giUnitType(def.category)}
          ${removeBtn}
        </div>
        <div class="la-uc-tooltip">
          <div class="la-tt-name">${def.name}${def.category === 'mercenary' ? ' <span class="la-merc-badge">Merc</span>' : ''}</div>
          <div class="la-tt-stats">
            <span title="Attack">${gi('crossed-swords')} ${def.combatStats.attack}</span>
            <span title="Defense">${gi('round-shield')} ${def.combatStats.defense}</span>
            <span title="HP">${gi('hearts')} ${def.combatStats.hp}</span>
            <span title="Speed">${gi('wingfoot')} ${def.combatStats.speed}</span>
          </div>
          <div class="la-tt-cost">${gi('two-coins')}${def.goldCost}</div>
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
          <div class="la-placeholder-icon">${gi('crossed-swords')}</div>
          <div class="la-placeholder-text">No troops mustered</div>
          <div class="la-placeholder-sub">Recruit from your city or hire mercenaries in the field.</div>
        </div>
      `;
    } else {
      armyListHtml = `<div class="la-unit-cards">${_armyCardsHtml(army, { removable: true })}</div>`;
    }

    // ── Recruitment (city-based) ───────────────────────────────
    let recruitSectionHtml;
    if (isTraveling) {
      recruitSectionHtml = `<p class="la-recruit-note">Cannot recruit while traveling.</p>`;
    } else if (!city) {
      recruitSectionHtml = `<p class="la-recruit-note">Your lord must be standing inside one of your cities to recruit.</p>`;
    } else {
      const queue      = city.recruitmentQueue || [];
      const MAX_QUEUE  = 5;
      const busy       = queue.length > 0;
      const queueFull  = queue.length >= MAX_QUEUE;

      let queueHtml = '';
      if (busy) {
        const job  = queue[0];
        const uDef = UNIT_DEFS[job.unitId];
        const pct  = Math.floor(RecruitmentService.progress(city) * 100);
        const secs = RecruitmentService.timeRemaining(city);
        const recruitCost = _creditCost(secs);

        // Queued-but-not-yet-started batches (position 1+) — each already has
        // real sequenced startedAt/finishAt from the server, so its own ETA
        // is just "time until ITS finishAt", same formula as the front item.
        const upcomingHtml = queue.slice(1).map((q, i) => {
          const qDef     = UNIT_DEFS[q.unitId];
          const etaSecs  = Math.max(0, Math.round((q.finishAt - TimeService.now()) / 1000));
          return `
            <div class="la-recruit-queue-item">
              <span class="la-recruit-queue-pos">#${i + 2}</span>
              <span class="la-recruit-queue-icon">${qDef?.icon || gi('crossed-swords')}</span>
              <span class="la-recruit-queue-name">${qDef?.name || q.unitId} ×${q.count}</span>
              <span class="la-recruit-queue-eta">${TimeService.formatDuration(etaSecs)}</span>
            </div>`;
        }).join('');

        queueHtml = `
          <div class="la-recruit-queue">
            <div class="la-recruit-queue-label">${uDef?.icon || gi('crossed-swords')} Training ${uDef?.name || job.unitId} ×${job.count}</div>
            <div class="la-progress-row">
              <div class="la-bar"><div class="la-fill" id="la-recruit-fill" style="transform:scaleX(${pct / 100})"></div></div>
              <span class="la-timer" id="la-recruit-timer">${TimeService.formatDuration(secs)}</span>
              <button class="ls-finish-btn" id="la-finish-recruit">${gi('power-lightning')} ${recruitCost}${gi('cut-diamond')}</button>
            </div>
            ${upcomingHtml ? `<div class="la-recruit-queue-upcoming">${upcomingHtml}</div>` : ''}
            <div class="la-recruit-queue-slots">${queue.length}/${MAX_QUEUE} queue slots used</div>
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
          const wouldExceedPower = _projectedArmyPower(_lord.id, unitId, 1) > maxPower;
          const disabled   = queueFull || !canAfford || wouldExceedPower;
          const btnLabel   = queueFull ? 'Queue Full' : wouldExceedPower ? gi('hazard-sign') + ' Power Limit' : canAfford ? 'Recruit' : 'No gold';
          // Displayed time mirrors the server: hangar divisor from this
          // city's training-building level + Drill Manuals research.
          const training   = EconomyCore.getUnitTraining(_lord.race, unitId);
          const recruitSecs = EconomyCore.getRecruitTime(
            def, 1,
            EconomyCore.getResearchEffects(player.research),
            training ? (city.buildings?.[training.buildingId] || 0) : 0,
            training ? training.minLevel : 0,
          );
          // Veterancy: attack/defense shown as the unit will actually fight
          // (training-building levels summed across ALL cities).
          const vetPct = EconomyCore.getVeterancyPct(
            _lord.race, unitId,
            CityService.getPlayerCities(player.id).map(c => c.buildings));
          const atkShown = Math.round(def.combatStats.attack  * (1 + vetPct));
          const defShown = Math.round(def.combatStats.defense * (1 + vetPct));
          return `
            <div class="la-recruit-card ${queueFull ? 'la-recruit-card--busy' : ''}">
              ${_unitPortraitHtml(def)}
              <div class="la-recruit-body">
                <div class="la-recruit-name">${def.name}${vetPct > 0 ? ` <span class="la-vet-badge" title="Veterancy from training buildings across your empire">+${Math.round(vetPct * 100)}%</span>` : ''}</div>
                <div class="la-recruit-stats">${gi('crossed-swords')}${atkShown} ${gi('round-shield')}${defShown} ${gi('hearts')}${def.combatStats.hp} ${gi('wingfoot')}${def.combatStats.speed}</div>
                <div class="la-recruit-cost">${gi('two-coins')}${def.goldCost} · ${gi('stopwatch')}${TimeService.formatDuration(recruitSecs)}</div>
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
          const wouldExceedPower = _projectedArmyPower(_lord.id, unitId, 1) > maxPower;
          const disabled   = !canAfford || wouldExceedPower;
          const btnLabel   = wouldExceedPower ? gi('hazard-sign') + ' Power Limit' : canAfford ? 'Hire' : 'No gold';
          return `
            <div class="la-recruit-card">
              ${_unitPortraitHtml(def)}
              <div class="la-recruit-body">
                <div class="la-recruit-name">${def.name} <span class="la-merc-badge">Mercenary</span></div>
                <div class="la-recruit-stats">${gi('crossed-swords')}${def.combatStats.attack} ${gi('round-shield')}${def.combatStats.defense} ${gi('hearts')}${def.combatStats.hp} ${gi('wingfoot')}${def.combatStats.speed}</div>
                <div class="la-recruit-cost">${gi('two-coins')}${def.goldCost} · Instant</div>
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
        return `<div class="la-merc-group"><div class="la-merc-group-title">${discDef?.icon || gi('crossed-swords')} ${discDef?.name || record.definitionId}</div>${cards}</div>`;
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
          <span class="la-army-power${overPower ? ' la-army-power--over' : ''}" title="Army Power — the capacity that gates recruiting">${gi('crossed-swords')} ${currentPower} / ${maxPower} PWR</span>
        </div>
        ${armyListHtml}
        <div class="la-section-divider"></div>
        <div class="la-section-header-row">
          <div class="la-section-title">Recruit</div>
        </div>
        ${recruitSectionHtml}
        ${mercHtml}
      </div>
    `;
  }

  function _bindArmyEvents() {
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
        if (def) _toast(`${def.name} dismissed.`);
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
        _toast(`${def.name} hired!`);
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
    // Each lord's own quest log only — entries carry lordId from addLog()
    // time, but getLog() itself stays player-scoped storage (see
    // discovery.js), so the per-lord split happens here on render.
    const log = DiscoveryService.getLog(_player.id).filter(e => e.lordId === _lord.id);

    if (log.length === 0) {
      return `
        <div class="la-placeholder">
          <div class="la-placeholder-icon">${gi('magnifying-glass')}</div>
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
      const terrain   = TERRAIN_TYPES[entry.terrain] || { icon: gi('world'), name: entry.terrain || 'Unknown' };
      const ago       = _timeAgo(TimeService.now() - entry.loggedAt);
      const icon      = def ? def.icon : gi('uncertainty');
      const defName   = isNothing ? 'Nothing Found' : (def ? def.name : 'Quest');
      const name      = entry.storyTitle || defName;
      // When a story quest supplied a custom headline, still surface the
      // underlying discovery type (e.g. "Goblin Camp") as a small tag so
      // players don't lose that at-a-glance identification — matters most
      // for combat, to gauge a fight before committing to it.
      const typeTagHtml = (entry.storyTitle && def) ? `<span class="qd-type-tag">${icon} ${defName}</span>` : '';
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

      // ── Quote / scout report — the journey. Lore — the thing itself. ──
      const quoteHtml = entry.narrative ? `<blockquote class="qd-quote">${entry.narrative}</blockquote>` : '';
      // Skip the generic def lore when a story quest already fired — its
      // narrative covers both the journey and the discovery itself, and
      // repeating the generic blurb right after would just be redundant.
      const loreHtml  = (!isNothing && !entry.storyTitle && def?.description) ? `<p class="qd-lore">${def.description}</p>` : '';

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
            <span class="qd-banner-icon">${won ? gi('crossed-swords') : gi('skull-crossed-bones')}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${kindLabel}</div>
              <div class="qd-banner-sub">${sub}</div>
            </div>
          </div>
          ${canViewReport
            ? `<button class="qd-battle-link" data-view-battles="1">${gi('scroll-unfurled')} View Battle Report</button>`
            : `<div class="qd-hint">Full battle report in the Battles tab.</div>`}`;
      } else if (isCombat) {
        const activeRecord = entry.recordId ? DiscoveryService.getActive(_player.id).find(r => r.id === entry.recordId) : null;
        const campPreview  = activeRecord?.campDetails ? _campPreviewHtml(activeRecord.campDetails) : '';
        bodyHtml = `
          <div class="qd-banner qd-banner--camp">
            <span class="qd-banner-icon">${icon}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${name}</div>
            </div>
          </div>
          ${campPreview}
          <div class="qd-hint">${gi('position-marker')} Visible on the map at (${entry.tileX}, ${entry.tileY}). Move your lord there and attack when ready.</div>`;
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
                ${typeTagHtml}
              </div>
              <span class="qd-pill qd-pill--lg qd-pill--${kind}">${kindLabel}</span>
            </div>
            ${quoteHtml}
            ${loreHtml}
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
        <div class="disc-section-row">
          <div class="disc-section-label">${gi('scroll-quill')} Quest History</div>
          <button class="disc-clear-all-btn" id="qd-clear-all">${gi('trash-can')} Clear All</button>
        </div>
        <div class="disc-log-list">${entries}</div>
      </div>`;
  }

  const _RES_ICONS = { gold: gi('two-coins'), wood: gi('wood-pile'), stone: gi('war-pick'), food: gi('wheat'), xp: gi('round-star') };
  const _ACTION_CATEGORIES = new Set(['combat']);

  function _campPreviewHtml(cd) {
    if (!cd) return '';
    const campDef = CAMP_DEFS[cd.type] || {};
    const chips = cd.defenders.map(d => {
      const def = UNIT_DEFS[d.unitId];
      return `<span class="camp-unit-chip">${def?.icon || gi('crossed-swords')} ${def?.name || d.unitId} ×${d.count}</span>`;
    }).join('');
    return `
      <div class="camp-preview">
        <div class="camp-preview-header">
          <span class="camp-level-badge">Level ${cd.level}</span>
          <span class="camp-type-label">${campDef.icon || gi('crossed-swords')} ${campDef.displayName || cd.type}</span>
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
          <div class="lt-locked-icon">${gi('padlock')}</div>
          <div class="lt-locked-text">Talent selection unlocks at <strong>level 5</strong>.</div>
          <div class="lt-locked-hint">Level up your lord to choose a permanent talent.</div>
        </div>`;
    } else if (chosenTalent) {
      talentSectionHtml = `
        <div class="lt-chosen-card" style="border-color:${chosenTalent.color}30">
          <div class="lt-chosen-icon" style="color:${chosenTalent.color}">${chosenTalent.icon}</div>
          <div class="lt-chosen-body">
            <div class="lt-chosen-name" style="color:${chosenTalent.color}">${chosenTalent.name}</div>
            <div class="lt-chosen-category">${chosenTalent.category === 'combat' ? gi('crossed-swords') + ' Combat' : gi('treasure-map') + ' Strategic'}</div>
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
        <div class="lt-group-label">${gi('crossed-swords')} Combat Talents</div>
        <div class="lt-talent-grid">${renderCards(combatTalents)}</div>
        <div class="lt-group-label">${gi('treasure-map')} Strategic Talents</div>
        <div class="lt-talent-grid">${renderCards(strategicTalents)}</div>`;
    }

    return `
      <div class="lt-container">
        <div class="lt-section">
          <div class="lt-section-title">${gi('magic-swirl')} Talent</div>
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
          <div class="lm-slot-label">${gi('padlock')} Unlocks at level 5</div>
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
              <span class="lm-mount-cost${canAfford ? '' : ' lm-mount-cost--short'}">${gi('two-coins')}${m.cost || 0}</span>
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
          <div class="lm-section-title">${gi('horse-head')} Mount</div>
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
        _toast(`${mount?.name || 'Mount'} equipped!`);
        _mountPickerOpen = false;
        _renderTab();
      });
    });
  }

  const _OUTCOME_META = {
    victory: { label: 'Victory', icon: gi('crossed-swords'), css: 'bh-victory' },
    defeat:  { label: 'Defeat',  icon: gi('skull-crossed-bones'), css: 'bh-defeat'  },
    draw:    { label: 'Draw',    icon: gi('shaking-hands'), css: 'bh-draw'    },
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
          <div class="bh-empty-icon">${gi('plain-dagger')}</div>
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
      const loot   = (b.outcome === 'victory' && b.goldEarned > 0 ? `+${b.goldEarned}${gi('two-coins')} · ` : '') + resLoot;
      const honor  = b.honorEarned || 0;
      const honorCls = honor > 0 ? 'bh-honor--pos' : honor < 0 ? 'bh-honor--neg' : '';
      const honorHtml = honor !== 0
        ? `<span class="bh-honor ${honorCls}">${honor > 0 ? '+' : ''}${honor} honor</span>`
        : '';
      return `
        <div class="bh-entry ${om.css}" data-bh-idx="${idx}">
          <div class="bh-entry-header">
            <span class="bh-outcome-badge ${om.css}">${om.icon} ${om.label}</span>
            <span class="bh-camp-name">${b.campIcon || gi('crossed-swords')} ${b.campName}</span>
            <span class="bh-date">${date} ${time}</span>
          </div>
          ${b.lordLevel ? `<div class="bh-lord-sub mip-value--muted">${_lord.name} · Lv ${b.lordLevel}</div>` : ''}
          <div class="bh-entry-stats">
            <span>Rounds: <strong>${b.rounds}</strong></span>
            <span>Losses: <strong>${b.modelsLost}</strong></span>
            <span>${loot}+${b.xpEarned}${gi('round-star')}</span>
            ${honorHtml}
            <span class="bh-reason">${_REASON_LABELS_TAB[b.reason] || b.reason}</span>
          </div>
          <button class="bh-log-toggle" data-bh-idx="${idx}">${gi('scroll-unfurled')} View Report</button>
          <div class="bh-log-body hidden" id="bh-log-${idx}">
            ${b.report ? _battleLogHtml(b) : '<em>Report unavailable</em>'}
          </div>
        </div>`;
    }).join('');

    return `
      <div class="bh-section-row">
        <button class="disc-clear-all-btn" id="bh-clear-all">${gi('trash-can')} Clear All</button>
      </div>
      <div class="bh-list">${rows}</div>`;
  }

  function _battleLogHtml(b) {
    return BattleResultView.inlineReportHtml(b.report, _lord, b.campName);
  }

  function _bindBattlesTabEvents() {
    document.querySelectorAll('.bh-log-toggle[data-bh-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(`bh-log-${btn.dataset.bhIdx}`);
        if (body) body.classList.toggle('hidden');
      });
    });
    document.getElementById('bh-clear-all')?.addEventListener('click', () => {
      if (!confirm(`Clear all battle history for ${_lord.name}? This cannot be undone.`)) return;
      BattleHistoryService.clearForLord(_lord.id);
      _renderTab();
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
    if ((_lord.level || 1) > oldLevel) _toast(`Level up! Now level ${_lord.level}.`);

    const discoveries = result.discoveries || [];
    if (discoveries.length === 0) {
      _toast('Quest complete — see Quests tab');
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
        _toast(outcome === 'repelled' ? 'Ambushed — but you fought them off!' : outcome === 'draw' ? 'Ambushed — battle was a draw' : 'Ambushed! No intel gathered — see Battles tab');
        _activeTab = 'battles';
      } else if (result.outcome === 'intel') {
        const applied = _applyIntelDiscoveries(result.discoveries);
        const gained   = applied.length;
        _toast(gained > 0 ? `Scouting complete — ${gained} report${gained > 1 ? 's' : ''} gathered` : 'Scouting complete — nothing on this tile');

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
          icon:  gi('spy'),
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

    const terrainId  = record?.terrain || (_lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains');
    // Prefer a curated story vignette (story-quests.js) over the generic
    // pooled narrative when one exists for this category — gives the quest
    // a proper name (storyTitle) and a fuller D&D-style narrative.
    const storyQuest = (typeof pickStoryQuest === 'function') ? pickStoryQuest(category) : null;
    const narrative  = storyQuest ? storyQuest.story : pickQuestNarrative(def, terrainId);
    const storyTitle = storyQuest ? storyQuest.title : null;
    const reportName = storyTitle || def.name;

    if (category === 'nothing') {
      DiscoveryService.addLog(_player.id, {
        definitionId: defId,
        tileX: record?.tileX ?? _lord.x, tileY: record?.tileY ?? _lord.y,
        terrain: terrainId, rewards: [], narrative, storyTitle,
        lordId: _lord.id, lordName: _lord.name,
      });
      _toast(storyTitle ? `${storyTitle} — see Quests tab` : 'Quest complete — nothing found');
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
        terrain: record.terrain, rewards: [], recordId: record.id, narrative, storyTitle,
        lordId: _lord.id, lordName: _lord.name,
      });
      ActivityService.log(_player.id, {
        type: 'discovery', icon: def.icon || gi('magnifying-glass'),
        title: `${reportName} discovered`, detail: `(${record.tileX}, ${record.tileY})`,
        lordName: _lord.name,
      });
      _toast(`${reportName} spotted — attack from the map`);
    } else {
      // Non-combat: gold/resources/XP already applied server-side; just show the log.
      DiscoveryService.addLog(_player.id, {
        definitionId: defId, tileX: record.tileX, tileY: record.tileY,
        terrain: record.terrain, rewards, narrative, storyTitle,
        lordId: _lord.id, lordName: _lord.name,
      });
      const rewardStr = rewards.filter(r => r.type !== 'xp').map(r => `+${r.amount} ${r.type}`).join(', ');
      ActivityService.log(_player.id, {
        type: 'discovery', icon: def.icon || gi('magnifying-glass'),
        title: `${reportName} claimed`,
        detail: rewardStr || `+${rewards.find(r => r.type === 'xp')?.amount || 0}${gi('round-star')}`,
        lordName: _lord.name,
      });
      _toast(`${reportName} — see Quests tab`);
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
    document.getElementById('qd-clear-all')?.addEventListener('click', () => {
      if (!confirm(`Clear all quest history for ${_lord.name}? This cannot be undone.`)) return;
      DiscoveryService.clearLog(_player.id, _lord.id);
      _renderTab();
    });
  }

  // Called when player clicks "⚔ Attack" on a combat discovery.
  // Battle resolution is fully server-authoritative (server/actions/pve-attack.js) —
  // the client never computes the outcome itself. It re-derives the same encounter
  // from the discovery record's server-rolled campDetails and runs BattleEngine
  // there, so nothing about wins/losses/loot is client-supplied.
  async function _claimDiscovery(recordId) {
    const record = DiscoveryService.getActive(_player.id).find(r => r.id === recordId);
    if (!record) { _toast('Camp no longer available.'); return; }
    const def = DISCOVERY_DEFS[record.definitionId];
    if (!def || def.category !== 'combat') return;

    const result = await ServerActions.pveAttack(_lord.id, recordId);
    if (!result.ok) {
      _toast(result.error || 'Attack failed — try again.');
      return;
    }

    const report = result.report;
    const meta    = report._meta || {};
    const outcome = report.winner === 'attacker' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat';
    const resourceLoot = outcome === 'victory' ? report.loot.resource : null;

    DiscoveryService.addLog(_player.id, {
      definitionId:  def.id,
      tileX:         record.tileX,
      tileY:         record.tileY,
      terrain:       record.terrain,
      rewards:       [],
      wasAttack:     true,
      combatOutcome: outcome === 'victory' ? 'victory' : 'defeat',
      lordId:        _lord.id,
      lordName:      _lord.name,
    });

    BattleHistoryService.save(_lord.id, {
      outcome,
      campName:   meta.campName  || 'Enemy',
      campIcon:   meta.campIcon  || gi('crossed-swords'),
      campLevel:  meta.campLevel || null,
      terrain:    meta.terrain   || null,
      goldEarned: outcome === 'victory' ? report.loot.gold : 0,
      resourceLoot,
      xpEarned:   report.xpEarned,
      modelsLost: report.attacker.modelsLost,
      rounds:     report.rounds,
      reason:     report.reason,
      report,
      honorEarned: result.honorDelta || 0,
    });

    const actIcon  = outcome === 'victory' ? gi('crossed-swords') : outcome === 'draw' ? gi('shaking-hands') : gi('skull-crossed-bones');
    const actTitle = outcome === 'victory' ? `Victory: ${meta.campName || 'Enemy'}`
                   : outcome === 'draw'    ? `Draw: ${meta.campName || 'Enemy'}`
                   : `Defeat: ${meta.campName || 'Enemy'}`;
    const resLabel = Object.entries(resourceLoot || {}).map(([t, amt]) => ` · +${amt} ${_RES_ICONS[t] || ''}`).join('');
    ActivityService.log(_player.id, {
      type:     `battle_${outcome}`,
      icon:     actIcon,
      title:    actTitle,
      detail:   `${report.rounds} rounds · losses: ${report.attacker.modelsLost}${outcome === 'victory' ? ` · +${report.loot.gold}${gi('two-coins')}${resLabel}` : ''} · +${report.xpEarned}${gi('round-star')}`
        + (result.honorDelta ? ` · ${result.honorDelta > 0 ? '+' : ''}${result.honorDelta}${gi('scales')}` : ''),
      lordName: _lord.name,
    });

    // Server already persisted everything (army, lord, player, honor, discoveries) —
    // just re-read the freshly-hydrated local cache that ServerActions.pveAttack wrote.
    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    HUD.refresh();

    if (result.leveled > 0) _toast(`Level up! Now level ${_lord.level}.`);
    const outcomeLabel = outcome === 'victory' ? 'Victory' : outcome === 'draw' ? 'Draw' : 'Defeat';
    _toast(`${outcomeLabel} — report in the Battles tab`);
    _activeTab = 'battles';
    _stopCountdown();
    _renderTab();
    _startCountdown();
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
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

  async function _ransomNow() {
    const result = await ServerActions.ransomLord(_lord.id);
    if (!result.ok) { _toast(result.error || 'Server error'); return; }
    _toast('Ransom paid — your lord is free.');
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
      else if (c.actionId === 'move_lord')     _toast(`Arrived at (${c.destX}, ${c.destY}).`);
    }
    HUD.refresh();
    _stopCountdown();
    _renderTab();
    _startCountdown();
  }

  // Server-authoritative — previously this faked a past finishAt purely
  // client-side (spent credits locally, ticked it, saved), which displayed
  // as complete but was never actually applied server-side: the next full
  // sync/refresh reverted it back to "still training" since the server's
  // own copy of finishAt was untouched. /api/city/instant-recruit is the
  // real fix — spends credits, applies the unit, and resequences whatever's
  // left in the queue, all server-side.
  async function _finishRecruitmentNow() {
    const city = _getLordCurrentCity();
    if (!city || (city.recruitmentQueue || []).length === 0) return;
    const job = city.recruitmentQueue[0];
    const btn = document.getElementById('la-finish-recruit');
    if (btn) btn.disabled = true;

    const result = await ServerActions.instantRecruit(city.id);
    if (!result.ok) {
      if (btn) btn.disabled = false;
      _toast(result.error || 'Server error');
      return;
    }

    _player = PlayerService.getById(_player.id);
    const uDef = UNIT_DEFS[job.unitId];
    _toast(`${uDef?.name || job.unitId} ×${job.count} ready!`);
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
                _toast('Attack dispatched — resolving on server…');
                setTimeout(async () => {
                  await ServerActions.syncNow();
                  _lord = LordService.getById(_lord.id);
                  _stopCountdown();
                  _activeTab = 'battles';
                  _renderTab();
                  _startCountdown();
                }, 6000);
              } else {
                _toast(`Arrived at (${c.destX}, ${c.destY}).`);
                ActivityService.log(_player.id, {
                  type:     'lord_moved',
                  icon:     gi('position-marker'),
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
            if (c.leveled > 0) _toast(`Level Up! Now Level ${_lord.level}.`);
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
          // Same numbers, mirrored into the Status section's own raiding bar (see _overviewTabHtml).
          const statusTimerEl = document.getElementById('lov-status-stance-timer');
          const statusFillEl  = document.getElementById('lov-status-stance-fill');
          if (statusTimerEl) statusTimerEl.textContent = TimeService.formatDuration(sRemain);
          if (statusFillEl)  statusFillEl.style.width  = `${sPct}%`;
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
            _toast(`${uDef?.name || c.unitId} ×${c.count} ready!`);
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

  // Exposed so App can stop this screen's background timer when navigating
  // away to a different screen. Without this, _tickTimer keeps firing after
  // the user leaves — _renderTab()/_resolveSearch() etc. self-defend against
  // missing DOM (harmless no-op), but the interval leaks forever and keeps
  // doing pointless work (tickActions, syncNow calls) for a screen nobody is
  // looking at. See also OverviewScreen.stop(), which has the same purpose
  // but a more serious consequence if left uncalled (see app.js _goto).
  function stop() {
    _stopCountdown();
  }

  function _toast(msg) { ToastService.show(msg); }

  return { render, stop };
})();
