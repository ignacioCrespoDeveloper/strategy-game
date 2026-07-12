// =============================================
//  map-view.js — World map + tile info panel
// =============================================

const MapView = (() => {
  const TILE = 36;
  const GAP  = 1;
  const STEP = TILE + GAP;

  let _canvas       = null;
  let _ctx          = null;
  let _lord         = null;   // context lord (opened from)
  let _player       = null;
  let _size         = 0;
  let _offset       = { x: 0, y: 0 };
  let _drag         = null;
  let _pendingTile  = null;
  let _selectedTile = null;
  let _movingLord   = null;   // lord currently being relocated
  let _moveTarget   = null;   // { x, y } — selected destination

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord, mode }) {
    _player       = player;
    _lord         = lord;
    _size         = WorldService.getSize();
    _selectedTile = null;
    _moveTarget   = null;
    _movingLord   = mode === 'move-lord' ? lord : null;

    root.innerHTML = `
      <div class="map-screen">

        <div class="map-move-bar${_movingLord ? '' : ' hidden'}" id="map-move-bar">
          <span class="map-move-msg" id="map-move-msg">${_movingLord ? `📍 Selecciona destino para <b>${_movingLord.name}</b>` : ''}</span>
          <button class="map-cancel-move-btn" id="map-cancel-move">✕ Cancelar</button>
        </div>

        <div class="map-body">
          <div class="map-area" id="map-area">
            <canvas id="world-canvas"></canvas>
            <div class="map-prompt" id="map-prompt"></div>
          </div>
          <aside class="map-info-panel" id="map-info-panel">
            ${_movingLord && _movingLord.x != null ? _selectDestHtml() : _emptyPanelHtml()}
          </aside>
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
    const myCityIds = new Set(_player ? CityService.getPlayerCities(_player.id).map(c => c.id) : []);

    const discoveredEnemyTiles = _player
      ? new Set(IntelligenceService.getByType(_player.id, 'enemy_city').map(r => `${r.tileX},${r.tileY}`))
      : new Set();

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
        // Dot badge in top-right corner of the city tile
        const bx = px + TILE - 7;
        const by = py + 7;
        _ctx.beginPath();
        _ctx.arc(bx, by, 6, 0, Math.PI * 2);
        _ctx.fillStyle = isCurr
          ? (isMovingThis ? '#ddb830' : '#c8933a')
          : '#50a050';
        _ctx.fill();
        _ctx.strokeStyle = '#0a0e18';
        _ctx.lineWidth   = 1.5;
        _ctx.stroke();
        if (race) {
          _ctx.font         = '7px serif';
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.icon, bx, by);
        }
      } else {
        const borderColor = isCurr
          ? (isMovingThis ? 'rgba(220,184,48,0.95)' : 'rgba(200,147,58,0.85)')
          : 'rgba(120,180,120,0.8)';
        _ctx.strokeStyle = borderColor;
        _ctx.lineWidth   = isCurr ? (isMovingThis ? 2.5 : 1.5) : 1;
        _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
        _ctx.stroke();
        if (race) {
          _ctx.font         = `${Math.floor(TILE * 0.42)}px serif`;
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.icon, px + TILE / 2, py + TILE / 2);
        }
      }
    });

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
        <div class="mip-empty-text">Toca cualquier tile</div>
      </div>
    `;
  }

  function _selectDestHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">📍</div>
        <div class="mip-empty-text">Selecciona el destino</div>
        <div class="mip-empty-sub" style="font-size:0.7rem;color:var(--text-muted);text-align:center;padding:0 1rem">Toca el tile de destino para ver el tiempo de viaje</div>
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
        <div class="mip-section-label">🗺 Mover Lord</div>
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
          <span class="mip-label">Desde</span>
          <span class="mip-value">${fromTerrain.icon} (${lord.x}, ${lord.y})</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Hasta</span>
          <span class="mip-value">${toTerrain.icon} (${tx}, ${ty})</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Distancia</span>
          <span class="mip-value">${dist} tile${dist !== 1 ? 's' : ''}</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Tiempo</span>
          <span class="mip-value mip-value--gold">⏱ ${TimeService.formatDuration(secs)}</span>
        </div>
      </div>
      <div class="mip-divider"></div>
      <div class="mip-section">
        <button class="btn-primary mip-action-btn" id="mip-confirm-move-btn">✓ Confirmar Movimiento</button>
        <button class="mip-cancel-move-link" id="mip-cancel-move-btn">✕ Cancelar</button>
      </div>
    `;
  }

  function _tilePanelHtml(x, y) {
    const terrain   = WorldService.getTerrain(x, y);
    const cityId    = WorldService.getTile(x, y);
    const rawCity   = cityId ? CityService.getById(cityId) : null;
    const isOwnCity = rawCity && _player && CityService.getPlayerCities(_player.id).some(c => c.id === cityId);
    const intelRec  = (!isOwnCity && rawCity && _player)
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

    // 2 — City
    let citySection = '';
    if (!rawCity) {
      // No city on this tile at all
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-stat-row">
            <span class="mip-label">Status</span>
            <span class="mip-value mip-value--muted">${banditsHere.length > 0 ? '⚔ Bandit Camp' : 'Unoccupied'}</span>
          </div>
          ${banditsHere.length === 0 ? `<button class="btn-primary mip-action-btn" id="mip-found-btn">⚑ Found City Here</button>` : ''}
        </div>
      `;
    } else if (isOwnCity) {
      // Own city — full info
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">City</div>
          <div class="mip-tile-header">
            <div class="mip-tile-icon">🏰</div>
            <div>
              <div class="mip-tile-name">${rawCity.name}</div>
              <div class="mip-tile-coords">Your city</div>
            </div>
          </div>
          <div class="mip-stat-row"><span class="mip-label">Population</span><span class="mip-value">${Math.floor(rawCity.population)}</span></div>
          <div class="mip-stat-row"><span class="mip-label">Town Hall</span><span class="mip-value">Lv ${rawCity.buildings.town_hall || 0}</span></div>
          <button class="btn-primary mip-action-btn" id="mip-open-city-btn">Enter City →</button>
        </div>
      `;
    } else if (isDiscoveredEnemy) {
      // Scouted enemy city — show info based on intel tier
      const idata = intelRec.data;
      const tier  = intelRec.qualityTier;
      const TIER_LABELS = { vague: 'Vaga', clear: 'Clara', precise: 'Precisa' };
      const TIER_COLORS = { vague: '#888899', clear: '#c8b040', precise: '#40c0ff' };
      let garrisonHtml = '';
      if (tier === 'vague' && idata.garrisonCount != null) {
        garrisonHtml = `<div class="mip-stat-row"><span class="mip-label">Guarnición</span><span class="mip-value">~${idata.garrisonCount} unidades</span></div>`;
      } else if (idata.garrisonUnits?.length > 0) {
        garrisonHtml = `<div class="mip-intel-garrison-label">Guarnición</div>` +
          idata.garrisonUnits.map(r => {
            const def = UNIT_DEFS[r.unitId];
            return `<div class="mip-stat-row"><span class="mip-label">${def?.icon || '⚔'} ${def?.name || r.unitId}</span><span class="mip-value">×${r.count}</span></div>`;
          }).join('');
      }
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">Ciudad Enemiga</div>
          <div class="mip-tile-header">
            <div class="mip-tile-icon">🏯</div>
            <div>
              <div class="mip-tile-name">${idata.name || 'Ciudad Enemiga'}</div>
              <div class="mip-tile-coords" style="color:${TIER_COLORS[tier]}">👁 Intel ${TIER_LABELS[tier] || tier}</div>
            </div>
          </div>
          ${tier === 'precise' && idata.population ? `<div class="mip-stat-row"><span class="mip-label">Población</span><span class="mip-value">${idata.population}</span></div>` : ''}
          ${garrisonHtml}
        </div>
      `;
    } else {
      // City exists but has never been scouted — unknown
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">City</div>
          <div class="mip-tile-header">
            <div class="mip-tile-icon">🏚</div>
            <div>
              <div class="mip-tile-name">Ciudad Desconocida</div>
              <div class="mip-tile-coords mip-value--muted">Explora esta zona para obtener información</div>
            </div>
          </div>
        </div>
      `;
    }

    // 3 — Lords at this tile
    const lordsSection = lordsHere.length > 0 ? `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">Lord${lordsHere.length > 1 ? 's' : ''} aquí</div>
        ${lordsHere.map(lord => {
          const race      = RACES[lord.race] || {};
          const cls       = LORD_CLASSES[lord.classId];
          const busy      = lord.actionQueue.length > 0;
          const stanceDef = STANCE_DEFS[lord.stance?.id] || STANCE_DEFS.idle;
          const isStanced = LordService.isStanced(lord);

          let statusLine = '';
          if (busy) {
            const action = lord.actionQueue[0];
            const secs   = LordService.actionTimeRemaining(lord);
            const icon   = action.actionId === 'search_area' ? '🔍' : '🗺';
            statusLine = `<div class="mip-lord-status">${icon} ${action.actionId === 'search_area' ? 'Buscando' : 'Viajando'} · ${TimeService.formatDuration(secs)}</div>`;
          } else if (isStanced) {
            statusLine = `<div class="mip-lord-status">${stanceDef.icon} ${stanceDef.name}</div>`;
          }

          const actionsHtml = !busy ? `
            <div class="mip-lord-actions">
              <button class="mip-lord-search-btn mip-action-btn-sm" data-lord-id="${lord.id}">🔍 Search</button>
              <button class="mip-lord-move-btn mip-action-btn-sm" data-lord-id="${lord.id}">🗺 Mover</button>
            </div>
          ` : '';

          return `
            <div class="mip-lord-card">
              <div class="mip-lord-top">
                <div class="mip-lord-portrait">${race.icon || '👤'}</div>
                <div class="mip-lord-info-text">
                  <div class="mip-lord-name">${lord.name}</div>
                  <div class="mip-lord-race">${race.name || ''} · Lv ${lord.level || 1}${cls ? ` · ${cls.icon} ${cls.name}` : ''}</div>
                </div>
                <button class="mip-lord-open-btn" data-lord-id="${lord.id}" title="Abrir Lord">›</button>
              </div>
              ${statusLine}
              ${actionsHtml}
            </div>
          `;
        }).join('')}
      </div>
    ` : '';

    // 4 — Bandit camps
    const banditsSection = banditsHere.length > 0 ? `
      <div class="mip-divider"></div>
      <div class="mip-section">
        <div class="mip-section-label">⚔ Bandit Camp</div>
        ${banditsHere.map(r => {
          const def   = DISCOVERY_DEFS[r.definitionId];
          const mercs = (r.mercenaryUnits || []).map(id => UNIT_DEFS[id]?.name || id).join(', ');
          return `
            <div class="mip-bandit-row">
              <div class="mip-stat-row"><span class="mip-label">Camp</span><span class="mip-value">${def?.name || 'Bandit Camp'}</span></div>
              ${mercs ? `<div class="mip-stat-row"><span class="mip-label">Mercs</span><span class="mip-value mip-value--gold">${mercs}</span></div>` : ''}
            </div>`;
        }).join('')}
        <div class="mip-note">Ver pestaña Discovery para atacar</div>
      </div>
    ` : '';

    return `${terrainSection}${citySection}${lordsSection}${banditsSection}`;
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
    document.getElementById('mip-open-city-btn')?.addEventListener('click', () => {
      const cityId = WorldService.getTile(x, y);
      const city   = CityService.getById(cityId);
      if (city) EventBus.emit('city:open', { city, lord: _lord, player: _player });
    });

    document.getElementById('mip-found-btn')?.addEventListener('click', () => {
      _openFoundModal(x, y);
    });

    // Open a lord's full screen
    document.querySelectorAll('.mip-lord-open-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (lord) EventBus.emit('lord:open', { lord, player: _player });
      });
    });

    // Search Area from map — start action then open lord-screen to show countdown
    document.querySelectorAll('.mip-lord-search-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) return;
        const result = LordService.enqueueAction(lord, 'search_area');
        if (!result.ok) {
          // Show inline error
          const err = document.createElement('div');
          err.className = 'mip-err-msg';
          err.textContent = result.error;
          btn.closest('.mip-lord-actions').appendChild(err);
          return;
        }
        const updated = LordService.getById(lord.id);
        EventBus.emit('lord:open', { lord: updated, player: _player });
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
    document.getElementById('mip-confirm-move-btn')?.addEventListener('click', () => {
      if (!_movingLord || !_moveTarget) return;
      const lord   = LordService.getById(_movingLord.id);
      const result = LordService.enqueueMoveAction(lord, _moveTarget.x, _moveTarget.y);
      if (!result.ok) {
        const btn = document.getElementById('mip-confirm-move-btn');
        if (btn) { btn.textContent = result.error; btn.disabled = true; }
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
      if (msg) msg.innerHTML = `📍 Selecciona destino para <b>${_movingLord.name}</b>`;
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

    // Banner cancel button (also re-bound dynamically in _updateMoveBanner)
    document.getElementById('map-cancel-move')?.addEventListener('click', _cancelMove);

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
    if (_movingLord) {
      // Clicking the moving lord's own tile cancels
      if (_movingLord.x === x && _movingLord.y === y) {
        _cancelMove();
        return;
      }
      // Select destination — show preview
      _moveTarget   = { x, y };
      _selectedTile = { x, y };
      _draw();
      _updatePanel(x, y); // will render _movePanelHtml because _moveTarget is set
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

    const result = CityService.found(_player.id, name, _pendingTile.x, _pendingTile.y);
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
