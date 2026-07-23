// =============================================
//  map-view.js — World map + tile info panel
// =============================================

const MapView = (() => {
  const TILE = 36;
  const GAP  = 1;
  const STEP = TILE + GAP;

  // Shared fog-of-war tier styling — used by both the enemy-city and
  // enemy-lord cards in the tile panel.
  const _TIER_COLORS = { vague: '#888899', clear: '#c8b040', precise: '#40c0ff' };
  const _TIER_LABELS = { vague: 'Vague', clear: 'Clear', precise: 'Precise' };

  let _canvas        = null;
  let _ctx           = null;
  let _lord          = null;
  let _player        = null;
  let _size          = 0;
  let _offset        = { x: 0, y: 0 };
  let _pendingTile   = null;
  let _selectedTile  = null;
  let _movingLord    = null;
  let _moveTarget    = null;
  // Keyboard-cursor state: lets a keyboard-only user move a focus ring across
  // the canvas with arrow keys and select with Enter/Space, mirroring mouse click.
  let _keyCursor     = null;
  let _canvasFocused = false;
  // Live, zero-stats existence layer for enemy lords (army > 0 only) — "x,y"
  // strings from /api/scan/presence. Cities already have an equivalent via
  // the global world_state table (WorldService.getOccupiedTiles()).
  let _presence       = new Set();

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord, mode }) {
    _player       = player;
    _lord         = lord;
    _size         = WorldService.getSize();
    _selectedTile = null;
    _moveTarget   = null;
    _movingLord   = mode === 'move-lord' ? lord : null;
    _keyCursor    = { x: lord?.x ?? Math.floor(_size / 2), y: lord?.y ?? Math.floor(_size / 2) };

    root.innerHTML = `
      <div class="map-screen">

        <div class="map-move-bar${_movingLord ? '' : ' hidden'}" id="map-move-bar">
          <span class="map-move-msg" id="map-move-msg">${_movingLord ? `📍 Select a destination for <b>${_movingLord.name}</b>` : ''}</span>
          <button class="map-cancel-move-btn" id="map-cancel-move">✕ Cancel</button>
        </div>

        <div class="map-body">
          <div class="map-area" id="map-area">
            <canvas id="world-canvas" tabindex="0" role="application" aria-label="World map. Use arrow keys to move the cursor, Enter to select a tile."></canvas>
            <div class="map-prompt" id="map-prompt"></div>
          </div>
          <aside class="map-info-panel" id="map-info-panel" aria-live="polite">
            ${_movingLord && _movingLord.x != null ? _selectDestHtml() : _emptyPanelHtml()}
          </aside>
        </div>

        <!-- Found-city modal -->
        <div class="modal-overlay hidden" id="found-modal" role="dialog" aria-modal="true" aria-labelledby="found-modal-title">
          <div class="modal-card">
            <h2 class="modal-title" id="found-modal-title">Found a City</h2>
            <p class="modal-sub" id="found-coords"></p>
            <div class="form-group">
              <label class="form-label" for="city-name-input">City Name</label>
              <div class="lc-name-row">
                <input class="form-input" type="text" id="city-name-input"
                       placeholder="Name your city" maxlength="30" autocomplete="off" />
                <button class="btn-dice" id="city-name-modal-dice" type="button" title="Random city name">🎲</button>
              </div>
            </div>
            <p class="form-error" id="found-error"></p>
            <div class="modal-actions">
              <button class="btn-secondary" id="found-cancel-btn">Cancel</button>
              <button class="btn-primary"   id="found-confirm-btn">Found City</button>
            </div>
          </div>
        </div>

      </div>
    `;

    _initCanvas();
    _bindEvents();
    _draw();
    _updateCanvasAriaLabel();
    _updatePrompt();
    _fetchPresence();
  }

  // ── Canvas setup ─────────────────────────────────────────────

  function _initCanvas() {
    _canvas = document.getElementById('world-canvas');
    _ctx    = _canvas.getContext('2d');
    const area = document.getElementById('map-area');

    const resize = () => {
      _canvas.width  = area.clientWidth;
      _canvas.height = area.clientHeight;
      const gridW = _size * STEP;
      const gridH = _size * STEP;
      _offset.x = Math.max(0, Math.floor((area.clientWidth  - gridW) / 2));
      _offset.y = Math.max(0, Math.floor((area.clientHeight - gridH) / 2));
      _draw();
    };

    resize();
    window.addEventListener('resize', resize);
  }

  // ── Draw ─────────────────────────────────────────────────────

  function _draw() {
    if (!_ctx) return;
    const W = _canvas.width;
    const H = _canvas.height;
    _ctx.clearRect(0, 0, W, H);
    _ctx.fillStyle = '#080c18';
    _ctx.fillRect(0, 0, W, H);

    const occupied = WorldService.getOccupiedTiles();
    const cityMap  = {};
    occupied.forEach(t => { cityMap[`${t.x},${t.y}`] = t.cityId; });
    const myCityIds = new Set(_player ? CityService.getPlayerCities(_player.id).map(c => c.id) : []);

    const discoveredEnemyTiles = _player
      ? new Set(IntelligenceService.getByType(_player.id, 'enemy_city').map(r => `${r.tileX},${r.tileY}`))
      : new Set();

    // Two separate layers: intel (scouted via Search Area, tiered detail)
    // and presence (live, zero-stats, always current — drives the marker
    // even before any scouting has happened, same as cities already work).
    const intelLordTiles = _player
      ? new Set(IntelligenceService.getByType(_player.id, 'enemy_lord').map(r => `${r.tileX},${r.tileY}`))
      : new Set();
    const presenceOnlyTiles = new Set([..._presence].filter(k => !intelLordTiles.has(k)));

    const banditTiles = _player
      ? new Set(DiscoveryService.getActive(_player.id)
          .filter(r => { const d = DISCOVERY_DEFS[r.definitionId]; return d?.category === 'combat'; })
          .map(r => `${r.tileX},${r.tileY}`))
      : new Set();

    const myLords = _player ? LordService.getByPlayer(_player.id).filter(l => l.x != null) : [];
    const lordTileMap = {};
    myLords.forEach(l => {
      const key = `${l.x},${l.y}`;
      if (!lordTileMap[key]) lordTileMap[key] = [];
      lordTileMap[key].push(l);
    });

    // ── Base tiles ────────────────────────────────────────────
    for (let y = 0; y < _size; y++) {
      for (let x = 0; x < _size; x++) {
        const px = _offset.x + x * STEP;
        const py = _offset.y + y * STEP;
        if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) continue;
        const rawCityId    = cityMap[`${x},${y}`] || null;
        const isCityKnown  = !rawCityId || myCityIds.has(rawCityId) || discoveredEnemyTiles.has(`${x},${y}`);
        const isSelected   = _selectedTile?.x === x && _selectedTile?.y === y;
        _drawTile(px, py, x, y, rawCityId, myCityIds, isCityKnown, isSelected);
      }
    }

    // ── Bandit camps ──────────────────────────────────────────
    banditTiles.forEach(key => {
      const [bx, by] = key.split(',').map(Number);
      if (cityMap[key]) return;
      const px = _offset.x + bx * STEP;
      const py = _offset.y + by * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      _ctx.strokeStyle = 'rgba(200,60,40,0.7)';
      _ctx.lineWidth   = 1.5;
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      _ctx.font         = `${Math.floor(TILE * 0.4)}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText('⚔', px + TILE / 2, py + TILE / 2);
    });

    // ── Enemy lords — known (intel) vs presence-only (unscouted) ─────
    // Intel expires after a TTL (set by the Scout action's server response); presence
    // is re-fetched live on map open / tile select and always reflects
    // current server state.
    intelLordTiles.forEach(key => {
      if (cityMap[key]) return; // city tiles handled by city rendering
      const [ex, ey] = key.split(',').map(Number);
      const px = _offset.x + ex * STEP;
      const py = _offset.y + ey * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      _ctx.strokeStyle = 'rgba(200,40,40,0.85)';
      _ctx.lineWidth   = 1.5;
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      _ctx.font         = `${Math.floor(TILE * 0.4)}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText('👁', px + TILE / 2, py + TILE / 2);
    });

    // Presence-only: something is here, but never scouted — subdued marker,
    // distinct from the intel-known 👁 above.
    presenceOnlyTiles.forEach(key => {
      if (cityMap[key]) return;
      const [ex, ey] = key.split(',').map(Number);
      const px = _offset.x + ex * STEP;
      const py = _offset.y + ey * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      _ctx.strokeStyle = 'rgba(140,140,150,0.55)';
      _ctx.lineWidth   = 1;
      _ctx.setLineDash([2, 2]);
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      _ctx.setLineDash([]);
      _ctx.font         = `${Math.floor(TILE * 0.32)}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillStyle    = 'rgba(180,180,190,0.75)';
      _ctx.fillText('❔', px + TILE / 2, py + TILE / 2);
    });

    // ── Lords — draw on ALL tiles, including city tiles ───────
    myLords.forEach(lord => {
      const px     = _offset.x + lord.x * STEP;
      const py     = _offset.y + lord.y * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      const race    = RACES[lord.race];
      const isCurr  = _lord && lord.id === _lord.id;
      const isMovingThis = _movingLord && lord.id === _movingLord.id;
      const onCity  = !!cityMap[`${lord.x},${lord.y}`];

      if (onCity) {
        // Badge in top-right corner of the city tile
        const bx = px + TILE - 10;
        const by = py + 10;
        const br = isCurr ? 10 : 8;
        _ctx.beginPath();
        _ctx.arc(bx, by, br, 0, Math.PI * 2);
        _ctx.fillStyle = isCurr
          ? (isMovingThis ? '#ddb830' : '#c8933a')
          : '#2a7a2a';
        _ctx.fill();
        _ctx.strokeStyle = isCurr ? '#fff8e0' : '#88dd88';
        _ctx.lineWidth   = isCurr ? 2 : 1.5;
        _ctx.stroke();
        if (race) {
          _ctx.font         = `${isCurr ? 10 : 8}px serif`;
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.icon, bx, by);
        }
      } else {
        // Filled tile with bright border for lords on open terrain
        const fillColor   = isCurr ? 'rgba(40,30,8,0.92)' : 'rgba(8,28,8,0.88)';
        const borderColor = isCurr
          ? (isMovingThis ? 'rgba(255,220,60,1)' : 'rgba(220,160,50,1)')
          : 'rgba(80,200,80,0.9)';
        _roundRect(px, py, TILE, TILE, 3);
        _ctx.fillStyle = fillColor;
        _ctx.fill();
        _ctx.strokeStyle = borderColor;
        _ctx.lineWidth   = isCurr ? 2.5 : 2;
        _ctx.stroke();
        if (race) {
          _ctx.font         = `${Math.floor(TILE * 0.52)}px serif`;
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.icon, px + TILE / 2, py + TILE / 2 - 1);
        }
      }
    });

    // ── Active movement arrows (lords already travelling) ────
    // Uses full lord list (not myLords) so lords with x=null (first move) are included.
    if (_player) {
      LordService.getByPlayer(_player.id).forEach(lord => {
        const qItem = lord.actionQueue && lord.actionQueue[0];
        if (!qItem || qItem.actionId !== 'move_lord' || qItem.destX == null) return;
        if (_movingLord && _movingLord.id === lord.id) return;

        const tox = _offset.x + qItem.destX * STEP + TILE / 2;
        const toy = _offset.y + qItem.destY * STEP + TILE / 2;

        const isAttack  = qItem.intent === 'attack';
        const lineColor = isAttack ? 'rgba(220, 60, 60, 0.9)'  : 'rgba(100, 200, 255, 0.85)';
        const dotColor  = isAttack ? 'rgba(220, 60, 60, 1.0)'  : 'rgba(100, 200, 255, 0.9)';
        const borColor  = isAttack ? 'rgba(200, 40, 40, 0.85)' : 'rgba(100, 200, 255, 0.8)';

        if (lord.x != null) {
          const fx = _offset.x + lord.x * STEP + TILE / 2;
          const fy = _offset.y + lord.y * STEP + TILE / 2;

          _ctx.beginPath();
          _ctx.moveTo(fx, fy);
          _ctx.lineTo(tox, toy);
          _ctx.strokeStyle = lineColor;
          _ctx.lineWidth   = isAttack ? 2 : 2.5;
          _ctx.setLineDash([5, 4]);
          _ctx.stroke();
          _ctx.setLineDash([]);

          const angle = Math.atan2(toy - fy, tox - fx);
          _ctx.beginPath();
          _ctx.moveTo(tox, toy);
          _ctx.lineTo(tox - 10 * Math.cos(angle - 0.4), toy - 10 * Math.sin(angle - 0.4));
          _ctx.lineTo(tox - 10 * Math.cos(angle + 0.4), toy - 10 * Math.sin(angle + 0.4));
          _ctx.closePath();
          _ctx.fillStyle = dotColor;
          _ctx.fill();
        }

        const dtx = _offset.x + qItem.destX * STEP;
        const dty = _offset.y + qItem.destY * STEP;
        _ctx.strokeStyle = borColor;
        _ctx.lineWidth   = 2;
        _ctx.setLineDash([3, 3]);
        _roundRect(dtx + 1, dty + 1, TILE - 2, TILE - 2, 2);
        _ctx.stroke();
        _ctx.setLineDash([]);

        _ctx.beginPath();
        _ctx.arc(tox, toy, 4, 0, Math.PI * 2);
        _ctx.fillStyle = dotColor;
        _ctx.fill();
      });
    }

    // ── Move mode overlay ─────────────────────────────────────
    if (_movingLord && _movingLord.x != null) {
      const lx = _offset.x + _movingLord.x * STEP;
      const ly = _offset.y + _movingLord.y * STEP;

      // Pulsing gold border on lord's current tile
      _ctx.strokeStyle = 'rgba(220,184,48,0.95)';
      _ctx.lineWidth   = 2.5;
      _roundRect(lx + 1, ly + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();

      if (_moveTarget) {
        const tx = _offset.x + _moveTarget.x * STEP;
        const ty = _offset.y + _moveTarget.y * STEP;

        // Green border on destination tile
        _ctx.strokeStyle = 'rgba(80,200,80,0.9)';
        _ctx.lineWidth   = 2;
        _roundRect(tx + 1, ty + 1, TILE - 2, TILE - 2, 2);
        _ctx.stroke();

        // Dotted arrow from lord to destination
        const fx  = lx + TILE / 2;
        const fy  = ly + TILE / 2;
        const tox = tx + TILE / 2;
        const toy = ty + TILE / 2;
        _ctx.beginPath();
        _ctx.moveTo(fx, fy);
        _ctx.lineTo(tox, toy);
        _ctx.strokeStyle = 'rgba(220,184,48,0.55)';
        _ctx.lineWidth   = 1.5;
        _ctx.setLineDash([5, 4]);
        _ctx.stroke();
        _ctx.setLineDash([]);

        // Arrowhead
        const angle = Math.atan2(toy - fy, tox - fx);
        _ctx.beginPath();
        _ctx.moveTo(tox, toy);
        _ctx.lineTo(tox - 9 * Math.cos(angle - 0.4), toy - 9 * Math.sin(angle - 0.4));
        _ctx.lineTo(tox - 9 * Math.cos(angle + 0.4), toy - 9 * Math.sin(angle + 0.4));
        _ctx.closePath();
        _ctx.fillStyle = 'rgba(220,184,48,0.8)';
        _ctx.fill();
      }
    }

    // Keyboard-cursor ring — only drawn while the canvas actually has
    // keyboard focus, so mouse-only users never see an extra ring they
    // didn't ask for.
    if (_canvasFocused && _keyCursor) {
      const px = _offset.x + _keyCursor.x * STEP;
      const py = _offset.y + _keyCursor.y * STEP;
      _ctx.strokeStyle = '#c8933a';
      _ctx.lineWidth   = 2;
      _ctx.setLineDash([4, 3]);
      _ctx.strokeRect(px - 1, py - 1, TILE + 2, TILE + 2);
      _ctx.setLineDash([]);
    }
  }

  function _drawTile(px, py, x, y, cityId, myCityIds, isCityKnown, isSelected) {
    _roundRect(px, py, TILE, TILE, 3);

    if (cityId) {
      const isOwn = myCityIds.has(cityId);
      if (isOwn) {
        _ctx.fillStyle   = isSelected ? '#1e4a1e' : '#152e15';
        _ctx.fill();
        _ctx.strokeStyle = isSelected ? '#6ae06a' : '#4a8a4a';
        _ctx.lineWidth   = isSelected ? 2 : 1.5;
        _ctx.stroke();
        _ctx.font         = `${Math.floor(TILE * 0.42)}px serif`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillStyle    = '#ffffff';
        _ctx.fillText('🏰', px + TILE / 2, py + TILE / 2 - 2);
      } else if (isCityKnown) {
        _ctx.fillStyle   = isSelected ? '#4a1e1e' : '#2e1515';
        _ctx.fill();
        _ctx.strokeStyle = isSelected ? '#e06a6a' : '#8a4a4a';
        _ctx.lineWidth   = isSelected ? 2 : 1.5;
        _ctx.stroke();
        _ctx.font         = `${Math.floor(TILE * 0.42)}px serif`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillStyle    = '#ffffff';
        _ctx.fillText('🏯', px + TILE / 2, py + TILE / 2 - 2);
      } else {
        // Unknown enemy city — muted silhouette
        _ctx.fillStyle   = isSelected ? '#252535' : '#18181f';
        _ctx.fill();
        _ctx.strokeStyle = isSelected ? '#5050a0' : '#303055';
        _ctx.lineWidth   = isSelected ? 2 : 1;
        _ctx.stroke();
        _ctx.font         = `${Math.floor(TILE * 0.36)}px serif`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillStyle    = '#555580';
        _ctx.fillText('🏚', px + TILE / 2, py + TILE / 2 - 1);
      }
    } else {
      const terrain = WorldService.getTerrain(x, y);
      if (isSelected) {
        _ctx.fillStyle   = '#1a2a3a';
        _ctx.fill();
        _ctx.strokeStyle = '#3a6a9a';
        _ctx.lineWidth   = 1.5;
        _ctx.stroke();
      } else {
        _ctx.fillStyle   = terrain.canvasBg;
        _ctx.fill();
        _ctx.strokeStyle = terrain.canvasBorder;
        _ctx.lineWidth   = 1;
        _ctx.stroke();
      }
    }

    if (x % 5 === 0 && y % 5 === 0) {
      _ctx.font         = '7px system-ui';
      _ctx.fillStyle    = '#2a3a5a';
      _ctx.textAlign    = 'left';
      _ctx.textBaseline = 'top';
      _ctx.fillText(`${x},${y}`, px + 3, py + 2);
    }
  }

  function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.lineTo(x + w - r, y);     _ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    _ctx.lineTo(x + w, y + h - r); _ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    _ctx.lineTo(x + r, y + h);     _ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
    _ctx.lineTo(x, y + r);         _ctx.quadraticCurveTo(x,     y,     x + r, y);
    _ctx.closePath();
  }

  // ── Info panel HTML builders ──────────────────────────────────

  function _emptyPanelHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">🗺</div>
        <div class="mip-empty-text">Tap any tile</div>
      </div>
    `;
  }

  function _selectDestHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">📍</div>
        <div class="mip-empty-text">Select a destination</div>
        <div class="mip-empty-sub" style="font-size:0.7rem;color:var(--text-muted);text-align:center;padding:0 1rem">Tap the destination tile to see travel time</div>
      </div>
    `;
  }

  // Panel showing move preview + confirm
  function _movePanelHtml(tx, ty) {
    const lord        = _movingLord;
    const race        = RACES[lord.race] || {};
    const cls         = LORD_CLASSES[lord.classId];
    const fromTerrain = WorldService.getTerrain(lord.x, lord.y);
    const toTerrain   = WorldService.getTerrain(tx, ty);
    const dist        = Math.max(1, Math.max(Math.abs(tx - lord.x), Math.abs(ty - lord.y)));
    const speed       = LordService.getEffectiveStats(lord).speed;
    const secs        = Math.round(dist * 20 * (5 / speed));

    return `
      <div class="mip-section">
        <div class="mip-section-label">🗺 Move Lord</div>
        <div class="mip-tile-header">
          <div class="mip-tile-icon">${race.icon || '👤'}</div>
          <div>
            <div class="mip-tile-name">${lord.name}</div>
            <div class="mip-tile-coords">${race.name || ''} · Lv ${lord.level || 1}${cls ? ` · ${cls.icon} ${cls.name}` : ''}</div>
          </div>
        </div>
      </div>
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-stat-row">
          <span class="mip-label">From</span>
          <span class="mip-value">${fromTerrain.icon} (${lord.x}, ${lord.y})</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">To</span>
          <span class="mip-value">${toTerrain.icon} (${tx}, ${ty})</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Distance</span>
          <span class="mip-value">${dist} tile${dist !== 1 ? 's' : ''}</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Time</span>
          <span class="mip-value mip-value--gold">⏱ ${TimeService.formatDuration(secs)}</span>
        </div>
      </div>
      <div class="mip-divider"></div>
      <div class="mip-section">
        <button class="btn-primary mip-action-btn" id="mip-confirm-move-btn">✓ Confirm Move</button>
        <button class="mip-cancel-move-link" id="mip-cancel-move-btn">✕ Cancel</button>
      </div>
    `;
  }

  function _tilePanelHtml(x, y) {
    const terrain   = WorldService.getTerrain(x, y);
    const cityId    = WorldService.getTile(x, y);
    // rawCity is only ever non-null for the player's OWN cities — client-side
    // CityService is RLS-scoped and structurally can't see other players'
    // city records. Gating intelRec on `rawCity` (instead of the globally-
    // visible `cityId` from world_state) meant an enemy city's intel could
    // never be found here regardless of how many times it was scouted — bug.
    const rawCity   = cityId ? CityService.getById(cityId) : null;
    const isOwnCity = !!rawCity && _player && CityService.getPlayerCities(_player.id).some(c => c.id === cityId);
    const intelRec  = (!isOwnCity && cityId && _player)
      ? IntelligenceService.getByType(_player.id, 'enemy_city').find(r => r.tileX === x && r.tileY === y)
      : null;
    const isDiscoveredEnemy = !!intelRec;
    const city = (isOwnCity || isDiscoveredEnemy) ? rawCity : null;

    const lordsHere = _player
      ? LordService.getByPlayer(_player.id).filter(l => l.x === x && l.y === y)
      : [];

    const banditsHere = _player
      ? DiscoveryService.getActive(_player.id).filter(r => {
          const d = DISCOVERY_DEFS[r.definitionId];
          return d?.category === 'combat' && r.tileX === x && r.tileY === y;
        })
      : [];

    const myLordsIdle = _player
      ? LordService.getByPlayer(_player.id).filter(l => l.actionQueue.length === 0 && l.x != null)
      : [];

    // 1 — Terrain
    const terrainSection = `
      <div class="mip-section">
        <div class="mip-terrain-card">
          ${terrain.image
            ? `<img class="mip-tc-img" src="${terrain.image}" alt="${terrain.name}" loading="lazy" />`
            : `<div class="mip-tc-icon-fallback"><span>${terrain.icon}</span></div>`}
          <div class="mip-tc-overlay"></div>
          <div class="mip-tc-body">
            <div class="mip-tc-name">${terrain.name}</div>
            <div class="mip-tc-coords">(${x}, ${y})</div>
            <div class="mip-tc-desc">${terrain.desc}</div>
          </div>
        </div>
      </div>
    `;

    // 2 — City
    let citySection = '';
    if (!cityId) {
      const isBandit     = banditsHere.length > 0;
      let foundBtnHtml   = '';
      if (_player && !isBandit) {
        const freshPlayer  = PlayerService.getById(_player.id);
        const playerCities = CityService.getPlayerCities(_player.id);
        const MAX_CITIES   = 5;
        if (playerCities.length < MAX_CITIES) {
          const cost      = playerCities.length === 0 ? 0 : 5000 * Math.pow(2, playerCities.length - 1);
          const coins     = freshPlayer?.coins ?? 0;
          const canAfford = cost === 0 || coins >= cost;
          const costLabel = cost === 0 ? 'Free' : `💰 ${cost.toLocaleString()}`;
          foundBtnHtml = `
            <button class="btn-primary mip-found-city-btn"
                    id="mip-found-btn"
                    style="width:100%;margin-top:0.75rem"
                    ${canAfford ? '' : 'disabled title="Not enough gold"'}>
              🏙 Found City Here${cost > 0 ? ` — ${costLabel}` : ''}
            </button>`;
        }
      }
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-stat-row">
            <span class="mip-label">Status</span>
            <span class="mip-value mip-value--muted">${isBandit ? '⚔ Bandit Camp' : 'Unoccupied'}</span>
          </div>
          ${foundBtnHtml}
        </div>
      `;
    } else if (isOwnCity) {
      // Own city — exact same card as homepage
      const _level     = CityStatsService.getCityLevel(rawCity);
      const _tierImgs  = ['assets/city/tier1.webp','assets/city/tier1.webp','assets/city/tier2.jpg','assets/city/tier3.jpg','assets/city/tier4.jpg','assets/city/tier4.jpg'];
      const _tierImg   = _tierImgs[Math.min(_level, _tierImgs.length - 1)];
      const _stats     = CityStatsService.getStats(rawCity);
      const _status    = CityStatsService.getCityStatus(_stats);
      const _slots     = CityStatsService.getSlotInfo(rawCity);
      const _goldRate  = ProductionService.getGoldRate(rawCity);
      const _rates     = ProductionService.getRates(rawCity, null);
      const _growth    = CityStatsService.getPopulationGrowthRate(rawCity, _stats, _rates);
      const _buildItem = rawCity.constructionQueue.length > 0 ? rawCity.constructionQueue[0] : null;
      const _buildDef  = _buildItem ? BUILDING_DEFS[_buildItem.buildingId] : null;
      const _buildPct  = _buildItem ? Math.floor(ConstructionService.progress(rawCity) * 100) : 0;
      const _buildSecs = _buildItem ? ConstructionService.timeRemaining(rawCity) : 0;
      const _growSym   = _growth > 0 ? '▲' : _growth < 0 ? '▼' : '─';
      const _growCls   = _growth > 0 ? 'ov-cc-grow--up' : _growth < 0 ? 'ov-cc-grow--down' : 'ov-cc-grow--stable';
      const _growLbl   = _growth !== 0 ? ` ${_growth > 0 ? '+' : ''}${_growth}/hr` : '';
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
        <div class="ov-city-card mip-card-wide" id="mip-open-city-btn" data-city-id="${rawCity.id}" style="cursor:pointer">
          <div class="ov-cc-art">
            <img class="ov-cc-art-img" src="${_tierImg}" alt="${rawCity.name}" loading="lazy" />
            <div class="ov-cc-art-fade"></div>
          </div>
          <div class="ov-cc-inner">
            <div class="ov-cc-terrain">
              <span class="ov-cc-terrain-icon">${terrain.icon}</span>
              <span class="ov-cc-terrain-name">${terrain.name}</span>
            </div>
            <div class="ov-cc-name-row">
              <span class="ov-cc-name">${rawCity.name}</span>
              <span class="cvl-status-badge cvl-${_status.id}">${_status.label}</span>
            </div>
            <div class="ov-cc-coords">(${rawCity.x}, ${rawCity.y})</div>
            <div class="ov-cc-divider"></div>
            <div class="ov-cc-stats">
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Population</span>
                <span class="ov-cc-stat-value">${Math.floor(rawCity.population).toLocaleString()} <span class="ov-cc-grow ${_growCls}">${_growSym}${_growLbl}</span></span>
              </div>
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Tier</span>
                <span class="ov-cc-stat-value">Tier ${_level}</span>
              </div>
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Slots</span>
                <span class="ov-cc-stat-value">${_slots.usedSlots}/${_slots.maxSlots}</span>
              </div>
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Gold/hr</span>
                <span class="ov-cc-stat-value ov-cc-gold-rate">+${_goldRate}💰</span>
              </div>
            </div>
            ${_buildItem ? `<div class="ov-cc-construction">
              <div class="ov-cc-constr-label">
                <span>🔨 ${_buildDef?.name || _buildItem.buildingId} → Lv ${_buildItem.targetLevel}</span>
                <span class="ov-cc-constr-time">${TimeService.formatDuration(_buildSecs)}</span>
              </div>
              <div class="ov-cc-constr-bar"><div class="ov-cc-constr-fill" style="width:${_buildPct}%"></div></div>
            </div>` : ''}
            <div class="ov-cc-enter">Enter City →</div>
          </div>
        </div>
        </div>
      `;
    } else if (isDiscoveredEnemy) {
      // Scouted enemy city — card matching own city format
      const idata      = intelRec.data;
      const intelTier  = intelRec.qualityTier;
      const knownPop   = intelTier === 'precise' && idata.population ? idata.population : null;
      const cityLevel  = knownPop ? (() => {
        if (knownPop >= 100000) return 5;
        if (knownPop >= 50000)  return 4;
        if (knownPop >= 25000)  return 3;
        if (knownPop >= 10000)  return 2;
        return 1;
      })() : null;
      const _tierImgs  = ['assets/city/tier1.webp','assets/city/tier1.webp','assets/city/tier2.jpg','assets/city/tier3.jpg','assets/city/tier4.jpg','assets/city/tier4.jpg'];
      const _tierImg   = _tierImgs[Math.min(cityLevel || 1, _tierImgs.length - 1)];
      const ownerLabel = idata.playerUsername ? `👤 ${idata.playerUsername}` : 'Enemy';
      // vague only ever reveals a bucketed force-size label, never an exact
      // garrison count (same rule as enemy lords) — clear/precise show the
      // real composition once actually scouted that far.
      let garrisonHtml = '';
      if (idata.garrisonUnits?.length > 0) {
        garrisonHtml = idata.garrisonUnits.map(r => {
          const def = UNIT_DEFS[r.unitId];
          return `<div class="ov-cc-stat"><span class="ov-cc-stat-label">${def?.icon || '⚔'} ${def?.name || r.unitId}</span><span class="ov-cc-stat-value">×${r.count}</span></div>`;
        }).join('');
      } else if (idata.forceSize) {
        garrisonHtml = `<div class="ov-cc-stat"><span class="ov-cc-stat-label">Garrison</span><span class="ov-cc-stat-value">${idata.forceSize}</span></div>`;
      }
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
        <div class="ov-city-card mip-card-wide mip-enemy-city-card">
          <div class="ov-cc-art">
            <img class="ov-cc-art-img" src="${_tierImg}" alt="${idata.name || 'Enemy City'}" loading="lazy" />
            <div class="ov-cc-art-fade"></div>
          </div>
          <div class="ov-cc-inner">
            <div class="ov-cc-name-row">
              <span class="ov-cc-name mip-enemy-city-name">${idata.name || 'Enemy City'}</span>
              <span class="mip-intel-badge" style="color:${_TIER_COLORS[intelTier]}">👁 ${_TIER_LABELS[intelTier]}</span>
            </div>
            <div class="ov-cc-coords">${ownerLabel}</div>
            <div class="ov-cc-divider"></div>
            <div class="ov-cc-stats">
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Tier</span>
                <span class="ov-cc-stat-value">${cityLevel ? `Tier ${cityLevel}` : '?'}</span>
              </div>
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Population</span>
                <span class="ov-cc-stat-value">${knownPop ? Math.floor(knownPop).toLocaleString() : '?'}</span>
              </div>
              ${garrisonHtml}
            </div>
          </div>
        </div>
        <button class="mip-city-attack-btn mip-attack-btn mip-card-wide" style="margin-top:0.5rem">⚔ Attack City</button>
        </div>
      `;
    } else {
      // City exists but never scouted — unknown card. Still attackable:
      // requirement is that attacking never depends on prior scouting.
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
        <div class="ov-city-card mip-card-wide mip-enemy-city-card">
          <div class="ov-cc-art" style="display:flex;align-items:center;justify-content:center">
            <span style="font-size:2.2rem;opacity:0.4">🏚</span>
          </div>
          <div class="ov-cc-inner">
            <div class="ov-cc-name-row">
              <span class="ov-cc-name mip-enemy-city-name">Unknown City</span>
            </div>
            <div class="ov-cc-coords mip-value--muted">Scout this area for intelligence</div>
            <div class="ov-cc-divider"></div>
            <div class="ov-cc-stats">
              <div class="ov-cc-stat"><span class="ov-cc-stat-label">Tier</span><span class="ov-cc-stat-value">?</span></div>
              <div class="ov-cc-stat"><span class="ov-cc-stat-label">Owner</span><span class="ov-cc-stat-value">?</span></div>
            </div>
          </div>
        </div>
        <button class="mip-city-attack-btn mip-attack-btn mip-card-wide" style="margin-top:0.5rem">⚔ Attack City</button>
        </div>
      `;
    }

    // 3 — Lords at this tile (own lords — exact homepage card)
    const lordsSection = lordsHere.length > 0 ? `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">Lord${lordsHere.length > 1 ? 's' : ''} Here</div>
        ${lordsHere.map(lord => {
          const race        = RACES[lord.race] || {};
          const cls         = LORD_CLASSES[lord.classId];
          const stats       = LordService.getEffectiveStats(lord);
          const maxHp       = stats.health;
          const lordIsDown  = LordService.isDown(lord);
          const downReason  = lord.downtimeReason || 'defeated';
          const downRemSecs = lordIsDown ? Math.ceil(LordService.getDowntimeRemaining(lord) / 1000) : 0;
          const curHp       = lordIsDown ? 0 : Math.min(lord.currentHp ?? maxHp, maxHp);
          const hpPct       = Math.min(100, Math.floor((curHp / maxHp) * 100));
          const xp          = lord.xp || 0;
          const xpNext      = lord.xpToNext || 100;
          const xpPct       = Math.min(100, Math.floor((xp / xpNext) * 100));

          const queueItem    = lord.actionQueue && lord.actionQueue.length > 0 ? lord.actionQueue[0] : null;
          const activeAction = queueItem ? LORD_ACTIONS[queueItem.actionId] : null;
          const actionPct    = queueItem ? Math.floor(LordService.actionProgress(lord) * 100) : 0;
          const actionSecs   = queueItem ? LordService.actionTimeRemaining(lord) : 0;
          const isAttacking  = queueItem?.intent === 'attack';
          const busy         = !!queueItem;

          const stanceObj   = LordService.getStance(lord);
          const stanceDef   = STANCE_DEFS[stanceObj.id] || STANCE_DEFS.idle;
          const isStanced   = LordService.isStanced(lord);
          const stanceBadge = isStanced
            ? `<span class="ov-lc-stance-badge">${stanceDef.icon} ${stanceDef.name}</span>`
            : '';

          const portraitSrc  = pickLordPortrait(lord.race, lord.classId, lord.id) || lord.portrait || race.portrait;
          const ownerBadge   = `<div class="ov-lc-portrait-owner">👤 ${_player?.username || 'You'}</div>`;
          const portraitHtml = portraitSrc
            ? `<div class="ov-lc-portrait">
                 <img class="ov-lc-portrait-img" src="${portraitSrc}" alt="${lord.name}" loading="lazy" />
                 <div class="ov-lc-portrait-fade"></div>
                 <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
                 ${ownerBadge}
               </div>`
            : `<div class="ov-lc-portrait ov-lc-portrait--icon">
                 <span>${race.icon || '👤'}</span>
                 <div class="ov-lc-portrait-level">Lv ${lord.level || 1}</div>
                 ${ownerBadge}
               </div>`;

          let locationLabel = 'Wandering';
          const allCities = StorageService.get('cities') || {};
          const cityHere  = Object.values(allCities).find(c => c.playerId === _player?.id && c.x === lord.x && c.y === lord.y);
          locationLabel   = cityHere ? cityHere.name : lord.x != null ? `(${lord.x}, ${lord.y})` : 'Wandering';

          // CP + army units
          const army      = ArmyService.get(lord.id);
          const ownUnits  = army?.units || [];
          const cp        = ownUnits.reduce((sum, u) => {
            const def = UNIT_DEFS[u.unitId];
            if (!def) return sum;
            const s = def.combatStats || {};
            return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * u.count;
          }, 0);
          const armyUnitCards = ownUnits.length > 0
            ? ownUnits.flatMap(u => {
                const def = UNIT_DEFS[u.unitId] || {};
                const tierClass = def.category === 'mercenary' ? ' la-unit-card--merc'
                  : (def.category === 'elite' || def.category === 'cavalry') ? ' la-unit-card--elite'
                  : def.category === 'monster' ? ' la-unit-card--monster'
                  : def.category === 'legendary' ? ' la-unit-card--legendary' : '';
                const portrait = def.image
                  ? `<img src="${def.image}" class="la-uc-img" alt="${def.name||u.unitId}" loading="lazy">`
                  : `<div class="la-uc-img la-uc-img--fallback">${def.icon||'⚔'}</div>`;
                return Array.from({ length: u.count }, () => `
                  <div class="la-unit-card mip-enemy-ucard${tierClass}" title="${def.name||u.unitId}">
                    <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
                    ${portrait}
                  </div>`);
              }).join('')
            : '<span class="mip-note">No units</span>';
          const armyToggleId = `mip-army-own-${lord.id}`;

          const actionsHtml = !busy ? `
            <div class="mip-lord-actions" style="margin-top:6px;display:flex;gap:6px">
              <button class="mip-lord-search-btn mip-action-btn-sm" data-lord-id="${lord.id}">🔍 Search</button>
              <button class="mip-lord-scout-btn mip-action-btn-sm" data-lord-id="${lord.id}" title="Gather intel on this tile's enemy lord and city. Safe without an army; risks an ambush if scouting with one.">🕵 Scout</button>
              <button class="mip-lord-move-btn mip-action-btn-sm" data-lord-id="${lord.id}">🗺 Move</button>
            </div>
          ` : '';

          return `
            <div class="ov-lord-card mip-card-wide${lordIsDown ? ' ov-lord-card--down' : ''}" data-lord-id="${lord.id}" style="cursor:pointer">
              ${lordIsDown ? `
                <div class="ov-lord-down-overlay">
                  <div class="ov-lord-down-icon">${downReason === 'captured' ? '⛓' : '💀'}</div>
                  <div class="ov-lord-down-label ov-lord-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
                  <div class="ov-lord-down-cd">${TimeService.formatDuration(downRemSecs)}</div>
                </div>` : ''}
              ${portraitHtml}
              <div class="ov-lc-body">
                <div class="ov-lc-top">
                  <span class="ov-lc-name">${lord.name}</span>
                  ${cp > 0 ? `<span class="mip-lc-cp">⚔ ${cp}</span>` : ''}
                </div>
                <div class="ov-lc-badges">
                  <span class="ov-lc-race">${race.name || ''}</span>
                  ${cls ? `<span class="ov-lc-class-badge" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
                  ${stanceBadge}
                </div>
                <div class="ov-lc-meta${isAttacking ? ' ov-lc-meta--attack' : ''}">
                  📍 ${locationLabel} · ${isAttacking ? `⚔ ATTACKING (${queueItem.destX},${queueItem.destY})` : activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
                </div>
                ${queueItem ? `<div class="ov-lc-action-row">
                  <div class="ov-lc-action-bar"><div class="ov-lc-action-fill${isAttacking ? ' ov-lc-action-fill--attack' : ''}" style="width:${actionPct}%"></div></div>
                  <span class="ov-lc-action-time">${TimeService.formatDuration(actionSecs)}</span>
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
                <button class="mip-army-toggle" data-target="${armyToggleId}">▶ Army (${ownUnits.length > 0 ? ownUnits.reduce((s,u)=>s+u.count,0) : 0})</button>
                <div class="mip-army-units mip-army-hidden" id="${armyToggleId}">
                  <div class="mip-enemy-unit-cards">${armyUnitCards}</div>
                </div>
                <div class="ov-lc-enter">Manage →</div>
              </div>
            </div>
            ${actionsHtml}
          `;
        }).join('')}
      </div>
    ` : '';

    // 4 — Bandit camps (same card design as enemy lords)
    const lordForAttack = lordsHere.find(l => l.actionQueue.length === 0);
    const banditCampCards = banditsHere.map(r => {
      const def       = DISCOVERY_DEFS[r.definitionId] || {};
      const level     = r.campDetails?.level || 1;
      const defenders = r.campDetails?.defenders || [];
      const expiry    = DiscoveryService.formatExpiry(r);
      const mercs     = (r.mercenaryUnits || []).map(id => UNIT_DEFS[id]?.name || id).join(', ');

      const cp = defenders.reduce((sum, u) => {
        const ud = UNIT_DEFS[u.unitId];
        if (!ud) return sum;
        const s = ud.combatStats || {};
        return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * u.count;
      }, 0);

      const unitCardsInner = defenders.length > 0
        ? defenders.flatMap(u => {
            const ud = UNIT_DEFS[u.unitId] || {};
            const tierClass = ud.category === 'mercenary' ? ' la-unit-card--merc'
              : (ud.category === 'elite' || ud.category === 'cavalry') ? ' la-unit-card--elite'
              : ud.category === 'monster' ? ' la-unit-card--monster'
              : ud.category === 'legendary' ? ' la-unit-card--legendary' : '';
            const portrait = ud.image
              ? `<img src="${ud.image}" class="la-uc-img" alt="${ud.name || u.unitId}" loading="lazy">`
              : `<div class="la-uc-img la-uc-img--fallback">${ud.icon || '⚔'}</div>`;
            return Array.from({ length: u.count }, () => `
              <div class="la-unit-card mip-enemy-ucard${tierClass}" title="${ud.name || u.unitId}">
                <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
                ${portrait}
              </div>`);
          }).join('')
        : '<span class="mip-note">No units</span>';

      const armyToggleId = `mip-army-camp-${r.id}`;
      const totalUnits    = defenders.reduce((s, u) => s + u.count, 0);

      const attackBtn = lordForAttack
        ? `<button class="mip-bandit-attack-btn mip-attack-btn mip-card-wide" data-record-id="${r.id}" data-lord-id="${lordForAttack.id}">⚔ Attack</button>`
        : `<p class="mip-note mip-note--warn">Move a lord here to attack</p>`;

      return `
        <div class="mip-enemy-lord-card mip-card-wide">
          <div class="ov-lc-portrait ov-lc-portrait--icon">
            <span style="font-size:2rem">${def.icon || '⚔'}</span>
            <div class="ov-lc-portrait-fade"></div>
            <div class="ov-lc-portrait-level">Lv ${level}</div>
            <div class="ov-lc-portrait-owner">⏱ ${expiry}</div>
          </div>
          <div class="ov-lc-body">
            <div class="ov-lc-top">
              <span class="ov-lc-name">${def.name || 'Enemy Camp'}</span>
              ${cp > 0 ? `<span class="mip-lc-cp mip-lc-cp--enemy">⚔ ${cp}</span>` : ''}
            </div>
            ${mercs ? `<div class="ov-lc-badges"><span class="ov-lc-race mip-value--gold">🤝 ${mercs}</span></div>` : ''}
            <button class="mip-army-toggle mip-army-toggle--enemy" data-target="${armyToggleId}">▶ Army (${totalUnits})</button>
            <div class="mip-army-units mip-army-hidden" id="${armyToggleId}">
              <div class="mip-enemy-unit-cards">${unitCardsInner}</div>
            </div>
          </div>
          ${attackBtn}
        </div>`;
    }).join('');

    const banditsSection = banditsHere.length > 0 ? `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">🏕 Enemy Camp${banditsHere.length > 1 ? 's' : ''}</div>
        ${banditCampCards}
      </div>
    ` : '';

    // 5 — Enemy lords: presence (live, no scouting needed, zero stats) +
    // intel (tiered detail, built up via Search Area quests). The server
    // already truncates rawData to the caller's tier before it crosses the
    // wire (combat-resolver.js scanTile) — this just renders whatever
    // fields are present, it isn't the enforcement point.
    const tileKey          = `${x},${y}`;
    const hasLordPresence  = _presence.has(tileKey);
    const lordIntelRecords = _player
      ? IntelligenceService.getByType(_player.id, 'enemy_lord').filter(r => r.tileX === x && r.tileY === y)
      : [];

    let enemyLordSection = '';
    if (lordIntelRecords.length > 0) {
      const enemyCards = lordIntelRecords.map((rec, idx) => {
        const data      = rec.data;
        const intelTier = rec.qualityTier;
        const race      = RACES[data.lordRace] || {};
        const cls       = LORD_CLASSES[data.lordClass] || null;
        const portraitSrc = data.lordRace
          ? (pickLordPortrait(data.lordRace, data.lordClass, data.lordId) || race.portrait)
          : null;
        const portraitInner = portraitSrc
          ? `<img class="ov-lc-portrait-img" src="${portraitSrc}" alt="${data.lordName || ''}" loading="lazy" />`
          : `<span style="font-size:2rem">${race.icon || '❔'}</span>`;

        const units = data.units || [];
        const cp    = units.reduce((sum, u) => {
          const def = UNIT_DEFS[u.unitId];
          if (!def) return sum;
          const s = def.combatStats || {};
          return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * u.count;
        }, 0);
        const totalUnits = units.length > 0 ? units.reduce((s, u) => s + u.count, 0) : null;

        const unitCardsInner = units.flatMap(u => {
          const def = UNIT_DEFS[u.unitId] || {};
          const tierClass = def.category === 'mercenary' ? ' la-unit-card--merc'
            : (def.category === 'elite' || def.category === 'cavalry') ? ' la-unit-card--elite'
            : def.category === 'monster' ? ' la-unit-card--monster'
            : def.category === 'legendary' ? ' la-unit-card--legendary' : '';
          const portrait = def.image
            ? `<img src="${def.image}" class="la-uc-img" alt="${def.name || u.unitId}" loading="lazy">`
            : `<div class="la-uc-img la-uc-img--fallback">${def.icon || '⚔'}</div>`;
          return Array.from({ length: u.count }, () => `
            <div class="la-unit-card mip-enemy-ucard${tierClass}" title="${def.name || u.unitId}">
              <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
              ${portrait}
            </div>`);
        }).join('');
        const armyToggleId = `mip-army-enemy-${idx}`;

        // Attacking never requires scouting — the button is always
        // available at any intel tier, including vague.
        const attackBtn = myLordsIdle.length > 0
          ? `<button class="mip-attack-btn mip-card-wide" data-lord-record-idx="${idx}">⚔ Attack</button>`
          : `<p class="mip-note mip-note--warn">No lord available to attack</p>`;

        return `
          <div class="mip-enemy-lord-card mip-card-wide">
            <div class="ov-lc-portrait${portraitSrc ? '' : ' ov-lc-portrait--icon'}">
              ${portraitInner}
              <div class="ov-lc-portrait-fade"></div>
              ${data.lordLevel ? `<div class="ov-lc-portrait-level">Lv ${data.lordLevel}</div>` : ''}
              ${data.playerUsername ? `<div class="ov-lc-portrait-owner">👤 ${data.playerUsername}</div>` : ''}
            </div>
            <div class="ov-lc-body">
              <div class="ov-lc-top">
                <span class="ov-lc-name">${data.lordName || 'Unknown Lord'}</span>
                <span class="mip-intel-badge" style="color:${_TIER_COLORS[intelTier]}">👁 ${_TIER_LABELS[intelTier]}</span>
                ${cp > 0 ? `<span class="mip-lc-cp mip-lc-cp--enemy">⚔ ${cp}</span>` : ''}
              </div>
              <div class="ov-lc-badges">
                ${race.name ? `<span class="ov-lc-race">${race.name}</span>` : ''}
                ${cls ? `<span class="ov-lc-class-badge" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
              </div>
              ${totalUnits != null
                ? `<button class="mip-army-toggle mip-army-toggle--enemy" data-target="${armyToggleId}">▶ Army (${totalUnits})</button>
                   <div class="mip-army-units mip-army-hidden" id="${armyToggleId}">
                     <div class="mip-enemy-unit-cards">${unitCardsInner}</div>
                   </div>`
                : `<div class="mip-note">${data.forceSize || 'Unknown force size'}</div>`}
            </div>
            ${attackBtn}
          </div>`;
      }).join('');

      enemyLordSection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">⚔ Enemy Lord${lordIntelRecords.length > 1 ? 's' : ''}</div>
          ${enemyCards}
        </div>`;
    } else if (hasLordPresence) {
      // Presence detected, never scouted — still attackable with zero info.
      enemyLordSection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">⚔ Unknown Force</div>
          <div class="mip-enemy-lord-card mip-card-wide">
            <div class="ov-lc-portrait ov-lc-portrait--icon"><span style="font-size:2rem">❔</span></div>
            <div class="ov-lc-body">
              <div class="ov-lc-top"><span class="ov-lc-name">Unknown Force</span></div>
              <div class="mip-note mip-note--muted">Scout this area for intelligence</div>
            </div>
            ${myLordsIdle.length > 0
              ? `<button class="mip-attack-btn mip-card-wide" data-attack-unknown-lord="1">⚔ Attack</button>`
              : `<p class="mip-note mip-note--warn">No lord available to attack</p>`}
          </div>
        </div>`;
    }

    return `${terrainSection}${citySection}${lordsSection}${enemyLordSection}${banditsSection}`;
  }

  function _updatePanel(x, y) {
    const panel = document.getElementById('map-info-panel');
    if (!panel) return;

    // If we're picking a move destination, show the move preview instead of tile info
    if (_movingLord && _moveTarget) {
      panel.innerHTML = _movePanelHtml(x, y);
      _bindMoveConfirmEvents();
      return;
    }

    panel.innerHTML = _tilePanelHtml(x, y);
    _bindTilePanelEvents(x, y);
  }

  function _bindTilePanelEvents(x, y) {
    const panel = document.getElementById('map-info-panel');

    document.getElementById('mip-open-city-btn')?.addEventListener('click', () => {
      const cityId = WorldService.getTile(x, y);
      const city   = CityService.getById(cityId);
      if (city) EventBus.emit('city:open', { city, lord: _lord, player: _player });
    });
    if (panel) A11y.makeClickable(panel, '#mip-open-city-btn');

    document.getElementById('mip-found-btn')?.addEventListener('click', () => {
      _openFoundModal(x, y);
    });

    // Open a lord's full screen (own lord card click)
    document.querySelectorAll('.ov-lord-card[data-lord-id]').forEach(card => {
      card.addEventListener('click', () => {
        const lord = LordService.getById(card.dataset.lordId);
        if (lord) EventBus.emit('lord:open', { lord, player: _player });
      });
    });
    if (panel) A11y.makeClickable(panel, '.ov-lord-card[data-lord-id]');

    // Army toggle (own + enemy lords)
    document.querySelectorAll('.mip-army-toggle').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const nowHidden = target.classList.toggle('mip-army-hidden');
        btn.textContent = (nowHidden ? '▶' : '▼') + btn.textContent.slice(1);
      });
    });

    // Search Area from map — start action then open lord-screen to show countdown
    document.querySelectorAll('.mip-lord-search-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) return;
        btn.disabled = true;
        const result = await ServerActions.lordSearch(lord.id);
        if (!result.ok) {
          btn.disabled = false;
          const err = document.createElement('div');
          err.className = 'mip-err-msg';
          err.textContent = result.error || 'Server error';
          btn.closest('.mip-lord-actions')?.appendChild(err);
          return;
        }
        const updated = LordService.getById(lord.id);
        EventBus.emit('lord:open', { lord: updated, player: _player });
      });
    });

    // Scout from map — start action then open lord-screen to show countdown
    document.querySelectorAll('.mip-lord-scout-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) return;
        btn.disabled = true;
        const result = await ServerActions.lordScout(lord.id);
        if (!result.ok) {
          btn.disabled = false;
          const err = document.createElement('div');
          err.className = 'mip-err-msg';
          err.textContent = result.error || 'Server error';
          btn.closest('.mip-lord-actions')?.appendChild(err);
          return;
        }
        const updated = LordService.getById(lord.id);
        EventBus.emit('lord:open', { lord: updated, player: _player });
      });
    });

    // Attack bandit camp from map tile panel
    document.querySelectorAll('.mip-bandit-attack-btn[data-record-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) return;
        App.navigate('lord-screen', {
          lord, player: _player,
          openTab: 'quests',
          autoAttackRecordId: btn.dataset.recordId,
        });
      });
    });

    // Attack: per-lord attack buttons target a specific scouted enemy record
    document.querySelectorAll('.mip-attack-btn[data-lord-record-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx     = parseInt(btn.dataset.lordRecordIdx, 10);
        const records = _player
          ? IntelligenceService.getByType(_player.id, 'enemy_lord').filter(r => r.tileX === x && r.tileY === y)
          : [];
        App.navigate('attack-confirm', {
          player: _player, targetX: x, targetY: y,
          enemyData: records[idx]?.data || null,
        });
      });
    });

    // Attack an unknown, unscouted force — blind attack, zero information.
    document.querySelector('.mip-attack-btn[data-attack-unknown-lord]')?.addEventListener('click', () => {
      App.navigate('attack-confirm', { player: _player, targetX: x, targetY: y, enemyData: null });
    });

    // Attack a city — works at any intel tier, including never-scouted.
    document.querySelectorAll('.mip-city-attack-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cityIntelRec = _player
          ? IntelligenceService.getByType(_player.id, 'enemy_city').find(r => r.tileX === x && r.tileY === y)
          : null;
        App.navigate('attack-confirm', {
          player: _player, targetX: x, targetY: y,
          enemyData: null,
          targetCity: cityIntelRec ? cityIntelRec.data : {},
        });
      });
    });

    // Start move mode inline
    document.querySelectorAll('.mip-lord-move-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord || lord.actionQueue.length > 0) return;
        _movingLord  = lord;
        _moveTarget  = null;
        _updateMoveBanner();
        _draw();
        _selectedTile = { x, y };
        // Show "select destination" hint in panel
        const panel = document.getElementById('map-info-panel');
        if (panel) panel.innerHTML = _selectDestHtml();
      });
    });
  }

  function _bindMoveConfirmEvents() {
    document.getElementById('mip-confirm-move-btn')?.addEventListener('click', async () => {
      if (!_movingLord || !_moveTarget) return;
      const lord = LordService.getById(_movingLord.id);
      const confirmBtn = document.getElementById('mip-confirm-move-btn');
      if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Moving…'; }
      const result = await ServerActions.lordMove(lord.id, _moveTarget.x, _moveTarget.y);
      if (!result.ok) {
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Move'; }
        // If the server says the lord is busy but our local state shows idle,
        // resync from Supabase and navigate to lord-screen so the player can see what's happening.
        if ((result.error || '').includes('already in progress')) {
          _movingLord = null;
          _moveTarget = null;
          _updateMoveBanner();
          await ServerActions.syncNow();
          const refreshed = LordService.getById(lord.id);
          EventBus.emit('lord:open', { lord: refreshed, player: _player });
          return;
        }
        if (confirmBtn) { confirmBtn.textContent = result.error || 'Server error'; setTimeout(() => { if (confirmBtn) confirmBtn.textContent = 'Confirm Move'; }, 3000); }
        return;
      }
      const updated = LordService.getById(lord.id);
      _movingLord   = null;
      _moveTarget   = null;
      _updateMoveBanner();
      // Navigate to lord-screen so player can see the travel countdown
      EventBus.emit('lord:open', { lord: updated, player: _player });
    });

    document.getElementById('mip-cancel-move-btn')?.addEventListener('click', _cancelMove);
  }

  function _cancelMove() {
    _movingLord = null;
    _moveTarget = null;
    _updateMoveBanner();
    _draw();
    if (_selectedTile) {
      _updatePanel(_selectedTile.x, _selectedTile.y);
    } else {
      const panel = document.getElementById('map-info-panel');
      if (panel) panel.innerHTML = _emptyPanelHtml();
    }
  }

  function _updateMoveBanner() {
    const bar = document.getElementById('map-move-bar');
    const msg = document.getElementById('map-move-msg');
    if (!bar) return;
    if (_movingLord) {
      bar.classList.remove('hidden');
      if (msg) msg.innerHTML = `📍 Select a destination for <b>${_movingLord.name}</b>`;
    } else {
      bar.classList.add('hidden');
      if (msg) msg.innerHTML = '';
    }
    // Re-bind the banner cancel button (HTML was not re-rendered)
    document.getElementById('map-cancel-move')?.addEventListener('click', _cancelMove);
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _hasCity() {
    return _player && CityService.getPlayerCities(_player.id).length > 0;
  }

  function _updatePrompt() {
    const el = document.getElementById('map-prompt');
    if (!el) return;
    el.textContent = _hasCity()
      ? ''
      : 'Select an empty tile to found your first city';
  }

  function _canvasToTile(cx, cy) {
    const tx = Math.floor((cx - _offset.x) / STEP);
    const ty = Math.floor((cy - _offset.y) / STEP);
    if (!WorldService.isInBounds(tx, ty)) return null;
    return { x: tx, y: ty };
  }

  function _updateCanvasAriaLabel() {
    if (!_canvas || !_keyCursor) return;
    const { x, y } = _keyCursor;
    const terrain  = WorldService.getTerrain(x, y);
    const occupied = WorldService.getOccupiedTiles().some(t => t.x === x && t.y === y);
    _canvas.setAttribute('aria-label',
      `Tile (${x}, ${y}), ${terrain?.name || 'unknown terrain'}${occupied ? ', has a city' : ''}. Press Enter to select.`);
  }

  function _canvasXY(e) {
    const rect = _canvas.getBoundingClientRect();
    return {
      cx: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
      cy: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top,
    };
  }

  // ── Live presence fetch ────────────────────────────────────────
  // Zero-stats "is there an enemy lord here" layer for the whole map —
  // fetched on map open and refreshed on every tile select (not a blind
  // timer, since that would multiply this cross-player scan by however
  // many map tabs happen to be open). Attacks always resolve against live
  // server state regardless of how fresh this snapshot is, so staleness
  // here only ever costs a wasted trip, never a wrong outcome.

  async function _fetchPresence() {
    let token = null;
    try {
      const { data: { session } } = await SupabaseService.client.auth.getSession();
      token = session?.access_token || null;
    } catch (e) {
      console.error('[presence] getSession error:', e);
    }
    if (!token) return;

    try {
      const resp = await fetch('/api/scan/presence', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      });
      const d = await resp.json();
      if (!d.ok || !Array.isArray(d.lords)) return;
      _presence = new Set(d.lords.map(l => `${l.x},${l.y}`));
      _draw();
      if (_selectedTile && !_movingLord) _updatePanel(_selectedTile.x, _selectedTile.y);
    } catch (e) {
      console.warn('[presence] fetch failed:', e.message);
    }
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    _canvas.addEventListener('click', e => {
      const { cx, cy } = _canvasXY(e);
      const tile = _canvasToTile(cx, cy);
      if (tile) _onTileClick(tile.x, tile.y);
    });

    _canvas.addEventListener('touchend', e => {
      const t = e.changedTouches[0], rect = _canvas.getBoundingClientRect();
      const tile = _canvasToTile(t.clientX - rect.left, t.clientY - rect.top);
      if (tile) _onTileClick(tile.x, tile.y);
    });

    _canvas.addEventListener('focus', () => { _canvasFocused = true; _updateCanvasAriaLabel(); _draw(); });
    _canvas.addEventListener('blur',  () => { _canvasFocused = false; _draw(); });

    _canvas.addEventListener('keydown', e => {
      if (!_keyCursor) return;
      const moves = { ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0] };
      if (moves[e.key]) {
        e.preventDefault();
        const [dx, dy] = moves[e.key];
        const nx = Math.min(_size - 1, Math.max(0, _keyCursor.x + dx));
        const ny = Math.min(_size - 1, Math.max(0, _keyCursor.y + dy));
        _keyCursor = { x: nx, y: ny };
        _updateCanvasAriaLabel();
        _draw();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _onTileClick(_keyCursor.x, _keyCursor.y);
      }
    });

    // Banner cancel button (also re-bound dynamically in _updateMoveBanner)
    document.getElementById('map-cancel-move')?.addEventListener('click', _cancelMove);

    document.getElementById('found-cancel-btn').addEventListener('click', _closeModal);
    document.getElementById('found-confirm-btn').addEventListener('click', _onFoundConfirm);
    document.getElementById('city-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') _onFoundConfirm();
      if (e.key === 'Escape') _closeModal();
    });
    document.getElementById('city-name-modal-dice').addEventListener('click', () => {
      const raceId = _lord?.race || _player?.race || 'human';
      document.getElementById('city-name-input').value = randomRaceName(raceId, 'cities');
    });
    document.getElementById('found-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
    document.getElementById('found-modal').addEventListener('keydown', e => {
      if (e.key === 'Escape') _closeModal();
    });
  }

  function _onTileClick(x, y) {
    if (_movingLord) {
      if (_movingLord.x === x && _movingLord.y === y) { _cancelMove(); return; }
      _moveTarget   = { x, y };
      _selectedTile = { x, y };
      _draw();
      _updatePanel(x, y);
      return;
    }

    _selectedTile = { x, y };
    _draw();
    _updatePanel(x, y);
    _fetchPresence(); // refresh-on-tile-select, per the plan's cadence
  }

  const _PENDING_CITY_KEY = 'hexfront_pending_city_name';

  function _openFoundModal(x, y) {
    _pendingTile = { x, y };
    document.getElementById('found-coords').textContent = `Tile (${x}, ${y})`;
    // First city: use the name entered during lord creation if available.
    const isFirst    = !_hasCity();
    const pending    = isFirst ? localStorage.getItem(_PENDING_CITY_KEY) : null;
    const raceId     = _lord?.race || _player?.race || 'human';
    const autoName   = pending || randomRaceName(raceId, 'cities');
    document.getElementById('city-name-input').value   = autoName;
    document.getElementById('found-error').textContent = '';
    document.getElementById('found-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('city-name-input').focus(), 50);
  }

  function _closeModal() {
    _pendingTile = null;
    document.getElementById('found-modal').classList.add('hidden');
  }

  async function _onFoundConfirm() {
    if (!_pendingTile) return;
    const name    = document.getElementById('city-name-input').value;
    const errorEl = document.getElementById('found-error');
    const btn     = document.getElementById('found-confirm-btn');
    errorEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Founding…'; }

    const { x, y } = _pendingTile;
    const result = await ServerActions.foundCity(name, x, y);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Server error';
      if (btn) { btn.disabled = false; btn.textContent = 'Found City'; }
      return;
    }

    localStorage.removeItem(_PENDING_CITY_KEY);
    _closeModal();
    if (_lord) _lord = LordService.getById(_lord.id);
    _player = PlayerService.getById(_player.id) || _player;
    _draw();
    _updatePrompt();
    _updatePanel(x, y);
    EventBus.emit('city:founded', { player: _player, lord: _lord, city: result.city });
  }

  return { render };
})();
