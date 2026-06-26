// =============================================
//  renderer.js — canvas draw calls
// =============================================

const Renderer = (() => {
  let canvas, ctx, scale;
  let camera       = { x: 0, y: 0 };
  let panFlags     = { left: false, right: false, up: false, down: false };
  let panRafId     = null;
  let lastDrawState = null;
  const PAN_SPEED  = 10; // px per animation frame

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

  // Called by game.js on keydown/keyup for arrow keys
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
      if (moved) {
        clampCamera();
        if (lastDrawState) draw(lastDrawState);
      }
      const any = panFlags.left || panFlags.right || panFlags.up || panFlags.down;
      panRafId = any ? requestAnimationFrame(loop) : null;
    }
    panRafId = requestAnimationFrame(loop);
  }

  // ── Main draw ──────────────────────────────
  function draw(state) {
    lastDrawState = state;
    const { selectedUnit, selectedGroup, reachable } = state;
    const units  = Units.getAll();
    const cities = Cities.getAll();
    const zones  = GameMap.getZones(units);
    const r      = HEX_R * scale;

    // Build reachable set for fast lookup
    const reachSet = new Set(reachable.map(h => hexKey(h.c, h.r)));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Viewport culling bounds (world coords)
    const vx0 = camera.x - r * 2, vx1 = camera.x + canvas.width  + r * 2;
    const vy0 = camera.y - r * 2, vy1 = camera.y + canvas.height + r * 2;

    // ── Pass 1: terrain + zone overlays
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        const t   = TERRAIN_MAP[row][col];
        const def = TERRAIN_DEF[t];
        const k   = hexKey(col, row);

        drawHex(ctx, x, y, r - 1, def.color, def.border, 0.8 * scale);

        const inP = zones.player.has(k);
        const inE = zones.enemy.has(k);
        if (inP && !inE) drawHex(ctx, x, y, r - 1, 'rgba(74,158,255,0.18)', 'rgba(74,158,255,0.55)', 1.2 * scale);
        else if (inE && !inP) drawHex(ctx, x, y, r - 1, 'rgba(255,80,80,0.18)', 'rgba(255,80,80,0.5)', 1.2 * scale);
        else if (inP && inE)  drawHex(ctx, x, y, r - 1, 'rgba(220,200,0,0.15)', 'rgba(220,200,0,0.45)', 1.2 * scale);

        if (reachSet.has(k)) {
          drawHex(ctx, x, y, r - 1, 'rgba(74,158,255,0.32)', 'rgba(120,190,255,0.9)', 1.5 * scale);
        }
      }
    }

    // ── Pass 2: resources
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const res = GameMap.getResource(col, row);
        if (!res) continue;
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;

        drawText(RESOURCE_DEF[res].icon, x, y + r * 0.05, r * 0.52, 'center', 'middle', '', 0.85);

        const capturedBy = GameMap.getCapturedBy(col, row);
        if (capturedBy) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x + r * 0.38, y - r * 0.28, 4 * scale, 0, Math.PI * 2);
          ctx.fillStyle   = capturedBy === 'player' ? '#4a9eff' : '#ff5050';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth   = 1 * scale;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // ── Pass 3: grid labels
    ctx.save();
    ctx.font         = `${Math.round(7 * scale)}px monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = hexCenter(col, row, scale);
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        ctx.fillText(String.fromCharCode(65 + col) + (row + 1), x, y + r * 0.9);
      }
    }
    ctx.restore();

    // ── Pass 4: cities
    cities.forEach(ci => {
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) return;

      const ownerColor = ci.owner === 'player' ? '#4a9eff' : ci.owner === 'enemy' ? '#ff5050' : '#ffe066';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(0,0,0,0.4)';
      ctx.fill();
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth   = 1.5 * scale;
      ctx.stroke();
      drawText('🏰', x, y - r * 0.12, r * 0.58, 'center', 'middle');
      ctx.save();
      ctx.font         = `bold ${Math.round(8.5 * scale)}px var(--font, sans-serif)`;
      ctx.fillStyle    = ownerColor;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4 * scale;
      ctx.fillText(ci.name, x, y + r * 0.5);
      ctx.restore();
    });

    // ── Pass 5: units (grouped per hex to support stacking)
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
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = 2 * scale;
        ctx.setLineDash([4 * scale, 3 * scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + 2 * scale, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle   = exhausted ? '#3a3a3a' : col;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth   = (isSelected ? 2 : 1.5) * scale;
      ctx.stroke();

      drawText(def.icon, x, y + 1, r * 0.38, 'center', 'middle');

      const barW = r * 0.7, barH = 3.5 * scale;
      const barX = x - barW / 2, barY = y + r * 0.46;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      const hpRatio = u.hp / u.maxHp;
      ctx.fillStyle = hpRatio > 0.6 ? '#4aaa44' : hpRatio > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      for (let i = 0; i < u.maxMoves; i++) {
        const px = x - ((u.maxMoves - 1) * 5 * scale) / 2 + i * 5 * scale;
        ctx.beginPath();
        ctx.arc(px, y + r * 0.6, 2.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = i < u.moves ? col : 'rgba(100,100,100,0.5)';
        ctx.fill();
      }

      if (stack.length > 1) {
        const bx = x + r * 0.28, by = y - r * 0.28;
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle   = col;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth   = 1 * scale;
        ctx.stroke();
        ctx.font         = `bold ${Math.round(r * 0.24)}px sans-serif`;
        ctx.fillStyle    = '#fff';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stack.length, bx, by);
        ctx.restore();
      }
    });

    ctx.restore(); // end camera transform

    // ── HUD overlay: pan hint (screen-space, outside camera transform)
    _drawPanHint();
  }

  function _drawPanHint() {
    const worldW = (42 + (COLS - 1) * HEX_R * 1.74 + HEX_R * 3) * scale;
    const worldH = (44 + (ROWS - 0.5) * HEX_H + HEX_H * 1.5) * scale;
    const canPan = worldW > canvas.width || worldH > canvas.height;
    if (!canPan) return;

    ctx.save();
    ctx.font         = `${Math.round(11 * scale)}px monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.30)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('↑↓←→ para navegar', canvas.width - 8, canvas.height - 6);
    ctx.restore();
  }

  function drawText(text, x, y, size, align, baseline, color = '', alpha = 1) {
    ctx.save();
    ctx.font         = `${Math.round(size)}px serif`;
    ctx.textAlign    = align || 'center';
    ctx.textBaseline = baseline || 'middle';
    ctx.globalAlpha  = alpha;
    if (color) ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  return { init, draw, resize, getScale, getCamera, setPanFlag };
})();
