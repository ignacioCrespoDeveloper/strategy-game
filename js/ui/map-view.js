// =============================================
//  map-view.js — World map + tile info panel
// =============================================

const MapView = (() => {
  // Bumped up from 36px — the previous size left no room for a city icon
  // (photo or emoji) to read cleanly; this gives real space for the vector
  // icons below without needing a scroll-heavy 20x20 grid.
  const TILE = 46;
  const GAP  = 2;
  const STEP = TILE + GAP;
  const RULER_MARGIN = 24; // px reserved at top/left for the coordinate ruler

  // Shared fog-of-war tier styling — used by both the enemy-city and
  // enemy-lord cards in the tile panel.
  const _TIER_COLORS = { vague: '#888899', clear: '#c8b040', precise: '#40c0ff' };
  const _TIER_LABELS = { vague: 'Vague', clear: 'Clear', precise: 'Precise' };

  function _cityLevelFromPopulation(pop) {
    if (pop >= 100000) return 5;
    if (pop >= 50000)  return 4;
    if (pop >= 25000)  return 3;
    if (pop >= 10000)  return 2;
    return 1;
  }

  // City tier (1-5) → map icon, drawn as flat vector silhouettes directly
  // on the canvas — no image loading/caching, always pixel-crisp regardless
  // of tile size, same warm-gold-on-dark-outline language as the honor-tier
  // crests elsewhere in the UI. Escalating building complexity per tier
  // (hut → houses → walled town w/ towers → castle w/ keep + banner)
  // instead of a downscaled photo or a default emoji glyph.
  const _CITY_ICON_FILL   = '#e8c878';
  const _CITY_ICON_STROKE = '#2a1a08';

  function _drawHouse(cx, baseY, w, h, roofH) {
    _ctx.beginPath();
    _ctx.rect(cx - w / 2, baseY - h, w, h);
    _ctx.fill();
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.moveTo(cx - w / 2 - w * 0.12, baseY - h);
    _ctx.lineTo(cx, baseY - h - roofH);
    _ctx.lineTo(cx + w / 2 + w * 0.12, baseY - h);
    _ctx.closePath();
    _ctx.fill();
    _ctx.stroke();
  }

  function _drawWallSegment(x, baseY, w, h, crenels) {
    _ctx.beginPath();
    _ctx.rect(x, baseY - h, w, h);
    _ctx.fill();
    _ctx.stroke();
    const step = w / crenels;
    const cw   = step * 0.5;
    for (let i = 0; i < crenels; i++) {
      const cxp = x + i * step + (step - cw) / 2;
      _ctx.beginPath();
      _ctx.rect(cxp, baseY - h - step * 0.4, cw, step * 0.4);
      _ctx.fill();
      _ctx.stroke();
    }
  }

  function _drawTower(cx, baseY, w, h, withFlag) {
    _ctx.beginPath();
    _ctx.rect(cx - w / 2, baseY - h, w, h);
    _ctx.fill();
    _ctx.stroke();
    _ctx.beginPath();
    _ctx.moveTo(cx - w / 2 - w * 0.15, baseY - h);
    _ctx.lineTo(cx, baseY - h - w * 0.9);
    _ctx.lineTo(cx + w / 2 + w * 0.15, baseY - h);
    _ctx.closePath();
    _ctx.fill();
    _ctx.stroke();
    if (withFlag) {
      const poleTop = baseY - h - w * 1.4;
      _ctx.beginPath();
      _ctx.moveTo(cx, baseY - h - w * 0.9);
      _ctx.lineTo(cx, poleTop);
      _ctx.stroke();
      _ctx.beginPath();
      _ctx.moveTo(cx, poleTop);
      _ctx.lineTo(cx + w * 0.55, poleTop + w * 0.18);
      _ctx.lineTo(cx, poleTop + w * 0.36);
      _ctx.closePath();
      _ctx.fill();
    }
  }

  function _drawCityTierIcon(px, py, size, level) {
    const cx    = px + TILE / 2;
    const baseY = py + TILE / 2 + size * 0.32;
    _ctx.save();
    _ctx.fillStyle   = _CITY_ICON_FILL;
    _ctx.strokeStyle = _CITY_ICON_STROKE;
    _ctx.lineWidth   = Math.max(1, size * 0.045);

    if (level <= 1) {
      _drawHouse(cx, baseY, size * 0.52, size * 0.36, size * 0.30);
    } else if (level === 2) {
      _drawHouse(cx - size * 0.20, baseY, size * 0.34, size * 0.24, size * 0.20);
      _drawHouse(cx + size * 0.16, baseY, size * 0.42, size * 0.32, size * 0.26);
    } else if (level === 3) {
      _drawWallSegment(cx - size * 0.46, baseY, size * 0.92, size * 0.24, 4);
      _drawTower(cx - size * 0.32, baseY, size * 0.24, size * 0.44, false);
      _drawTower(cx + size * 0.32, baseY, size * 0.24, size * 0.44, false);
    } else {
      _drawWallSegment(cx - size * 0.50, baseY, size * 1.0, size * 0.26, 5);
      _drawTower(cx - size * 0.36, baseY, size * 0.24, size * 0.48, false);
      _drawTower(cx + size * 0.36, baseY, size * 0.24, size * 0.48, false);
      _drawTower(cx, baseY, size * 0.28, size * 0.66, true);
    }
    _ctx.restore();
  }

  let _canvas        = null;
  let _ctx           = null;
  let _lord          = null;
  let _player        = null;
  let _size          = 0;
  let _offset        = { x: 0, y: 0 };
  let _pendingTile   = null;
  let _selectedTile  = null;
  // 1s interval keeping the tile panel's lord activity countdowns live
  // (overlay + action bar). Self-clears when the panel leaves the DOM.
  let _panelTimer    = null;
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

  // Other players' honor points, fetched lazily as their name shows up in
  // the tile panel (enemy city owner, enemy lord) — cities/lords are
  // always-visible by name+owner now, and the owner's honor rank rides
  // along with that, so this fetches in the background (never blocks the
  // panel's initial render) and re-renders the panel once it resolves.
  // ownerId -> honorPoints (number) | 'pending'.
  const _honorCache = new Map();

  // playerId -> { clanId, tag, name }, fetched once per map render (whole
  // table in one call, unlike honor which is per-owner-lazy) — refreshed
  // alongside presence on the same cadence. An ally is strictly a fellow
  // clan member; used both for the [TAG] badge and to block/hide attacking.
  let _clanByPid = {};

  function _isAlly(ownerId) {
    if (!ownerId || !_player?.clanId) return false;
    return _clanByPid[ownerId]?.clanId === _player.clanId;
  }

  function _clanTagHtml(ownerId) {
    const c = ownerId ? _clanByPid[ownerId] : null;
    return c ? `<span class="mip-owner-clan-tag">[${c.tag}]</span> ` : '';
  }

  async function _fetchClanMap() {
    _clanByPid = await ClanService.getPlayerClanMap();
    _draw();
    if (_selectedTile && !_movingLord) _updatePanel(_selectedTile.x, _selectedTile.y);
  }

  function _ensureOwnerHonor(ownerId, tileXY) {
    if (!ownerId || _honorCache.has(ownerId)) return;
    _honorCache.set(ownerId, 'pending');
    SupabaseService.client
      .from('storage').select('value').eq('key', 'honor_points').eq('player_id', ownerId).maybeSingle()
      .then(({ data }) => {
        _honorCache.set(ownerId, data?.value ?? 0);
        if (tileXY && _selectedTile?.x === tileXY.x && _selectedTile?.y === tileXY.y) {
          _updatePanel(tileXY.x, tileXY.y);
        }
      })
      .catch(() => { _honorCache.delete(ownerId); });
  }

  function _honorInlineHtml(honorPoints) {
    const tier = getHonorTier(honorPoints);
    const n    = honorPoints || 0;
    const sign = n > 0 ? '+' : n < 0 ? '−' : '';
    const cls  = n > 0 ? 'mip-honor--pos' : n < 0 ? 'mip-honor--neg' : 'mip-honor--zero';
    return `${tier ? honorCrestHtml(tier, 'mip-honor-crest') : ''}<span class="mip-honor-value ${cls}">(${sign}${Math.abs(n)})</span>`;
  }

  // Bigger, more prominent "👤 Username (honor)" badge for an enemy city's
  // or enemy lord's owner — used in place of the old small muted coord-style
  // label. Kicks off the honor fetch above the first time this owner is seen.
  function _ownerBadgeHtml(ownerId, ownerUsername, x, y) {
    if (!ownerUsername) return '<span class="mip-owner-badge mip-owner-badge--unknown">Enemy</span>';
    if (ownerId) _ensureOwnerHonor(ownerId, { x, y });
    const cached = ownerId ? _honorCache.get(ownerId) : undefined;
    const honorHtml = (typeof cached === 'number') ? _honorInlineHtml(cached) : '';
    const allyHtml = _isAlly(ownerId) ? '<span class="mip-ally-badge">🤝 Ally</span>' : '';
    return `<span class="mip-owner-badge">👤 ${_clanTagHtml(ownerId)}${ownerUsername}</span> ${allyHtml} ${honorHtml}`;
  }

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
    _fetchClanMap();
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
      // RULER_MARGIN reserves room for the coordinate ruler drawn in _draw()
      // — without it, a grid that fills/overflows the viewport would push
      // offset to 0 and leave no space for the axis numbers.
      _offset.x = Math.max(RULER_MARGIN, Math.floor((area.clientWidth  - gridW) / 2));
      _offset.y = Math.max(RULER_MARGIN, Math.floor((area.clientHeight - gridH) / 2));
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

    // City tier per tile, for the map icon — own cities read their real
    // (always-known) population; enemy cities only know it once scouted to
    // 'precise' (same rule as the tile panel), otherwise default to tier 1
    // rather than leaking info the player hasn't earned.
    const enemyCityTierByKey = {};
    if (_player) {
      IntelligenceService.getByType(_player.id, 'enemy_city').forEach(r => {
        const pop = r.qualityTier === 'precise' ? r.data?.population : null;
        if (pop) enemyCityTierByKey[`${r.tileX},${r.tileY}`] = _cityLevelFromPopulation(pop);
      });
    }

    // Two separate layers: intel (scouted via Search Area, tiered detail)
    // and presence (live, zero-stats, always current — drives the marker
    // even before any scouting has happened, same as cities already work).
    const enemyLordIntel = _player
      ? IntelligenceService.getByType(_player.id, 'enemy_lord')
      : [];
    const intelLordTiles = new Set(enemyLordIntel.map(r => `${r.tileX},${r.tileY}`));
    const allyLordTiles  = new Set(
      enemyLordIntel.filter(r => _isAlly(r.data?.playerId)).map(r => `${r.tileX},${r.tileY}`)
    );
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
        const isSelected   = _selectedTile?.x === x && _selectedTile?.y === y;
        let cityLevel = 1;
        let isAllyCity = false;
        if (rawCityId) {
          if (myCityIds.has(rawCityId)) {
            const ownCity = CityService.getById(rawCityId);
            cityLevel = ownCity ? CityStatsService.getCityLevel(ownCity) : 1;
          } else {
            cityLevel = enemyCityTierByKey[`${x},${y}`] || 1;
            isAllyCity = _isAlly(WorldService.getCityMeta(x, y)?.ownerId);
          }
        }
        _drawTile(px, py, x, y, rawCityId, myCityIds, isSelected, cityLevel, isAllyCity);
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
      const isAllyTile = allyLordTiles.has(key);
      _ctx.strokeStyle = isAllyTile ? 'rgba(70,130,220,0.9)' : 'rgba(200,40,40,0.85)';
      _ctx.lineWidth   = 1.5;
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      _ctx.font         = `${Math.floor(TILE * 0.4)}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillText(isAllyTile ? '🤝' : '👁', px + TILE / 2, py + TILE / 2);
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

    // ── Coordinate ruler — column numbers above the grid, row numbers to
    // its left. Same 0-indexed values used everywhere else tile coords are
    // shown (city/lord "(x, y)" labels), so the ruler and those stay in sync.
    _ctx.font         = '10px sans-serif';
    _ctx.fillStyle    = 'rgba(180,190,210,0.55)';
    _ctx.textBaseline = 'middle';
    _ctx.textAlign    = 'center';
    for (let gx = 0; gx < _size; gx++) {
      const px = _offset.x + gx * STEP + TILE / 2;
      if (px < 0 || px > W) continue;
      _ctx.fillText(String(gx), px, _offset.y - 10);
    }
    _ctx.textAlign = 'right';
    for (let gy = 0; gy < _size; gy++) {
      const py = _offset.y + gy * STEP + TILE / 2;
      if (py < 0 || py > H) continue;
      _ctx.fillText(String(gy), _offset.x - 6, py);
    }
  }

  function _drawTile(px, py, x, y, cityId, myCityIds, isSelected, cityLevel, isAllyCity) {
    // Terrain is always the base layer, city or not — a city no longer
    // paints over it with a solid color, so forest/plains/desert etc. stay
    // visible even on an occupied tile. Selection highlight still takes
    // priority visually (bright blue wash) regardless of what's on the tile.
    _roundRect(px, py, TILE, TILE, 3);
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

    if (cityId) {
      // Ownership is a colored ring overlay (green = own, blue = allied clan,
      // red = enemy) — not a fill — so the terrain drawn above stays
      // visible. The city itself is a hand-drawn vector icon (see
      // _drawCityTierIcon), not a downscaled photo or a default emoji glyph.
      const isOwn = myCityIds.has(cityId);
      const ringColor = isOwn
        ? (isSelected ? '#6ae06a' : '#4a8a4a')
        : isAllyCity
          ? (isSelected ? '#6ab0e0' : '#4a80c0')
          : (isSelected ? '#e06a6a' : '#c05050');

      _drawCityTierIcon(px, py, TILE * 0.66, cityLevel);

      _roundRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3, 3);
      _ctx.strokeStyle = ringColor;
      _ctx.lineWidth   = isSelected ? 2.5 : 2;
      _ctx.stroke();
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
        <div class="mip-empty-sub">Tap the destination tile to see travel time</div>
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
        <div class="mip-section-label">🧭 Move Lord</div>
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
    // Name + owner are always visible map-wide (no scouting required) — see
    // js/domain/world.js's getCityMeta(); only garrison composition/count
    // stays gated behind intelRec below.
    const cityMeta  = (!isOwnCity && cityId) ? WorldService.getCityMeta(x, y) : null;

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
    } else {
      // Enemy city — name + owner are ALWAYS shown (world_state carries
      // them map-wide, no scouting required); garrison composition/count
      // and population/tier stay gated behind actually scouting the tile.
      const idata      = intelRec?.data || null;
      const intelTier  = intelRec?.qualityTier || null;
      const cityName   = cityMeta?.name || idata?.name || 'Enemy City';
      const ownerLabel = cityMeta?.ownerUsername
        ? _ownerBadgeHtml(cityMeta.ownerId, cityMeta.ownerUsername, x, y)
        : (idata?.playerUsername ? _ownerBadgeHtml(null, idata.playerUsername, x, y) : '<span class="mip-owner-badge mip-owner-badge--unknown">Enemy</span>');
      const knownPop   = intelTier === 'precise' && idata?.population ? idata.population : null;
      const cityLevel  = knownPop ? _cityLevelFromPopulation(knownPop) : null;
      const _tierImgs  = ['assets/city/tier1.webp','assets/city/tier1.webp','assets/city/tier2.jpg','assets/city/tier3.jpg','assets/city/tier4.jpg','assets/city/tier4.jpg'];
      const _tierImg   = _tierImgs[Math.min(cityLevel || 1, _tierImgs.length - 1)];
      // vague only ever reveals a bucketed force-size label, never an exact
      // garrison count (same rule as enemy lords) — clear/precise show the
      // real composition once actually scouted that far. Same collapsible
      // "▶ Army (N)" toggle + unit-card grid as an enemy lord's army.
      const garrisonUnits = idata?.garrisonUnits || [];
      const garrisonTotal = garrisonUnits.reduce((s, r) => s + r.count, 0);
      const garrisonToggleId = `mip-army-garrison-${cityId}`;
      // Two pieces: a compact stat-row fallback (fits inside .ov-cc-stats,
      // used when there's nothing to expand) and the collapsible unit-card
      // dropdown (rendered as its own block below .ov-cc-stats, same
      // "▶ Army (N)" pattern as an enemy lord's army — see enemyLordSection).
      let garrisonStatRow    = '';
      let garrisonToggleHtml = '';
      if (garrisonUnits.length > 0) {
        const garrisonCardsInner = garrisonUnits.flatMap(r => {
          const def = UNIT_DEFS[r.unitId] || {};
          const tierClass = def.category === 'mercenary' ? ' la-unit-card--merc'
            : (def.category === 'elite' || def.category === 'cavalry') ? ' la-unit-card--elite'
            : def.category === 'monster' ? ' la-unit-card--monster'
            : def.category === 'legendary' ? ' la-unit-card--legendary' : '';
          const portrait = def.image
            ? `<img src="${def.image}" class="la-uc-img" alt="${def.name || r.unitId}" loading="lazy">`
            : `<div class="la-uc-img la-uc-img--fallback">${def.icon || '⚔'}</div>`;
          return Array.from({ length: r.count }, () => `
            <div class="la-unit-card mip-enemy-ucard${tierClass}" title="${def.name || r.unitId}">
              <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
              ${portrait}
            </div>`);
        }).join('');
        garrisonToggleHtml = `
          <button class="mip-army-toggle mip-army-toggle--enemy" data-target="${garrisonToggleId}">▶ Garrison (${garrisonTotal})</button>
          <div class="mip-army-units mip-army-hidden" id="${garrisonToggleId}">
            <div class="mip-enemy-unit-cards">${garrisonCardsInner}</div>
          </div>`;
      } else if (idata?.forceSize) {
        garrisonStatRow = `<div class="ov-cc-stat"><span class="ov-cc-stat-label">Garrison</span><span class="ov-cc-stat-value">${idata.forceSize}</span></div>`;
      } else {
        garrisonStatRow = `<div class="ov-cc-stat"><span class="ov-cc-stat-label mip-value--muted">Garrison</span><span class="ov-cc-stat-value mip-value--muted">Scout to reveal</span></div>`;
      }
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
        <div class="ov-city-card mip-card-wide mip-enemy-city-card">
          <div class="ov-cc-art">
            <img class="ov-cc-art-img" src="${_tierImg}" alt="${cityName}" loading="lazy" />
            <div class="ov-cc-art-fade"></div>
          </div>
          <div class="ov-cc-inner">
            <div class="ov-cc-name-row">
              <span class="ov-cc-name mip-enemy-city-name">${cityName}</span>
              ${intelTier ? `<span class="mip-intel-badge" style="color:${_TIER_COLORS[intelTier]}">👁 ${_TIER_LABELS[intelTier]}</span>` : ''}
            </div>
            <div class="ov-cc-owner-row">${ownerLabel}</div>
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
              ${garrisonStatRow}
            </div>
            ${garrisonToggleHtml}
          </div>
          ${_isAlly(cityMeta?.ownerId)
            ? '<div class="mip-ally-notice mip-card-wide">🤝 Allied clan — cannot attack</div>'
            : '<button class="mip-city-attack-btn mip-attack-btn mip-card-wide">⚔ Attack City</button>'}
        </div>
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
          const isRaiding   = !lordIsDown && isStanced && stanceObj.id === 'raiding';
          // Raiding gets the full activity overlay (like the homepage card) —
          // the small badge would be redundant next to it.
          const stanceBadge = isStanced && !isRaiding
            ? `<span class="ov-lc-stance-badge">${stanceDef.icon} ${stanceDef.name}</span>`
            : '';
          const raidSecs = isRaiding ? Math.max(0, Math.floor((stanceObj.finishAt - TimeService.now()) / 1000)) : 0;

          const isQuesting = !lordIsDown && queueItem?.actionId === 'search_area';
          const isScouting = !lordIsDown && queueItem?.actionId === 'scout';
          const isMoving   = !lordIsDown && queueItem?.actionId === 'move_lord' && !isAttacking;

          const activityOverlay = !lordIsDown && isAttacking ? `
            <div class="ov-lord-activity-overlay ov-lord-activity-overlay--attack">
              <div class="ov-lord-activity-icon">&#9876;</div>
              <div class="ov-lord-activity-label">Attacking</div>
              <div class="ov-lord-activity-dest">(${queueItem.destX}, ${queueItem.destY})</div>
              <div class="ov-lord-activity-cd" id="map-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
            </div>` :
          isQuesting ? `
            <div class="ov-lord-activity-overlay ov-lord-activity-overlay--quest">
              <div class="ov-lord-activity-icon">&#128506;</div>
              <div class="ov-lord-activity-label">Questing</div>
              <div class="ov-lord-activity-cd" id="map-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
            </div>` :
          isScouting ? `
            <div class="ov-lord-activity-overlay ov-lord-activity-overlay--scout">
              <div class="ov-lord-activity-icon">&#128373;</div>
              <div class="ov-lord-activity-label">Scouting</div>
              <div class="ov-lord-activity-cd" id="map-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
            </div>` :
          isMoving ? `
            <div class="ov-lord-activity-overlay ov-lord-activity-overlay--move">
              <div class="ov-lord-activity-icon">&#128694;</div>
              <div class="ov-lord-activity-label">Marching</div>
              <div class="ov-lord-activity-dest">(${queueItem.destX}, ${queueItem.destY})</div>
              <div class="ov-lord-activity-cd" id="map-act-cd-${lord.id}">${TimeService.formatDuration(actionSecs)}</div>
            </div>` :
          isRaiding ? `
            <div class="ov-lord-activity-overlay ov-lord-activity-overlay--raiding">
              <div class="ov-lord-activity-icon">🏴</div>
              <div class="ov-lord-activity-label">Raiding</div>
              <div class="ov-lord-activity-dest">(${lord.x}, ${lord.y})</div>
              <div class="ov-lord-activity-cd" id="map-act-cd-${lord.id}">${TimeService.formatDuration(raidSecs)}</div>
            </div>` : '';

          const cardModifier = lordIsDown ? ' ov-lord-card--down'
            : isAttacking ? ' ov-lord-card--attacking'
            : isQuesting  ? ' ov-lord-card--questing'
            : isScouting  ? ' ov-lord-card--scouting'
            : isMoving    ? ' ov-lord-card--marching'
            : isRaiding   ? ' ov-lord-card--raiding'
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
          // Dampened per stack (count^0.8) to match battle-engine.js's _stackDamageMult.
          const cp        = Math.round(ownUnits.reduce((sum, u) => {
            const def = UNIT_DEFS[u.unitId];
            if (!def) return sum;
            const s = def.combatStats || {};
            return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * Math.pow(u.count, 0.8);
          }, 0));
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
            <div class="mip-lord-actions">
              <button class="mip-lord-search-btn mip-action-btn-sm" data-lord-id="${lord.id}">🔍 Quest</button>
              <button class="mip-lord-scout-btn mip-action-btn-sm" data-lord-id="${lord.id}" title="Gather intel on this tile's enemy lord and city. Safe without an army; risks an ambush if scouting with one.">🕵 Scout</button>
              <button class="mip-lord-move-btn mip-action-btn-sm" data-lord-id="${lord.id}">🧭 Move</button>
            </div>
          ` : '';

          return `
            <div class="ov-lord-card mip-card-wide${cardModifier}" data-lord-id="${lord.id}" style="cursor:pointer">
              ${lordIsDown && lord.capturedByPlayerId ? `
                <div class="ov-lord-down-overlay">
                  <div class="ov-lord-down-icon">⛓</div>
                  <div class="ov-lord-down-label ov-lord-down-label--captured">CAPTURED</div>
                  <div class="ov-lord-captor">by ${lord.capturedByUsername || 'Unknown'}</div>
                </div>` : lordIsDown ? `
                <div class="ov-lord-down-overlay">
                  <div class="ov-lord-down-icon">${downReason === 'captured' ? '⛓' : '💀'}</div>
                  <div class="ov-lord-down-label ov-lord-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
                  <div class="ov-lord-down-cd">${TimeService.formatDuration(downRemSecs)}</div>
                </div>` : ''}
              ${activityOverlay}
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
                  📍 ${locationLabel} · ${isAttacking ? `⚔ ATTACKING (${queueItem.destX},${queueItem.destY})` : queueItem?.actionId === 'scout' ? '🕵 Scouting' : queueItem?.actionId === 'search_area' ? '🔍 Questing' : activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
                </div>
                ${queueItem ? `<div class="ov-lc-action-row">
                  <div class="ov-lc-action-bar"><div class="ov-lc-action-fill${isAttacking ? ' ov-lc-action-fill--attack' : ''}" id="map-act-fill-${lord.id}" style="width:${actionPct}%"></div></div>
                  <span class="ov-lc-action-time" id="map-act-time-${lord.id}">${TimeService.formatDuration(actionSecs)}</span>
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
                ${actionsHtml}
                <div class="ov-lc-enter">Manage →</div>
              </div>
            </div>
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

      // Dampened per stack (count^0.8) to match battle-engine.js's _stackDamageMult.
      const cp = Math.round(defenders.reduce((sum, u) => {
        const ud = UNIT_DEFS[u.unitId];
        if (!ud) return sum;
        const s = ud.combatStats || {};
        return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * Math.pow(u.count, 0.8);
      }, 0));

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
        // Dampened per stack (count^0.8) to match battle-engine.js's _stackDamageMult.
        const cp    = Math.round(units.reduce((sum, u) => {
          const def = UNIT_DEFS[u.unitId];
          if (!def) return sum;
          const s = def.combatStats || {};
          return sum + ((s.attack||0)*3 + (s.defense||0)*2 + Math.floor((s.hp||0)/10) + (s.speed||0)) * Math.pow(u.count, 0.8);
        }, 0));
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
        // available at any intel tier, including vague. Except against a
        // fellow clan member, which is unattackable outright (server-
        // enforced in combat-resolver.js) — show a notice instead.
        const isAllyLord = _isAlly(data.playerId);
        const attackBtn = isAllyLord
          ? '<div class="mip-ally-notice mip-card-wide">🤝 Allied clan — cannot attack</div>'
          : myLordsIdle.length > 0
            ? `<button class="mip-attack-btn mip-card-wide" data-lord-record-idx="${idx}">⚔ Attack</button>`
            : `<p class="mip-note mip-note--warn">No lord available to attack</p>`;

        return `
          <div class="mip-enemy-lord-card mip-card-wide">
            <div class="ov-lc-portrait${portraitSrc ? '' : ' ov-lc-portrait--icon'}">
              ${portraitInner}
              <div class="ov-lc-portrait-fade"></div>
              ${data.lordLevel ? `<div class="ov-lc-portrait-level">Lv ${data.lordLevel}</div>` : ''}
              ${data.playerUsername ? `<div class="ov-lc-portrait-owner">👤 ${_clanTagHtml(data.playerId)}${data.playerUsername}</div>` : ''}
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
      if (_panelTimer) { clearInterval(_panelTimer); _panelTimer = null; }
      panel.innerHTML = _movePanelHtml(x, y);
      _bindMoveConfirmEvents();
      return;
    }

    panel.innerHTML = _tilePanelHtml(x, y);
    _bindTilePanelEvents(x, y);
    _startPanelTicker(x, y);
  }

  // Keeps the tile panel's lord activity countdowns ticking (the panel itself
  // is rendered once per tile select). Mirrors the overview ticker: consume
  // completed actions client-side and re-render — the server dispatcher
  // resolves outcomes, picked up on the next /api/sync poll.
  function _startPanelTicker(x, y) {
    if (_panelTimer) { clearInterval(_panelTimer); _panelTimer = null; }
    if (!document.querySelector('[id^="map-act-cd-"]')) return;

    _panelTimer = setInterval(() => {
      const panel = document.getElementById('map-info-panel');
      if (!panel || !document.body.contains(panel)) {
        clearInterval(_panelTimer);
        _panelTimer = null;
        return;
      }

      let needsRerender = false;
      LordService.getByPlayer(_player.id).forEach(lord => {
        const cd = document.getElementById(`map-act-cd-${lord.id}`);
        if (!cd) return;

        let secs = 0, pct = 0;
        if (lord.actionQueue.length > 0) {
          if (LordService.tickActions(lord).length > 0) { needsRerender = true; return; }
          secs = LordService.actionTimeRemaining(lord);
          pct  = Math.floor(LordService.actionProgress(lord) * 100);
        } else if (LordService.isStanced(lord) && lord.stance.id === 'raiding') {
          secs = Math.max(0, Math.floor((lord.stance.finishAt - TimeService.now()) / 1000));
          const totalMs = lord.stance.finishAt - lord.stance.startedAt;
          pct  = totalMs > 0 ? Math.min(100, Math.floor(((TimeService.now() - lord.stance.startedAt) / totalMs) * 100)) : 0;
          if (secs <= 0) { needsRerender = true; return; }
        } else {
          // Action/stance ended elsewhere (e.g. sync) — refresh the card
          needsRerender = true;
          return;
        }

        cd.textContent = TimeService.formatDuration(secs);
        const fill = document.getElementById(`map-act-fill-${lord.id}`);
        const time = document.getElementById(`map-act-time-${lord.id}`);
        if (fill) fill.style.width = `${pct}%`;
        if (time) time.textContent = TimeService.formatDuration(secs);
      });

      if (needsRerender) _updatePanel(x, y);
    }, 1000);
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
      btn.addEventListener('click', async e => {
        e.stopPropagation();
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
      btn.addEventListener('click', async e => {
        e.stopPropagation();
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
          openTab: 'discovery',
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
      btn.addEventListener('click', e => {
        e.stopPropagation();
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
