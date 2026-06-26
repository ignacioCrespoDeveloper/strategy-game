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

    scale         = 1.0;
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

  function _worldLogW() { return Math.ceil(42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 4); }
  function _worldLogH() { return Math.ceil(44 + (ROWS - 0.5) * HEX_H + HEX_H * 2);      }

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

  // ── MAIN DRAW (per frame) ────────────────────
  function draw(state) {
    lastDrawState = state;
    const { selectedUnit, selectedGroup, reachable } = state;
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

    // ── 4. Cities ─────────────────────────────
    cities.forEach(ci => {
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const ownerCol = ci.owner === 'player' ? '#4a9eff'
                     : ci.owner === 'enemy'  ? '#e04040' : '#ddb030';

      // Outer glow ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
      ctx.fillStyle   = ownerCol + '1e';
      ctx.fill();
      ctx.strokeStyle = ownerCol + '55';
      ctx.lineWidth   = 2.2;
      ctx.stroke();
      ctx.restore();

      // Drop shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 2, y + 3, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fill();
      ctx.restore();

      // City disc
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(x - r * 0.12, y - r * 0.12, r * 0.02, x, y, r * 0.44);
      cg.addColorStop(0, '#2e2518');
      cg.addColorStop(1, '#0e0c08');
      ctx.fillStyle   = cg;
      ctx.fill();
      ctx.strokeStyle = ownerCol;
      ctx.lineWidth   = 1.8;
      ctx.stroke();
      ctx.restore();

      // Icon
      ctx.save();
      ctx.font         = `${Math.round(r * 0.40)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4;
      ctx.fillText('🏰', x, y - r * 0.02);
      ctx.restore();

      // City name label
      ctx.save();
      ctx.font         = `bold ${Math.round(8.5)}px sans-serif`;
      ctx.fillStyle    = ownerCol;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur   = 5;
      ctx.fillText(ci.name, x, y + r * 0.48);
      ctx.restore();
    });

    // ── 5. Units ──────────────────────────────
    const hexGroups = new Map();
    units.forEach(u => {
      const k = hexKey(u.c, u.r);
      if (!hexGroups.has(k)) hexGroups.set(k, []);
      hexGroups.get(k).push(u);
    });

    hexGroups.forEach(stack => {
      const u         = stack[0];
      const { x, y } = hexCenter(u.c, u.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const isSelected = selectedUnit  && stack.some(su => su.id === selectedUnit.id);
      const isInGroup  = selectedGroup && stack.some(su => selectedGroup.includes(su.id));
      const isPlayer   = u.owner === 'player';
      const def        = UNIT_TYPES[u.type];
      const teamCol    = isPlayer ? '#4a9eff' : '#ff5050';
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

      // Icon
      ctx.save();
      ctx.font         = `${Math.round(r * 0.30)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur   = 2;
      ctx.fillText(def.icon, x, y + 1);
      ctx.restore();

      // HP bar
      const bw = r * 0.64, bh = 3, bx = x - bw / 2, by = y + r * 0.42;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, bh);
      const hp = u.hp / u.maxHp;
      ctx.fillStyle = hp > 0.6 ? '#4aaa44' : hp > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(bx, by, bw * hp, bh);

      // Move pips
      for (let i = 0; i < u.maxMoves; i++) {
        const px = x - ((u.maxMoves - 1) * 5) / 2 + i * 5;
        ctx.beginPath();
        ctx.arc(px, y + r * 0.58, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = i < u.moves ? teamCol : 'rgba(100,100,100,0.40)';
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

  return { init, draw, resize, getScale, getCamera, setPanFlag, markTerrainDirty };
})();
