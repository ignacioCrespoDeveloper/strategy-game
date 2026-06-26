// =============================================
//  renderer.js — canvas draw calls
// =============================================

const Renderer = (() => {
  let canvas, ctx, scale;
  let camera        = { x: 0, y: 0 };
  let panFlags      = { left: false, right: false, up: false, down: false };
  let panRafId      = null;
  let lastDrawState = null;
  const PAN_SPEED   = 10;

  function init(c) {
    canvas = c;
    ctx    = c.getContext('2d');
    resize();
    window.addEventListener('resize', () => { resize(); if (lastDrawState) draw(lastDrawState); });
  }

  function resize() {
    const wrap = document.getElementById('map-wrap');
    canvas.width  = wrap.clientWidth  || 900;
    canvas.height = wrap.clientHeight || 620;
    scale = 1.0;
    _worldDirty = true;
    clampCamera();
  }

  function getScale()  { return scale; }
  function getCamera() { return { x: camera.x, y: camera.y }; }

  function clampCamera() {
    const worldW = (42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 3) * scale;
    const worldH = (44 + (ROWS - 0.5) * HEX_H + HEX_H * 1.5) * scale;
    camera.x = Math.max(0, Math.min(camera.x, Math.max(0, worldW - canvas.width)));
    camera.y = Math.max(0, Math.min(camera.y, Math.max(0, worldH - canvas.height)));
  }

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

  // ── Terrain world cache ──────────────────────
  // Terrain is static — render all hexes once to an offscreen canvas.
  let _worldCanvas = null;
  let _worldDirty  = true;

  function markTerrainDirty() { _worldDirty = true; }

  // ── Procedural texture helpers ───────────────

  // Deterministic pseudo-random per hex (consistent across frames)
  function _sr(c, r, s) {
    const v = Math.sin(c * 374761 + r * 1234567 + (s || 0) * 999983) * 43758.5453;
    return v - Math.floor(v);
  }

  // Build hex clip path (same orientation as hex.js drawHex)
  function _hexPath(wCtx, x, y, r) {
    wCtx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a  = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + r * Math.cos(a);
      const py = y + r * Math.sin(a);
      i === 0 ? wCtx.moveTo(px, py) : wCtx.lineTo(px, py);
    }
    wCtx.closePath();
  }

  // ── Per-terrain texture painters ────────────
  // Each receives the world-canvas 2d context and world coords.
  const _terrain = {

    water(wc, x, y, r, c, row, skipBase) {
      if (!skipBase) {
        const g = wc.createRadialGradient(x, y - r*0.2, r*0.05, x, y + r*0.3, r*1.1);
        g.addColorStop(0, '#1e3f6a');
        g.addColorStop(1, '#091828');
        wc.fillStyle = g;
        wc.fill();
      }

      // Sine-wave ripples
      const wCount = 3 + Math.floor(_sr(c, row, 0) * 3);
      for (let i = 0; i < wCount; i++) {
        const wy    = y - r * 0.5 + (i / (wCount - 1)) * r * 1.0;
        const amp   = r * (0.035 + _sr(c, row, i + 5)  * 0.04);
        const freq  = 2   + _sr(c, row, i + 10) * 2.5;
        const phase = _sr(c, row, i + 20) * Math.PI * 2;
        wc.beginPath();
        const steps = 16;
        for (let j = 0; j <= steps; j++) {
          const t  = j / steps;
          const wx = x - r * 0.82 + t * r * 1.64;
          const ry = wy + Math.sin(t * Math.PI * freq + phase) * amp;
          j === 0 ? wc.moveTo(wx, ry) : wc.lineTo(wx, ry);
        }
        wc.strokeStyle = `rgba(90,175,255,${0.10 + _sr(c, row, i + 30) * 0.10})`;
        wc.lineWidth   = 0.9;
        wc.stroke();
      }

      // Subtle shimmer dots
      const dots = 4 + Math.floor(_sr(c, row, 50) * 4);
      for (let i = 0; i < dots; i++) {
        const dx = x + (_sr(c, row, i * 3 + 60) - 0.5) * r * 1.3;
        const dy = y + (_sr(c, row, i * 3 + 61) - 0.5) * r * 0.9;
        const dr = r * (0.02 + _sr(c, row, i * 3 + 62) * 0.03);
        wc.beginPath();
        wc.arc(dx, dy, dr, 0, Math.PI * 2);
        wc.fillStyle = `rgba(150,210,255,${0.15 + _sr(c, row, i + 70) * 0.10})`;
        wc.fill();
      }
    },

    plains(wc, x, y, r, c, row, skipBase) {
      const hue  = 100 + Math.floor(_sr(c, row, 0) * 20);
      const lite = 18  + Math.floor(_sr(c, row, 1) * 6);
      if (!skipBase) {
        const g = wc.createRadialGradient(x, y - r * 0.25, r * 0.05, x, y + r * 0.15, r * 1.1);
        g.addColorStop(0, `hsl(${hue},48%,${lite + 8}%)`);
        g.addColorStop(1, `hsl(${hue},42%,${lite}%)`);
        wc.fillStyle = g;
        wc.fill();
      }

      // Grass tufts
      const count = 10 + Math.floor(_sr(c, row, 2) * 9);
      for (let i = 0; i < count; i++) {
        const gx  = x + (_sr(c, row, i * 5)     - 0.5) * r * 1.5;
        const gy  = y + (_sr(c, row, i * 5 + 1) - 0.5) * r * 1.15;
        const gh  = r * (0.07 + _sr(c, row, i * 5 + 2) * 0.10);
        const gt  = (_sr(c, row, i * 5 + 3) - 0.5) * 0.55;
        const gv  = 75 + Math.floor(_sr(c, row, i * 5 + 4) * 40);
        wc.beginPath();
        wc.moveTo(gx, gy);
        wc.lineTo(gx + gt * gh, gy - gh);
        wc.strokeStyle = `rgba(30,${gv},15,0.65)`;
        wc.lineWidth   = 0.85;
        wc.stroke();
        // second blade slightly offset
        wc.beginPath();
        wc.moveTo(gx + 1.5, gy);
        wc.lineTo(gx + 1.5 - gt * gh * 0.7, gy - gh * 0.8);
        wc.strokeStyle = `rgba(35,${gv - 10},18,0.45)`;
        wc.stroke();
      }

      // Occasional small pebble/flower
      const spotCount = 2 + Math.floor(_sr(c, row, 80) * 3);
      for (let i = 0; i < spotCount; i++) {
        const sx = x + (_sr(c, row, i * 3 + 90) - 0.5) * r * 1.2;
        const sy = y + (_sr(c, row, i * 3 + 91) - 0.5) * r;
        wc.beginPath();
        wc.arc(sx, sy, r * 0.025, 0, Math.PI * 2);
        wc.fillStyle = `rgba(180,160,60,0.3)`;
        wc.fill();
      }
    },

    forest(wc, x, y, r, c, row, skipBase) {
      if (!skipBase) {
        const g = wc.createRadialGradient(x, y, r * 0.1, x, y + r * 0.2, r * 1.1);
        g.addColorStop(0, '#162414');
        g.addColorStop(1, '#070e06');
        wc.fillStyle = g;
        wc.fill();
      }

      // Ground texture
      const gnd = 3 + Math.floor(_sr(c, row, 100) * 4);
      for (let i = 0; i < gnd; i++) {
        const lx = x + (_sr(c, row, i * 4 + 100) - 0.5) * r * 1.4;
        const ly = y + (_sr(c, row, i * 4 + 101) - 0.5) * r * 1.1;
        wc.beginPath();
        wc.arc(lx, ly, r * (0.04 + _sr(c, row, i + 105) * 0.04), 0, Math.PI * 2);
        wc.fillStyle = 'rgba(8,22,6,0.5)';
        wc.fill();
      }

      // Tree crowns — sorted back to front
      const count = 5 + Math.floor(_sr(c, row, 0) * 4);
      const trees = [];
      for (let i = 0; i < count; i++) {
        trees.push({
          tx: x + (_sr(c, row, i * 6)     - 0.5) * r * 1.15,
          ty: y + (_sr(c, row, i * 6 + 1) - 0.5) * r * 0.85,
          tr: r * (0.17 + _sr(c, row, i * 6 + 2) * 0.15),
          gv: 32 + Math.floor(_sr(c, row, i * 6 + 3) * 48),
          lf: _sr(c, row, i * 6 + 4),
        });
      }
      trees.sort((a, b) => a.ty - b.ty);
      trees.forEach(({ tx, ty, tr, gv, lf }) => {
        // Drop shadow
        wc.beginPath();
        wc.arc(tx + tr * 0.18, ty + tr * 0.22, tr * 0.9, 0, Math.PI * 2);
        wc.fillStyle = 'rgba(0,0,0,0.22)';
        wc.fill();
        // Crown body
        wc.beginPath();
        wc.arc(tx, ty, tr, 0, Math.PI * 2);
        wc.fillStyle = `rgba(8,${gv},6,0.85)`;
        wc.fill();
        // Subtle highlight
        wc.beginPath();
        wc.arc(tx - tr * 0.22, ty - tr * 0.25, tr * 0.45, 0, Math.PI * 2);
        wc.fillStyle = `rgba(30,${Math.min(gv + 35, 120)},18,0.20)`;
        wc.fill();
        // Tiny secondary crown
        if (lf > 0.5) {
          wc.beginPath();
          wc.arc(tx + tr * 0.55, ty - tr * 0.4, tr * 0.45, 0, Math.PI * 2);
          wc.fillStyle = `rgba(10,${gv - 5},8,0.7)`;
          wc.fill();
        }
      });
    },

    mountain(wc, x, y, r, c, row, skipBase) {
      if (!skipBase) {
        const g = wc.createRadialGradient(x, y - r * 0.1, r * 0.05, x, y + r * 0.4, r * 1.15);
        g.addColorStop(0, '#4e4030');
        g.addColorStop(1, '#241e18');
        wc.fillStyle = g;
        wc.fill();
      }

      // Pebble scatter on base
      const pebbles = 6 + Math.floor(_sr(c, row, 200) * 6);
      for (let i = 0; i < pebbles; i++) {
        const px = x + (_sr(c, row, i * 4 + 200) - 0.5) * r * 1.4;
        const py = y + (_sr(c, row, i * 4 + 201) - 0.5) * r * 1.1;
        const pr = r * (0.022 + _sr(c, row, i * 4 + 202) * 0.025);
        const sh = 50 + Math.floor(_sr(c, row, i * 4 + 203) * 30);
        wc.beginPath();
        wc.arc(px, py, pr, 0, Math.PI * 2);
        wc.fillStyle = `rgba(${sh},${sh - 5},${sh - 10},0.5)`;
        wc.fill();
      }

      // Mountain peaks (back to front)
      const peakCount = 2 + Math.floor(_sr(c, row, 0) * 2);
      const peaks = [];
      for (let i = 0; i < peakCount; i++) {
        peaks.push({
          px: x + (_sr(c, row, i * 7)     - 0.5) * r * 0.75,
          py: y + _sr(c, row, i * 7 + 1)  * r * 0.5,
          h:  r * (0.50 + _sr(c, row, i * 7 + 2) * 0.42),
          w:  r * (0.30 + _sr(c, row, i * 7 + 3) * 0.22),
          sh: 55 + Math.floor(_sr(c, row, i * 7 + 4) * 38),
        });
      }
      peaks.sort((a, b) => a.py - b.py);
      peaks.forEach(({ px, py, h, w, sh }) => {
        // Shadow face (right)
        wc.beginPath();
        wc.moveTo(px - w, py);
        wc.lineTo(px + w * 0.08, py - h);
        wc.lineTo(px + w, py);
        wc.closePath();
        wc.fillStyle = `rgba(${sh - 18},${sh - 22},${sh - 22},0.72)`;
        wc.fill();
        // Lit face (left)
        wc.beginPath();
        wc.moveTo(px - w, py);
        wc.lineTo(px + w * 0.08, py - h);
        wc.lineTo(px - w * 0.08, py);
        wc.closePath();
        wc.fillStyle = `rgba(${sh + 22},${sh + 16},${sh + 10},0.38)`;
        wc.fill();
        // Snow cap
        if (h > r * 0.52) {
          const sf = h * 0.28;
          wc.beginPath();
          wc.moveTo(px - w * 0.25, py - h + sf);
          wc.lineTo(px + w * 0.08, py - h);
          wc.lineTo(px + w * 0.22, py - h + sf);
          wc.closePath();
          wc.fillStyle = 'rgba(228,235,250,0.60)';
          wc.fill();
          // Snow shadow line
          wc.beginPath();
          wc.moveTo(px - w * 0.25, py - h + sf);
          wc.lineTo(px + w * 0.08, py - h + sf * 0.1);
          wc.strokeStyle = 'rgba(150,165,185,0.22)';
          wc.lineWidth   = 0.7;
          wc.stroke();
        }
      });
    },

    desert(wc, x, y, r, c, row, skipBase) {
      if (!skipBase) {
        const g = wc.createRadialGradient(x, y - r * 0.1, r * 0.08, x, y + r * 0.3, r * 1.1);
        g.addColorStop(0, '#9a7c38');
        g.addColorStop(1, '#4e3a18');
        wc.fillStyle = g;
        wc.fill();
      }

      // Dune ripples
      const lineCount = 4 + Math.floor(_sr(c, row, 0) * 4);
      for (let i = 0; i < lineCount; i++) {
        const wy    = y - r * 0.55 + (i / (lineCount - 1)) * r * 1.1;
        const off   = (_sr(c, row, i + 8)  - 0.5) * r * 0.18;
        const bulge = r * (0.045 + _sr(c, row, i + 15) * 0.05);
        const cx2   = x + (_sr(c, row, i + 20) - 0.5) * r * 0.35;
        wc.beginPath();
        wc.moveTo(x - r * 0.78, wy + off);
        wc.quadraticCurveTo(cx2, wy + off - bulge, x + r * 0.78, wy + off);
        wc.strokeStyle = `rgba(210,170,65,${0.14 + _sr(c, row, i + 25) * 0.10})`;
        wc.lineWidth   = 0.85 + _sr(c, row, i + 30) * 0.55;
        wc.stroke();
      }

      // Wind erosion marks (diagonal scratches)
      const scratches = 3 + Math.floor(_sr(c, row, 60) * 3);
      for (let i = 0; i < scratches; i++) {
        const sx  = x + (_sr(c, row, i * 4 + 60) - 0.5) * r * 1.2;
        const sy  = y + (_sr(c, row, i * 4 + 61) - 0.5) * r * 0.9;
        const sl  = r * (0.08 + _sr(c, row, i * 4 + 62) * 0.10);
        wc.beginPath();
        wc.moveTo(sx, sy);
        wc.lineTo(sx + sl, sy + sl * 0.3);
        wc.strokeStyle = `rgba(240,195,80,${0.10 + _sr(c, row, i * 4 + 63) * 0.08})`;
        wc.lineWidth   = 0.6;
        wc.stroke();
      }
    },
  };

  // ── Bake all terrain hexes to a single offscreen canvas ─
  // No hex borders on the terrain layer — the grid appears only as
  // a gameplay overlay (zones, reachable, selection) in draw().
  function _buildWorldCanvas() {
    const worldW = Math.ceil((42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 4) * scale);
    const worldH = Math.ceil((44 + (ROWS - 0.5) * HEX_H + HEX_H * 2) * scale);

    if (!_worldCanvas) _worldCanvas = document.createElement('canvas');
    _worldCanvas.width  = worldW;
    _worldCanvas.height = worldH;

    const wc = _worldCanvas.getContext('2d');
    wc.clearRect(0, 0, worldW, worldH);

    const r = HEX_R * scale;

    // Pass A: base terrain fills — slightly LARGER than hex so adjacent tiles
    // share edges without gaps (seamless terrain regions).
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t        = TERRAIN_MAP[row][col];
        const { x, y } = hexCenter(col, row, scale);
        const fn       = _terrain[t];
        if (!fn) continue;

        wc.save();
        _hexPath(wc, x, y, r + 0.8);   // slight overdraw, no gap between tiles
        wc.clip();
        fn(wc, x, y, r, col, row);
        wc.restore();
      }
    }

    // Pass B: redraw ONLY the texture detail elements (not the base gradient)
    // with a wider clip so trees, grass, peaks bleed into neighbours.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t        = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);

        wc.save();
        _hexPath(wc, x, y, r + 4.5);
        wc.clip();
        _terrain[t]?.(wc, x, y, r, col, row, true); // true = skip base fill
        wc.restore();
      }
    }

    _worldDirty = false;
  }

  // ── Main draw ──────────────────────────────
  function draw(state) {
    lastDrawState = state;
    const { selectedUnit, selectedGroup, reachable } = state;
    const units   = Units.getAll();
    const cities  = Cities.getAll();
    const zones   = GameMap.getZones(units);
    const r       = HEX_R * scale;

    const reachSet = new Set(reachable.map(h => hexKey(h.c, h.r)));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Viewport culling bounds (world coords)
    const vx0 = camera.x - r * 2, vx1 = camera.x + canvas.width  + r * 2;
    const vy0 = camera.y - r * 2, vy1 = camera.y + canvas.height + r * 2;

    // ── Pass 1: Terrain (from pre-baked cache) ──
    if (_worldDirty) _buildWorldCanvas();
    if (_worldCanvas) ctx.drawImage(_worldCanvas, 0, 0);

    // ── Pass 2: Hex gameplay overlay ─────────────────────────────────────
    // The hex grid is INVISIBLE on the base map. It only appears here
    // to convey gameplay information: control zones and movement range.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        const k      = hexKey(col, row);
        const inP    = zones.player.has(k);
        const inE    = zones.enemy.has(k);
        const reach  = reachSet.has(k);

        if (!inP && !inE && !reach) continue;   // skip — nothing to show

        ctx.save();
        _hexPath(ctx, x, y, r - 0.5);

        if (reach) {
          // Reachable: solid tinted fill + bright border
          ctx.fillStyle   = 'rgba(74,158,255,0.18)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(140,205,255,0.90)';
          ctx.lineWidth   = 1.6 * scale;
          ctx.stroke();
          // Inner highlight ring
          _hexPath(ctx, x, y, r - 3.5);
          ctx.strokeStyle = 'rgba(200,235,255,0.28)';
          ctx.lineWidth   = 1 * scale;
          ctx.stroke();
        } else if (inP && !inE) {
          ctx.fillStyle   = 'rgba(74,158,255,0.11)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(74,158,255,0.38)';
          ctx.lineWidth   = 1.2 * scale;
          ctx.stroke();
        } else if (inE && !inP) {
          ctx.fillStyle   = 'rgba(255,80,80,0.11)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,80,80,0.35)';
          ctx.lineWidth   = 1.2 * scale;
          ctx.stroke();
        } else {
          // Contested
          ctx.fillStyle   = 'rgba(220,200,0,0.09)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(220,200,0,0.32)';
          ctx.lineWidth   = 1.2 * scale;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // ── Pass 3: Resources ──
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const res = GameMap.getResource(col, row);
        if (!res) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        const rdef = RESOURCE_DEF[res];

        // Background token
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y + r * 0.05, r * 0.30, 0, Math.PI * 2);
        const bg = ctx.createRadialGradient(x, y - r * 0.08, r * 0.04, x, y + r * 0.10, r * 0.32);
        bg.addColorStop(0, 'rgba(30,22,8,0.82)');
        bg.addColorStop(1, 'rgba(10,8,2,0.88)');
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.strokeStyle = rdef.color + '88';
        ctx.lineWidth   = 1 * scale;
        ctx.stroke();
        ctx.restore();

        // Resource emoji
        ctx.save();
        ctx.font         = `${Math.round(r * 0.38)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha  = 0.92;
        ctx.fillText(rdef.icon, x, y + r * 0.05);
        ctx.restore();

        // Capture dot
        const capturedBy = GameMap.getCapturedBy(col, row);
        if (capturedBy) {
          const dotX = x + r * 0.24;
          const dotY = y - r * 0.22;
          ctx.save();
          ctx.beginPath();
          ctx.arc(dotX, dotY, 4.5 * scale, 0, Math.PI * 2);
          ctx.fillStyle   = capturedBy === 'player' ? '#4a9eff' : '#ff5050';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth   = 1.2 * scale;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── Pass 4: Cities ──
    cities.forEach(ci => {
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const ownerColor = ci.owner === 'player' ? '#4a9eff'
                       : ci.owner === 'enemy'  ? '#ff5050' : '#ffe066';

      // Outer glow ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.60, 0, Math.PI * 2);
      ctx.fillStyle   = `${ownerColor}18`;
      ctx.fill();
      ctx.strokeStyle = `${ownerColor}55`;
      ctx.lineWidth   = 2.5 * scale;
      ctx.stroke();
      ctx.restore();

      // Inner shadow disk
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + 2 * scale, r * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.restore();

      // City disk
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.46, 0, Math.PI * 2);
      const cg = ctx.createRadialGradient(x - r*0.1, y - r*0.1, r*0.02, x, y, r*0.48);
      cg.addColorStop(0, '#2a2016');
      cg.addColorStop(1, '#0e0c08');
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth   = 1.8 * scale;
      ctx.stroke();
      ctx.restore();

      // Castle emoji
      ctx.save();
      ctx.font         = `${Math.round(r * 0.46)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4 * scale;
      ctx.fillText('🏰', x, y - r * 0.04);
      ctx.restore();

      // City name label
      ctx.save();
      ctx.font         = `bold ${Math.round(8.5 * scale)}px var(--font, sans-serif)`;
      ctx.fillStyle    = ownerColor;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur   = 5 * scale;
      ctx.fillText(ci.name, x, y + r * 0.52);
      ctx.restore();
    });

    // ── Pass 5: Units ──
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

      const isSelected = selectedUnit && stack.some(su => su.id === selectedUnit.id);
      const isInGroup  = selectedGroup && stack.some(su => selectedGroup.includes(su.id));
      const isPlayer   = u.owner === 'player';
      const def        = UNIT_TYPES[u.type];
      const col        = isPlayer ? '#4a9eff' : '#ff5050';
      const exhausted  = stack.every(su => su.moves === 0);

      // Group ring
      if (isInGroup) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80,220,120,0.85)';
        ctx.lineWidth   = 2.5 * scale;
        ctx.stroke();
        ctx.restore();
      }

      // Selection ring (dashed)
      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.54, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth   = 2 * scale;
        ctx.setLineDash([4 * scale, 3 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Drop shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 1.5 * scale, y + 2.5 * scale, r * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.restore();

      // Unit disk with gradient
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.36, 0, Math.PI * 2);
      const ug = ctx.createRadialGradient(x - r*0.1, y - r*0.1, r*0.02, x, y, r*0.38);
      const baseCol = exhausted ? '#3a3a3a' : col;
      ug.addColorStop(0, exhausted ? '#555' : isPlayer ? '#6ab4ff' : '#ff8080');
      ug.addColorStop(1, baseCol);
      ctx.fillStyle   = ug;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth   = (isSelected ? 2 : 1.5) * scale;
      ctx.stroke();
      ctx.restore();

      // Unit emoji
      ctx.save();
      ctx.font         = `${Math.round(r * 0.34)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.7)';
      ctx.shadowBlur   = 2;
      ctx.fillText(def.icon, x, y + 1);
      ctx.restore();

      // HP bar
      const barW = r * 0.68, barH = 3.5 * scale;
      const barX = x - barW / 2, barY = y + r * 0.44;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(barX, barY, barW, barH);
      const hpRatio = u.hp / u.maxHp;
      ctx.fillStyle = hpRatio > 0.6 ? '#4aaa44' : hpRatio > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      // Move pips
      for (let i = 0; i < u.maxMoves; i++) {
        const px = x - ((u.maxMoves - 1) * 5 * scale) / 2 + i * 5 * scale;
        ctx.beginPath();
        ctx.arc(px, y + r * 0.60, 2.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = i < u.moves ? col : 'rgba(100,100,100,0.45)';
        ctx.fill();
      }

      // Stack count badge
      if (stack.length > 1) {
        const bx = x + r * 0.26, by = y - r * 0.26;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r * 0.20, 0, Math.PI * 2);
        ctx.fillStyle   = col;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth   = 1 * scale;
        ctx.stroke();
        ctx.font         = `bold ${Math.round(r * 0.22)}px sans-serif`;
        ctx.fillStyle    = '#fff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stack.length, bx, by);
        ctx.restore();
      }
    });

    ctx.restore(); // end camera transform

    _drawPanHint();
  }

  function _drawPanHint() {
    const worldW = (42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 3) * scale;
    const worldH = (44 + (ROWS - 0.5) * HEX_H + HEX_H * 1.5) * scale;
    if (!(worldW > canvas.width || worldH > canvas.height)) return;
    ctx.save();
    ctx.font         = `${Math.round(11 * scale)}px monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.28)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('↑↓←→ para navegar', canvas.width - 8, canvas.height - 6);
    ctx.restore();
  }

  return { init, draw, resize, getScale, getCamera, setPanFlag, markTerrainDirty };
})();
