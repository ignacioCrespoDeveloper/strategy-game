// =============================================
//  map-view.js — World map + tile info panel
// =============================================

const MapView = (() => {
  const TILE = 36;
  const GAP  = 1;
  const STEP = TILE + GAP;

  let _canvas  = null;
  let _ctx     = null;
  let _lord    = null;
  let _player  = null;
  let _size    = 0;
  let _offset  = { x: 0, y: 0 };
  let _drag    = null;
  let _pendingTile  = null;
  let _selectedTile = null;
  let _moveMode     = false;

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord, mode }) {
    _player   = player;
    _lord     = lord;
    _moveMode = mode === 'move-lord';
    _size     = WorldService.getSize();
    _selectedTile = null;

    root.innerHTML = `
      <div class="map-screen">

        ${_moveMode ? `
          <div class="map-move-bar">
            <span class="map-move-msg">📍 Click any tile to move your lord there</span>
            <button class="map-cancel-move-btn" id="map-cancel-move">✕ Cancel</button>
          </div>
        ` : ''}

        <div class="map-body">
          <div class="map-area" id="map-area">
            <canvas id="world-canvas"></canvas>
            <div class="map-prompt" id="map-prompt"></div>
          </div>
          ${!_moveMode ? `
            <aside class="map-info-panel" id="map-info-panel">
              ${_emptyPanelHtml()}
            </aside>
          ` : ''}
        </div>


        <!-- Found-city modal -->
        <div class="modal-overlay hidden" id="found-modal">
          <div class="modal-card">
            <h2 class="modal-title">Found a City</h2>
            <p class="modal-sub" id="found-coords"></p>
            <div class="form-group">
              <label class="form-label" for="city-name-input">City Name</label>
              <input class="form-input" type="text" id="city-name-input"
                     placeholder="Name your city" maxlength="30" autocomplete="off" />
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
    _updatePrompt();
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
    const myCityIds = new Set(_lord ? (_lord.cityIds || []) : []);

    for (let y = 0; y < _size; y++) {
      for (let x = 0; x < _size; x++) {
        const px = _offset.x + x * STEP;
        const py = _offset.y + y * STEP;
        if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) continue;
        const cityId     = cityMap[`${x},${y}`] || null;
        const isSelected = _selectedTile?.x === x && _selectedTile?.y === y;
        _drawTile(px, py, x, y, cityId, myCityIds, isSelected);
      }
    }

    // Draw lord position on non-city tiles
    if (_lord && _lord.x != null && !cityMap[`${_lord.x},${_lord.y}`]) {
      const px   = _offset.x + _lord.x * STEP;
      const py   = _offset.y + _lord.y * STEP;
      const race = RACES[_lord.race];
      _ctx.strokeStyle = _moveMode ? 'rgba(200,147,58,0.9)' : 'rgba(200,147,58,0.55)';
      _ctx.lineWidth   = _moveMode ? 2 : 1.5;
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      if (race) {
        _ctx.font         = `${Math.floor(TILE * 0.42)}px serif`;
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.fillText(race.icon, px + TILE / 2, py + TILE / 2);
      }
    }
  }

  function _drawTile(px, py, x, y, cityId, myCityIds, isSelected) {
    _roundRect(px, py, TILE, TILE, 3);

    if (cityId) {
      const isOwn = myCityIds.has(cityId);
      _ctx.fillStyle   = isOwn ? (isSelected ? '#1e4a1e' : '#152e15') : (isSelected ? '#4a1e1e' : '#2e1515');
      _ctx.fill();
      _ctx.strokeStyle = isOwn ? (isSelected ? '#6ae06a' : '#4a8a4a') : (isSelected ? '#e06a6a' : '#8a4a4a');
      _ctx.lineWidth   = isSelected ? 2 : 1.5;
      _ctx.stroke();

      _ctx.font         = `${Math.floor(TILE * 0.42)}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(isOwn ? '🏰' : '🏯', px + TILE / 2, py + TILE / 2 - 2);

      if (isOwn && _lord) {
        const race = RACES[_lord.race];
        if (race) {
          _ctx.font         = `${Math.floor(TILE * 0.28)}px serif`;
          _ctx.textAlign    = 'right';
          _ctx.textBaseline = 'bottom';
          _ctx.fillText(race.icon, px + TILE - 2, py + TILE - 1);
        }
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

  // ── Info panel ────────────────────────────────────────────────

  function _emptyPanelHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">🗺</div>
        <div class="mip-empty-text">Click any tile to explore</div>
      </div>
    `;
  }

  function _tilePanelHtml(x, y) {
    const terrain   = WorldService.getTerrain(x, y);
    const cityId    = WorldService.getTile(x, y);
    const city      = cityId ? CityService.getById(cityId) : null;
    const isOwnCity = city && _lord && (_lord.cityIds || []).includes(cityId);
    const cityLord  = city ? LordService.getById(city.lordId) : null;
    const cityLordRace = cityLord ? (RACES[cityLord.race] || {}) : {};

    // 1 — Terrain
    const terrainSection = `
      <div class="mip-section">
        <div class="mip-section-label">Terrain</div>
        <div class="mip-tile-header">
          <div class="mip-tile-icon">${terrain.icon}</div>
          <div>
            <div class="mip-tile-name">${terrain.name}</div>
            <div class="mip-tile-coords">(${x}, ${y})</div>
          </div>
        </div>
        <div class="mip-tile-desc">${terrain.desc}</div>
      </div>
    `;

    if (!city) {
      return `
        ${terrainSection}
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-stat-row">
            <span class="mip-label">Status</span>
            <span class="mip-value mip-value--muted">Unoccupied</span>
          </div>
          ${!_hasCity()
            ? '<button class="btn-primary mip-action-btn" id="mip-found-btn">⚑ Found City Here</button>'
            : '<p class="mip-note">You already have a city.</p>'}
        </div>
      `;
    }

    // 2 — City
    const citySection = `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">City</div>
        <div class="mip-tile-header">
          <div class="mip-tile-icon">${isOwnCity ? '🏰' : '🏯'}</div>
          <div>
            <div class="mip-tile-name">${city.name}</div>
            <div class="mip-tile-coords">${isOwnCity ? 'Your city' : 'Enemy city'}</div>
          </div>
        </div>
        <div class="mip-stat-row"><span class="mip-label">Population</span><span class="mip-value">${Math.floor(city.population)}</span></div>
        <div class="mip-stat-row"><span class="mip-label">Town Hall</span><span class="mip-value">Lv ${city.buildings.town_hall || 0}</span></div>
        ${isOwnCity ? '<button class="btn-primary mip-action-btn" id="mip-open-city-btn">Enter City →</button>' : ''}
      </div>
    `;

    // 3 — Lord
    const lordSection = cityLord ? `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">Lord</div>
        <button class="mip-lord-btn" id="mip-lord-btn" data-lord-id="${cityLord.id}">
          <div class="mip-lord-portrait">${cityLordRace.icon || '👤'}</div>
          <div class="mip-lord-info-text">
            <div class="mip-lord-name">${cityLord.name}</div>
            <div class="mip-lord-race">${cityLordRace.name || ''} · Lv ${cityLord.level || 1}</div>
          </div>
          <span class="mip-lord-arrow">›</span>
        </button>
      </div>
    ` : '';

    return `${terrainSection}${citySection}${lordSection}`;
  }

  function _updatePanel(x, y) {
    const panel = document.getElementById('map-info-panel');
    if (!panel) return;
    panel.innerHTML = _tilePanelHtml(x, y);

    document.getElementById('mip-open-city-btn')?.addEventListener('click', () => {
      const cityId = WorldService.getTile(x, y);
      const city   = CityService.getById(cityId);
      if (city) EventBus.emit('city:open', { city, lord: _lord, player: _player });
    });

    document.getElementById('mip-found-btn')?.addEventListener('click', () => {
      _openFoundModal(x, y);
    });

    document.getElementById('mip-lord-btn')?.addEventListener('click', () => {
      const lordId = document.getElementById('mip-lord-btn').dataset.lordId;
      const lord   = LordService.getById(lordId);
      if (lord) EventBus.emit('lord:open', { lord, player: _player });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _hasCity() {
    return _lord && _lord.cityIds && _lord.cityIds.length > 0;
  }

  function _updatePrompt() {
    const el = document.getElementById('map-prompt');
    if (!el) return;
    if (_moveMode) { el.textContent = ''; return; }
    el.textContent = _hasCity()
      ? 'Click your city to manage it'
      : 'Select an empty tile to found your first city';
  }

  function _canvasToTile(cx, cy) {
    const tx = Math.floor((cx - _offset.x) / STEP);
    const ty = Math.floor((cy - _offset.y) / STEP);
    if (!WorldService.isInBounds(tx, ty)) return null;
    return { x: tx, y: ty };
  }

  function _canvasXY(e) {
    const rect = _canvas.getBoundingClientRect();
    return {
      cx: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left,
      cy: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top,
    };
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    _canvas.addEventListener('mousedown', e => {
      _drag = { startX: e.clientX, startY: e.clientY, ox: _offset.x, oy: _offset.y, moved: false };
    });
    window.addEventListener('mousemove', e => {
      if (!_drag) return;
      const dx = e.clientX - _drag.startX, dy = e.clientY - _drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _drag.moved = true;
      if (_drag.moved) { _offset.x = _drag.ox + dx; _offset.y = _drag.oy + dy; _draw(); }
    });
    window.addEventListener('mouseup', e => {
      if (!_drag) return;
      if (!_drag.moved) {
        const { cx, cy } = _canvasXY(e);
        const tile = _canvasToTile(cx, cy);
        if (tile) _onTileClick(tile.x, tile.y);
      }
      _drag = null;
    });

    _canvas.addEventListener('touchstart', e => {
      const t = e.touches[0];
      _drag = { startX: t.clientX, startY: t.clientY, ox: _offset.x, oy: _offset.y, moved: false };
    }, { passive: true });
    _canvas.addEventListener('touchmove', e => {
      if (!_drag) return;
      const t = e.touches[0], dx = t.clientX - _drag.startX, dy = t.clientY - _drag.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) _drag.moved = true;
      if (_drag.moved) { _offset.x = _drag.ox + dx; _offset.y = _drag.oy + dy; _draw(); }
    }, { passive: true });
    _canvas.addEventListener('touchend', e => {
      if (_drag && !_drag.moved) {
        const t = e.changedTouches[0], rect = _canvas.getBoundingClientRect();
        const tile = _canvasToTile(t.clientX - rect.left, t.clientY - rect.top);
        if (tile) _onTileClick(tile.x, tile.y);
      }
      _drag = null;
    });

    document.getElementById('map-cancel-move')?.addEventListener('click', () => {
      App.navigate('lord-screen', { lord: _lord, player: _player });
    });

    document.getElementById('found-cancel-btn').addEventListener('click', _closeModal);
    document.getElementById('found-confirm-btn').addEventListener('click', _onFoundConfirm);
    document.getElementById('city-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') _onFoundConfirm();
      if (e.key === 'Escape') _closeModal();
    });
    document.getElementById('found-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) _closeModal();
    });
  }

  function _onTileClick(x, y) {
    if (_moveMode) {
      const result = LordService.enqueueMoveAction(_lord, x, y);
      if (!result.ok) return; // already moving, shouldn't happen
      _lord = LordService.getById(_lord.id);
      App.navigate('lord-screen', { lord: _lord, player: _player });
      return;
    }
    _selectedTile = { x, y };
    _draw();
    _updatePanel(x, y);
  }

  function _openFoundModal(x, y) {
    _pendingTile = { x, y };
    document.getElementById('found-coords').textContent = `Tile (${x}, ${y})`;
    document.getElementById('city-name-input').value   = '';
    document.getElementById('found-error').textContent = '';
    document.getElementById('found-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('city-name-input').focus(), 50);
  }

  function _closeModal() {
    _pendingTile = null;
    document.getElementById('found-modal').classList.add('hidden');
  }

  function _onFoundConfirm() {
    if (!_pendingTile || !_lord) return;
    const name    = document.getElementById('city-name-input').value;
    const errorEl = document.getElementById('found-error');
    errorEl.textContent = '';

    const result = CityService.found(_lord.id, name, _pendingTile.x, _pendingTile.y);
    if (!result.ok) { errorEl.textContent = result.error; return; }

    _closeModal();
    _lord = LordService.getById(_lord.id);
    const updatedPlayer = PlayerService.getById(_player.id);
    _draw();
    _updatePrompt();
    _updatePanel(_pendingTile.x, _pendingTile.y);
    EventBus.emit('city:founded', { player: updatedPlayer, lord: _lord, city: result.city });
  }

  return { render };
})();
