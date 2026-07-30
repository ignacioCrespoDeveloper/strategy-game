// =============================================
//  attack-confirm-view.js — Attack order confirmation
// =============================================

const AttackConfirmView = (() => {

  let _player     = null;
  let _targetX    = 0;
  let _targetY    = 0;
  // The latest scout report for this tile, straight out of the Activity feed —
  // that feed is the only place scout findings are ever stored, so this screen
  // reads it rather than being handed intel by whoever navigated here. null
  // means the tile was never scouted (or the report was dismissed/aged out),
  // which is a perfectly valid state: you can always attack blind.
  let _report     = null;
  let _cityMeta   = null;  // always-public { name, ownerUsername } from world_state
  let _lords      = [];

  // ── Unit card (mirrors lord-screen's _buildUnitCard, same CSS classes) ──

  function _unitCardHtml(def, count) {
    const tierClass = unitTierClass(def);
    const portrait = def.image
      ? `<img src="${def.image}" class="ac-unit-portrait" alt="${def.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const fallback = `<div class="ac-unit-icon-fallback" style="${def.image ? 'display:none' : ''}">${def.icon}</div>`;
    return `
      <div class="ac-unit-slot">
        <div class="ac-unit-portrait-wrap${tierClass ? ` ${tierClass}` : ''}">
          ${portrait}${fallback}${giUnitType(def.category)}
        </div>
        <div class="ac-unit-name">${def.name}</div>
        <div class="ac-unit-count-label">×${count}</div>
      </div>`;
  }

  function _armyHtml(lordId) {
    const army = ArmyService.get(lordId);
    if (!army || army.units.length === 0) {
      return `<div class="ac-empty-army">This lord has no army</div>`;
    }
    return `<div class="ac-army-cards">${army.units.map(s => {
      const def = UNIT_DEFS[s.unitId];
      return def ? _unitCardHtml(def, s.count) : '';
    }).filter(Boolean).join('')}</div>`;
  }

  // ── Target cards ──────────────────────────────────────────────
  // A tile can hold both a city and one or more lords (co-op defense), so
  // these render independently. Everything below the city's name/owner comes
  // from the scout report and is simply absent when the tile was never
  // scouted — attacking blind stays allowed, you just do it without numbers.

  function _unitChipsHtml(units) {
    return (units || []).map(u => {
      const def = UNIT_DEFS[u.unitId] || {};
      return `<div class="mip-enemy-unit-chip">${def.icon || gi('crossed-swords')} ${def.name || u.unitId} ×${u.count}</div>`;
    }).join('');
  }

  function _staleHtml() {
    if (!_report?.at) return '';
    const mins = Math.floor((TimeService.now() - _report.at) / 60000);
    const ago  = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
    return `<div class="ac-enemy-stance">${gi('spy')} Scouted ${ago}</div>`;
  }

  function _cityCardHtml() {
    const city = _report?.city || null;
    if (!city && !_cityMeta) return '';

    const name  = city?.name || _cityMeta?.name || 'Unknown City';
    const owner = city?.ownerUsername || _cityMeta?.ownerUsername || null;
    const plunder = city?.plunder;
    const lootHtml = plunder ? [
      plunder.gold  > 0 ? `<div class="mip-enemy-unit-chip">${gi('two-coins')} ${plunder.gold.toLocaleString()}</div>` : '',
      plunder.food  > 0 ? `<div class="mip-enemy-unit-chip">${gi('wheat')} ${plunder.food.toLocaleString()}</div>` : '',
      plunder.wood  > 0 ? `<div class="mip-enemy-unit-chip">${gi('wood-pile')} ${plunder.wood.toLocaleString()}</div>` : '',
      plunder.stone > 0 ? `<div class="mip-enemy-unit-chip">${gi('war-pick')} ${plunder.stone.toLocaleString()}</div>` : '',
    ].filter(Boolean).join('') : '';

    return `
      <div class="ac-enemy-card ac-city-card">
        <div class="ac-enemy-top">
          <div class="ac-enemy-portrait"><div class="ac-enemy-portrait-icon">${gi('guarded-tower')}</div></div>
          <div class="ac-enemy-info">
            <div class="ac-enemy-name">${name}</div>
            <div class="ac-enemy-meta">${owner ? `Enemy city · ${owner}` : 'Enemy city'}</div>
            ${city
              ? `<div class="ac-enemy-stance">${gi('guarded-tower')} Garrison ${city.garrisonCount} · ${city.garrisonPower} PWR</div>${_staleHtml()}`
              : `<div class="ac-enemy-stance ac-enemy-unscouted">Never scouted — garrison unknown</div>`}
          </div>
        </div>
        ${city ? `<div class="ac-enemy-units">${_unitChipsHtml(city.garrison)}</div>` : ''}
        ${lootHtml ? `<div class="ac-loot-label">Spoils if you win</div><div class="ac-enemy-units">${lootHtml}</div>` : ''}
      </div>`;
  }

  function _enemyCardHtml() {
    const lords = _report?.lords || [];
    if (!lords.length) {
      // Nothing known about defending lords. Either the tile was never
      // scouted, or the scout found only a city — the map's own "Unknown
      // Force" marker is what sent us here, so say so plainly.
      if (_report?.city) return '';
      return `<div class="ac-enemy-none">${gi('uncertainty')} Unknown force — scout this tile to see what defends it</div>`;
    }

    return lords.map(data => {
      const race = RACES[data.lordRace] || {};
      const cls  = LORD_CLASSES[data.lordClass] || null;
      const portraitSrc  = data.lordPortrait || pickLordPortrait(data.lordRace, data.lordClass, data.lordId) || race.portrait;
      const portraitHtml = portraitSrc
        ? `<img src="${portraitSrc}" class="ac-enemy-portrait-img" alt="" onerror="this.style.display='none'">`
        : `<div class="ac-enemy-portrait-icon">${race.icon || gi('crossed-swords')}</div>`;
      const unitsHtml = _unitChipsHtml(data.units);

      return `
        <div class="ac-enemy-card">
          <div class="ac-enemy-top">
            <div class="ac-enemy-portrait">${portraitHtml}</div>
            <div class="ac-enemy-info">
              <div class="ac-enemy-name">${data.lordName || 'Enemy Lord'}</div>
              <div class="ac-enemy-meta">
                ${race.name ? `${race.icon} ${race.name}` : ''}
                ${data.lordLevel ? ` · Lv ${data.lordLevel}` : ''}
                ${cls ? ` · ${cls.icon} ${cls.name}` : ''}
              </div>
              ${data.playerUsername ? `<div class="ac-enemy-stance">${gi('person')} ${data.playerUsername}</div>` : ''}
              ${data.armyPower != null ? `<div class="ac-enemy-stance">${gi('crossed-swords')} ${data.armyCount} troops · ${data.armyPower} PWR</div>` : ''}
              ${_staleHtml()}
            </div>
          </div>
          ${unitsHtml ? `<div class="ac-enemy-units">${unitsHtml}</div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Lord selector section ─────────────────────────────────────

  function _lordOptionHtml(lord) {
    const speed = LordService.getEffectiveStats(lord).speed;
    const fromX = lord.x ?? _targetX;
    const fromY = lord.y ?? _targetY;
    const dist  = Math.max(Math.abs(_targetX - fromX), Math.abs(_targetY - fromY));
    const secs  = EconomyCore.getTravelTime(dist, speed);
    const eta   = secs > 0 ? TimeService.formatDuration(secs) : 'Immediate';
    const race  = RACES[lord.race] || {};
    return `<option value="${lord.id}">${lord.name} · ${eta}</option>`;
  }

  // ── Attacker info card ─────────────────────────────────────────

  function _attackerCardHtml(lord) {
    const race       = RACES[lord.race] || {};
    const cls        = LORD_CLASSES[lord.classId];
    const portraitSrc  = lord.portrait || pickLordPortrait(lord.race, lord.classId, lord.id) || race.portrait;
    const portraitHtml = portraitSrc
      ? `<img src="${portraitSrc}" class="ac-atk-portrait-img" alt="${lord.name}" onerror="this.style.display='none'">`
      : `<div class="ac-atk-portrait-icon">${race.icon || gi('crossed-swords')}</div>`;
    const stats  = LordService.getEffectiveStats(lord);
    const fromX  = lord.x ?? _targetX;
    const fromY  = lord.y ?? _targetY;
    const dist   = Math.max(Math.abs(_targetX - fromX), Math.abs(_targetY - fromY));
    const secs   = EconomyCore.getTravelTime(dist, stats.speed);
    const eta    = secs > 0 ? TimeService.formatDuration(secs) : 'Immediate';
    const terrain = WorldService.getTerrain(_targetX, _targetY);

    return `
      <div class="ac-atk-card">
        <div class="ac-atk-top">
          <div class="ac-atk-portrait">${portraitHtml}</div>
          <div class="ac-atk-info">
            <div class="ac-atk-name">${lord.name}</div>
            <div class="ac-atk-meta">${race.name || ''} · ${cls ? `${cls.icon} ${cls.name}` : ''} · Lv ${lord.level || 1}</div>
            <div class="ac-atk-pos">${gi('position-marker')} (${fromX}, ${fromY})</div>
          </div>
        </div>
        <div class="ac-route-bar">
          <div class="ac-route-from">(${fromX}, ${fromY})</div>
          <div class="ac-route-mid">
            <div class="ac-route-line-dot"></div>
            <div class="ac-route-dash-line"></div>
            <div class="ac-route-time">${gi('stopwatch')} ${eta}</div>
            <div class="ac-route-dash-line"></div>
            <div class="ac-route-line-dot ac-route-line-dot--red"></div>
          </div>
          <div class="ac-route-to">${terrain.icon} (${_targetX}, ${_targetY})</div>
        </div>
        ${dist === 0 ? `<div class="ac-instant-note">${gi('power-lightning')} Immediate resolution</div>` : ''}
      </div>
      <div class="ac-army-label">Your army</div>
      ${_armyHtml(lord.id)}`;
  }

  // ── Main render ───────────────────────────────────────────────

  function render(root, { player, targetX, targetY }) {
    _player     = player;
    _targetX    = targetX;
    _targetY    = targetY;
    // Read the intel here rather than accepting it from the caller: the
    // Activity feed is the single store, so every entry point to this screen
    // sees exactly the same thing.
    _report     = ActivityService.latestScoutReport(player.id, targetX, targetY);
    _cityMeta   = WorldService.getTile(targetX, targetY)
      ? WorldService.getCityMeta(targetX, targetY)
      : null;
    _lords      = LordService.getByPlayer(player.id).filter(l => !LordService.isDown(l) && l.actionQueue.length === 0 && l.x != null);

    const terrain = WorldService.getTerrain(targetX, targetY);

    if (_lords.length === 0) {
      root.innerHTML = `
        <div class="ac-screen">
          <div class="ac-header">
            <button class="ac-back-btn" id="ac-back">← Back</button>
            <h2 class="ac-title">Attack Order</h2>
          </div>
          <div class="ac-body ac-body--center">
            <div class="ac-no-lord">No lord available to attack.<br>All are busy or off the map.</div>
          </div>
        </div>`;
      document.getElementById('ac-back')?.addEventListener('click', () => {
        App.navigate('map', { player });
      });
      return;
    }

    root.innerHTML = `
      <div class="ac-screen">

        <div class="ac-header">
          <button class="ac-back-btn" id="ac-back">← Cancel</button>
          <h2 class="ac-title">Attack Order — ${terrain.icon} (${targetX}, ${targetY})</h2>
        </div>

        <div class="ac-body">

          <div class="ac-columns">

            <!-- Left: your lord + army -->
            <div class="ac-col ac-col--atk">
              <div class="ac-col-label">${gi('crossed-swords')} YOUR FORCES</div>
              <select class="ac-lord-sel" id="ac-lord-sel">
                ${_lords.map(_lordOptionHtml).join('')}
              </select>
              <div id="ac-atk-detail">
                ${_attackerCardHtml(_lords[0])}
              </div>
            </div>

            <!-- Right: enemy -->
            <div class="ac-col ac-col--enemy">
              <div class="ac-col-label">${gi('cloak-dagger')} TARGET</div>
              ${_cityCardHtml()}
              ${_enemyCardHtml()}
            </div>

          </div>

        </div>

        <div class="ac-footer">
          <span class="ac-march-cost" id="ac-march-cost"></span>
          <button class="ac-cancel-btn" id="ac-cancel">Cancel</button>
          <button class="ac-confirm-btn" id="ac-confirm">${gi('crossed-swords')} Confirm Attack</button>
        </div>

      </div>
    `;

    // March food cost for the selected lord — mirrors the server's
    // EconomyCore.getMarchFoodCost check in lord-action.js.
    const _updateMarchCost = lord => {
      const el = document.getElementById('ac-march-cost');
      if (!el || !lord) return;
      const dist     = Math.max(Math.abs(targetX - (lord.x ?? targetX)), Math.abs(targetY - (lord.y ?? targetY)));
      const foodCost = EconomyCore.getMarchFoodCost(dist, ArmyService.get(lord.id).units,
        EconomyCore.getResearchEffects(PlayerService.getById(player.id)?.research));
      if (foodCost <= 0) { el.textContent = ''; return; }
      const have  = Math.floor(PlayerService.getById(player.id)?.resources?.food || 0);
      const short = have < foodCost;
      el.classList.toggle('ac-march-cost--short', short);
      el.textContent = `🌾 March cost: ${foodCost.toLocaleString()} food${short ? ` (have ${have.toLocaleString()})` : ''}`;
    };
    _updateMarchCost(_lords[0]);

    // Lord selector change
    document.getElementById('ac-lord-sel')?.addEventListener('change', e => {
      const lord = LordService.getById(e.target.value);
      if (!lord) return;
      const detail = document.getElementById('ac-atk-detail');
      if (detail) detail.innerHTML = _attackerCardHtml(lord);
      _updateMarchCost(lord);
    });

    document.getElementById('ac-back')?.addEventListener('click', () => {
      App.navigate('map', { player });
    });
    document.getElementById('ac-cancel')?.addEventListener('click', () => {
      App.navigate('map', { player });
    });

    document.getElementById('ac-confirm')?.addEventListener('click', async () => {
      const selEl = document.getElementById('ac-lord-sel');
      const lord  = LordService.getById(selEl?.value || _lords[0].id);
      if (!lord) return;

      const btn = document.getElementById('ac-confirm');
      btn.disabled    = true;
      btn.textContent = 'Sending...';

      // 1 — Enqueue move with attack intent (server-validated).
      // Defenders are NOT pre-warned — they find out via the pvp_result /
      // lord_captured feed entries once the battle resolves (design call:
      // no "incoming attack" notification).
      const result = await ServerActions.lordMove(lord.id, targetX, targetY, { intent: 'attack' });
      if (!result.ok) {
        btn.disabled    = false;
        btn.innerHTML = `${gi('crossed-swords')} Confirm Attack`;
        const footer = document.querySelector('.ac-footer');
        let err = footer.querySelector('.ac-err');
        if (!err) { err = document.createElement('div'); err.className = 'ac-err'; footer.prepend(err); }
        err.textContent = result.error || 'Server error';
        return;
      }

      // 2 — Navigate to overview
      const refreshedPlayer = PlayerService.getById(player.id);
      App.navigate('overview', { player: refreshedPlayer, lord: LordService.getById(lord.id) });
    });
  }

  return { render };
})();
