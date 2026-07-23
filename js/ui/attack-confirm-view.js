// =============================================
//  attack-confirm-view.js — Attack order confirmation
// =============================================

const AttackConfirmView = (() => {

  let _player     = null;
  let _targetX    = 0;
  let _targetY    = 0;
  let _enemyData  = null;  // rawData from scanTile (not wrapped in intel record)
  let _targetCity = null;  // tiered enemy_city data, {} for unscouted, null if no city on this tile
  let _lords      = [];

  // ── Unit card (mirrors lord-screen's _buildUnitCard, same CSS classes) ──

  function _cardTierClass(category) {
    if (category === 'mercenary') return 'la-unit-card--merc';
    if (category === 'elite' || category === 'cavalry') return 'la-unit-card--elite';
    if (category === 'monster') return 'la-unit-card--monster';
    if (category === 'legendary') return 'la-unit-card--legendary';
    return '';
  }

  function _unitCardHtml(def, count) {
    const tierClass = _cardTierClass(def.category);
    const portrait = def.image
      ? `<img src="${def.image}" class="ac-unit-portrait" alt="${def.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const fallback = `<div class="ac-unit-icon-fallback" style="${def.image ? 'display:none' : ''}">${def.icon}</div>`;
    return `
      <div class="ac-unit-slot">
        <div class="ac-unit-portrait-wrap${tierClass ? ` ${tierClass}` : ''}">
          ${portrait}${fallback}
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

  // ── City target card ──────────────────────────────────────────
  // A tile can hold both a city and one or more lords (co-op defense) —
  // this renders independently of _enemyCardHtml below. _targetCity is
  // {} for an unscouted city (still attackable — no intel required) or
  // tiered rawData from IntelligenceService once scouted.

  function _cityCardHtml() {
    if (!_targetCity) return '';
    const data    = _targetCity;
    const hasName = !!data.name;
    const garrisonHtml = data.garrisonUnits?.length > 0
      ? data.garrisonUnits.map(r => {
          const def = UNIT_DEFS[r.unitId];
          return `<div class="mip-enemy-unit-chip">${def?.icon || '⚔'} ${def?.name || r.unitId} ×${r.count}</div>`;
        }).join('')
      : (data.forceSize ? `<div class="mip-enemy-unit-chip">🏯 Garrison: ${data.forceSize}</div>` : '');

    return `
      <div class="ac-enemy-card ac-city-card">
        <div class="ac-enemy-top">
          <div class="ac-enemy-portrait"><div class="ac-enemy-portrait-icon">🏯</div></div>
          <div class="ac-enemy-info">
            <div class="ac-enemy-name">${hasName ? data.name : 'Unknown City'}</div>
            <div class="ac-enemy-meta">${hasName ? 'Enemy City' : 'Never scouted — attacking anyway'}</div>
          </div>
        </div>
        ${garrisonHtml ? `<div class="ac-enemy-units">${garrisonHtml}</div>` : ''}
      </div>`;
  }

  // ── Enemy intel card ──────────────────────────────────────────

  function _enemyCardHtml() {
    if (!_enemyData) {
      // A city card may already be shown above this — only show the
      // "no data" placeholder when there's truly nothing known at all.
      return _targetCity ? '' : `<div class="ac-enemy-none">No enemy data available</div>`;
    }
    const data  = _enemyData;
    const race  = RACES[data.lordRace] || {};
    const cls   = LORD_CLASSES[data.lordClass] || null;
    const portraitSrc  = pickLordPortrait(data.lordRace, data.lordClass, data.lordId) || race.portrait;
    const portraitHtml = portraitSrc
      ? `<img src="${portraitSrc}" class="ac-enemy-portrait-img" alt="" onerror="this.style.display='none'">`
      : `<div class="ac-enemy-portrait-icon">${race.icon || '⚔'}</div>`;

    const units = data.units || [];
    const unitsHtml = units.map(u => {
      const def = UNIT_DEFS[u.unitId] || {};
      return `<div class="mip-enemy-unit-chip">${def.icon || '⚔'} ${def.name || u.unitId} ×${u.count}</div>`;
    }).join('');

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
            ${data.playerUsername ? `<div class="ac-enemy-stance">👤 ${data.playerUsername}</div>` : ''}
            ${data.armyCapacity != null ? `<div class="ac-enemy-stance">⚔ ${data.armyCapacity} army pts</div>` : ''}
          </div>
        </div>
        ${unitsHtml ? `<div class="ac-enemy-units">${unitsHtml}</div>` : ''}
      </div>`;
  }

  // ── Lord selector section ─────────────────────────────────────

  function _lordOptionHtml(lord) {
    const speed = LordService.getEffectiveStats(lord).speed;
    const fromX = lord.x ?? _targetX;
    const fromY = lord.y ?? _targetY;
    const dist  = Math.max(Math.abs(_targetX - fromX), Math.abs(_targetY - fromY));
    const secs  = dist > 0 ? Math.round(dist * 20 * (5 / speed)) : 0;
    const eta   = secs > 0 ? TimeService.formatDuration(secs) : 'Immediate';
    const race  = RACES[lord.race] || {};
    return `<option value="${lord.id}">${race.icon || ''} ${lord.name} · ${eta}</option>`;
  }

  // ── Attacker info card ─────────────────────────────────────────

  function _attackerCardHtml(lord) {
    const race       = RACES[lord.race] || {};
    const cls        = LORD_CLASSES[lord.classId];
    const portraitSrc  = pickLordPortrait(lord.race, lord.classId, lord.id) || race.portrait;
    const portraitHtml = portraitSrc
      ? `<img src="${portraitSrc}" class="ac-atk-portrait-img" alt="${lord.name}" onerror="this.style.display='none'">`
      : `<div class="ac-atk-portrait-icon">${race.icon || '⚔'}</div>`;
    const stats  = LordService.getEffectiveStats(lord);
    const fromX  = lord.x ?? _targetX;
    const fromY  = lord.y ?? _targetY;
    const dist   = Math.max(Math.abs(_targetX - fromX), Math.abs(_targetY - fromY));
    const secs   = dist > 0 ? Math.round(dist * 20 * (5 / stats.speed)) : 0;
    const eta    = secs > 0 ? TimeService.formatDuration(secs) : 'Immediate';
    const terrain = WorldService.getTerrain(_targetX, _targetY);

    return `
      <div class="ac-atk-card">
        <div class="ac-atk-top">
          <div class="ac-atk-portrait">${portraitHtml}</div>
          <div class="ac-atk-info">
            <div class="ac-atk-name">${lord.name}</div>
            <div class="ac-atk-meta">${race.name || ''} · ${cls ? `${cls.icon} ${cls.name}` : ''} · Lv ${lord.level || 1}</div>
            <div class="ac-atk-pos">📍 (${fromX}, ${fromY})</div>
          </div>
        </div>
        <div class="ac-route-bar">
          <div class="ac-route-from">(${fromX}, ${fromY})</div>
          <div class="ac-route-mid">
            <div class="ac-route-line-dot"></div>
            <div class="ac-route-dash-line"></div>
            <div class="ac-route-time">⏱ ${eta}</div>
            <div class="ac-route-dash-line"></div>
            <div class="ac-route-line-dot ac-route-line-dot--red"></div>
          </div>
          <div class="ac-route-to">${terrain.icon} (${_targetX}, ${_targetY})</div>
        </div>
        ${dist === 0 ? `<div class="ac-instant-note">⚡ Immediate resolution</div>` : ''}
      </div>
      <div class="ac-army-label">Your army</div>
      ${_armyHtml(lord.id)}`;
  }

  // ── Main render ───────────────────────────────────────────────

  function render(root, { player, targetX, targetY, enemyData, targetCity }) {
    _player     = player;
    _targetX    = targetX;
    _targetY    = targetY;
    _enemyData  = enemyData || null;
    _targetCity = targetCity || null;
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
              <div class="ac-col-label">⚔ YOUR FORCES</div>
              <select class="ac-lord-sel" id="ac-lord-sel">
                ${_lords.map(_lordOptionHtml).join('')}
              </select>
              <div id="ac-atk-detail">
                ${_attackerCardHtml(_lords[0])}
              </div>
            </div>

            <!-- Right: enemy -->
            <div class="ac-col ac-col--enemy">
              <div class="ac-col-label">🎯 TARGET</div>
              ${_cityCardHtml()}
              ${_enemyCardHtml()}
            </div>

          </div>

        </div>

        <div class="ac-footer">
          <button class="ac-cancel-btn" id="ac-cancel">Cancel</button>
          <button class="ac-confirm-btn" id="ac-confirm">⚔ Confirm Attack</button>
        </div>

      </div>
    `;

    // Lord selector change
    document.getElementById('ac-lord-sel')?.addEventListener('change', e => {
      const lord = LordService.getById(e.target.value);
      if (!lord) return;
      const detail = document.getElementById('ac-atk-detail');
      if (detail) detail.innerHTML = _attackerCardHtml(lord);
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

      // 1 — Notify defender server-side
      try {
        const { data: { session } } = await SupabaseService.client.auth.getSession();
        const token = session?.access_token || null;
        // Calculate ETA from the enqueue (speed-based), used for defender's warning message
        const speed   = LordService.getEffectiveStats(lord).speed;
        const fromX   = lord.x ?? targetX;
        const fromY   = lord.y ?? targetY;
        const dist    = Math.max(Math.abs(targetX - fromX), Math.abs(targetY - fromY));
        const etaSecs = Math.max(60, dist > 0 ? Math.round(dist * 20 * (5 / speed)) : 60);
        if (token) {
          await fetch('/api/attack/declare', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body:    JSON.stringify({ attackerLordId: lord.id, targetTileX: targetX, targetTileY: targetY, etaSecs }),
          });
        }
      } catch (_) {
        // Non-fatal — continue with local enqueue even if server is down
      }

      // 2 — Enqueue move with attack intent (server-validated)
      const result = await ServerActions.lordMove(lord.id, targetX, targetY, { intent: 'attack' });
      if (!result.ok) {
        btn.disabled    = false;
        btn.textContent = '⚔ Confirm Attack';
        const footer = document.querySelector('.ac-footer');
        let err = footer.querySelector('.ac-err');
        if (!err) { err = document.createElement('div'); err.className = 'ac-err'; footer.prepend(err); }
        err.textContent = result.error || 'Server error';
        return;
      }

      // 3 — Navigate to overview
      const refreshedPlayer = PlayerService.getById(player.id);
      App.navigate('overview', { player: refreshedPlayer, lord: LordService.getById(lord.id) });
    });
  }

  return { render };
})();
