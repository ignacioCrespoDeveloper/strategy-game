// =============================================
//  lord-screen.js — Full-screen lord management
// =============================================

const LordScreen = (() => {
  let _lord            = null;
  let _player          = null;
  let _activeTab       = 'overview';
  let _tickTimer       = null;
  let _resolvingSearch = false;
  // Troop-exchange mode (Army tab): partner lord id + the model-level
  // preview state. Client-side only until Confirm posts /api/army/transfer.
  let _exchangeWith    = null;
  let _exchangeState   = null; // { a: [{unitId, hp, home}], b: [...] } — hp null = fresh model
  // Chosen expedition length (DiscoveryRoll.LENGTHS). Session-only and
  // deliberately sticky across lords — a player who has settled on Long
  // expeditions shouldn't have to re-pick every time they open a lord.
  let _questLength     = DiscoveryRoll.DEFAULT_LENGTH;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { lord, player, openTab }) {
    _player          = player;
    _lord            = LordService.getById(lord.id);
    _activeTab       = openTab || 'overview';
    _exchangeWith    = null;
    _exchangeState   = null;

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
    // A stance whose def no longer exists (the retired 'ambush', 2026-07-29)
    // would leave the lord stuck: Status reports "Idle", the Location card
    // still blocks every action, and there is no exit button any more. Reset
    // it here rather than waiting out the original timer.
    if (_lord.stance.id && !STANCE_DEFS[_lord.stance.id]) {
      _lord.stance = { id: 'idle', startedAt: null, finishAt: null };
      changed = true;
    }

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
              <button class="ls-tab ${_activeTab === 'mount'     ? 'ls-tab--active' : ''}" data-tab="mount" ${(_lord.level || 1) < MOUNT_MIN_LEVEL ? `title="Unlocks at level ${MOUNT_MIN_LEVEL}"` : ''}>${gi('horse-head')} Mount${(_lord.level || 1) >= MOUNT_MIN_LEVEL && !_lord.mountId ? '<span class="ls-tab-badge ls-tab-badge--gold">!</span>' : ''}</button>
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
    const atMaxLevel = level >= LORD_MAX_LEVEL;
    // A capped lord sits at a permanently full bar; without a label that reads
    // as "about to level" forever rather than "done".
    const xpPct   = atMaxLevel ? 100 : Math.min(100, Math.floor((xp / xpNext) * 100));

    const effective = LordService.getEffectiveStats(_lord);
    const maxHp     = effective.health;
    const curHp     = Math.min(_lord.currentHp ?? maxHp, maxHp);
    const hpPct     = Math.min(100, Math.floor((curHp / maxHp) * 100));

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

    const portraitSrc  = _lord.portrait || pickLordPortrait(_lord.race, _lord.classId, _lord.id) || race.portrait;
    const portraitHtml = portraitSrc
      ? `<div class="lsl-portrait-area lsl-portrait-area--image${lordIsDown ? ' lsl-portrait-area--down' : ''}">
           <img class="lsl-portrait-img" src="${portraitSrc}" alt="${_lord.name}" />
           <div class="lsl-portrait-fade"></div>
           <div class="lsl-portrait-glow" style="background:radial-gradient(ellipse at 50% 80%, ${race.portraitGlow || 'rgba(200,147,58,0.25)'} 0%, transparent 70%)"></div>
           ${downOverlay}${activityOverlay}
           <div class="lsl-portrait-level lvl-medal" title="Level ${level}">${gi('laurel-crown', 'lvl-medal-icon')}<span class="lvl-medal-num">${level}</span></div>
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
           <div class="lsl-portrait-level lvl-medal" title="Level ${level}">${gi('laurel-crown', 'lvl-medal-icon')}<span class="lvl-medal-num">${level}</span></div>
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

    // (The Mount slot lived here until 2026-07-29. It moved to the Overview
    // tab, into the slot the retired Stance section used to occupy — the left
    // rail is the lord's identity and stat readout, and the mount card needs
    // the room to show its art.)

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
          <span class="lsl-bar-label-val">${atMaxLevel ? `Level ${LORD_MAX_LEVEL} — MAX` : `${xp} / ${xpNext} XP`}</span>
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
    document.getElementById('ls-ransom-now')?.addEventListener('click', _ransomNow);

    // Force back to overview while downed
    if (LordService.isDown(_lord) && (_activeTab === 'army' || _activeTab === 'discovery')) {
      _activeTab = 'overview';
    }

    switch (_activeTab) {
      case 'overview':
        content.innerHTML = _overviewTabHtml();
        document.getElementById('lov-finish-lord')?.addEventListener('click', _finishLordActionNow);
        document.getElementById('lov-cancel-action')?.addEventListener('click', _cancelLordActionNow);
        // Every lord action routes through its own confirmation screen first
        // (ActionConfirmView), matching the attack-order flow: the player sees
        // duration, cost and expected outcome, then commits there. Nothing on
        // this card fires an action directly any more.
        const _openConfirm = action => {
          _stopCountdown();
          App.navigate('action-confirm', {
            player: PlayerService.getById(_player.id),
            lord:   LordService.getById(_lord.id),
            action,
          });
        };
        document.getElementById('lov-search-btn')?.addEventListener('click', () => _openConfirm('quest'));
        document.getElementById('lov-scout-btn') ?.addEventListener('click', () => _openConfirm('scout'));
        document.getElementById('lov-raid-btn')  ?.addEventListener('click', () => _openConfirm('raid'));
        document.getElementById('lov-move-btn')  ?.addEventListener('click', () => {
          _stopCountdown();
          App.navigate('map', { player: PlayerService.getById(_player.id), lord: LordService.getById(_lord.id), mode: 'move-lord' });
        });
        // The Mount card sits where the Stance section used to; the whole card
        // jumps to the Mount tab (as does the empty slot's Equip button).
        document.querySelectorAll('#ls-content [data-action="open-mount-tab"]').forEach(el => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            _activeTab = 'mount';
            document.querySelectorAll('.ls-tab').forEach(b => b.classList.toggle('ls-tab--active', b.dataset.tab === 'mount'));
            _renderTab();
            _startCountdown();
          });
        });
        // No generic "exit stance" button any more: raiding is the only stance
        // left and it owns two explicit exits (Cancel / Finish Now) below.
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
          // Plain text only — ToastService uses textContent (gi() would print
          // as literal SVG markup). The full itemised entry, with the lord it
          // belongs to, lands in the Activity feed on the next sync.
          const res      = result.resources || {};
          const resToast = ['food', 'wood', 'stone'].filter(k => res[k] > 0).map(k => `+${res[k]} ${k}`).join(', ');
          _toast(`Raid complete: +${result.goldEarned || 0} gold${resToast ? `, ${resToast}` : ''}`);
          _lord   = LordService.getById(_lord.id);
          // The payout lands on the player, not the lord — without this the
          // Mount tab's afford check still reads pre-raid gold.
          _player = PlayerService.getById(_player.id) || _player;
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

  // Preview of the raid payout. Reads the SAME EconomyCore rate the server
  // pays out with (at completion, never here), so the "earned so far" number
  // and the real payout can never disagree.
  function _raidHourlyRewardsPreview(lord) {
    return EconomyCore.getRaidHourlyRewards(lord.level);
  }

  // Army power if `addCount` more of `unitId` were added to this lord's army.
  // Mirrors server/actions/recruit.js's _projectedArmyPower via the same
  // EconomyCore helper — the server is the authoritative gate and this is
  // only the client-side pre-check that disables the Recruit/Hire button.
  function _projectedArmyPower(lordId, unitId, addCount) {
    const army = ArmyService.get(lordId);
    return EconomyCore.getProjectedArmyPower(army.units, UNIT_DEFS, unitId, addCount);
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

    // Stances (raiding) don't go through actionQueue, so `busy` alone
    // would call a raiding lord "Idle" — computed here (not just in the
    // Stance section below) so Status can tell the two apart too.
    const stanceObj  = LordService.getStance(_lord);
    const stanceDef  = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
    const isInStance = LordService.isStanced(_lord);
    const isRaiding  = isInStance && stanceObj.id === 'raiding';

    // ── Status ────────────────────────────────────────────────────
    let statusHtml;
    if (isRaiding) {
      // The whole raid lives here now — progress, earnings and both exits.
      // It used to be split between Status and a separate Stance section at
      // the bottom of the tab; that section is gone (raiding is the only
      // stance left), so the one place that answers "what is this lord doing"
      // owns its controls too. Raiding is server-authoritative with real gold
      // at stake, which is why the two exits are spelled out: Cancel is free
      // but forfeits everything earned, Finish Now pays credits to collect
      // the full reward immediately (server/actions/raid-{cancel,instant}.js).
      const sRemain    = Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000));
      const totalMs    = stanceObj.finishAt - stanceObj.startedAt;
      const elapsedMs  = TimeService.now() - stanceObj.startedAt;
      const sPct       = totalMs > 0 ? Math.min(100, Math.floor((elapsedMs / totalMs) * 100)) : 0;
      const rates      = _raidHourlyRewardsPreview(_lord);
      const elapsedHrs = Math.max(0, elapsedMs / 3_600_000);
      const goldSoFar  = Math.floor(rates.gold * elapsedHrs);
      const resSoFar   = Math.floor(rates.food * elapsedHrs); // all 4 resource types share the same rate
      const finishCost = Math.max(1, Math.ceil(sRemain / 60));
      statusHtml = `
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
          ${isAttacking
            ? `<button class="x-cancel-btn x-cancel-btn--wide" id="lov-cancel-action" title="Recall the attack (no refund)">✕ Recall</button>`
            : `<button class="ls-finish-btn" id="lov-finish-lord">${gi('power-lightning')} ${cost}${gi('cut-diamond')}</button>`}
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

      // Every lord action lives on this card. Each one opens a confirmation
      // screen first (ActionConfirmView) rather than firing immediately, so
      // the player sees duration, cost and expected outcome before committing
      // — same contract as the attack-order screen. "Go to Map" is plain
      // navigation, not an action, so it still goes straight there.
      let searchHtml;
      if (isSearching) {
        searchHtml = `<span class="lov-lc-busy">${gi('magnifying-glass')} Quest in progress on this tile…</span>`;
      } else if (isScouting) {
        searchHtml = `<span class="lov-lc-busy">${gi('spy')} Scouting this tile…</span>`;
      } else if (isTraveling) {
        searchHtml = `<span class="lov-lc-busy">${gi('compass')} Arrive first to act on this tile</span>`;
      } else if (isInStance) {
        searchHtml = `<span class="lov-lc-busy">${stanceDef.icon} ${stanceDef.name} — see Status above</span>`;
      } else if (!busy) {
        searchHtml = `
          <div class="lov-lc-btns">
            <button class="lov-search-btn" id="lov-search-btn">${gi('magnifying-glass')} Send on Quest</button>
            <button class="lov-scout-btn" id="lov-scout-btn" title="Gather intel on this tile's enemy lord and city.">${gi('spy')} Scout</button>
            <button class="lov-raid-btn" id="lov-raid-btn" title="Hold this tile and earn gold and resources over time. Enemy lords arriving here will fight you.">${STANCE_DEFS.raiding.icon} Raid</button>
            <button class="lov-move-btn" id="lov-move-btn">${gi('treasure-map')} Go to Map</button>
          </div>`;
      } else {
        searchHtml = `<span class="lov-lc-busy">Lord is busy</span>`;
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

    // ── Mount (own section, after Army) ──────────────────────────
    //
    // This slot used to be the Stance section. Stances are down to raiding
    // alone (the picker is gone, Ambush was removed 2026-07-29) and raiding
    // now reports inside Status, so the section was an empty placeholder most
    // of the time — the mount card took the space instead. Clicking anywhere
    // on the card opens the Mount tab.
    //
    // It renders the SAME card as the Mount tab's ladder, inside the same
    // .lm-mount-grid — so it lands on one grid track and comes out exactly the
    // width of a card over there (2026-07-29). It used to be a bespoke compact
    // card at 25% width, which meant the equipped mount looked like a different
    // object depending on which tab you were standing in.
    //
    // Here it's cut to art + name + "Equipped" (noFoot): Overview is a readout,
    // and the stat chips and Change button are both duplicated one tab over.
    // The whole card is the click target into that tab, so nothing is lost.
    const mountUnlocked = (_lord.level || 1) >= MOUNT_MIN_LEVEL;
    const chosenMount   = (typeof MOUNT_POOL !== 'undefined' && _lord.mountId)
      ? getMountForRace(_lord.mountId, _lord.race)
      : null;
    const mountCard = !mountUnlocked ? _mountEmptyTileHtml(true)
      : chosenMount ? _mountTileHtml(chosenMount, {
          equipped: true,
          link:     true,
          value:    'Equipped',
          noFoot:   true,
        })
      : _mountEmptyTileHtml(false);
    const mountHtml = `<div class="lm-mount-grid">${mountCard}</div>`;

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
      : `${_regenNoteHtml(army)}<div class="la-unit-cards">${_armyCardsHtml(army, { removable: false, regen: _isGarrisonRegen() })}</div>`;

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
          <div class="lov-section-title">Mount</div>
          ${mountHtml}
        </div>
      </div>
    `;
  }

  // ── Army tab ──────────────────────────────────────────────────

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

  function _getLordCurrentCity() {
    if (_lord.x == null) return null;
    return CityService.getPlayerCities(_player.id).find(c => c.x === _lord.x && c.y === _lord.y) || null;
  }

  // Garrison regen is active when the lord rests idle (no action, no stance,
  // not down) on one of its own city tiles — mirrors the server rule in
  // catch-up.js (1e). Drives the unit-card heal pip and the status note.
  function _isGarrisonRegen() {
    if (!_lord) return false;
    if ((_lord.actionQueue || []).length > 0) return false;
    if (LordService.isStanced(_lord)) return false;
    if (LordService.isDown(_lord))    return false;
    return !!_getLordCurrentCity();
  }

  // A visible "units are recovering" banner — shown above the roster whenever
  // the army is garrison-regenerating AND at least one unit is below full HP.
  function _regenNoteHtml(army) {
    if (!_isGarrisonRegen()) return '';
    const damaged = (army.units || []).some(u => {
      const m = UNIT_DEFS[u.unitId]?.combatStats?.hp;
      return m && (u.currentHp ?? m) < m;
    });
    if (!damaged) return '';
    return `<div class="la-regen-note">${gi('health-increase')} Resting in garrison — units recovering (+1%/min)</div>`;
  }

  // ── Shared unit card builder ───────────────────────────────────

  function _buildUnitCard(def, { removable = false, currentHp, maxHp, modelIdx = 0, regen = false } = {}) {
    const tierClass = unitTierClass(def);
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
      ? `<button class="la-uc-remove" data-unit-id="${def.id}" data-model-idx="${modelIdx}" title="Dismiss 1 — refunds gold based on remaining HP">×</button>`
      : '';

    // Regen pip — only shown on a damaged model while the army rests in a
    // friendly city (see _isGarrisonRegen). Signals "this unit is healing".
    const regenBadge = (regen && hpCur < hpMax)
      ? `<span class="la-uc-regen" title="Regenerating — resting in a friendly city">${gi('health-increase')}</span>`
      : '';

    return `
      <div class="la-uc-wrap">
        <div class="la-unit-card${tierClass ? ' ' + tierClass : ''}">
          <div class="la-uc-top">
            <div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:${hpPct}%;background:${hpColor}"></div></div>
          </div>
          ${portrait}
          ${giUnitType(def.category)}
          ${regenBadge}
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

  // ── Troop exchange (same-tile lord ↔ lord) ─────────────────────
  // Hand-offs follow the same "you must be standing there" grammar as
  // recruiting: the exchange affordance only exists when another of your
  // lords shares this tile — armies never teleport, so march time and
  // food costs keep mattering. Server twin: actions/army-transfer.js.

  function _exchangePartners() {
    if (_lord.x == null) return [];
    return LordService.getByPlayer(_player.id)
      .filter(l => l.id !== _lord.id && l.x === _lord.x && l.y === _lord.y);
  }

  // Why a lord can't exchange right now, or null if they can.
  // Mirrors the server checks so the button never promises what the
  // endpoint would refuse.
  function _exchangeBlockReason(lord) {
    if (LordService.isDown(lord)) return `${lord.name} is incapacitated`;
    if ((lord.actionQueue || []).length > 0) return `${lord.name} is busy with an action`;
    if (LordService.isStanced(lord) && STANCE_DEFS[lord.stance.id]?.restrictions.includes('action')) {
      return `${lord.name} is in ${STANCE_DEFS[lord.stance.id].name} stance`;
    }
    return null;
  }

  // One entry per model, because the roster UI is per-model cards: the
  // front model carries the stack's damage (hp = number), everyone
  // behind it is fresh (hp = null). `home` remembers which lord the
  // model started with so Confirm can compute the two transfer lists.
  function _exchangeModels(lordId, side) {
    const models = [];
    ArmyService.get(lordId).units.forEach(stack => {
      if (!UNIT_DEFS[stack.unitId]) return;
      for (let i = 0; i < stack.count; i++) {
        models.push({ unitId: stack.unitId, hp: i === 0 ? (stack.currentHp ?? null) : null, home: side });
      }
    });
    return models;
  }

  function _modelsToStacks(models) {
    const counts = new Map();
    models.forEach(m => counts.set(m.unitId, (counts.get(m.unitId) || 0) + 1));
    return [...counts.entries()].map(([unitId, count]) => ({ unitId, count }));
  }

  // Units bought and still training for this lord, across all cities —
  // counted into the preview PWR so it matches the server's cap check.
  function _queuedUnitsFor(lordId) {
    const queued = [];
    CityService.getPlayerCities(_player.id).forEach(c => {
      (c.recruitmentQueue || []).forEach(it => {
        if (it.lordId === lordId) queued.push({ unitId: it.unitId, count: it.count });
      });
    });
    return queued;
  }

  function _exchangeProjectedPower(lordId, models) {
    return Math.round(EconomyCore.getArmyPower(
      [..._modelsToStacks(models), ..._queuedUnitsFor(lordId)], UNIT_DEFS));
  }

  function _openExchange(partnerId) {
    _exchangeWith  = partnerId;
    _exchangeState = { a: _exchangeModels(_lord.id, 'a'), b: _exchangeModels(partnerId, 'b') };
  }

  function _closeExchange() {
    _exchangeWith  = null;
    _exchangeState = null;
  }

  function _exchangeHtml(partner) {
    const st       = _exchangeState;
    const moved    = st.a.some(m => m.home !== 'a') || st.b.some(m => m.home !== 'b');
    const lords    = { a: _lord, b: partner };
    const overCap  = {};

    const colHtml = (side) => {
      const lord      = lords[side];
      const models    = st[side];
      const power     = _exchangeProjectedPower(lord.id, models);
      const cap       = LordService.getArmyPowerCap(lord);
      // Same rule as the server: over cap is only a problem if this
      // exchange made it WORSE than the lord's starting point.
      const original  = _exchangeProjectedPower(lord.id, _exchangeModels(lord.id, side));
      overCap[side]   = power > cap && power > original;
      const cards     = models.map((m, idx) => {
        const def = UNIT_DEFS[m.unitId];
        const inner = _buildUnitCard(def, { currentHp: m.hp ?? def.combatStats.hp, maxHp: def.combatStats.hp });
        return `<div class="la-ex-card${m.home !== side ? ' la-ex-card--moved' : ''}" data-side="${side}" data-idx="${idx}" role="button" title="Click to move to ${lords[side === 'a' ? 'b' : 'a'].name}">${inner}</div>`;
      }).join('');
      return `
        <div class="la-ex-col">
          <div class="la-ex-col-head">
            <span class="la-ex-col-name">${lord.name}</span>
            <span class="la-army-power${overCap[side] ? ' la-army-power--over' : ''}" title="Army Power after this exchange, including units still training">${gi('crossed-swords')} ${power} / ${cap} PWR</span>
          </div>
          <div class="la-unit-cards la-ex-cards">${cards || `<p class="la-ex-empty">No troops</p>`}</div>
        </div>`;
    };

    const cols       = colHtml('a') + colHtml('b');
    const capBlocked = overCap.a || overCap.b;
    return `
      <div class="la-army-tab">
        <div class="la-section-header-row">
          <div class="la-section-title">⇄ Troop Exchange</div>
          <button class="x-cancel-btn" id="la-ex-cancel" title="Leave without exchanging">✕</button>
        </div>
        <p class="la-ex-hint">Click a soldier to send it to the other army. Nothing happens until you confirm.</p>
        <div class="la-ex-columns">${cols}</div>
        <div class="la-ex-footer">
          <span class="la-ex-note">${capBlocked
            ? `${gi('hazard-sign')} A lord is over their Army Power cap — move something back.`
            : 'Wounded soldiers keep their wounds when they change armies.'}</span>
          <button class="la-recruit-btn bld-btn--ready" id="la-ex-confirm" ${(!moved || capBlocked) ? 'disabled' : ''}>Confirm Exchange</button>
        </div>
      </div>
    `;
  }

  function _bindExchangeEvents(partner) {
    document.getElementById('la-ex-cancel')?.addEventListener('click', () => {
      _closeExchange();
      _renderTab();
    });

    document.querySelectorAll('.la-ex-card[data-side]').forEach(card => {
      card.addEventListener('click', () => {
        const side  = card.dataset.side;
        const other = side === 'a' ? 'b' : 'a';
        const idx   = parseInt(card.dataset.idx, 10);
        const model = _exchangeState[side][idx];
        if (!model) return;
        const def      = UNIT_DEFS[model.unitId];
        const receiver = other === 'a' ? _lord : partner;
        if (def.category === 'legendary' && (receiver.level || 1) < 12) {
          _toast(`Only a lord of level 12 or higher can command a ${def.name}.`);
          return;
        }
        _exchangeState[side].splice(idx, 1);
        _exchangeState[other].push(model);
        _renderTab();
      });
    });

    document.getElementById('la-ex-confirm')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;

      // Models sitting on the side they didn't start on = the transfer.
      const movesFrom = (side, home) => {
        const byUnit = new Map();
        _exchangeState[side].filter(m => m.home === home).forEach(m => {
          const entry = byUnit.get(m.unitId) || { unitId: m.unitId, count: 0, damaged: false };
          entry.count  += 1;
          entry.damaged = entry.damaged || m.hp != null;
          byUnit.set(m.unitId, entry);
        });
        return [...byUnit.values()];
      };
      const toB = movesFrom('b', 'a');
      const toA = movesFrom('a', 'b');

      const result = await ServerActions.transferUnits(_lord.id, partner.id, toB, toA);
      if (!result.ok) {
        _toast(result.error || 'Server error');
        btn.disabled = false; // keep the player's plan so they can adjust it
        return;
      }
      _toast(`Troops exchanged with ${partner.name}.`);
      _closeExchange();
      _renderTab();
    });
  }

  function _armyHtml() {
    // Exchange mode replaces the whole tab while active. Validity can decay
    // between renders (partner marched off, went down, got busy) — drop out
    // gracefully instead of rendering a stale panel.
    if (_exchangeWith) {
      const partner = _exchangePartners().find(l => l.id === _exchangeWith);
      if (partner && !_exchangeBlockReason(_lord) && !_exchangeBlockReason(partner)) {
        return _exchangeHtml(partner);
      }
      _closeExchange();
    }

    const army        = ArmyService.get(_lord.id);
    const city        = _getLordCurrentCity();
    const player      = PlayerService.getById(_player.id);
    const isTraveling = _lord.actionQueue.length > 0 && _lord.actionQueue[0].actionId === 'move_lord';

    // Army Power is the single capacity stat — see the identical note in
    // _overviewTabHtml(). It's both informational (shown as a badge) and
    // the real, server-enforced recruit limit: server/actions/recruit.js and
    // catch-up.js's expedition Recruits handler gate on this exact same
    // calculation (a recruit that doesn't fit under the cap is lost).
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
      armyListHtml = `${_regenNoteHtml(army)}<div class="la-unit-cards">${_armyCardsHtml(army, { removable: true, regen: _isGarrisonRegen() })}</div>`;
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
              <button class="x-cancel-btn" data-cancel-recruit="${i + 1}" title="Cancel &amp; refund gold">✕</button>
            </div>`;
        }).join('');

        queueHtml = `
          <div class="la-recruit-queue">
            <div class="la-recruit-queue-label">${uDef?.icon || gi('crossed-swords')} Training ${uDef?.name || job.unitId} ×${job.count}</div>
            <div class="la-progress-row">
              <div class="la-bar"><div class="la-fill" id="la-recruit-fill" style="transform:scaleX(${pct / 100})"></div></div>
              <span class="la-timer" id="la-recruit-timer">${TimeService.formatDuration(secs)}</span>
              <button class="ls-finish-btn" id="la-finish-recruit">${gi('power-lightning')} ${recruitCost}${gi('cut-diamond')}</button>
              <button class="x-cancel-btn" data-cancel-recruit="0" title="Cancel &amp; refund gold">✕</button>
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
          // Displayed time mirrors server/actions/recruit.js exactly: hangar
          // divisor from this city's training-building level, plus recruit_speed
          // summed across Library research AND an active God of War blessing.
          const training   = EconomyCore.getUnitTraining(_lord.race, unitId);
          const _researchFx = EconomyCore.getResearchEffects(player.research);
          const _blessingFx = EconomyCore.getBlessingEffects(player.activeBlessing, TimeService.now());
          const recruitSecs = EconomyCore.getRecruitTime(
            def, 1,
            { ..._researchFx, recruit_speed: (_researchFx.recruit_speed || 0) + (_blessingFx.recruit_speed || 0) },
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
          return TechTreeScreen.unitCardHtml(def, {
            extraClass: queueFull ? 'la-recruit-card--busy' : '',
            nameSuffixHtml: vetPct > 0 ? ` <span class="la-vet-badge" title="Veterancy from training buildings across your empire">+${Math.round(vetPct * 100)}%</span>` : '',
            stats: { attack: atkShown, defense: defShown },
            costHtml: `<span class="tt-unit-cost">${gi('two-coins')} ${def.goldCost} · ${gi('stopwatch')} ${TimeService.formatDuration(recruitSecs)}</span>`,
            bodyExtraHtml: `${_abilityBadgesHtml(def)}${_tagBadgesHtml(def)}`,
            actionHtml: `
              <button class="la-recruit-btn bld-btn--ready" data-unit-id="${unitId}"
                      ${disabled ? 'disabled' : ''}>
                ${btnLabel}
              </button>`,
          });
        }).join('');
        cardsHtml = `<div class="tt-unit-grid">${cardsHtml}</div>`;
      }
      recruitSectionHtml = `${queueHtml}${cardsHtml}`;
    }

    // The "Mercenaries" section lived here — it let a lord buy units from a
    // bandit camp it had discovered. Camps are gone (combat finds resolve as
    // an immediate ambush), and mercenaries now JOIN for free via the
    // expedition Recruits outcome, gated by Expedition Rating rather than by
    // gold. Removed 2026-07-29.
    const mercHtml = '';

    // ── Troop exchange entry — only exists when another of your lords is
    // standing on this exact tile, so the button never leads to a dead end.
    const partners = _exchangePartners();
    let exchangeEntryHtml = '';
    if (partners.length > 0) {
      const selfBlock = _exchangeBlockReason(_lord);
      exchangeEntryHtml = `<div class="la-ex-entry">` + partners.map(p => {
        const block = selfBlock || _exchangeBlockReason(p);
        return `<button class="la-ex-open-btn" data-exchange-with="${p.id}" ${block ? `disabled title="${block}"` : `title="${p.name} is standing on this tile"`}>⇄ Exchange Troops with ${p.name}</button>`;
      }).join('') + `</div>`;
    }

    return `
      <div class="la-army-tab">
        <div class="la-section-header-row">
          <div class="la-section-title">Army</div>
          <span class="la-army-power${overPower ? ' la-army-power--over' : ''}" title="Army Power — the capacity that gates recruiting">${gi('crossed-swords')} ${currentPower} / ${maxPower} PWR</span>
        </div>
        ${armyListHtml}
        ${exchangeEntryHtml}
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
    // Exchange mode has its own, much smaller surface — nothing else from
    // the normal Army tab exists in the DOM while it's open.
    if (_exchangeWith) {
      const partner = LordService.getById(_exchangeWith);
      if (partner) { _bindExchangeEvents(partner); return; }
    }
    document.querySelectorAll('.la-ex-open-btn[data-exchange-with]').forEach(btn => {
      btn.addEventListener('click', () => {
        _openExchange(btn.dataset.exchangeWith);
        _renderTab();
      });
    });

    // Finish recruitment instantly
    document.getElementById('la-finish-recruit')?.addEventListener('click', _finishRecruitmentNow);

    // Cancel a queued recruitment batch (full gold refund)
    document.querySelectorAll('[data-cancel-recruit]').forEach(btn => {
      btn.addEventListener('click', () => _cancelRecruitment(Number(btn.dataset.cancelRecruit)));
    });

    // Dismiss unit from army — click once to arm, click again within 3s to confirm
    document.querySelectorAll('.la-uc-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!btn.classList.contains('la-uc-remove--confirm')) {
          btn.classList.add('la-uc-remove--confirm');
          btn.title = 'Click again to confirm dismissal';
          clearTimeout(btn._confirmTimer);
          btn._confirmTimer = setTimeout(() => {
            btn.classList.remove('la-uc-remove--confirm');
            btn.title = 'Dismiss 1 — refunds gold based on remaining HP';
          }, 3000);
          return;
        }
        clearTimeout(btn._confirmTimer);
        btn.disabled = true;
        const unitId   = btn.dataset.unitId;
        const modelIdx = parseInt(btn.dataset.modelIdx || '0', 10);
        const result   = await ServerActions.disbandUnit(_lord.id, unitId, modelIdx);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        const def = UNIT_DEFS[unitId];
        if (def) _toast(result.refund > 0 ? `${def.name} dismissed — ${result.refund} gold refunded.` : `${def.name} dismissed.`);
        _renderTab();
      });
    });

    // City recruitment
    document.querySelectorAll('.la-recruit-btn[data-unit-id]:not([disabled])').forEach(btn => {
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

    const _TIER_ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

    const entries = log.map((entry, idx) => {
      const def       = DISCOVERY_DEFS[entry.definitionId];
      const isNothing = !def || def.category === 'nothing';
      // Legacy entries only — a combat find is an ambush now and carries a
      // battle report, handled by the `ambush` branch further down.
      const isCombat  = def?.category === 'combat';
      const terrain   = TERRAIN_TYPES[entry.terrain] || { icon: gi('world'), name: entry.terrain || 'Unknown' };
      const ago       = _timeAgo(TimeService.now() - entry.loggedAt);
      const icon      = def ? def.icon : gi('uncertainty');
      const defName   = isNothing ? 'Nothing Found' : (def ? def.name : 'Quest');
      const name      = entry.storyTitle || defName;
      const code      = `RPT-${String(log.length - idx).padStart(3, '0')}`;

      // ── Outcome kind — drives the badge and the card's accent ──
      // Order matters: the two newest outcomes (ambush, recruits) carry their
      // own marker and must be read BEFORE the generic fallbacks, or an
      // ambush files as an ordinary "Found" with loot attached and a
      // recruitment renders as a card with nothing in it.
      let kind, kindLabel;
      if (entry.outcome === 'ambush') {
        const won = entry.ambush?.won;
        kind      = won ? 'win' : 'loss';
        kindLabel = entry.ambush?.lordFell ? 'Lord Fell' : won ? 'Ambush Won' : 'Ambush Lost';
      } else if (entry.outcome === 'recruits') {
        const joined = entry.recruits?.joined || 0;
        kind      = joined > 0 ? 'recruits' : 'nothing';
        kindLabel = joined > 0 ? 'Recruited' : 'Turned Away';
      } else if (entry.wasAttack) {
        // Legacy: the retired attack-a-camp flow.
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

      // Tier rides the title as a numeral ("The Honey Cliffs II") instead of
      // sitting in a chip row. It was one of three chips under the quote —
      // alongside Category, which the outcome pill already tells you, and
      // Reported, which repeated the "18h ago" in the summary row directly
      // above. Only the tier carried anything the card wasn't saying twice.
      const tierHtml = def?.tier
        ? ` <span class="qd-title-tier">${_TIER_ROMAN[def.tier] || def.tier}</span>`
        : '';

      // ── Quote / scout report — the journey. Lore — the thing itself. ──
      const quoteHtml = entry.narrative ? `<blockquote class="qd-quote">${entry.narrative}</blockquote>` : '';
      // Skip the generic def lore when a story quest already fired — its
      // narrative covers both the journey and the discovery itself, and
      // repeating the generic blurb right after would just be redundant.
      const loreHtml  = (!isNothing && !entry.storyTitle && def?.description) ? `<p class="qd-lore">${def.description}</p>` : '';

      // ── Outcome / spoils body ──
      let bodyHtml = '';
      if (entry.outcome === 'ambush') {
        const a   = entry.ambush || {};
        const cls = a.won ? 'qd-banner--win' : 'qd-banner--loss';
        const sub = a.lordFell
          ? 'Your lord was cut down and is recovering.'
          : a.won
            ? 'The attackers were beaten off and stripped of what they carried.'
            : 'Your column was driven off and left the field.';
        const spoils = (entry.rewards || []).filter(r => _RES_ICONS[r.type] && r.amount > 0);
        bodyHtml = `
          <div class="qd-banner ${cls}">
            <span class="qd-banner-icon">${a.won ? gi('crossed-swords') : gi('skull-crossed-bones')}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${kindLabel}${a.campName ? ` — ${a.campName}` : ''}</div>
              <div class="qd-banner-sub">${sub}</div>
            </div>
          </div>
          ${spoils.length ? `
            <div class="qd-spoils">
              <div class="qd-spoils-label">Taken from the dead</div>
              <div class="qd-spoils-list">${spoils.map(_spoilChip).join('')}</div>
            </div>` : ''}
          ${entry.lordId && entry.lordId === _lord.id
            ? `<button class="qd-battle-link" data-view-battles="1">${gi('scroll-unfurled')} View Battle Report</button>`
            : `<div class="qd-hint">${gi('scroll-unfurled')} Full battle report in the Battles tab.</div>`}`;
      } else if (entry.outcome === 'recruits') {
        const r      = entry.recruits || {};
        const joined = r.joined || 0;
        const lost   = r.lost   || 0;

        // Show what actually joined as the same unit cards the Army tab uses —
        // portrait, tier frame, hover stats and all. One card per model, so
        // "3 joined" looks like the three models it added. unitId is absent on
        // entries logged before it was carried through, so this degrades to the
        // banner alone rather than rendering broken cards.
        const rDef = r.unitId ? UNIT_DEFS[r.unitId] : null;
        const recruitCardsHtml = (rDef && joined > 0)
          ? `<div class="qd-spoils">
               <div class="qd-spoils-label">Joined the column</div>
               <div class="la-unit-cards">${
                 Array.from({ length: joined }, (_, i) =>
                   _buildUnitCard(rDef, { removable: false, modelIdx: i })).join('')
               }</div>
             </div>`
          : '';

        bodyHtml = `
          <div class="qd-banner ${joined > 0 ? 'qd-banner--recruits' : 'qd-banner--nothing'}">
            <span class="qd-banner-icon">${gi('crossed-swords')}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${joined > 0 ? `${joined}× ${r.unitName} joined` : `${r.unitName} refused`}</div>
              <div class="qd-banner-sub">${
                lost > 0 && joined > 0
                  ? `${lost} more turned away — your army was at ${r.armyPwr}/${r.cap} PWR.`
                  : lost > 0
                    ? `No room to take them on: a ${r.unitName} needs ${r.unitPwr} PWR free and you had ${r.headroom}.`
                    : `${r.tierLabel} tier — your army stands at ${r.armyPwr}/${r.cap} PWR.`
              }</div>
            </div>
          </div>
          ${recruitCardsHtml}
          ${lost > 0 ? `<div class="qd-hint">${gi('hazard-sign')} Recruits that don't fit are lost, not queued. Leave PWR free before questing.</div>` : ''}`;
      } else if (entry.wasAttack) {
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
        // Legacy log entries only — combat finds are fought on the spot now,
        // and land in the `ambush` branch above with a battle report. Entries
        // from before the change still reference a camp that no longer exists.
        bodyHtml = `
          <div class="qd-banner qd-banner--camp">
            <span class="qd-banner-icon">${icon}</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">${name}</div>
            </div>
          </div>
          <div class="qd-hint">${gi('position-marker')} Sighted at (${entry.tileX}, ${entry.tileY}) before camps were retired — nothing to attack.</div>`;
      } else if (!isNothing && entry.rewards && entry.rewards.length > 0) {
        const rows = entry.rewards
          .filter(r => _RES_ICONS[r.type] && r.amount > 0)
          .map(_spoilChip)
          .join('');
        if (rows) {
          bodyHtml = `
            <div class="qd-spoils">
              <div class="qd-spoils-label">Spoils of the Quest</div>
              <div class="qd-spoils-list">${rows}</div>
            </div>`;
        }
      } else if (isNothing) {
        // Even an empty expedition pays XP for the time spent — show it. The
        // card used to render the banner ALONE, so the most frequent outcome
        // in the game looked like it paid nothing whatsoever.
        const nothingRows = (entry.rewards || [])
          .filter(r => _RES_ICONS[r.type] && r.amount > 0)
          .map(_spoilChip)
          .join('');
        bodyHtml = `
          <div class="qd-banner qd-banner--nothing">
            <span class="qd-banner-icon">—</span>
            <div class="qd-banner-body">
              <div class="qd-banner-title">Nothing Found</div>
              <div class="qd-banner-sub">The area yielded no discoveries this time. Try again later or explore a different tile.</div>
            </div>
          </div>
          ${nothingRows ? `
            <div class="qd-spoils">
              <div class="qd-spoils-label">Earned regardless</div>
              <div class="qd-spoils-list">${nothingRows}</div>
            </div>` : ''}`;
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
                <h3 class="qd-panel-title">${icon} ${name}${tierHtml}</h3>
                <div class="qd-panel-byline">${entry.lordName ? `Scouted by <strong>${entry.lordName}</strong> · ` : ''}${terrain.icon} ${terrain.name} · (${entry.tileX ?? '?'}, ${entry.tileY ?? '?'})</div>
              </div>
              <!-- No outcome pill here on purpose. The <summary> row stays
                   visible while the panel is open and already carries one ~50px
                   above, at nearly the same x — and the banner below states the
                   outcome a third time, with detail. One stamp per card. -->
            </div>
            ${quoteHtml}
            ${loreHtml}
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

  // One reward → one chip. Both spoils lists (quest finds and ambush pickings)
  // render through here so they can't drift apart again.
  function _spoilChip(r) {
    return `
      <div class="qd-spoil">
        <span class="qd-spoil-icon">${_RES_ICONS[r.type]}</span>
        <span class="qd-spoil-name">${r.type}</span>
        <span class="qd-spoil-value">+${r.amount}</span>
      </div>`;
  }

  // _campPreviewHtml() rendered a discovered camp's defender roster so the
  // player could size it up before attacking. There is nothing to size up any
  // more — an ambush is already over by the time it's reported, and its full
  // roster is in the battle report. Removed 2026-07-29.

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

  // Mount artwork if set (MOUNT_POOL[id].image), else the icon glyph. When art
  // IS set the glyph stays in the DOM hidden, so a missing/typo'd asset path
  // falls back to it instead of showing a broken image. The Griffon ships with
  // no `image` at all (art pending) and takes the glyph path directly.
  function _mountVisual(m) {
    const glyph = `<span class="bld3-tile-icon" style="color:${m.color}${m.image ? ';display:none' : ''}">${m.icon}</span>`;
    return m.image
      ? `<img src="${m.image}" class="bld3-tile-img" alt="${m.name}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display=''">${glyph}`
      : glyph;
  }

  // One mount card.
  //
  // Built out of the BUILDING tile classes (.bld3-tile*, see city-view.js)
  // rather than a parallel set of its own — the two grids are the same object:
  // art strip with a bottom fade, name + value row under it, one state per
  // card. The three mount states map 1:1 onto the building states, so they
  // reuse them outright instead of re-inventing the look:
  //
  //   locked (level gate)  → .bld3-tile--locked    (greyed art)
  //   equipped             → .bld3-tile--selected  (gold border + glow)
  //   can't afford         → .bld3-tile--cant      (diagonal hatch)
  //
  // Restyling the building grid therefore restyles mounts for free, which is
  // the whole point. Only the foot (stat chips + action) is mount-specific.
  //
  // noFoot drops that foot entirely, leaving art + name + value — the Overview
  // card's shape (2026-07-29). Without it the tile ends on .bld3-tile-info,
  // which already carries its own bottom padding, so it needs no extra CSS.
  //
  // opts: { locked, equipped, cant, link, value, buttonHtml, reasonHtml, noFoot }
  function _mountTileHtml(m, opts) {
    const o = opts || {};
    const classes = [
      'bld3-tile', 'lm-mount-tile',
      o.equipped ? 'bld3-tile--selected' : '',
      o.locked   ? 'bld3-tile--locked'   : '',
      o.cant     ? 'bld3-tile--cant'     : '',
      o.link     ? 'lm-mount-tile--link' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}"${o.link ? ' data-action="open-mount-tab"' : ''}>
        <span class="bld3-tile-art">
          ${_mountVisual(m)}
          <span class="bld3-tile-art-fade"></span>
          ${o.locked ? '<span class="lm-locked-veil"></span>' : ''}
        </span>
        <span class="bld3-tile-info">
          <span class="bld3-tile-name">${m.name}</span>
          <span class="bld3-tile-level">${o.value || ''}</span>
        </span>
        ${o.noFoot ? '' : `
        <div class="lm-mount-foot">
          <div class="lm-stat-chips">${_mountEffectChips(m.effects)}</div>
          ${o.buttonHtml || ''}
          ${o.reasonHtml || ''}
        </div>`}
      </div>`;
  }

  // The no-mount card — same tile, same size, in place of a mount. Two
  // flavours: below MOUNT_MIN_LEVEL it reads as locked (matching a locked
  // building tile), above it as an empty slot that opens the Mount tab.
  function _mountEmptyTileHtml(locked) {
    return `
      <div class="bld3-tile lm-mount-tile ${locked ? 'bld3-tile--locked' : 'lm-mount-tile--link'}"${locked ? '' : ' data-action="open-mount-tab"'}>
        <span class="bld3-tile-art">
          <span class="bld3-tile-icon">${locked ? gi('padlock') : gi('horse-head')}</span>
          <span class="bld3-tile-art-fade"></span>
          ${locked ? '<span class="lm-locked-veil"></span>' : ''}
        </span>
        <span class="bld3-tile-info">
          <span class="bld3-tile-name">No mount</span>
          <span class="bld3-tile-level">${locked ? `Lv ${MOUNT_MIN_LEVEL}` : '—'}</span>
        </span>
        <div class="lm-mount-foot">
          ${locked
            ? `<div class="lm-mount-reason">${gi('padlock')} Requires lord level ${MOUNT_MIN_LEVEL}</div>`
            : `<button class="lm-choose-btn lm-choose-btn--change" data-action="open-mount-tab">Equip a mount</button>`}
        </div>
      </div>`;
  }

  function _mountTabHtml() {
    const level     = _lord.level || 1;
    const chosenId  = _lord.mountId;
    const coins     = _player?.coins || 0;

    // The whole ladder is always visible — locked tiers included, with their
    // stats on show. A mount you can't reach yet is a reason to keep levelling,
    // so hiding it would throw away the only thing the level gate buys.
    //
    // (The wide "Equipped" summary strip that used to sit above the grid went
    // on 2026-07-29. The equipped mount is already the gold-bordered card in
    // the ladder and the Overview tab carries the read-out, so the strip was
    // a third copy of the same card — and the only thing on the tab that
    // wasn't building-card grammar.)
    const ladder = Object.values(MOUNT_POOL)
      .map(m => getMountForRace(m.id, _lord.race))
      .sort((a, b) => (a.unlockLevel || 0) - (b.unlockLevel || 0) || (a.cost || 0) - (b.cost || 0));

    const pickerHtml = `
      <div class="lm-mount-grid">
        ${ladder.map(m => {
          const reqLevel   = m.unlockLevel || MOUNT_MIN_LEVEL;
          const isLocked   = level < reqLevel;
          const isEquipped = m.id === chosenId;
          const canAfford  = isEquipped || coins >= (m.cost || 0);
          const disabled   = isLocked || isEquipped || !canAfford;
          const btnLabel   = isLocked ? `${gi('padlock')} Locked`
                           : isEquipped ? 'Equipped'
                           : canAfford ? 'Equip'
                           : 'No gold';
          // Button states mirror the building panel's .bld2-btn--* set, so
          // "can't yet" reads the same here as it does in a city.
          const btnState   = isLocked ? 'lm-choose-btn--locked'
                           : isEquipped ? 'lm-choose-btn--equipped'
                           : canAfford ? 'lm-choose-btn--ready'
                           : 'lm-choose-btn--cant';
          return _mountTileHtml(m, {
            locked:   isLocked,
            equipped: isEquipped,
            cant:     !isLocked && !isEquipped && !canAfford,
            value:    `${gi('two-coins')}${m.cost || 0}`,
            buttonHtml: `<button class="lm-choose-btn ${btnState}" data-mount-id="${m.id}" ${disabled ? 'disabled' : ''}>${btnLabel}</button>`,
            reasonHtml: isLocked ? `<div class="lm-mount-reason">${gi('padlock')} Requires lord level ${reqLevel}</div>` : '',
          });
        }).join('')}
      </div>`;

    return `
      <div class="lm-container">
        <div class="lm-section">
          <div class="lm-section-title">${gi('horse-head')} All mounts — one equipped at a time, swap any time for the new mount's price</div>
          ${pickerHtml}
        </div>
      </div>`;
  }

  function _bindMountEvents() {
    // No open/change/cancel handlers any more — the ladder is always on
    // screen, so the only thing to bind is equipping.
    document.querySelectorAll('.lm-choose-btn[data-mount-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.spendMount(_lord.id, btn.dataset.mountId);
        if (!result.ok) { _toast(result.error || 'Server error'); btn.disabled = false; return; }
        _lord   = LordService.getById(_lord.id);
        _player = PlayerService.getById(_player.id);
        HUD.refresh();
        const mount = getMountForRace(btn.dataset.mountId, _lord.race);
        _toast(`${mount?.name || 'Mount'} equipped!`);
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
          <p class="bh-empty-hint">Expedition ambushes and enemy attacks are recorded here.</p>
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
      // RACE RECOVERY (fixes ROADMAP #6's "quests completing with nothing
      // happening"). TWO endpoints drain lord.pendingDiscoveries and clear it:
      // sync.js (into its events array) and quest-resolve.js (into this
      // response). Whichever fires first wins, so a sync that interleaves
      // between the action completing and this call leaves questResolve with
      // nothing to return. The result is NOT lost — it went into the sync
      // response — but nothing here ever went and collected it, so the quest
      // produced no reward, no log entry and no feedback at all.
      //
      // syncNow() routes those events through DiscoveryService.ingestSyncEvents,
      // which populates the quest log + Activity feed. _resolveScout already
      // handles the identical race via its 'resolved_elsewhere' branch; this is
      // the same recovery for the search path.
      //
      // Most visible on the credit-finish path (instant-action backdates
      // finishAt and resolves immediately, so the window between completion and
      // this call is tiny but a polling sync can still land inside it).
      const logBefore = DiscoveryService.getLog(_player.id).length;
      await ServerActions.syncNow();
      _lord   = LordService.getById(_lord.id)     || _lord;
      _player = PlayerService.getById(_player.id) || _player;
      const recovered = DiscoveryService.getLog(_player.id).length > logBefore;
      _toast(recovered
        ? 'Quest complete — see Quests tab'
        : 'Quest already resolved — check the Quests tab');
      _refreshDiscoveryBadge();
      _renderTab();
      HUD.refresh();
      return;
    }

    // Each result is isolated. The rewards are ALREADY applied server-side by
    // the time we get here, so a presentation failure must never cost the
    // player the re-render that shows them — that is precisely what happened
    // when _applyAmbushResult threw on the missing BattleHistoryService.add:
    // the screen kept showing the pre-quest army until you navigated away and
    // back. Report the failure, keep going, always re-render.
    for (const pending of discoveries) {
      try {
        _applyQuestResult(pending);
      } catch (err) {
        console.error('Quest result could not be displayed:', pending?.defId, err);
        _toast('Quest resolved — the report could not be rendered');
      }
    }
    _refreshDiscoveryBadge();
    _renderTab();
    HUD.refresh();
    } finally {
      _resolvingSearch = false;
    }
  }

  // Called when a 'scout' action completes. /api/lord/scout-resolve does the
  // report-gathering server-side (it has cross-player admin access this
  // client never does) and produces a tile report.
  //
  // The client sends nothing but the lord id and stores nothing itself: the
  // report is stashed server-side and delivered by /api/sync into the Activity
  // feed, which is the one and only place a scout's findings live. That's why
  // every branch here just syncs and toasts.
  let _resolvingScout = false;
  async function _resolveScout() {
    if (_resolvingScout) return;
    _resolvingScout = true;
    try {
      const result = await ServerActions.scoutResolve(_lord.id);
      if (!result.ok) {
        _toast(result.error || 'Scout error — please refresh');
        return;
      }

      if (result.outcome === 'intel' || result.outcome === 'resolved_elsewhere') {
        // 'resolved_elsewhere' = the ~5 s dispatcher beat us to it (it drains
        // pendingScoutResolve for ANY due event of ours, online or not). Either
        // way the report is already stashed, so the same sync collects it.
        await ServerActions.syncNow();
        _lord   = LordService.getById(_lord.id)     || _lord;
        _player = PlayerService.getById(_player.id) || _player;
        const empty = result.outcome === 'intel' && ActivityService.scoutIsEmpty(result.report);
        _toast(empty ? 'Scouting complete — nothing on this tile' : 'Scout report filed — see Activity');
      }

      _refreshDiscoveryBadge();
      _renderTab();
      HUD.refresh();
    } finally {
      _resolvingScout = false;
    }
  }

  // Fighters offered to the lord. Already applied server-side; this reports it.
  // The over-cap case is the important one: recruits that don't fit are GONE,
  // so the message names the exact numbers rather than just saying "some were
  // lost" — a player who loses a Young Dragon to 40 missing PWR should be able
  // to see precisely what it would have taken to keep it.
  function _applyRecruitsResult(pending, def) {
    const r = pending.recruits;
    const terrainId = _lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains';

    const storyQuest = (typeof pickStoryQuest === 'function') ? pickStoryQuest('trade') : null;
    const narrative  = storyQuest ? storyQuest.story : pickQuestNarrative(def, terrainId);
    const storyTitle = storyQuest ? storyQuest.title : null;

    const what = `${r.count}× ${r.unitName}`;
    const detail = r.lost > 0 && r.joined > 0
        ? `${r.joined} joined · ${r.lost} turned away — army at ${r.armyPwr}/${r.cap} PWR`
      : r.lost > 0
        ? `All ${r.lost} turned away — needed ${r.unitPwr} PWR free, had ${r.headroom}`
        : `${r.joined}× ${r.unitName} joined (${r.tierLabel})`;

    // `outcome` is what lets the log render this as a recruitment rather than
    // a generic find — without it the card has no rewards to show and comes
    // out blank.
    DiscoveryService.addLog(_player.id, {
      definitionId: pending.defId,
      tileX: _lord.x, tileY: _lord.y, terrain: terrainId,
      rewards: [], narrative, storyTitle,
      outcome: 'recruits',
      // unitId is what lets the log render real unit cards for what joined,
      // the same cards the Army tab shows — without it the entry can only
      // print a name.
      recruits: { unitId: r.unitId, unitName: r.unitName, count: r.count, joined: r.joined, lost: r.lost,
                  tierLabel: r.tierLabel, armyPwr: r.armyPwr, cap: r.cap,
                  headroom: r.headroom, unitPwr: r.unitPwr },
      lordId: _lord.id, lordName: _lord.name,
    });

    ActivityService.log(_player.id, {
      type:   'discovery',
      icon:   def.icon || gi('crossed-swords'),
      title:  r.joined > 0 ? `${what} joined your army` : `${what} refused to join`,
      detail,
      lordId: _lord.id, lordName: _lord.name,
    });

    _toast(r.lost > 0 && r.joined === 0
      ? `${r.unitName} refused — no army capacity (needed ${r.unitPwr} PWR, had ${r.headroom})`
      : r.lost > 0
        ? `${r.joined}× ${r.unitName} joined — ${r.lost} turned away, army full`
        : `${r.joined}× ${r.unitName} joined your army!`);
  }

  // An expedition that walked into a fight. The battle is already resolved and
  // persisted (server/tick/catch-up.js's _resolveAmbush) — HP, casualties and
  // any downtime came back with the lord/army hydration. This only records and
  // presents it.
  function _applyAmbushResult(pending, def) {
    const { defId, rewards, ambush } = pending;
    const { won, report, campName, lordFell } = ambush;
    const terrainId = _lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains';

    const storyQuest = (typeof pickStoryQuest === 'function') ? pickStoryQuest('combat') : null;
    const narrative  = storyQuest ? storyQuest.story : pickQuestNarrative(def, terrainId);
    const storyTitle = storyQuest ? storyQuest.title : null;
    const name       = storyTitle || campName || def.name;

    if (report && typeof BattleHistoryService !== 'undefined') {
      BattleHistoryService.saveAmbush(_lord.id, {
        report, campName: campName || def.name,
        campLevel: ambush.campLevel, lordLevel: _lord.level || null,
        at: ambush.at,   // when the fight happened, not when we heard about it
      });
    }

    // `outcome` marks this as a battle so the log can show who won rather
    // than filing it as an ordinary find with some loot attached.
    DiscoveryService.addLog(_player.id, {
      definitionId: defId,
      tileX: _lord.x, tileY: _lord.y, terrain: terrainId,
      rewards: rewards || [], narrative, storyTitle,
      outcome: 'ambush',
      ambush: { won, lordFell, campName: campName || def.name },
      lordId: _lord.id, lordName: _lord.name,
    });

    const lootStr = (rewards || []).filter(r => r.type !== 'xp')
      .map(r => `+${r.amount} ${r.type}`).join(', ');
    ActivityService.log(_player.id, {
      type:   'discovery',
      icon:   def.icon || gi('crossed-swords'),
      title:  won ? `Ambushed at ${name} — victory` : `Ambushed at ${name} — defeat`,
      detail: lordFell ? 'Your lord fell and is recovering'
            : won      ? (lootStr || 'No spoils')
            :            'Your army was driven off',
      lordId: _lord.id, lordName: _lord.name,
    });

    _toast(lordFell ? 'Ambushed — your lord has fallen. See Battles tab.'
         : won      ? `Ambushed at ${name} — you won! See Battles tab.`
         :            `Ambushed at ${name} — you were beaten back.`);

    _activeTab = 'battles';
  }

  // Handle one server-resolved quest result — add to log, add record to storage if needed.
  function _applyQuestResult(pending) {
    const { defId, category, record, rewards, ambush, recruits } = pending;
    const def = DISCOVERY_DEFS?.[defId];
    if (!def) return;

    if (recruits) {
      _applyRecruitsResult(pending, def);
      return;
    }

    // Combat finds are AMBUSHES now — already fought server-side, so there is
    // no camp to store and nothing for the player to attack later. Record the
    // battle in this lord's history, log it, and say who won.
    if (ambush) {
      _applyAmbushResult(pending, def);
      return;
    }

    const terrainId  = record?.terrain || (_lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains');
    // Prefer a curated story vignette (story-quests.js) over the generic
    // pooled narrative when one exists for this category — gives the quest
    // a proper name (storyTitle) and a fuller D&D-style narrative.
    const storyQuest = (typeof pickStoryQuest === 'function') ? pickStoryQuest(category) : null;
    const narrative  = storyQuest ? storyQuest.story : pickQuestNarrative(def, terrainId);
    const storyTitle = storyQuest ? storyQuest.title : null;
    const reportName = storyTitle || def.name;

    if (category === 'nothing') {
      // An empty expedition still pays the flat "you were out there" XP, which
      // the server now folds into rewards. Passing [] here threw that away and
      // the commonest outcome in the game read as a total waste of time.
      const xp = (rewards || []).find(r => r.type === 'xp')?.amount || 0;
      DiscoveryService.addLog(_player.id, {
        definitionId: defId,
        tileX: record?.tileX ?? _lord.x, tileY: record?.tileY ?? _lord.y,
        terrain: terrainId, rewards: rewards || [], narrative, storyTitle,
        lordId: _lord.id, lordName: _lord.name,
      });
      ActivityService.log(_player.id, {
        type: 'discovery', icon: def.icon || gi('fog'),
        title: `${reportName} — nothing found`,
        detail: xp > 0 ? `+${xp} XP for the expedition` : null,
        lordId: _lord.id, lordName: _lord.name,
      });
      _toast(storyTitle
        ? `${storyTitle} — see Quests tab`
        : xp > 0 ? `Nothing found — +${xp} XP` : 'Quest complete — nothing found');
      return;
    }

    // There used to be a `category === 'combat'` branch here that pushed a
    // camp RECORD into the 'discoveries' store so the player could go attack
    // it later. It is unreachable — a combat find returns an `ambush` and is
    // handled by _applyAmbushResult above, long before this point — and it
    // wrote to a store nothing reads any more. Removed 2026-07-29.
    //
    // Everything that lands here is a plain find: gold, resources and XP were
    // already applied server-side, so this only records and announces it.
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
      lordId: _lord.id, lordName: _lord.name,
    });
    _toast(`${reportName} — see Quests tab`);
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

  // _claimDiscovery() ran the "⚔ Attack" flow against a discovered bandit camp
  // via /api/lord/pve-attack, and render() took an autoAttackRecordId to jump
  // straight into it from the map. Combat expedition finds are now fought the
  // instant they happen (catch-up.js's _resolveAmbush) and reported by
  // _applyAmbushResult, so there is no camp to click and no endpoint behind
  // it. All of it removed 2026-07-29.

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

  // Recall an outgoing attack (or any in-progress action). No refund — the
  // lord simply stops where it started, since position only updates on a
  // completed move.
  async function _cancelLordActionNow() {
    const lord = LordService.getById(_lord.id);
    if (!lord || (lord.actionQueue || []).length === 0) return;
    if (!confirm('Recall this attack? The march supplies spent are forfeit.')) return;
    _stopCountdown();

    const result = await ServerActions.cancelLordAction(_lord.id);
    if (!result.ok) { _toast(result.error || 'Server error'); _startCountdown(); return; }

    _lord   = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id);
    HUD.refresh();
    _renderTab();
    _startCountdown();
    _toast('Attack recalled.');
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

  async function _cancelRecruitment(queueIndex) {
    const city = _getLordCurrentCity();
    if (!city || !Number.isInteger(queueIndex)) return;
    const result = await ServerActions.cancelRecruit(city.id, queueIndex);
    if (!result.ok) { _toast(result.error || 'Server error'); return; }

    _player = PlayerService.getById(_player.id);
    HUD.refresh();
    _stopCountdown();
    _renderTab();
    _startCountdown();
    _toast('Recruitment cancelled — gold refunded.');
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

  // raidHourlyPreview is exported so ActionConfirmView can show the SAME
  // projected earnings the active-raid block does — one formula, two screens.
  return { render, stop, raidHourlyPreview: _raidHourlyRewardsPreview };
})();
