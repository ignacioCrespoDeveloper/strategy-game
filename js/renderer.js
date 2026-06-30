// =============================================
//  renderer.js — TW campaign-map style
//  Two layers:
//    1. _worldCanvas (static, DPR-sharp): ocean + organic terrain blobs
//    2. draw() (per-frame): reachable hex overlay + cities + units
// =============================================

const Renderer = (() => {
  let canvas, ctx, scale;
  let _dpr  = 1;
  let _logW = 900, _logH = 620;   // logical (CSS) canvas dimensions
  let camera        = { x: 0, y: 0 };
  let panFlags      = { left: false, right: false, up: false, down: false };
  let panRafId      = null;
  let lastDrawState = null;
  const PAN_SPEED   = 10;

  let _worldCanvas = null;
  let _worldDirty  = true;

  // Unit portrait images (loaded asynchronously; drawn in token if available)
  const _unitImgs = {};

  // Terrain colour palette — muted organic campaign-map tones
  const TPAL = {
    water:    { mid: '#0a2030' },
    plains:   { base: '#5a6830', mid: '#6b7838', lite: '#7d8e44' },
    forest:   { base: '#1c3018', mid: '#294220', lite: '#325428' },
    mountain: { base: '#3e3630', mid: '#524840', lite: '#6a6058' },
    desert:   { base: '#726022', mid: '#8a7030', lite: '#a08838' },
  };

  // Draw order: each terrain overwrites the bleed of earlier ones at boundaries
  const PAINT_ORDER = ['plains', 'desert', 'forest', 'mountain'];

  // ── Init / resize ────────────────────────────
  function init(c) {
    canvas = c;
    ctx    = c.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); if (lastDrawState) draw(lastDrawState); });
    _preloadUnitImgs();
  }

  function _preloadUnitImgs() {
    Object.entries(UNIT_TYPES).forEach(([type, def]) => {
      if (!def.img) return;
      const img = new Image();
      img.onload = () => { if (lastDrawState) draw(lastDrawState); };
      img.src    = `assets/units/${def.img}.png`;
      _unitImgs[type] = img;
    });
  }

  function resize() {
    const wrap = document.getElementById('map-wrap');
    _dpr  = Math.min(window.devicePixelRatio || 1, 3);
    _logW = wrap.clientWidth  || 900;
    _logH = wrap.clientHeight || 620;

    // Physical canvas = logical × DPR for sharp rendering
    canvas.width        = Math.round(_logW * _dpr);
    canvas.height       = Math.round(_logH * _dpr);
    canvas.style.width  = _logW + 'px';
    canvas.style.height = _logH + 'px';

    scale         = Math.min(1.0, (_logW * 2) / ((COLS - 1) * HEX_R * 1.74));
    _worldDirty   = true;
    _patternCache = {};
    clampCamera();
  }

  function getScale()  { return scale; }
  function getCamera() { return { x: camera.x, y: camera.y }; }
  function markTerrainDirty() { _worldDirty = true; _patternCache = {}; }

  function clampCamera() {
    const worldW = _worldLogW();
    const worldH = _worldLogH();
    camera.x = Math.max(0, Math.min(camera.x, Math.max(0, worldW - _logW)));
    camera.y = Math.max(0, Math.min(camera.y, Math.max(0, worldH - _logH)));
  }

  function _worldLogW() { return Math.ceil((42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 4) * scale); }
  function _worldLogH() { return Math.ceil((44 + (ROWS - 0.5) * HEX_H + HEX_H * 2) * scale);      }

  function centerOn(col, row) {
    const { x, y } = hexCenter(col, row, scale);
    camera.x = x - _logW / 2;
    camera.y = y - _logH / 2;
    clampCamera();
  }

  function zoomAt(px, py, delta) {
    const prev   = scale;
    scale        = Math.max(0.25, Math.min(2.0, scale * (delta > 0 ? 0.85 : 1.18)));
    if (scale === prev) return;
    // Zoom toward mouse position: shift camera so (px,py) stays fixed
    camera.x = (camera.x + px) * (scale / prev) - px;
    camera.y = (camera.y + py) * (scale / prev) - py;
    _worldDirty   = true;
    _patternCache = {};
    clampCamera();
    if (lastDrawState) draw(lastDrawState);
  }

  // ── Pan ─────────────────────────────────────
  function setPanFlag(dir, active) {
    panFlags[dir] = active;
    if (active && !panRafId) _startPanRaf();
  }
  function _startPanRaf() {
    function loop() {
      let moved = false;
      if (panFlags.left)  { camera.x -= PAN_SPEED; moved = true; }
      if (panFlags.right) { camera.x += PAN_SPEED; moved = true; }
      if (panFlags.up)    { camera.y -= PAN_SPEED; moved = true; }
      if (panFlags.down)  { camera.y += PAN_SPEED; moved = true; }
      if (moved) { clampCamera(); if (lastDrawState) draw(lastDrawState); }
      const any = panFlags.left || panFlags.right || panFlags.up || panFlags.down;
      panRafId = any ? requestAnimationFrame(loop) : null;
    }
    panRafId = requestAnimationFrame(loop);
  }

  // ── Helpers ──────────────────────────────────
  function _hexPath(c2d, x, y, r) {
    c2d.beginPath();
    for (let i = 0; i < 6; i++) {
      const a  = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      i === 0 ? c2d.moveTo(px, py) : c2d.lineTo(px, py);
    }
    c2d.closePath();
  }

  function _sr(c, r, s) {
    const v = Math.sin(c * 374761 + r * 1234567 + (s || 0) * 999983) * 43758.5453;
    return v - Math.floor(v);
  }

  function _shiftL(hex, amt) {
    let rv = parseInt(hex.slice(1, 3), 16);
    let gv = parseInt(hex.slice(3, 5), 16);
    let bv = parseInt(hex.slice(5, 7), 16);
    rv = Math.min(255, Math.max(0, rv + amt));
    gv = Math.min(255, Math.max(0, gv + amt));
    bv = Math.min(255, Math.max(0, bv + amt));
    return `rgb(${rv},${gv},${bv})`;
  }

  let _patternCache = {};

  // Creates a seamlessly-tiling 45° diagonal stripe tile canvas
  function _makeStripeTile(lineColor, spacing) {
    const s = Math.max(4, Math.round(spacing));
    const c = document.createElement('canvas');
    c.width  = s * 2;
    c.height = s * 2;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, s * 2, s * 2);
    cx.strokeStyle = lineColor;
    cx.lineWidth   = 1.2;
    cx.lineCap     = 'square';
    for (let i = -s * 2; i < s * 4; i += s) {
      cx.beginPath();
      cx.moveTo(i,         0);
      cx.lineTo(i + s * 2, s * 2);
      cx.stroke();
    }
    return c;
  }

  // ── WORLD CANVAS (static terrain layer) ─────
  function _buildWorldCanvas() {
    const logW = _worldLogW();
    const logH = _worldLogH();

    if (!_worldCanvas) _worldCanvas = document.createElement('canvas');
    // Physical size for DPR-sharp rendering
    _worldCanvas.width  = Math.round(logW * _dpr);
    _worldCanvas.height = Math.round(logH * _dpr);

    const wc = _worldCanvas.getContext('2d');
    // Resetting canvas.width resets the context transform — apply DPR scale fresh
    wc.scale(_dpr, _dpr);   // all subsequent coords are in LOGICAL pixels

    const r = HEX_R * scale;

    // ── Pass 1: Ocean background ─────────────
    const og = wc.createLinearGradient(0, 0, 0, logH);
    og.addColorStop(0,   '#0f2840');
    og.addColorStop(0.5, '#0a2035');
    og.addColorStop(1,   '#07182a');
    wc.fillStyle = og;
    wc.fillRect(0, 0, logW, logH);

    // Subtle wave lines over ocean
    wc.save();
    for (let wy = 22; wy < logH; wy += 32) {
      wc.beginPath();
      for (let wx = 0; wx <= logW; wx += 8) {
        const yy = wy + Math.sin(wx * 0.034) * 3.5;
        wx === 0 ? wc.moveTo(wx, yy) : wc.lineTo(wx, yy);
      }
      wc.strokeStyle = 'rgba(255,255,255,0.020)';
      wc.lineWidth   = 1;
      wc.stroke();
    }
    wc.restore();

    // ── Pass 2: Organic terrain blobs ────────
    // Each hex is drawn with clip radius r*1.9 (much larger than r).
    // Adjacent same-terrain hexes overlap → they merge into seamless regions.
    // Different terrain types are drawn in PAINT_ORDER so later types "win"
    // at terrain boundaries — creating organic, non-hexagonal transitions.
    for (const t of PAINT_ORDER) {
      const flatColor = TPAL[t].mid;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (TERRAIN_MAP[row][col] !== t) continue;
          const { x, y } = hexCenter(col, row, scale);
          wc.save();
          _hexPath(wc, x, y, r * 1.9);
          wc.clip();
          wc.fillStyle = flatColor;
          wc.fill();
          wc.restore();
        }
      }
    }

    // ── Pass 3: Per-hex radial variation ─────
    // Adds subtle light/dark variation within terrain regions so they
    // don't look like a flat fill. Uses the same large clip so the
    // variation also bleeds softly into neighbouring hexes.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);
        const v = _sr(col, row, 0);
        const p = TPAL[t];
        const dv = Math.floor(v * 14 - 7);

        wc.save();
        _hexPath(wc, x, y, r * 1.9);
        wc.clip();

        const g = wc.createRadialGradient(
          x - r * 0.12, y - r * 0.14, r * 0.04,
          x + r * 0.08, y + r * 0.18, r * 1.60
        );
        g.addColorStop(0,   _shiftL(p.lite, dv));
        g.addColorStop(0.6, _shiftL(p.mid,  dv - 4));
        g.addColorStop(1,   _shiftL(p.base, dv - 9));
        wc.globalAlpha = 0.48;
        wc.fillStyle   = g;
        wc.fill();
        wc.globalAlpha = 1;
        wc.restore();
      }
    }

    // ── Pass 4: Global diagonal stripe texture ─
    // Applied as a SINGLE full-canvas fill (no per-hex clipping) so the
    // stripe has no hexagonal shape — it looks like a uniform map texture.
    {
      const tile = _makeStripeTile('rgba(255,255,255,1)', 8);
      const pat  = wc.createPattern(tile, 'repeat');
      wc.globalAlpha = 0.048;
      wc.fillStyle   = pat;
      wc.fillRect(0, 0, logW, logH);
      wc.globalAlpha = 1;
    }

    // ── Pass 5: Terrain detail elements ──────
    // Clipped to a smaller hex (r*0.82) so details stay well inside each hex.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);
        wc.save();
        _hexPath(wc, x, y, r * 0.82);
        wc.clip();
        _drawDetail(wc, t, x, y, r, col, row);
        wc.restore();
      }
    }

    // ── No borders of any kind on terrain ────

    _worldDirty = false;
  }

  function _drawDetail(wc, terrain, x, y, r, col, row) {
    if (terrain === 'forest') {
      const n = 4 + Math.floor(_sr(col, row, 0) * 3);
      for (let i = 0; i < n; i++) {
        const tx = x + (_sr(col, row, i * 4 + 1) - 0.5) * r * 1.0;
        const ty = y + (_sr(col, row, i * 4 + 2) - 0.5) * r * 0.75;
        const tr = r * (0.12 + _sr(col, row, i * 4 + 3) * 0.09);
        const gv = 26 + Math.floor(_sr(col, row, i * 4 + 4) * 32);
        wc.beginPath();
        wc.arc(tx, ty + tr * 0.10, tr, 0, Math.PI * 2);
        wc.fillStyle = `rgba(8,${gv},5,0.58)`;
        wc.fill();
      }
    } else if (terrain === 'mountain') {
      const n = 2 + Math.floor(_sr(col, row, 0) * 2);
      for (let i = 0; i < n; i++) {
        const mx = x + (_sr(col, row, i * 5 + 1) - 0.5) * r * 0.65;
        const my = y + _sr(col, row, i * 5 + 2)          * r * 0.38;
        const mh = r * (0.38 + _sr(col, row, i * 5 + 3) * 0.32);
        const mw = r * (0.26 + _sr(col, row, i * 5 + 4) * 0.16);
        const sh = 55 + Math.floor(_sr(col, row, i * 5 + 5) * 28);
        wc.beginPath();
        wc.moveTo(mx - mw, my);
        wc.lineTo(mx, my - mh);
        wc.lineTo(mx + mw, my);
        wc.closePath();
        wc.fillStyle = `rgba(${sh},${sh - 5},${sh - 10},0.52)`;
        wc.fill();
        if (mh > r * 0.42) {
          const sf = mh * 0.28;
          wc.beginPath();
          wc.moveTo(mx - mw * 0.20, my - mh + sf);
          wc.lineTo(mx, my - mh);
          wc.lineTo(mx + mw * 0.20, my - mh + sf);
          wc.closePath();
          wc.fillStyle = 'rgba(225,232,248,0.48)';
          wc.fill();
        }
      }
    } else if (terrain === 'desert') {
      const n = 3 + Math.floor(_sr(col, row, 0) * 3);
      for (let i = 0; i < n; i++) {
        const dy = y - r * 0.42 + (i / Math.max(1, n - 1)) * r * 0.84;
        wc.beginPath();
        wc.moveTo(x - r * 0.65, dy);
        wc.quadraticCurveTo(x, dy - r * 0.045, x + r * 0.65, dy);
        wc.strokeStyle = 'rgba(215,180,55,0.13)';
        wc.lineWidth   = 0.9;
        wc.stroke();
      }
    }
  }

  // ── City 2D renderer ─────────────────────────
  function _seededRng(seed) {
    let s = (seed ^ 0xdeadbeef) >>> 0;
    return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; s = s >>> 0; return s / 0xffffffff; };
  }

  function _roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function _drawCity2D(ctx, city, cx, cy, hexR) {
    const tier = CITY_TYPES[city.type || 'aldea']?.tier ?? 0;
    let ownerCol;
    if (city.owner === 'player') {
      ownerCol = (typeof Game !== 'undefined') ? Game.getPlayerColor() : '#4a9eff';
    } else if (city.factionId && typeof FACTIONS !== 'undefined') {
      const f = FACTIONS.find(f => f.id === city.factionId);
      ownerCol = f ? f.color : (city.owner === 'enemy' ? '#e04040' : '#c8a030');
    } else {
      ownerCol = city.owner === 'enemy' ? '#e04040' : '#c8a030';
    }

    const TIER = [
      { r: 0.45, blds: 12,  sides: 8,  streets: 3 },  // aldea
      { r: 0.80, blds: 26,  sides: 10, streets: 4 },  // pueblo
      { r: 1.30, blds: 60,  sides: 10, streets: 5 },  // ciudad
      { r: 1.90, blds: 110, sides: 12, streets: 6 },  // gran_ciudad
    ];
    const cfg   = TIER[Math.min(tier, 3)];
    const cityR = hexR * cfg.r;
    const rng   = _seededRng((city.c * 7919 + city.r * 1013) | 0);

    const wallPoly = (rad, offset = 0) =>
      Array.from({length: cfg.sides}, (_, i) => {
        const a = (i / cfg.sides) * Math.PI * 2 + offset - Math.PI / 2;
        return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
      });

    const tracePoly = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.closePath();
    };

    const outer = wallPoly(cityR);
    const inner = wallPoly(cityR * 0.86);

    // Shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = hexR * 0.35;
    ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
    tracePoly(outer); ctx.fillStyle = '#00000000'; ctx.fill();
    ctx.restore();

    // Ground inside walls
    tracePoly(outer);
    const grd = ctx.createRadialGradient(cx, cy - cityR * 0.15, 0, cx, cy, cityR);
    grd.addColorStop(0,   '#d8c88a');
    grd.addColorStop(0.6, '#cbbf7a');
    grd.addColorStop(1,   '#b8ac68');
    ctx.fillStyle = grd;
    ctx.fill();

    // Streets — radial spokes from center to gates
    ctx.save();
    const streetW = Math.max(0.6, hexR * 0.044);
    ctx.lineWidth   = streetW;
    ctx.strokeStyle = '#a89054';
    for (let g = 0; g < cfg.streets; g++) {
      const a = (g / cfg.streets) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * cityR * 0.92, cy + Math.sin(a) * cityR * 0.92);
      ctx.stroke();
    }
    // Ring road near walls
    ctx.lineWidth   = streetW * 0.7;
    ctx.strokeStyle = '#9e8850';
    ctx.beginPath();
    ctx.arc(cx, cy, cityR * 0.76, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Buildings — seeded, top-down rooftop rectangles
    const ROOF = ['#b85c2a','#c46830','#a85028','#cc7035','#b06030','#c07840','#9a4820'];
    for (let b = 0; b < cfg.blds; b++) {
      const ang  = rng() * Math.PI * 2;
      const dist = Math.sqrt(rng()) * cityR * 0.78;
      const bx   = cx + Math.cos(ang) * dist;
      const by   = cy + Math.sin(ang) * dist;
      if ((bx - cx) ** 2 + (by - cy) ** 2 > (cityR * 0.80) ** 2) continue;

      // Skip if close to a street spoke
      let onStreet = false;
      for (let g = 0; g < cfg.streets; g++) {
        const sa = (g / cfg.streets) * Math.PI * 2 - Math.PI / 2;
        const da = Math.abs(Math.atan2(by - cy, bx - cx) - sa);
        const normDa = Math.min(da, Math.PI * 2 - da);
        if (normDa < 0.18 && dist > hexR * 0.08) { onStreet = true; break; }
      }
      if (onStreet) continue;

      const bw  = cityR * (0.022 + rng() * 0.055);
      const bh  = cityR * (0.016 + rng() * 0.038);
      const rot = rng() * Math.PI;

      ctx.save();
      ctx.translate(bx, by); ctx.rotate(rot);
      ctx.fillStyle   = ROOF[Math.floor(rng() * ROOF.length)];
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.strokeStyle = 'rgba(50,20,5,0.50)';
      ctx.lineWidth   = 0.35;
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    }

    // Central plaza & cathedral/forum
    ctx.save();
    ctx.fillStyle   = '#d8ca80';
    ctx.strokeStyle = 'rgba(90,60,20,0.4)';
    ctx.lineWidth   = 0.5;
    ctx.beginPath(); ctx.arc(cx, cy, cityR * 0.06, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const cbW = cityR * (0.06 + tier * 0.008);
    const cbH = cityR * (0.09 + tier * 0.008);
    ctx.fillStyle   = '#e8d060';
    ctx.strokeStyle = 'rgba(70,45,10,0.7)'; ctx.lineWidth = 0.6;
    ctx.fillRect(cx - cbW / 2, cy - cbH * 0.6 - cityR * 0.06, cbW, cbH);
    ctx.strokeRect(cx - cbW / 2, cy - cbH * 0.6 - cityR * 0.06, cbW, cbH);
    ctx.restore();

    // Outer wall
    tracePoly(outer);
    ctx.lineWidth   = Math.max(1.4, cityR * 0.055);
    ctx.strokeStyle = '#8a7858';
    ctx.stroke();

    // Inner wall edge (stone thickness detail)
    tracePoly(inner);
    ctx.lineWidth   = Math.max(0.5, cityR * 0.018);
    ctx.strokeStyle = 'rgba(70,55,30,0.35)';
    ctx.stroke();

    // Towers at wall vertices
    const twR = Math.max(2, cityR * 0.062);
    outer.forEach(p => {
      ctx.save();
      ctx.beginPath(); ctx.arc(p.x, p.y, twR, 0, Math.PI * 2);
      ctx.fillStyle   = '#c8b068'; ctx.fill();
      ctx.strokeStyle = '#5a4a28'; ctx.lineWidth = Math.max(0.5, cityR * 0.018); ctx.stroke();
      ctx.restore();
    });

    // Ownership tint on wall outline
    tracePoly(outer);
    ctx.lineWidth   = Math.max(0.8, hexR * 0.03);
    ctx.strokeStyle = ownerCol + 'cc';
    ctx.stroke();

    // Name badge: black rounded pill + owner dot + white text
    const fs = Math.round(Math.max(9, Math.min(15, hexR * 0.32)));
    ctx.save();
    ctx.font = `bold ${fs}px sans-serif`;
    const textW  = ctx.measureText(city.name).width;
    const dotR   = fs * 0.44;
    const padX   = 7;
    const padY   = 4;
    const gapTxt = 5;
    const badgeW = padX + dotR * 2 + gapTxt + textW + padX;
    const badgeH = fs + padY * 2;
    const bx     = cx - badgeW / 2;
    const by     = cy + cityR + 6;
    const brad   = badgeH / 2;

    // Black pill background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    _roundRect(ctx, bx, by, badgeW, badgeH, brad);
    ctx.fill();

    // Thin border matching owner color
    ctx.strokeStyle = ownerCol + '99';
    ctx.lineWidth   = 1;
    _roundRect(ctx, bx, by, badgeW, badgeH, brad);
    ctx.stroke();

    // Owner color dot
    ctx.beginPath();
    ctx.arc(bx + padX + dotR, by + badgeH / 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = ownerCol;
    ctx.fill();

    // City name text
    ctx.fillStyle    = '#ffffff';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur   = 2;
    ctx.fillText(city.name, bx + padX + dotR * 2 + gapTxt, by + badgeH / 2);
    ctx.restore();
  }

  // ── MAIN DRAW (per frame) ────────────────────
  function draw(state) {
    lastDrawState = state;
    const { selectedUnit, selectedGroup, reachable, phase, leaderHex, visibleHexes, exploredHexes } = state;
    const units    = Units.getAll();
    const cities   = Cities.getAll();
    const r        = HEX_R * scale;
    const reachSet = new Set(reachable.map(h => hexKey(h.c, h.r)));

    // DPR-correct transform: all subsequent coords are in LOGICAL pixels
    ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    ctx.clearRect(0, 0, _logW, _logH);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Viewport culling in logical pixels
    const vx0 = camera.x - r * 2, vx1 = camera.x + _logW + r * 2;
    const vy0 = camera.y - r * 2, vy1 = camera.y + _logH + r * 2;

    // ── 1. Terrain world canvas (baked) ───────
    if (_worldDirty) _buildWorldCanvas();
    if (_worldCanvas) {
      ctx.drawImage(_worldCanvas, 0, 0, _worldLogW(), _worldLogH());
    }

    // ── 1.5. Fog of War dark overlay ──────────
    if (exploredHexes && exploredHexes.size > 0) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const { x, y } = hexCenter(col, row, scale);
          if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
          const k = hexKey(col, row);
          const isVisible  = visibleHexes && visibleHexes.has(k);
          const isExplored = exploredHexes.has(k);
          if (isVisible) continue;
          ctx.save();
          _hexPath(ctx, x, y, r);
          ctx.fillStyle = isExplored ? 'rgba(10,12,20,0.50)' : 'rgba(0,0,0,0.88)';
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // ── 2. Reachable hex overlay ─────────────
    // Hexagonal grid ONLY visible here (movement range on army select)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!reachSet.has(hexKey(col, row))) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        ctx.save();
        _hexPath(ctx, x, y, r - 0.5);
        ctx.fillStyle = 'rgba(74,158,255,0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,215,255,0.90)';
        ctx.lineWidth   = 1.8;
        ctx.stroke();
        _hexPath(ctx, x, y, r - 4);
        ctx.strokeStyle = 'rgba(200,235,255,0.28)';
        ctx.lineWidth   = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── 3. Resources ──────────────────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const res = GameMap.getResource(col, row);
        if (!res) continue;
        const rk = hexKey(col, row);
        if (exploredHexes && !exploredHexes.has(rk) && !(visibleHexes && visibleHexes.has(rk))) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        const rdef = RESOURCE_DEF[res];
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + r * 0.04, r * 0.27, 0, Math.PI * 2);
        ctx.fillStyle   = 'rgba(10,6,2,0.78)';
        ctx.fill();
        ctx.strokeStyle = rdef.color + '99';
        ctx.lineWidth   = 1.2;
        ctx.stroke();
        ctx.font         = `${Math.round(r * 0.34)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha  = 0.88;
        ctx.fillText(rdef.icon, x, y + r * 0.04);
        ctx.globalAlpha = 1;
        ctx.restore();

        const cap = GameMap.getCapturedBy(col, row);
        if (cap) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x + r * 0.22, y - r * 0.20, 4.5, 0, Math.PI * 2);
          ctx.fillStyle   = cap === 'player' ? '#4a9eff' : '#ff5050';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth   = 1.2;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── 4a. City influence — per-hex tint + soft glow ────────────────
    cities.forEach(ci => {
      // Only draw influence for player cities and currently visible non-player cities
      if (ci.owner !== 'player' && visibleHexes && !visibleHexes.has(hexKey(ci.c, ci.r))) return;
      const typeData = CITY_TYPES[ci.type || 'aldea'];
      const rgb = ci.owner === 'player' ? '74,158,255'
                : ci.owner === 'enemy'  ? '220,60,60' : '200,160,40';

      // BFS: collect all hexes within influence radius
      const visited = new Set();
      const queue   = [{ c: ci.c, r: ci.r, dist: 0 }];
      visited.add(hexKey(ci.c, ci.r));
      while (queue.length) {
        const { c: hc, r: hr, dist } = queue.shift();
        if (dist > 0) {  // skip the city hex itself
          const { x: hx, y: hy } = hexCenter(hc, hr, scale);
          ctx.save();
          _hexPath(ctx, hx, hy, r * 0.94);
          ctx.fillStyle = `rgba(${rgb},${dist === 1 ? 0.18 : 0.10})`;
          ctx.fill();
          ctx.strokeStyle = `rgba(${rgb},${dist === 1 ? 0.30 : 0.14})`;
          ctx.lineWidth   = 0.8;
          ctx.stroke();
          ctx.restore();
        }
        if (dist < typeData.influence) {
          neighbors(hc, hr).forEach(n => {
            const k = hexKey(n.c, n.r);
            if (!visited.has(k) && !GameMap.isWater(n.c, n.r)) {
              visited.add(k);
              queue.push({ c: n.c, r: n.r, dist: dist + 1 });
            }
          });
        }
      }

      // Soft radial glow on top
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      const influenceR = typeData.influence * r * 2.0;
      ctx.save();
      const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, influenceR);
      grad.addColorStop(0,   `rgba(${rgb},0.12)`);
      grad.addColorStop(0.55,`rgba(${rgb},0.03)`);
      grad.addColorStop(1,   `rgba(${rgb},0.00)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, influenceR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // ── 4. Cities ─────────────────────────────
    cities.forEach(ci => {
      const ck = hexKey(ci.c, ci.r);
      // Skip completely unexplored cities (player doesn't know they exist)
      if (exploredHexes && !exploredHexes.has(ck) && !(visibleHexes && visibleHexes.has(ck))) return;
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      if (x < vx0 - r * 1.5 || x > vx1 + r * 1.5 || y < vy0 - r * 1.5 || y > vy1 + r * 1.5) return;
      _drawCity2D(ctx, ci, x, y, r);
    });

    // ── 4b. City-select pulse rings ────────────
    if (phase === 'city-select') {
      const t = Date.now() / 700;
      const pulse = 0.55 + Math.sin(t) * 0.25; // 0.30 … 0.80
      cities.forEach(ci => {
        const { x, y } = hexCenter(ci.c, ci.r, scale);
        if (x < vx0 - r * 2 || x > vx1 + r * 2 || y < vy0 - r * 2 || y > vy1 + r * 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.74, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(200,160,30,${pulse.toFixed(2)})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(200,160,30,${(pulse * 0.35).toFixed(2)})`;
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.restore();
      });
    }

    // ── 5. Units ──────────────────────────────
    const hexGroups = new Map();
    units.forEach(u => {
      const k = hexKey(u.c, u.r);
      if (!hexGroups.has(k)) hexGroups.set(k, []);
      hexGroups.get(k).push(u);
    });

    hexGroups.forEach(stack => {
      const u = stack[0];
      // Non-player units are hidden in non-visible hexes (fog of war)
      if (u.owner !== 'player' && visibleHexes && !visibleHexes.has(hexKey(u.c, u.r))) return;
      const { x, y } = hexCenter(u.c, u.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const isSelected    = selectedUnit  && stack.some(su => su.id === selectedUnit.id);
      const isInGroup     = selectedGroup && stack.some(su => selectedGroup.includes(su.id));
      const isPlayer      = u.owner === 'player';
      const isLeaderStack = stack.some(su => su.isLeader);
      const def           = UNIT_TYPES[u.type];
      const teamCol       = isPlayer ? Game.getPlayerColor() : '#ff5050';
      const exhausted  = stack.every(su => su.moves === 0);

      if (isInGroup) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80,220,120,0.85)';
        ctx.lineWidth   = 2.5;
        ctx.stroke();
        ctx.restore();
      }
      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.54, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.80)';
        ctx.lineWidth   = 2;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Gold ring for leader unit
      if (isLeaderStack && isPlayer) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.46, 0, Math.PI * 2);
        ctx.strokeStyle = '#e8c050';
        ctx.lineWidth   = 3;
        ctx.stroke();
        ctx.restore();
      }

      // Shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 1.5, y + 2.5, r * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.restore();

      // Disc
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
      const ug = ctx.createRadialGradient(x - r * 0.08, y - r * 0.10, r * 0.02, x, y, r * 0.36);
      ug.addColorStop(0, exhausted ? '#555' : isPlayer ? '#6ab4ff' : '#ff8080');
      ug.addColorStop(1, exhausted ? '#3a3a3a' : teamCol);
      ctx.fillStyle   = ug;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(0,0,0,0.70)';
      ctx.lineWidth   = isSelected ? 2 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Portrait image or emoji fallback inside token
      ctx.save();
      const uImg = _unitImgs[u.type];
      if (uImg && uImg.complete && uImg.naturalWidth > 0) {
        const ir = r * 0.31;
        ctx.beginPath();
        ctx.arc(x, y, ir, 0, Math.PI * 2);
        ctx.clip();
        // Draw top portion of the portrait (head/torso)
        const iw = uImg.naturalWidth, ih = uImg.naturalHeight;
        const drawH = Math.min(ih, iw * 1.2);
        ctx.drawImage(uImg, 0, 0, iw, drawH, x - ir, y - ir, ir * 2, ir * 2);
      } else {
        ctx.font         = `${Math.round(r * 0.30)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur   = 2;
        ctx.fillText(def.icon, x, y + 1);
      }
      ctx.restore();

      // HP bar
      const bw = r * 0.64, bh = 3, bx = x - bw / 2, by = y + r * 0.42;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, bh);
      const hp = u.hp / u.maxHp;
      ctx.fillStyle = hp > 0.6 ? '#4aaa44' : hp > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(bx, by, bw * hp, bh);

      // Move pips — 1 pip = 2 moves (halved to match UI)
      const totalPips = Math.ceil(u.maxMoves / 2);
      const fullPips  = Math.floor(u.moves / 2);
      const hasHalf   = u.moves % 2 === 1;
      const pipSpacing = 5.5;
      const pipStartX  = x - ((totalPips - 1) * pipSpacing) / 2;
      for (let i = 0; i < totalPips; i++) {
        const px = pipStartX + i * pipSpacing;
        const py = y + r * 0.58;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        if (i < fullPips) {
          ctx.fillStyle = teamCol;
        } else if (i === fullPips && hasHalf) {
          ctx.fillStyle = isPlayer ? 'rgba(74,158,255,0.50)' : 'rgba(255,80,80,0.50)';
        } else {
          ctx.fillStyle = 'rgba(100,100,100,0.40)';
        }
        ctx.fill();
      }

      // Stack count badge
      if (stack.length > 1) {
        const bx2 = x + r * 0.24, by2 = y - r * 0.24;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx2, by2, r * 0.19, 0, Math.PI * 2);
        ctx.fillStyle   = teamCol;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.font         = `bold ${Math.round(r * 0.20)}px sans-serif`;
        ctx.fillStyle    = '#fff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stack.length, bx2, by2);
        ctx.restore();
      }

      // Leader crown — shown when leader is commanding this army
      if (isPlayer && leaderHex && leaderHex.c === u.c && leaderHex.r === u.r) {
        ctx.save();
        ctx.font         = `${Math.round(r * 0.28)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur   = 4;
        ctx.fillText('👑', x - r * 0.30, y - r * 0.46);
        ctx.restore();
      }
    });

    ctx.restore();
    _drawPanHint();
  }

  function _drawPanHint() {
    const worldW = _worldLogW();
    const worldH = _worldLogH();
    if (!(worldW > _logW || worldH > _logH)) return;
    ctx.save();
    ctx.font         = '11px monospace';
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('↑↓←→ para navegar', _logW - 8, _logH - 6);
    ctx.restore();
  }

  return { init, draw, resize, getScale, getCamera, setPanFlag, markTerrainDirty, zoomAt, centerOn };
})();
