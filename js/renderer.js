// =============================================
//  renderer.js  —  Total War campaign-map style
//  Two layers:
//    1. _worldCanvas (static): ocean + terrain fills + diagonal hatching
//    2. draw() (per-frame):    hex overlay (zones/reach) + cities + units
// =============================================

const Renderer = (() => {
  let canvas, ctx, scale;
  let camera        = { x: 0, y: 0 };
  let panFlags      = { left: false, right: false, up: false, down: false };
  let panRafId      = null;
  let lastDrawState = null;
  const PAN_SPEED   = 10;

  let _worldCanvas  = null;
  let _worldDirty   = true;

  // ── Terrain palette (TW campaign map colours) ──
  const TPAL = {
    water:    { base: '#0a2030' },
    plains:   { base: '#6b7840', mid: '#7e8f4a', lite: '#96aa55', stripe: 'rgba(180,200,100,0.13)' },
    forest:   { base: '#253b1a', mid: '#2e4e20', lite: '#3a6328', stripe: 'rgba(80,140,50,0.16)'   },
    mountain: { base: '#4a3e2e', mid: '#5a4c38', lite: '#7a6650', stripe: 'rgba(180,155,110,0.14)' },
    desert:   { base: '#6e5822', mid: '#8a7030', lite: '#aa9040', stripe: 'rgba(220,185,70,0.16)'  },
  };

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
    scale         = 1.0;
    _worldDirty   = true;
    _patternCache = {};
    clampCamera();
  }

  function getScale()  { return scale; }
  function getCamera() { return { x: camera.x, y: camera.y }; }
  function markTerrainDirty() { _worldDirty = true; _patternCache = {}; }

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

  // ── Hex path helper ─────────────────────────
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

  // ── Diagonal stripe pattern (TW campaign style) ─
  let _patternCache = {};

  function _stripePattern(ctx2, key, lineColor, spacing, lineW) {
    if (_patternCache[key]) return _patternCache[key];
    const sp = spacing || 7;
    const lw = lineW   || 1.4;
    const c  = document.createElement('canvas');
    c.width  = sp * 2;
    c.height = sp * 2;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, sp * 2, sp * 2);
    cx.strokeStyle = lineColor;
    cx.lineWidth   = lw;
    cx.lineCap     = 'square';
    // 45° lines tiling seamlessly in a 2s×2s tile
    for (let i = -sp * 2; i < sp * 4; i += sp) {
      cx.beginPath();
      cx.moveTo(i,        0);
      cx.lineTo(i + sp * 2, sp * 2);
      cx.stroke();
    }
    _patternCache[key] = ctx2.createPattern(c, 'repeat');
    return _patternCache[key];
  }

  // ── Seeded pseudo-random ─────────────────────
  function _sr(c, r, s) {
    const v = Math.sin(c * 374761 + r * 1234567 + (s || 0) * 999983) * 43758.5453;
    return v - Math.floor(v);
  }

  // ── WORLD CANVAS BUILD ───────────────────────
  function _buildWorldCanvas() {
    const worldW = Math.ceil((42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 4) * scale);
    const worldH = Math.ceil((44 + (ROWS - 0.5) * HEX_H + HEX_H * 2) * scale);

    if (!_worldCanvas) _worldCanvas = document.createElement('canvas');
    _worldCanvas.width  = worldW;
    _worldCanvas.height = worldH;

    const wc = _worldCanvas.getContext('2d');
    wc.clearRect(0, 0, worldW, worldH);

    const r = HEX_R * scale;

    // ── Ocean background ───────────────────────
    // Deep teal fill + subtle horizontal wave lines (TW ocean feel)
    const oceanGrad = wc.createLinearGradient(0, 0, 0, worldH);
    oceanGrad.addColorStop(0,   '#0f2840');
    oceanGrad.addColorStop(0.5, '#0a2035');
    oceanGrad.addColorStop(1,   '#07182a');
    wc.fillStyle = oceanGrad;
    wc.fillRect(0, 0, worldW, worldH);

    // Wave lines over the ocean
    wc.save();
    for (let wy = 18; wy < worldH; wy += 28) {
      wc.beginPath();
      for (let wx = 0; wx <= worldW; wx += 6) {
        const y = wy + Math.sin(wx * 0.04) * 3;
        wx === 0 ? wc.moveTo(wx, y) : wc.lineTo(wx, y);
      }
      wc.strokeStyle = 'rgba(255,255,255,0.025)';
      wc.lineWidth   = 1;
      wc.stroke();
    }
    wc.restore();

    // ── Land hexes ─────────────────────────────
    // Pass 1: solid base fill (slightly larger than hex = no gaps)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const p        = TPAL[t];
        const { x, y } = hexCenter(col, row, scale);

        wc.save();
        _hexPath(wc, x, y, r + 0.8);
        wc.clip();

        // Subtle micro-variation in shade per hex
        const v   = _sr(col, row, 0);
        const lit = Math.floor(v * 12 - 6);
        const g   = wc.createRadialGradient(
          x - r * 0.2, y - r * 0.25, r * 0.05,
          x + r * 0.15, y + r * 0.25, r * 1.1
        );
        g.addColorStop(0, _shiftL(p.lite, lit));
        g.addColorStop(0.55, _shiftL(p.mid, lit));
        g.addColorStop(1,    _shiftL(p.base, lit - 4));
        wc.fillStyle = g;
        wc.fill();

        wc.restore();
      }
    }

    // Pass 2: diagonal stripe overlay (the TW "map texture" look)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const p        = TPAL[t];
        const { x, y } = hexCenter(col, row, scale);

        wc.save();
        _hexPath(wc, x, y, r + 0.8);
        wc.clip();

        const pat = _stripePattern(wc, `stripe_${t}`, p.stripe, 7, 1.3);
        if (pat) { wc.fillStyle = pat; wc.fill(); }

        wc.restore();
      }
    }

    // Pass 3: terrain detail elements (contained to each hex)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);
        wc.save();
        _hexPath(wc, x, y, r - 1);
        wc.clip();
        _drawDetail(wc, t, x, y, r, col, row);
        wc.restore();
      }
    }

    // Pass 4: coastline — thin bright border ONLY where land meets water
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);
        const isCoast   = neighbors(col, row).some(n => TERRAIN_MAP[n.r]?.[n.c] === 'water');
        if (!isCoast) continue;

        _hexPath(wc, x, y, r - 0.5);
        wc.strokeStyle = 'rgba(200,185,130,0.30)';
        wc.lineWidth   = 1.5;
        wc.stroke();
      }
    }

    // Pass 5: interior land-to-land terrain borders (subtle)
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;
        const { x, y } = hexCenter(col, row, scale);
        const hasDiff   = neighbors(col, row).some(n => {
          const nt = TERRAIN_MAP[n.r]?.[n.c];
          return nt && nt !== 'water' && nt !== t;
        });
        if (!hasDiff) continue;

        _hexPath(wc, x, y, r - 0.5);
        wc.strokeStyle = 'rgba(0,0,0,0.18)';
        wc.lineWidth   = 0.8;
        wc.stroke();
      }
    }

    _worldDirty = false;
  }

  // ── Terrain detail elements ──────────────────
  function _drawDetail(wc, terrain, x, y, r, col, row) {
    if (terrain === 'forest') {
      // A few simple tree crowns
      const n = 4 + Math.floor(_sr(col, row, 0) * 3);
      for (let i = 0; i < n; i++) {
        const tx = x + (_sr(col, row, i * 4 + 1) - 0.5) * r * 1.1;
        const ty = y + (_sr(col, row, i * 4 + 2) - 0.5) * r * 0.8;
        const tr = r * (0.13 + _sr(col, row, i * 4 + 3) * 0.10);
        const gv = 28 + Math.floor(_sr(col, row, i * 4 + 4) * 36);
        wc.beginPath();
        wc.arc(tx, ty + tr * 0.12, tr, 0, Math.PI * 2);
        wc.fillStyle = `rgba(10,${gv},6,0.60)`;
        wc.fill();
      }
    } else if (terrain === 'mountain') {
      // Simple peak silhouettes
      const n = 2 + Math.floor(_sr(col, row, 0) * 2);
      for (let i = 0; i < n; i++) {
        const mx = x + (_sr(col, row, i * 5 + 1) - 0.5) * r * 0.7;
        const my = y + _sr(col, row, i * 5 + 2)          * r * 0.4;
        const mh = r * (0.40 + _sr(col, row, i * 5 + 3) * 0.35);
        const mw = r * (0.28 + _sr(col, row, i * 5 + 4) * 0.18);
        const sh = 60 + Math.floor(_sr(col, row, i * 5 + 5) * 30);
        wc.beginPath();
        wc.moveTo(mx - mw, my); wc.lineTo(mx, my - mh); wc.lineTo(mx + mw, my);
        wc.closePath();
        wc.fillStyle = `rgba(${sh},${sh - 6},${sh - 12},0.55)`;
        wc.fill();
        if (mh > r * 0.45) {
          const sf = mh * 0.28;
          wc.beginPath();
          wc.moveTo(mx - mw * 0.22, my - mh + sf);
          wc.lineTo(mx, my - mh);
          wc.lineTo(mx + mw * 0.22, my - mh + sf);
          wc.closePath();
          wc.fillStyle = 'rgba(230,235,250,0.50)';
          wc.fill();
        }
      }
    } else if (terrain === 'desert') {
      // Light dune ripple lines
      const n = 3 + Math.floor(_sr(col, row, 0) * 3);
      for (let i = 0; i < n; i++) {
        const dy = y - r * 0.45 + (i / (n - 1)) * r * 0.9;
        wc.beginPath();
        wc.moveTo(x - r * 0.70, dy);
        wc.quadraticCurveTo(x, dy - r * 0.05, x + r * 0.70, dy);
        wc.strokeStyle = `rgba(220,185,60,0.14)`;
        wc.lineWidth   = 0.9;
        wc.stroke();
      }
    }
    // plains: no extra detail (stripes + gradient are enough)
  }

  // ── Colour helpers ───────────────────────────
  function _shiftL(hex, amt) {
    // Very naive lightness shift on hex colour
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.max(0, r + amt));
    g = Math.min(255, Math.max(0, g + amt));
    b = Math.min(255, Math.max(0, b + amt));
    return `rgb(${r},${g},${b})`;
  }

  // ── MAIN DRAW (per frame) ────────────────────
  function draw(state) {
    lastDrawState = state;
    const { selectedUnit, selectedGroup, reachable } = state;
    const units    = Units.getAll();
    const cities   = Cities.getAll();
    const zones    = GameMap.getZones(units);
    const r        = HEX_R * scale;
    const reachSet = new Set(reachable.map(h => hexKey(h.c, h.r)));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Viewport culling bounds
    const vx0 = camera.x - r * 2, vx1 = camera.x + canvas.width  + r * 2;
    const vy0 = camera.y - r * 2, vy1 = camera.y + canvas.height + r * 2;

    // ── 1. Terrain world (baked) ───────────────
    if (_worldDirty) _buildWorldCanvas();
    if (_worldCanvas) ctx.drawImage(_worldCanvas, 0, 0);

    // ── 2. Faction territory stripes ──────────
    // Player and enemy-controlled hexes get a coloured diagonal stripe overlay,
    // exactly like TW campaign map province colours.
    const playerStripe = _stripePattern(ctx, 'ov_player', 'rgba(74,158,255,0.28)', 9, 1.8);
    const enemyStripe  = _stripePattern(ctx, 'ov_enemy',  'rgba(220,60,60,0.28)',  9, 1.8);
    const contestStripe= _stripePattern(ctx, 'ov_contest','rgba(220,195,0,0.22)',  9, 1.8);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        const t = TERRAIN_MAP[row][col];
        if (t === 'water') continue;

        const k   = hexKey(col, row);
        const inP = zones.player.has(k);
        const inE = zones.enemy.has(k);
        if (!inP && !inE) continue;

        let pat = null, borderCol = null;
        if      (inP && !inE) { pat = playerStripe; borderCol = 'rgba(74,158,255,0.45)';  }
        else if (inE && !inP) { pat = enemyStripe;  borderCol = 'rgba(220,60,60,0.42)';   }
        else                  { pat = contestStripe; borderCol = 'rgba(220,195,0,0.40)';  }

        ctx.save();
        _hexPath(ctx, x, y, r - 0.5);
        ctx.clip();
        if (pat) { ctx.fillStyle = pat; ctx.fill(); }
        ctx.restore();

        // Border line for the territory
        _hexPath(ctx, x, y, r - 0.5);
        ctx.strokeStyle = borderCol;
        ctx.lineWidth   = 1.5 * scale;
        ctx.stroke();
      }
    }

    // ── 3. Reachable hex overlay ───────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (!reachSet.has(hexKey(col, row))) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        ctx.save();
        _hexPath(ctx, x, y, r - 0.5);
        ctx.fillStyle = 'rgba(74,158,255,0.20)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(160,215,255,0.92)';
        ctx.lineWidth   = 1.8 * scale;
        ctx.stroke();
        // Inner glow ring
        _hexPath(ctx, x, y, r - 4);
        ctx.strokeStyle = 'rgba(200,235,255,0.30)';
        ctx.lineWidth   = 1.2 * scale;
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── 4. Resources ──────────────────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const res = GameMap.getResource(col, row);
        if (!res) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        const rdef = RESOURCE_DEF[res];
        ctx.save();
        // Token circle
        ctx.beginPath();
        ctx.arc(x, y + r * 0.04, r * 0.27, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15,10,4,0.78)';
        ctx.fill();
        ctx.strokeStyle = rdef.color + '99';
        ctx.lineWidth   = 1.2 * scale;
        ctx.stroke();
        // Icon
        ctx.font         = `${Math.round(r * 0.34)}px serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha  = 0.90;
        ctx.fillText(rdef.icon, x, y + r * 0.04);
        ctx.restore();

        // Capture dot
        const cap = GameMap.getCapturedBy(col, row);
        if (cap) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x + r * 0.22, y - r * 0.20, 4.5 * scale, 0, Math.PI * 2);
          ctx.fillStyle   = cap === 'player' ? '#4a9eff' : '#ff5050';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth   = 1.2 * scale;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── 5. Cities ─────────────────────────────
    cities.forEach(ci => {
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const ownerCol = ci.owner === 'player' ? '#4a9eff'
                     : ci.owner === 'enemy'  ? '#e04040' : '#ddb030';

      // Outer glow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = ownerCol + '20';
      ctx.fill();
      ctx.strokeStyle = ownerCol + '55';
      ctx.lineWidth   = 2.2 * scale;
      ctx.stroke();
      ctx.restore();

      // Drop shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 2 * scale, y + 3 * scale, r * 0.42, 0, Math.PI * 2);
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
      ctx.lineWidth   = 1.8 * scale;
      ctx.stroke();
      ctx.restore();

      // Castle icon
      ctx.save();
      ctx.font         = `${Math.round(r * 0.40)}px serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4 * scale;
      ctx.fillText('🏰', x, y - r * 0.02);
      ctx.restore();

      // City name
      ctx.save();
      ctx.font         = `bold ${Math.round(8.5 * scale)}px var(--font, sans-serif)`;
      ctx.fillStyle    = ownerCol;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur   = 5 * scale;
      ctx.fillText(ci.name, x, y + r * 0.48);
      ctx.restore();
    });

    // ── 6. Units ──────────────────────────────
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
        ctx.lineWidth   = 2.5 * scale;
        ctx.stroke();
        ctx.restore();
      }
      if (isSelected) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.54, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.80)';
        ctx.lineWidth   = 2 * scale;
        ctx.setLineDash([4 * scale, 3 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 1.5 * scale, y + 2.5 * scale, r * 0.34, 0, Math.PI * 2);
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
      ctx.lineWidth   = (isSelected ? 2 : 1.5) * scale;
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
      const bw = r * 0.64, bh = 3 * scale, bx = x - bw / 2, by = y + r * 0.42;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx, by, bw, bh);
      const hp = u.hp / u.maxHp;
      ctx.fillStyle = hp > 0.6 ? '#4aaa44' : hp > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(bx, by, bw * hp, bh);

      // Move pips
      for (let i = 0; i < u.maxMoves; i++) {
        const px = x - ((u.maxMoves - 1) * 5 * scale) / 2 + i * 5 * scale;
        ctx.beginPath();
        ctx.arc(px, y + r * 0.58, 2.5 * scale, 0, Math.PI * 2);
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
        ctx.lineWidth   = 1 * scale;
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
    const worldW = (42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 3) * scale;
    const worldH = (44 + (ROWS - 0.5) * HEX_H + HEX_H * 1.5) * scale;
    if (!(worldW > canvas.width || worldH > canvas.height)) return;
    ctx.save();
    ctx.font         = `${Math.round(11 * scale)}px monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('↑↓←→ para navegar', canvas.width - 8, canvas.height - 6);
    ctx.restore();
  }

  return { init, draw, resize, getScale, getCamera, setPanFlag, markTerrainDirty };
})();
