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

  // "3m ago" for the freshness line on a scouted tile. The Activity feed holds
  // the report itself; the map only says how stale it is.
  function _agoLabel(at) {
    const mins = Math.floor((TimeService.now() - (at || 0)) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // City tier (1-5) → map icon, drawn as flat vector silhouettes directly
  // on the canvas — no image loading/caching, always pixel-crisp regardless
  // of tile size, same warm-gold-on-dark-outline language as the honor-tier
  // crests elsewhere in the UI. Escalating building complexity per tier
  // (hut → houses → walled town w/ towers → castle w/ keep + banner)
  // instead of a downscaled photo or a default emoji glyph.
  const _CITY_ICON_FILL   = '#e8c878';
  const _CITY_ICON_STROKE = '#2a1a08';

  // City tier (index = level 0-5) → the same overview-card art, reused on
  // the canvas tiles and the side panel so every surface shows one image.
  const _CITY_TIER_IMGS = ['assets/city/tier1.webp','assets/city/tier1.webp','assets/city/tier2.jpg','assets/city/tier3.jpg','assets/city/tier4.jpg','assets/city/tier4.jpg'];

  // Canvas image cache — drawImage needs a loaded HTMLImageElement, so each
  // src loads once and triggers one redraw when ready. Returns null until
  // the image is usable; callers fall back to the vector/glyph icon.
  const _imgCache = new Map();
  function _getImg(src) {
    if (!src) return null;
    let img = _imgCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => _draw();
      img.src = src;
      _imgCache.set(src, img);
    }
    return (img.complete && img.naturalWidth > 0) ? img : null;
  }

  // City tier (1-5) → icon name from the game-icons sprite, escalating like
  // the old hand-drawn silhouettes did (hut → village → walled town → castle).
  function _cityIconName(level) {
    return level <= 1 ? 'house' : level === 2 ? 'village' : level === 3 ? 'guarded-tower' : 'castle';
  }

  // Rasterize a sprite symbol (js/core/icons.js) into a tinted Image the
  // canvas can drawImage() — gi() markup itself only works in HTML. Cached
  // per name+color; same load-once-redraw-once contract as _getImg.
  function _giImg(name, color) {
    const key = `gi:${name}:${color}`;
    let img = _imgCache.get(key);
    if (!img) {
      const sym = document.getElementById(`gi-${name}`);
      if (!sym) return null;
      const vb  = sym.getAttribute('viewBox') || '0 0 512 512';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="${color}">${sym.innerHTML}</svg>`;
      img = new Image();
      img.onload = () => _draw();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      _imgCache.set(key, img);
    }
    return (img.complete && img.naturalWidth > 0) ? img : null;
  }

  // object-fit: cover, for drawImage
  function _drawImageCover(img, dx, dy, dw, dh) {
    const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
    const sw = dw / scale;
    const sh = dh / scale;
    _ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, dx, dy, dw, dh);
  }

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
  let _w             = 0;
  let _h             = 0;
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
  // Live existence layer for enemy lords (army > 0 only) from
  // /api/scan/presence — the ONLY thing the map knows about enemy lords.
  // It carries who owns them (public: cities show their owner too, and the
  // Clan screen lists every roster) but never how strong they are; on the map
  // every enemy lord is an "Unknown force" until a scout reports on the tile.
  // Cities have an equivalent always-visible layer via the global world_state
  // table (WorldService.getOccupiedTiles()).
  //   _presence      — Set of "x,y" strings, drives the marker
  //   _presenceOwner — "x,y" → { playerId, username }, drives ally/war colour
  let _presence       = new Set();
  let _presenceOwner  = new Map();

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

  // At war = my clan has an ACTIVE clan war against this owner's clan.
  // Clanless players (either side) are never "at war" — they render as
  // neutral grey on the map and white in the tile panel.
  function _isAtWar(ownerId) {
    if (!ownerId || !_player?.clanId) return false;
    return ClanService.isAtWar(_player.clanId, _clanByPid[ownerId]?.clanId);
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
    const allyHtml = _isAlly(ownerId) ? '<span class="mip-ally-badge">' + gi('shaking-hands') + ' Ally</span>' : '';
    const warCls   = _isAtWar(ownerId) ? ' mip-owner-badge--war' : '';
    return `<span class="mip-owner-badge${warCls}">${gi('person')} ${_clanTagHtml(ownerId)}${ownerUsername}</span> ${allyHtml} ${honorHtml}`;
  }

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord, mode }) {
    _player       = player;
    _lord         = lord;
    _w            = WorldService.getWidth();
    _h            = WorldService.getHeight();
    _selectedTile = null;
    _moveTarget   = null;
    _movingLord   = mode === 'move-lord' ? lord : null;
    _keyCursor    = { x: lord?.x ?? Math.floor(_w / 2), y: lord?.y ?? Math.floor(_h / 2) };

    root.innerHTML = `
      <div class="map-screen">

        <div class="map-move-bar${_movingLord ? '' : ' hidden'}" id="map-move-bar">
          <span class="map-move-msg" id="map-move-msg">${_movingLord ? `${gi('position-marker')} Select a destination for <b>${_movingLord.name}</b>` : ''}</span>
          <button class="map-cancel-move-btn" id="map-cancel-move">✕ Cancel</button>
        </div>

        <div class="map-body">
          <aside class="map-side-panel" id="map-side-panel" aria-label="Your cities and lords">
            ${_sidePanelHtml()}
          </aside>
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
                <button class="btn-dice" id="city-name-modal-dice" type="button" title="Random city name">${gi('perspective-dice-six-faces-random')}</button>
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
      const gridW = _w * STEP;
      const gridH = _h * STEP;
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

    // Enemy city size is NOT public — population only ever appears in a scout
    // report, so every enemy city draws at the default tier. Own cities read
    // their real population below.
    const enemyCityTierByKey = {};

    // One layer only: presence. It says a lord is there and who owns it —
    // enough to colour allies green and at-war clans red — and nothing about
    // strength. Composition comes from a scout report in the Activity feed.
    const allyLordTiles = new Set();
    const warLordTiles  = new Set();
    _presenceOwner.forEach((owner, key) => {
      if (_isAlly(owner.playerId))       allyLordTiles.add(key);
      else if (_isAtWar(owner.playerId)) warLordTiles.add(key);
    });
    const presenceOnlyTiles = new Set(
      [..._presence].filter(k => !allyLordTiles.has(k) && !warLordTiles.has(k))
    );

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
    for (let y = 0; y < _h; y++) {
      for (let x = 0; x < _w; x++) {
        const px = _offset.x + x * STEP;
        const py = _offset.y + y * STEP;
        if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) continue;
        const rawCityId    = cityMap[`${x},${y}`] || null;
        const isSelected   = _selectedTile?.x === x && _selectedTile?.y === y;
        let cityLevel = 1;
        let isAllyCity = false;
        let isWarCity  = false;
        if (rawCityId) {
          if (myCityIds.has(rawCityId)) {
            const ownCity = CityService.getById(rawCityId);
            cityLevel = ownCity ? CityStatsService.getCityLevel(ownCity) : 1;
          } else {
            cityLevel = enemyCityTierByKey[`${x},${y}`] || 1;
            const ownerId = WorldService.getCityMeta(x, y)?.ownerId;
            isAllyCity = _isAlly(ownerId);
            isWarCity  = !isAllyCity && _isAtWar(ownerId);
          }
        }
        _drawTile(px, py, x, y, rawCityId, myCityIds, isSelected, cityLevel, isAllyCity, isWarCity);
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

    // ── Enemy lords — one marker, coloured by relationship ──────────
    // Every enemy lord draws the same "unknown force" marker regardless of
    // whether you've scouted the tile: the map never reveals strength. Only
    // the border colour varies, from the always-public owner identity that
    // /api/scan/presence returns (ally / at-war / neutral).
    const _drawLordMarker = (key, stroke, glyph, dashed) => {
      if (cityMap[key]) return; // city tiles handled by city rendering
      const [ex, ey] = key.split(',').map(Number);
      const px = _offset.x + ex * STEP;
      const py = _offset.y + ey * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      _ctx.strokeStyle = stroke;
      _ctx.lineWidth   = dashed ? 1 : 1.5;
      if (dashed) _ctx.setLineDash([2, 2]);
      _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 2);
      _ctx.stroke();
      if (dashed) _ctx.setLineDash([]);
      _ctx.font         = `${Math.floor(TILE * (dashed ? 0.32 : 0.4))}px serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.fillStyle    = 'rgba(180,180,190,0.85)';
      _ctx.fillText(glyph, px + TILE / 2, py + TILE / 2);
    };

    allyLordTiles.forEach(key => _drawLordMarker(key, 'rgba(70,130,220,0.9)',  '🤝', false));
    warLordTiles.forEach(key  => _drawLordMarker(key, 'rgba(200,40,40,0.85)', '⚑',  false));
    presenceOnlyTiles.forEach(key => _drawLordMarker(key, 'rgba(140,140,150,0.55)', '❔', true));

    // ── Lords — draw on ALL tiles, including city tiles ───────
    myLords.forEach(lord => {
      const px     = _offset.x + lord.x * STEP;
      const py     = _offset.y + lord.y * STEP;
      if (px + TILE < 0 || px > W || py + TILE < 0 || py > H) return;
      const race    = RACES[lord.race];
      const isCurr  = _lord && lord.id === _lord.id;
      const isMovingThis = _movingLord && lord.id === _movingLord.id;
      const onCity  = !!cityMap[`${lord.x},${lord.y}`];

      const portraitImg = _getImg(lord.portrait || pickLordPortrait(lord.race, lord.classId, lord.id) || race?.portrait);

      if (onCity) {
        // Portrait badge in top-right corner of the city tile
        const bx = px + TILE - 10;
        const by = py + 10;
        const br = isCurr ? 10 : 8;
        _ctx.beginPath();
        _ctx.arc(bx, by, br, 0, Math.PI * 2);
        _ctx.fillStyle = isCurr
          ? (isMovingThis ? '#ddb830' : '#c8933a')
          : '#2a7a2a';
        _ctx.fill();
        if (portraitImg) {
          _ctx.save();
          _ctx.beginPath();
          _ctx.arc(bx, by, br, 0, Math.PI * 2);
          _ctx.clip();
          _drawImageCover(portraitImg, bx - br, by - br, br * 2, br * 2);
          _ctx.restore();
        }
        _ctx.beginPath();
        _ctx.arc(bx, by, br, 0, Math.PI * 2);
        _ctx.strokeStyle = isCurr ? '#fff8e0' : '#88dd88';
        _ctx.lineWidth   = isCurr ? 2 : 1.5;
        _ctx.stroke();
        if (!portraitImg && race) {
          _ctx.font         = `${isCurr ? 10 : 8}px serif`;
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.glyph, bx, by);
        }
      } else {
        // Portrait tile with bright border for lords on open terrain
        const fillColor   = isCurr ? 'rgba(40,30,8,0.92)' : 'rgba(8,28,8,0.88)';
        const borderColor = isCurr
          ? (isMovingThis ? 'rgba(255,220,60,1)' : 'rgba(220,160,50,1)')
          : 'rgba(80,200,80,0.9)';
        _roundRect(px, py, TILE, TILE, 3);
        _ctx.fillStyle = fillColor;
        _ctx.fill();
        if (portraitImg) {
          _ctx.save();
          _roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 3);
          _ctx.clip();
          _drawImageCover(portraitImg, px + 1, py + 1, TILE - 2, TILE - 2);
          _ctx.restore();
        } else if (race) {
          _ctx.font         = `${Math.floor(TILE * 0.52)}px serif`;
          _ctx.textAlign    = 'center';
          _ctx.textBaseline = 'middle';
          _ctx.fillText(race.glyph, px + TILE / 2, py + TILE / 2 - 1);
        }
        _roundRect(px, py, TILE, TILE, 3);
        _ctx.strokeStyle = borderColor;
        _ctx.lineWidth   = isCurr ? 2.5 : 2;
        _ctx.stroke();
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
    for (let gx = 0; gx < _w; gx++) {
      const px = _offset.x + gx * STEP + TILE / 2;
      if (px < 0 || px > W) continue;
      _ctx.fillText(String(gx), px, _offset.y - 10);
    }
    _ctx.textAlign = 'right';
    for (let gy = 0; gy < _h; gy++) {
      const py = _offset.y + gy * STEP + TILE / 2;
      if (py < 0 || py > H) continue;
      _ctx.fillText(String(gy), _offset.x - 6, py);
    }
  }

  function _drawTile(px, py, x, y, cityId, myCityIds, isSelected, cityLevel, isAllyCity, isWarCity) {
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
      // Ownership is a colored ring overlay (green = own, blue = allied
      // clan, red = at war with that clan, grey = everyone else/neutral) —
      // not a fill — so the terrain drawn above stays visible. The city
      // itself is a tier-scaled icon from the game-icons sprite (see
      // _cityIconName), not a downscaled photo or a default emoji glyph.
      const isOwn = myCityIds.has(cityId);
      const ringColor = isOwn
        ? (isSelected ? '#6ae06a' : '#4a8a4a')
        : isAllyCity
          ? (isSelected ? '#6ab0e0' : '#4a80c0')
          : isWarCity
            ? (isSelected ? '#e06a6a' : '#c05050')
            : (isSelected ? '#b8bcc6' : '#82868f');

      const iconImg  = _giImg(_cityIconName(cityLevel), _CITY_ICON_FILL);
      const iconSize = TILE * 0.62;
      if (iconImg) {
        _ctx.drawImage(iconImg, px + (TILE - iconSize) / 2, py + (TILE - iconSize) / 2, iconSize, iconSize);
      } else {
        _drawCityTierIcon(px, py, TILE * 0.66, cityLevel);
      }

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

  // ── Left side panel (cities + lords quick list) ───────────────
  // Clicking a row selects that tile on the map — same path as a canvas
  // click, so the tile highlight + right info panel both react.

  function _sidePanelHtml() {
    const cities = _player ? CityService.getPlayerCities(_player.id) : [];
    const lords  = _player ? LordService.getByPlayer(_player.id).filter(l => l.x != null) : [];

    const cityRows = cities.map(c => {
      const lvl = CityStatsService.getCityLevel(c);
      const img = _CITY_TIER_IMGS[Math.min(lvl, _CITY_TIER_IMGS.length - 1)];
      return `
      <button class="msp-row" data-x="${c.x}" data-y="${c.y}" title="Show ${c.name} on the map">
        <img class="msp-row-img" src="${img}" alt="" loading="lazy" />
        <span class="msp-row-body">
          <span class="msp-row-name">${c.name}</span>
          <span class="msp-row-sub">Pop ${Math.floor(c.population).toLocaleString()}</span>
        </span>
        <span class="msp-row-coords">(${c.x}, ${c.y})</span>
      </button>`;
    }).join('');

    const lordRows = lords.map(l => {
      const race = RACES[l.race] || {};
      const cls  = LORD_CLASSES[l.classId];
      const q    = l.actionQueue && l.actionQueue[0];
      const sub  = (q?.actionId === 'move_lord' && q.destX != null)
        ? `${q.intent === 'attack' ? gi('crossed-swords') : gi('compass')} → (${q.destX}, ${q.destY})`
        : `Lv ${l.level || 1}${cls ? ` · ${cls.name}` : ''}`;
      const psrc = l.portrait || pickLordPortrait(l.race, l.classId, l.id) || race.portrait;
      return `
      <button class="msp-row" data-x="${l.x}" data-y="${l.y}" title="Show ${l.name} on the map">
        ${psrc
          ? `<img class="msp-row-img msp-row-img--lord" src="${psrc}" alt="" loading="lazy" />`
          : `<span class="msp-row-icon">${race.icon || gi('person')}</span>`}
        <span class="msp-row-body">
          <span class="msp-row-name">${l.name}</span>
          <span class="msp-row-sub">${sub}</span>
        </span>
        <span class="msp-row-coords">(${l.x}, ${l.y})</span>
      </button>`;
    }).join('');

    return `
      <div class="msp-section">
        <div class="msp-section-label">${gi('village')} Cities <span class="msp-count">${cities.length}</span></div>
        ${cityRows || '<div class="msp-empty">No cities yet</div>'}
      </div>
      <div class="msp-section">
        <div class="msp-section-label">${gi('person')} Lords <span class="msp-count">${lords.length}</span></div>
        ${lordRows || '<div class="msp-empty">No lords on the map</div>'}
      </div>`;
  }

  function _updateSideActive(x, y) {
    document.querySelectorAll('#map-side-panel .msp-row').forEach(r => {
      r.classList.toggle('msp-row--active', Number(r.dataset.x) === x && Number(r.dataset.y) === y);
    });
  }

  // ── Info panel HTML builders ──────────────────────────────────

  function _emptyPanelHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">${gi('treasure-map')}</div>
        <div class="mip-empty-text">Tap any tile</div>
      </div>
    `;
  }

  function _selectDestHtml() {
    return `
      <div class="mip-empty">
        <div class="mip-empty-icon">${gi('position-marker')}</div>
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
    // Cartography's travel_speed (2026-08-03) — without it this preview quotes
    // the un-researched march and the server then queues a shorter one.
    const secs        = EconomyCore.getTravelTime(dist, speed, {
      researchEffects: EconomyCore.getResearchEffects(PlayerService.getById(lord.playerId)?.research),
    });

    return `
      <div class="mip-section">
        <div class="mip-section-label">${gi('compass')} Move Lord</div>
        <div class="mip-tile-header">
          <div class="mip-tile-icon">${race.icon || gi('person')}</div>
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
          <span class="mip-value mip-value--gold">${gi('stopwatch')} ${TimeService.formatDuration(secs)}</span>
        </div>
        <div class="mip-stat-row">
          <span class="mip-label">Arrives</span>
          <span class="mip-value mip-value--gold">${gi('hourglass')} ${TimeService.endsAtClock(secs)}</span>
        </div>
        ${(() => {
          // March food cost — mirrors the server's EconomyCore.getMarchFoodCost
          // check in lord-action.js (same shared formula, incl. Cartography).
          const foodCost = EconomyCore.getMarchFoodCost(dist, ArmyService.get(lord.id).units,
            EconomyCore.getResearchEffects(PlayerService.getById(_player.id)?.research));
          if (foodCost <= 0) return '';
          const have  = Math.floor(PlayerService.getById(_player.id)?.resources?.food || 0);
          const short = have < foodCost;
          return `
            <div class="mip-stat-row">
              <span class="mip-label">Food</span>
              <span class="mip-value ${short ? 'mip-value--danger' : ''}">🌾 ${foodCost.toLocaleString()}${short ? ` (have ${have.toLocaleString()})` : ''}</span>
            </div>`;
        })()}
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
    // Name + owner are always visible map-wide, no scouting required — see
    // js/domain/world.js's getCityMeta(). Everything else about an enemy city
    // (population, garrison, what it's worth) exists only inside a scout
    // report in the Activity feed, never on the map.
    const cityMeta  = (!isOwnCity && cityId) ? WorldService.getCityMeta(x, y) : null;

    const lordsHere = _player
      ? LordService.getByPlayer(_player.id).filter(l => l.x === x && l.y === y)
      : [];

    // Bandit camps are retired — a combat expedition find is fought on the
    // spot as an ambush (server/tick/catch-up.js), so nothing writes a camp
    // record any more and the map has none to draw. Kept as an empty array
    // rather than deleted outright because the city section below still uses
    // it to decide whether a tile is free to settle. Once a database reset has
    // cleared the last legacy records this can go entirely.
    const banditsHere = [];

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
        // Was a hardcoded `const MAX_CITIES = 5` — a THIRD copy of a constant
        // the server had at 7, so this button vanished two cities early and
        // told the player nothing. Now the one shared formula, which reads the
        // Frontier Charters research (2026-08-03).
        const citySlots = CityService.getCitySlots(_player.id);
        const cost      = CityService.getFoundCost(playerCities.length);
        const coins     = freshPlayer?.coins ?? 0;
        const canAfford = cost === 0 || coins >= cost;
        // Hidden entirely when unaffordable — no disabled teaser.
        if (playerCities.length < citySlots && canAfford) {
          const costLabel = cost === 0 ? 'Free' : `${gi('two-coins')} ${cost.toLocaleString()}`;
          foundBtnHtml = `
            <button class="btn-primary mip-found-city-btn"
                    id="mip-found-btn"
                    style="width:100%;margin-top:0.75rem">
              ${gi('village')} Found City Here${cost > 0 ? ` — ${costLabel}` : ''}
            </button>`;
        }
      }
      citySection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-stat-row">
            <span class="mip-label">Status</span>
            <span class="mip-value mip-value--muted">${isBandit ? gi('crossed-swords') + ' Bandit Camp' : 'Unoccupied'}</span>
          </div>
          ${foundBtnHtml}
        </div>
      `;
    } else if (isOwnCity) {
      // Own city — exact same card as homepage
      const _level     = CityStatsService.getCityLevel(rawCity);
      const _tierImg   = _CITY_TIER_IMGS[Math.min(_level, _CITY_TIER_IMGS.length - 1)];
      const _stats     = CityStatsService.getStats(rawCity);
      const _slots     = CityStatsService.getSlotInfo(rawCity);
      const _goldRate  = ProductionService.getGoldRate(rawCity);
      const _rates     = ProductionService.getRates(rawCity);
      // getGrowthReport, not getCityStatus — this panel used to label a starving
      // city "Stable" with no hint that it was shrinking (see city-stats.js).
      const _report    = CityStatsService.getGrowthReport(rawCity, _stats, _rates);
      const _growth    = _report.growth;
      const _buildItem = rawCity.constructionQueue.length > 0 ? rawCity.constructionQueue[0] : null;
      const _buildDef  = _buildItem ? BUILDING_DEFS[_buildItem.buildingId] : null;
      const _buildPct  = _buildItem ? Math.floor(ConstructionService.progress(rawCity) * 100) : 0;
      const _buildSecs = _buildItem ? ConstructionService.timeRemaining(rawCity) : 0;
      const _growCls   = _growth > 0 ? 'ov-cc-grow--up' : 'ov-cc-grow--down';
      const _growLbl   = ` ${_growth > 0 ? '+' : ''}${_growth}/hr`;
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
              <span class="cvl-status-badge cvl-${_report.badgeId}" title="${_report.title}">${_report.badgeLabel}</span>
            </div>
            <div class="ov-cc-coords">(${rawCity.x}, ${rawCity.y})</div>
            <div class="ov-cc-divider"></div>
            <div class="ov-cc-stats">
              <div class="ov-cc-stat">
                <span class="ov-cc-stat-label">Population</span>
                <span class="ov-cc-stat-value">${Math.floor(rawCity.population).toLocaleString()} <span class="ov-cc-grow ${_growCls}" title="${_report.title}">${_report.sign}${_growLbl}</span></span>
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
                <span class="ov-cc-stat-value ov-cc-gold-rate">+${_goldRate}${gi('two-coins')}</span>
              </div>
            </div>
            ${_buildItem ? `<div class="ov-cc-construction">
              <div class="ov-cc-constr-label">
                <span>${gi('claw-hammer')} ${_buildDef?.name || _buildItem.buildingId} → Lv ${_buildItem.targetLevel}</span>
                <span class="ov-cc-constr-time">${TimeService.formatDuration(_buildSecs)}</span>
              </div>
              <div class="ov-cc-constr-bar"><div class="ov-cc-constr-fill" style="width:${_buildPct}%"></div></div>
            </div>` : ''}
          </div>
        </div>
        </div>
      `;
    } else {
      // Enemy city — name + owner and nothing else. Both come from
      // world_state, which is public map-wide. Population, tier and garrison
      // are never shown here at any point: they live in a scout report.
      const cityName   = cityMeta?.name || 'Enemy City';
      const ownerLabel = cityMeta?.ownerUsername
        ? _ownerBadgeHtml(cityMeta.ownerId, cityMeta.ownerUsername, x, y)
        : '<span class="mip-owner-badge mip-owner-badge--unknown">Enemy</span>';
      const _tierImg   = _CITY_TIER_IMGS[1];
      // If this tile has been scouted, the report is still sitting in the
      // Activity feed — surface how fresh it is and let the player jump to it,
      // rather than re-printing the intel in a second place.
      const scouted    = _player ? ActivityService.latestScoutReport(_player.id, x, y) : null;
      const scoutedRow = scouted
        ? `<div class="mip-scouted-row">${gi('spy')} Scouted ${_agoLabel(scouted.at)} — see Activity</div>`
        : `<div class="mip-scouted-row mip-scouted-row--none">${gi('spy')} Not scouted — send a lord to scout this tile</div>`;
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
            </div>
            <div class="ov-cc-owner-row">${ownerLabel}</div>
            <div class="ov-cc-divider"></div>
            ${scoutedRow}
          </div>
          ${_isAlly(cityMeta?.ownerId)
            ? '<div class="mip-ally-notice mip-card-wide">' + gi('shaking-hands') + ' Allied clan — cannot attack</div>'
            : '<button class="mip-city-attack-btn mip-attack-btn mip-card-wide">' + gi('crossed-swords') + ' Attack City</button>'}
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
              <div class="ov-lord-activity-icon">${gi('black-flag')}</div>
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

          const portraitSrc  = lord.portrait || pickLordPortrait(lord.race, lord.classId, lord.id) || race.portrait;
          const ownerBadge   = `<div class="ov-lc-portrait-owner">${gi('person')} ${_player?.username || 'You'}</div>`;
          const portraitHtml = portraitSrc
            ? `<div class="ov-lc-portrait">
                 <img class="ov-lc-portrait-img" src="${portraitSrc}" alt="${lord.name}" loading="lazy" />
                 <div class="ov-lc-portrait-fade"></div>
                 <div class="ov-lc-portrait-level" title="Level ${lord.level || 1}">${lord.level || 1}</div>
                 ${ownerBadge}
               </div>`
            : `<div class="ov-lc-portrait ov-lc-portrait--icon">
                 <span>${race.icon || gi('person')}</span>
                 <div class="ov-lc-portrait-level" title="Level ${lord.level || 1}">${lord.level || 1}</div>
                 ${ownerBadge}
               </div>`;

          let locationLabel = 'Wandering';
          const allCities = StorageService.get('cities') || {};
          const cityHere  = Object.values(allCities).find(c => c.playerId === _player?.id && c.x === lord.x && c.y === lord.y);
          locationLabel   = cityHere ? cityHere.name : lord.x != null ? `(${lord.x}, ${lord.y})` : 'Wandering';

          // CP + army units
          const army      = ArmyService.get(lord.id);
          const ownUnits  = army?.units || [];
          // Same PWR score as the recruit cap (EconomyCore.getArmyPower).
          const cp        = Math.round(EconomyCore.getArmyPower(ownUnits, UNIT_DEFS));
          const armyUnitCards = ownUnits.length > 0
            ? ownUnits.flatMap(u => {
                const def = UNIT_DEFS[u.unitId] || {};
                const tierClass = unitTierClass(def);
                const portrait = def.image
                  ? `<img src="${def.image}" class="la-uc-img" alt="${def.name||u.unitId}" loading="lazy">`
                  : `<div class="la-uc-img la-uc-img--fallback">${def.icon||gi('crossed-swords')}</div>`;
                return Array.from({ length: u.count }, () => `
                  <div class="la-unit-card mip-enemy-ucard${tierClass ? ' ' + tierClass : ''}" title="${def.name||u.unitId}">
                    <div class="la-uc-top"><div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%"></div></div></div>
                    ${portrait}
                    ${giUnitType(def.category)}
                  </div>`);
              }).join('')
            : '<span class="mip-note">No units</span>';
          const armyToggleId = `mip-army-own-${lord.id}`;

          const actionsHtml = !busy ? `
            <div class="mip-lord-actions">
              <button class="mip-lord-search-btn mip-action-btn-sm" data-lord-id="${lord.id}">${gi('magnifying-glass')} Quest</button>
              <button class="mip-lord-scout-btn mip-action-btn-sm" data-lord-id="${lord.id}" title="Gather intel on this tile's enemy lord and city.">${gi('spy')} Scout</button>
              <button class="mip-lord-move-btn mip-action-btn-sm" data-lord-id="${lord.id}">${gi('compass')} Move</button>
            </div>
          ` : '';

          return `
            <div class="ov-lord-card mip-card-wide${cardModifier}" data-lord-id="${lord.id}" style="cursor:pointer">
              ${lordIsDown && lord.capturedByPlayerId ? `
                <div class="ov-lord-down-overlay">
                  <div class="ov-lord-down-icon">${gi('manacles')}</div>
                  <div class="ov-lord-down-label ov-lord-down-label--captured">CAPTURED</div>
                  <div class="ov-lord-captor">by ${lord.capturedByUsername || 'Unknown'}</div>
                </div>` : lordIsDown ? `
                <div class="ov-lord-down-overlay">
                  <div class="ov-lord-down-icon">${downReason === 'captured' ? gi('manacles') : gi('death-skull')}</div>
                  <div class="ov-lord-down-label ov-lord-down-label--${downReason}">${downReason === 'captured' ? 'CAPTURED' : 'FALLEN'}</div>
                  <div class="ov-lord-down-cd">${TimeService.formatDuration(downRemSecs)}</div>
                </div>` : ''}
              ${activityOverlay}
              ${portraitHtml}
              <div class="ov-lc-body">
                <div class="ov-lc-top">
                  <span class="ov-lc-name">${lord.name}</span>
                  ${cp > 0 ? `<span class="mip-lc-cp">${gi('crossed-swords')} ${cp}</span>` : ''}
                </div>
                <div class="ov-lc-badges">
                  <span class="ov-lc-race">${race.name || ''}</span>
                  ${cls ? `<span class="ov-lc-class-badge" style="color:${cls.color}">${cls.icon} ${cls.name}</span>` : ''}
                  ${stanceBadge}
                </div>
                <div class="ov-lc-meta${isAttacking ? ' ov-lc-meta--attack' : ''}">
                  ${gi('position-marker')} ${locationLabel} · ${isAttacking ? `${gi('crossed-swords')} ATTACKING (${queueItem.destX},${queueItem.destY})` : queueItem?.actionId === 'scout' ? gi('spy') + ' Scouting' : queueItem?.actionId === 'search_area' ? gi('magnifying-glass') + ' Questing' : activeAction ? `${activeAction.icon} ${activeAction.name}` : 'Idle'}
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
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : '';

    // 4 — Bandit camps: removed 2026-07-29. This section rendered a card per
    // discovered camp with its defender roster, expiry and an Attack button.
    // Combat finds are ambushes now — fought where they happen, never parked
    // on the map — so there is nothing to render and nothing to attack.
    const banditsSection = '';

    // 5 — Enemy lords. One layer, one card: presence says a lord is here and
    // who owns it, and that is deliberately all the map will ever tell you.
    // Name, level, class and army composition come from a scout report in the
    // Activity feed — never from here, at any point, for anyone.
    const tileKey         = `${x},${y}`;
    const hasLordPresence = _presence.has(tileKey);
    const presenceOwner   = _presenceOwner.get(tileKey) || null;

    let enemyLordSection = '';
    if (hasLordPresence) {
      const isAllyLord = _isAlly(presenceOwner?.playerId);
      const ownerRow   = presenceOwner?.username
        ? `<div class="ov-lc-portrait-owner">${gi('person')} ${_clanTagHtml(presenceOwner.playerId)}${presenceOwner.username}</div>`
        : '';
      const scouted    = _player ? ActivityService.latestScoutReport(_player.id, x, y) : null;
      const scoutNote  = scouted && (scouted.lords || []).length
        ? `<div class="mip-note">${gi('spy')} Scouted ${_agoLabel(scouted.at)} — full report in Activity</div>`
        : `<div class="mip-note mip-note--muted">Scout this tile to see their army</div>`;

      const attackBtn = isAllyLord
        ? '<div class="mip-ally-notice mip-card-wide">' + gi('shaking-hands') + ' Allied clan — cannot attack</div>'
        : myLordsIdle.length > 0
          ? `<button class="mip-attack-btn mip-card-wide" data-attack-unknown-lord="1">${gi('crossed-swords')} Attack</button>`
          : `<p class="mip-note mip-note--warn">No lord available to attack</p>`;

      enemyLordSection = `
        <div class="mip-divider"></div>
        <div class="mip-section">
          <div class="mip-section-label">${gi('crossed-swords')} Unknown Force</div>
          <div class="mip-enemy-lord-card mip-card-wide">
            <div class="ov-lc-portrait ov-lc-portrait--icon">
              <span style="font-size:2rem">${gi('uncertainty')}</span>
              ${ownerRow}
            </div>
            <div class="ov-lc-body">
              <div class="ov-lc-top"><span class="ov-lc-name">Unknown Force</span></div>
              ${scoutNote}
            </div>
            ${attackBtn}
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

    // Quest / Scout from the map tile panel.
    //
    // These used to FIRE the action immediately. That silently skipped the
    // confirmation screen every other entry point goes through — so a quest
    // launched from the map always ran at Standard length, with no chance to
    // pick Short/Long, and no sight of the tile's depletion, the army's
    // footprint, or how strong an ambush would be. Same action, two different
    // contracts depending on which button you happened to press.
    //
    // Now they open ActionConfirmView like the lord screen's buttons do. The
    // map keeps its shortcut; the shortcut just stops being a different game.
    document.querySelectorAll('.mip-lord-search-btn[data-lord-id], .mip-lord-scout-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) return;
        App.navigate('action-confirm', {
          player: _player,
          lord,
          action:   btn.classList.contains('mip-lord-scout-btn') ? 'scout' : 'quest',
          returnTo: 'map',
        });
      });
    });

    // Attack — always allowed, scouted or not. The attack screen looks up the
    // latest scout report for this tile itself (ActivityService), so nothing
    // about the enemy needs threading through the navigation call any more.
    document.querySelector('.mip-attack-btn[data-attack-unknown-lord]')?.addEventListener('click', () => {
      App.navigate('attack-confirm', { player: _player, targetX: x, targetY: y });
    });

    document.querySelectorAll('.mip-city-attack-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        App.navigate('attack-confirm', { player: _player, targetX: x, targetY: y });
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
      if (msg) msg.innerHTML = `${gi('position-marker')} Select a destination for <b>${_movingLord.name}</b>`;
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
      _presence      = new Set(d.lords.map(l => `${l.x},${l.y}`));
      _presenceOwner = new Map(d.lords.map(l => [`${l.x},${l.y}`, { playerId: l.playerId, username: l.username }]));
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
        const nx = Math.min(_w - 1, Math.max(0, _keyCursor.x + dx));
        const ny = Math.min(_h - 1, Math.max(0, _keyCursor.y + dy));
        _keyCursor = { x: nx, y: ny };
        _updateCanvasAriaLabel();
        _draw();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        _onTileClick(_keyCursor.x, _keyCursor.y);
      }
    });

    // Left side panel — click a city/lord row to select its tile
    document.getElementById('map-side-panel')?.addEventListener('click', e => {
      const row = e.target.closest('.msp-row');
      if (!row) return;
      const x = Number(row.dataset.x);
      const y = Number(row.dataset.y);
      _keyCursor = { x, y };
      _onTileClick(x, y);
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
    _updateSideActive(x, y);
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
