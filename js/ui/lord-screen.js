// =============================================
//  lord-screen.js — Full-screen lord management
// =============================================

const LordScreen = (() => {
  let _lord      = null;
  let _player    = null;
  let _activeTab = 'overview';
  let _tickTimer = null;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player, openTab, autoAttackRecordId }) {
    _player    = player;
    _lord      = LordService.getById(lord.id);
    _activeTab = openTab || 'overview';

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
      _lord = LordService.getById(_lord.id);
      completed.forEach(c => {
        if (c.actionId === 'search_area') {
          _resolveSearch();
        } else if (c.actionId === 'move_lord') {
          if (c.intent === 'attack') {
            _toast('⚔ Ataque ejecutado — resolviendo en servidor…');
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
              title: `${_lord.name} llegó a (${c.destX}, ${c.destY})`,
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
              <button class="ls-tab ${_activeTab === 'battles'   ? 'ls-tab--active' : ''}" data-tab="battles">🗡 Batallas${(() => { const n = BattleHistoryService.getForLord(_lord.id).length; return n > 0 ? `<span class="ls-tab-badge ls-tab-badge--neutral">${n}</span>` : ''; })()}</button>
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
        document.getElementById('lov-debug-camp-btn')?.addEventListener('click', () => {
          DiscoveryService.spawnBanditCamp(_lord, _player.id, _armyPower(_lord.id));
          _lord = LordService.getById(_lord.id);
          _renderTab();
          _refreshDiscoveryBadge();
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
          if (!stanceId) { _toast('Selecciona una postura primero.'); return; }
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

  // Detection difficulty per terrain — open terrain = easy to spot enemies.
  const _TERRAIN_DETECTION = {
    plains: 1.00, hills: 0.70, forest: 0.45,
    mountain: 0.40, marsh: 0.40, desert: 0.80, coast: 0.90,
  };
  function _terrainDetectionMod(terrainId) { return _TERRAIN_DETECTION[terrainId] ?? 0.75; }

  // Scan for enemy lords & cities on the current tile and log intel results.
  // Called once per completed Search Area action, before the random discovery roll.
  //
  // Enemy lord detection is server-side: the client only has own-player data in
  // localStorage (RLS prevents reading other players' rows). The /api/scan/tile
  // endpoint uses the service role key to check all lords + army sizes server-side
  // and returns only those that pass the visibility check.
  async function _scanIntelligence(x, y, terrain) {
    const isRogue = _lord.classId === 'rogue';

    // Enemy cities on this tile — progressive scouting (vague → clear → precise).
    // NOTE: In multiplayer, CityService.getAll() only has the current player's cities
    // (RLS isolation), so this block is effectively Phase 2. Kept as a seam.
    CityService.getAll()
      .filter(c => c.x === x && c.y === y && c.playerId !== _player.id)
      .forEach(city => {
        const existing     = IntelligenceService.getByType(_player.id, 'enemy_city')
          .find(r => r.tileX === x && r.tileY === y);
        const alreadyKnown = !!existing;
        const garrison     = CityService.getGarrison(city);
        const intelRec     = IntelligenceService.buildRecord(_lord, {
          type:        'enemy_city',
          tileX:       x,
          tileY:       y,
          currentTier: existing?.qualityTier ?? null,
          rawData: {
            name:          city.name,
            population:    Math.floor(city.population || 0),
            garrisonCount: garrison.reduce((s, r) => s + r.count, 0),
            garrisonUnits: garrison,
          },
        });
        if (!alreadyKnown) {
          IntelligenceService.addRecord(_player.id, intelRec);
        } else if (existing.qualityTier !== 'precise') {
          IntelligenceService.removeRecord(_player.id, existing.id);
          IntelligenceService.addRecord(_player.id, intelRec);
        }
        DiscoveryService.addLog(_player.id, {
          definitionId: 'enemy_city', tileX: x, tileY: y, terrain: terrain.id, rewards: [],
          intelQuality: intelRec.qualityTier,
          detail:       intelRec.data?.name || null,
          alreadyKnown,
        });
      });

    // Enemy lords on this tile — server-side detection (service role key).
    // Client-side LordService.getAll() only returns own lords; army sizes of enemies
    // are never in localStorage. The server checks both visibility conditions and
    // returns only lords that pass, with enough data to build the intel record.
    try {
      const { data: { session } } = await SupabaseService.client.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      const resp = await fetch('/api/scan/tile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ tileX: x, tileY: y }),
      });
      if (!resp.ok) return;
      const d = await resp.json();
      if (!d.ok || !Array.isArray(d.discoveries)) return;

      d.discoveries.forEach(disc => {
        const intelRec = IntelligenceService.buildRecord(_lord, {
          type:    disc.type,
          tileX:   disc.tileX,
          tileY:   disc.tileY,
          ttl:     disc.ttl,
          rawData: disc.rawData,
        });
        IntelligenceService.addRecord(_player.id, intelRec);
        DiscoveryService.addLog(_player.id, {
          definitionId: 'enemy_lord', tileX: x, tileY: y, terrain: terrain.id, rewards: [],
          intelQuality: intelRec.qualityTier,
          detail: (isRogue && disc.rawData?.stanceName) ? disc.rawData.stanceName : null,
        });
      });
    } catch (e) {
      console.warn('[scan] enemy lord server scan failed:', e.message);
    }
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
    }

    // ── Location card ─────────────────────────────────────────────
    let terrainHtml;
    if (_lord.x == null) {
      terrainHtml = `<p class="lov-pos-none">No position — claim a city to place your lord on the map.</p>`;
    } else {
      const terrain     = WorldService.getTerrain(_lord.x, _lord.y);
      const isSearching = busy && queueItem.actionId === 'search_area'; // action id kept for compat
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
      } else if (!busy) {
        searchHtml = `
          <div class="lov-lc-btns">
            <button class="lov-search-btn" id="lov-search-btn">🗺 Send on Quest</button>
            <button class="lov-move-btn" id="lov-move-btn">🗺 Go to Map</button>
            <button class="lov-debug-btn" id="lov-debug-camp-btn">🏕 Bandit Camp</button>
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
        <div class="lov-status lov-status--stanced">${stanceDef.icon} Postura: ${stanceDef.name}</div>
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
            <button class="lov-stance-start-btn" id="lov-stance-start" disabled>Iniciar</button>
          </div>
          <div class="lov-stance-pick-desc" id="lov-stance-desc">${busy ? 'No disponible mientras el lord está ocupado' : 'Selecciona una postura'}</div>
        </div>
      `;
    }

    // ── Army ──────────────────────────────────────────────────────
    const army        = ArmyService.get(_lord.id);
    const totalUnits  = army.units.reduce((s, u) => s + u.count, 0);
    const totalUpkeep = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
    const totalPower  = _armyPower(_lord.id);
    const maxPower    = LordService.getArmyPowerCap(_lord);
    const overviewCmdCap = LordService.getCommandCapacity(_lord);
    const overCap     = totalPower > maxPower;
    const armyHtml    = army.units.length === 0
      ? `<p class="lov-pos-none">No troops mustered — recruit from the Army tab.</p>`
      : `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: false })}</div>
        <div class="la-army-total">
          ${totalUnits} / ${overviewCmdCap} units
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
            <span class="lov-army-power${overCap ? ' lov-army-power--over' : ''}">⚔ ${totalPower} / ${maxPower} CP</span>
          </div>
          ${armyHtml}
        </div>
        <div class="lov-section-divider"></div>
        <div class="lov-section">
          <div class="lov-section-title">Postura</div>
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

  const ARMY_LIMIT = 10;

  // ── Unit Requirements panel ───────────────────────────────────

  function _unitRequirementsHtml() {
    const city       = _getLordCurrentCity();
    const raceRoster = UNIT_ROSTER[_lord.race];
    const race       = RACES[_lord.race];

    if (!raceRoster) {
      return `<p class="ur-empty">No unit roster defined for ${race?.name || _lord.race}.</p>`;
    }

    const cityNote = city
      ? `Requisitos para <strong>${city.name}</strong>`
      : '<em>Tu lord no está en una ciudad — los niveles de edificios no están disponibles.</em>';

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
    const totalUnits  = army.units.reduce((s, u) => s + u.count, 0);
    const cmdCap      = LordService.getCommandCapacity(_lord);
    const atLimit     = totalUnits >= cmdCap;
    const currentCP   = _armyPower(_lord.id);
    const maxCP       = LordService.getArmyPowerCap(_lord);
    const overCap     = currentCP > maxCP;

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
      const total       = army.units.reduce((s, u) => s + u.count, 0);
      const totalUpkeep = army.units.reduce((s, u) => s + (UNIT_DEFS[u.unitId]?.upkeep || 0) * u.count, 0);
      armyListHtml = `
        <div class="la-unit-cards">${_armyCardsHtml(army, { removable: true })}</div>
        <div class="la-army-total">
          ${total} / ${cmdCap} units
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
              <div class="la-bar"><div class="la-fill" id="la-recruit-fill" style="width:${pct}%"></div></div>
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
          const unitCP     = _unitPower(def);
          const wouldExceedCap = currentCP + unitCP > maxCP;
          const disabled   = busy || !canAfford || atLimit || wouldExceedCap;
          const btnLabel   = busy ? 'Training…' : atLimit ? 'Army Full' : wouldExceedCap ? '⚠ Límite CP' : canAfford ? 'Recruit' : 'No gold';
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
          const unitCP     = _unitPower(def);
          const wouldExceedCap = currentCP + unitCP > maxCP;
          const disabled   = !canAfford || atLimit || wouldExceedCap;
          const btnLabel   = atLimit ? 'Army Full' : wouldExceedCap ? '⚠ Límite CP' : canAfford ? 'Hire' : 'No gold';
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
          <span class="la-army-cp${overCap ? ' la-army-cp--over' : ''}">⚔ ${currentCP} / ${maxCP} CP</span>
        </div>
        ${armyListHtml}
        <div class="la-section-divider"></div>
        <div class="la-section-header-row">
          <div class="la-section-title">Recruit</div>
          <button class="ur-open-btn" id="ur-open-btn">📋 Ver Requisitos</button>
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

    // Dismiss unit from army
    document.querySelectorAll('.la-uc-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
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
    if (s < 60)          return 'ahora mismo';
    const m = Math.floor(s / 60);
    if (m < 60)          return `hace ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)          return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
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

    const entries = log.map(entry => {
      const def       = DISCOVERY_DEFS[entry.definitionId];
      const isNothing = !def || def.category === 'nothing';
      const isCombat  = def && _ACTION_CATEGORIES.has(def.category);
      const terrain   = TERRAIN_TYPES[entry.terrain] || { icon: '🌍', name: entry.terrain || 'Unknown' };
      const ago       = _timeAgo(TimeService.now() - entry.loggedAt);
      const icon      = def ? def.icon : '❓';
      const name      = isNothing ? 'Nothing found' : (def ? def.name : 'Quest');

      // ── Summary status dot (small visual hint only) ──
      let statusDot = '';
      if (entry.wasAttack) {
        const won = entry.combatOutcome === 'victory';
        statusDot = `<span class="disc-log-status-dot ${won ? 'disc-log-dot--win' : 'disc-log-dot--loss'}"></span>`;
      } else if (isCombat) {
        statusDot = `<span class="disc-log-status-dot disc-log-dot--camp"></span>`;
      } else if (isNothing) {
        statusDot = `<span class="disc-log-status-dot disc-log-dot--nothing"></span>`;
      } else {
        statusDot = `<span class="disc-log-status-dot disc-log-dot--found"></span>`;
      }

      // ── Expanded report ──
      const narrativeSection = entry.narrative ? `
        <div class="disc-report-section">
          <div class="disc-report-section-title">Scout Report</div>
          <div class="disc-report-narrative">${entry.narrative}</div>
        </div>` : '';

      let outcomeSection = '';
      if (entry.wasAttack) {
        const won  = entry.combatOutcome === 'victory';
        const cls  = won ? 'disc-report-outcome--win' : 'disc-report-outcome--loss';
        const lbl  = won ? 'Victory' : 'Defeat';
        const sub  = won
          ? 'The camp has been cleared and its spoils taken. Full battle report in the Battles tab.'
          : 'Your forces were repelled. The camp still stands. Full battle report in the Battles tab.';
        outcomeSection = `
          <div class="disc-report-section">
            <div class="disc-report-outcome-card ${cls}">
              <span class="disc-report-outcome-icon">${won ? '⚔' : '☠'}</span>
              <div class="disc-report-outcome-body">
                <div class="disc-report-outcome-title">${lbl}</div>
                <div class="disc-report-outcome-sub">${sub}</div>
              </div>
            </div>
          </div>`;
      } else if (isCombat) {
        const defDesc = def?.description || '';
        outcomeSection = `
          <div class="disc-report-section">
            <div class="disc-report-section-title">Discovery</div>
            <div class="disc-report-outcome-card disc-report-outcome--camp">
              <span class="disc-report-outcome-icon">${icon}</span>
              <div class="disc-report-outcome-body">
                <div class="disc-report-outcome-title">${name}</div>
                ${defDesc ? `<div class="disc-report-outcome-sub">${defDesc}</div>` : ''}
                <div class="disc-report-camp-hint">📍 Visible on the map at (${entry.tileX}, ${entry.tileY}). Move your lord there and attack when ready.</div>
              </div>
            </div>
          </div>`;
      } else if (!isNothing && entry.rewards && entry.rewards.length > 0) {
        const chips = entry.rewards
          .filter(r => _RES_ICONS[r.type] && r.amount > 0)
          .map(r => `<span class="disc-report-chip">${_RES_ICONS[r.type]} +${r.amount} ${r.type}</span>`)
          .join('');
        if (chips) {
          outcomeSection = `
            <div class="disc-report-section">
              <div class="disc-report-section-title">Resources Secured</div>
              <div class="disc-report-chips">${chips}</div>
            </div>`;
        }
      } else if (isNothing) {
        outcomeSection = `
          <div class="disc-report-section">
            <div class="disc-report-outcome-card disc-report-outcome--nothing">
              <span class="disc-report-outcome-icon">—</span>
              <div class="disc-report-outcome-body">
                <div class="disc-report-outcome-title">Nothing found</div>
                <div class="disc-report-outcome-sub">The area yielded no discoveries this time. Try again later or explore a different tile.</div>
              </div>
            </div>
          </div>`;
      }

      return `
        <details class="disc-log-entry${isNothing ? ' disc-log-entry--nothing' : ''}${isCombat && !entry.wasAttack ? ' disc-log-entry--camp' : ''}">
          <summary class="disc-log-summary">
            ${statusDot}
            <div class="disc-log-body">
              <span class="disc-log-name">Quest — ${terrain.icon} ${terrain.name} (${entry.tileX ?? '?'}, ${entry.tileY ?? '?'})</span>
              <span class="disc-log-meta">${ago}</span>
            </div>
            <button class="disc-log-dismiss" data-log-id="${entry.id}" title="Dismiss">✕</button>
          </summary>
          <div class="disc-log-detail">
            <div class="disc-report-terrain-row">
              <span class="disc-report-terrain-icon">${terrain.icon}</span>
              <span class="disc-report-terrain-name">${terrain.name}</span>
              <span class="disc-report-terrain-sep">·</span>
              <span class="disc-report-coords">(${entry.tileX ?? '?'}, ${entry.tileY ?? '?'})</span>
              <span class="disc-report-terrain-sep">·</span>
              <span class="disc-report-ago">${ago}</span>
            </div>
            ${narrativeSection}
            ${outcomeSection}
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
          <span class="camp-level-badge">Nivel ${cd.level}</span>
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

  const _OUTCOME_META = {
    victory: { label: 'Victoria', icon: '⚔', css: 'bh-victory' },
    defeat:  { label: 'Derrota',  icon: '☠', css: 'bh-defeat'  },
    draw:    { label: 'Empate',   icon: '🤝', css: 'bh-draw'    },
  };

  const _REASON_LABELS_TAB = {
    eliminated: 'Eliminación total',
    routed:     'Dispersión',
    retreated:  'Retirada',
    max_rounds: 'Duración máxima',
  };

  function _battlesTabHtml() {
    const battles = BattleHistoryService.getForLord(_lord.id);

    if (battles.length === 0) {
      return `
        <div class="bh-empty">
          <div class="bh-empty-icon">🗡</div>
          <p class="bh-empty-msg">Sin batallas registradas aún.</p>
          <p class="bh-empty-hint">Ataca un campamento en la pestaña Descubrimientos.</p>
        </div>`;
    }

    const rows = battles.map((b, idx) => {
      const om     = _OUTCOME_META[b.outcome] || _OUTCOME_META.defeat;
      const date   = new Date(b.at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
      const time   = new Date(b.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const loot   = b.outcome === 'victory' && b.goldEarned > 0 ? `+${b.goldEarned}💰 · ` : '';
      return `
        <div class="bh-entry ${om.css}" data-bh-idx="${idx}">
          <div class="bh-entry-header">
            <span class="bh-outcome-badge ${om.css}">${om.icon} ${om.label}</span>
            <span class="bh-camp-name">${b.campIcon || '⚔'} ${b.campName}</span>
            <span class="bh-date">${date} ${time}</span>
          </div>
          <div class="bh-entry-stats">
            <span>Rondas: <strong>${b.rounds}</strong></span>
            <span>Bajas: <strong>${b.modelsLost}</strong></span>
            <span>${loot}+${b.xpEarned}⭐</span>
            <span class="bh-reason">${_REASON_LABELS_TAB[b.reason] || b.reason}</span>
          </div>
          <button class="bh-log-toggle" data-bh-idx="${idx}">📜 Ver informe</button>
          <div class="bh-log-body hidden" id="bh-log-${idx}">
            ${b.report ? _battleLogHtml(b.report) : '<em>Informe no disponible</em>'}
          </div>
        </div>`;
    }).join('');

    return `<div class="bh-list">${rows}</div>`;
  }

  function _battleLogHtml(report) {
    const _PHASE_LABELS_TAB = {
      passive: 'Pasivo', ranged: 'Distancia', charge: 'Carga',
      melee: 'Melee', morale: 'Moral', end_round: 'Fin ronda',
    };
    const _RESULT_LABELS_TAB = {
      hit: 'golpe', killed: 'modelo muerto', eliminated: 'ELIMINADO',
      miss: 'esquivado', routed: 'DISPERSADO', retreated: 'RETIRADA', healed: 'curado',
    };

    const unitCols = `
      <div class="bh-unit-cols">
        <div class="bh-unit-col">
          <div class="bh-unit-col-header">Tu Ejército</div>
          ${report.attacker.unitsStart.map(s => {
            const surv = report.attacker.unitsSurviving.find(u => u.sourceId === s.sourceId);
            const cnt  = surv?.count ?? 0;
            const def  = UNIT_DEFS[s.sourceId];
            const icon = def?.icon || '⚔';
            const name = def?.name || s.sourceId;
            const badge = cnt === 0 ? '☠' : cnt < s.count ? '🩹' : '✓';
            return `<div class="bh-unit-row"><span>${icon} ${name}</span><span class="bh-unit-cnt">${badge} ${cnt}/${s.count}</span></div>`;
          }).join('')}
        </div>
        <div class="bh-unit-col">
          <div class="bh-unit-col-header">Enemigo</div>
          ${report.defender.unitsStart.map(s => {
            const surv    = report.defender.unitsSurviving.find(u => u.sourceId === s.sourceId);
            const cnt     = surv?.count ?? 0;
            const rawId   = s.sourceId.replace(/^d\d+_/, ''); // strip PvP prefix (d0_unitId → unitId)
            const def     = UNIT_DEFS[rawId];
            const icon    = def?.icon || '⚔';
            const name    = def?.name || rawId;
            const badge = cnt === 0 ? '☠' : cnt < s.count ? '🩹' : '✓';
            return `<div class="bh-unit-row"><span>${icon} ${name}</span><span class="bh-unit-cnt">${badge} ${cnt}/${s.count}</span></div>`;
          }).join('')}
        </div>
      </div>`;

    const logLines = report.events.map(e => {
      const phase = _PHASE_LABELS_TAB[e.phase] || e.phase;
      const res   = _RESULT_LABELS_TAB[e.result] || e.result;
      if (!e.actorName || !e.targetName) {
        return `<div class="bh-log-line bh-log-${e.result || 'hit'}">[R${e.round} ${phase}] ${e.result === 'routed' ? '💥' : '🚶'} ${res}</div>`;
      }
      if (e.result === 'healed') {
        return `<div class="bh-log-line bh-log-healed">[R${e.round} ${phase}] ${e.actorName} ✚ ${-e.damage} curado</div>`;
      }
      const dmg   = e.damage > 0 ? ` ⚔ ${e.damage}` : '';
      const trait = e.trait ? ` (${e.trait})` : '';
      return `<div class="bh-log-line bh-log-${e.result || 'hit'}">[R${e.round} ${phase}] ${e.actorName} → ${e.targetName}${dmg}${trait} — ${res}</div>`;
    }).join('');

    return `${unitCols}<div class="bh-log-lines">${logLines}</div>`;
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
    // Scan the tile for PvP intel (stays client-side — reads other players' data).
    if (_lord.x != null) {
      const terrain = WorldService.getTerrain(_lord.x, _lord.y);
      await _scanIntelligence(_lord.x, _lord.y, terrain);
    }

    const oldLevel = _lord.level || 1;
    const result   = await ServerActions.questResolve(_lord.id);
    if (!result.ok) {
      _toast(result.error || 'Quest error — please refresh');
      return;
    }

    // Hydrate from server response (XP, coins, resources already applied server-side).
    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    if ((_lord.level || 1) > oldLevel) _toast(`⭐ ¡Subiste de nivel! Ahora nivel ${_lord.level}.`);

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
    document.querySelectorAll('.disc-log-dismiss[data-log-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); // prevent toggling the <details> parent
        DiscoveryService.dismissLog(_player.id, btn.dataset.logId);
        _renderTab();
      });
    });
  }

  // Shared reward application — used by auto-resolve AND manual Attack
  const _RES_TYPES_CITY = ['food', 'wood', 'stone', 'iron'];
  async function _applyRewards(rewards) {
    let xpGained   = 0;
    let cityForRes = null;
    rewards.forEach(r => {
      if (r.type === 'xp') {
        xpGained += r.amount;
      } else if (r.type === 'gold') {
        const p = PlayerService.getById(_player.id);
        PlayerService.update(_player.id, { coins: (p.coins || 0) + r.amount });
        _player = PlayerService.getById(_player.id);
      } else if (_RES_TYPES_CITY.includes(r.type)) {
        if (!cityForRes) cityForRes = _getLordCurrentCity() || CityService.getPlayerCities(_player.id)[0] || null;
        if (cityForRes) {
          cityForRes.resources = cityForRes.resources || {};
          cityForRes.resources[r.type] = (cityForRes.resources[r.type] || 0) + r.amount;
          CityService.save(cityForRes);
        }
      }
    });
    if (xpGained > 0) {
      _lord.xp = (_lord.xp || 0) + xpGained;
      const leveled = LordService.checkLevelUp(_lord);
      LordService.save(_lord);
      _lord = LordService.getById(_lord.id);
      if (leveled > 0) _toast(`⭐ ¡Subiste de nivel! Ahora nivel ${_lord.level}.`);
      await ServerActions.saveLordXp(_lord.id, _lord); // must complete before syncNow() reads Supabase
    }
    HUD.refresh();
  }

  // Called when player clicks "⚔ Atacar" on a combat discovery
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
      name:           `${campDef.displayName || 'Campamento'}${cd ? ` (Nivel ${cd.level})` : ''}`,
      startingMorale: campDef.morale || 55,
      loot:           { goldMin: Math.round(baseLoot.goldMin * mult), goldMax: Math.round(baseLoot.goldMax * mult) },
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

    if (leveled > 0) _toast(`⭐ ¡Subiste de nivel! Ahora nivel ${freshLord.level}.`);
    const outcomeLabel = report.winner === 'attacker' ? '⚔ Victoria' : report.winner === 'draw' ? '🤝 Empate' : '☠ Derrota';
    _toast(`${outcomeLabel} — informe en pestaña Batallas`);
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
          _lord = LordService.getById(_lord.id);
          for (const c of completed) {
            if (c.actionId === 'search_area') {
              await _resolveSearch();
            } else if (c.actionId === 'move_lord') {
              if (c.intent === 'attack') {
                _toast('⚔ Ataque ejecutado — resolviendo en servidor…');
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
                  title:    `${_lord.name} llegó a (${c.destX}, ${c.destY})`,
                  detail:   '',
                  lordName: _lord.name,
                });
              }
            } else {
              _toast(`✓ ${c.name} completed!`);
              ActivityService.log(_player.id, {
                type:     'action_complete',
                icon:     '✓',
                title:    `${c.name} completado`,
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
          if (fillEl)  fillEl.style.width  = `${Math.floor(RecruitmentService.progress(city) * 100)}%`;
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
