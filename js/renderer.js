// =============================================
//  renderer.js — canvas draw calls
// =============================================

const Renderer = (() => {
  let canvas, ctx, scale;

  function init(c) {
    canvas = c;
    ctx    = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const wrap = document.getElementById('map-wrap');
    const W    = wrap.clientWidth  || 680;
    const H    = wrap.clientHeight || 480;
    scale      = Math.min(W / 680, H / 480, 1.4);
    canvas.width  = Math.round(680 * scale);
    canvas.height = Math.round(480 * scale);
  }

  function getScale() { return scale; }

  // ── Main draw ──────────────────────────────
  function draw(state) {
    const { selectedUnit, selectedGroup, reachable } = state;
    const units  = Units.getAll();
    const cities = Cities.getAll();
    const zones  = GameMap.getZones(units);
    const r      = HEX_R * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Pass 1: terrain + zone overlays
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t   = TERRAIN_MAP[row][col];
        const def = TERRAIN_DEF[t];
        const { x, y } = hexCenter(col, row, scale);
        const k   = hexKey(col, row);

        drawHex(ctx, x, y, r - 1, def.color, def.border, 0.8 * scale);

        // Control zones
        const inP = zones.player.has(k);
        const inE = zones.enemy.has(k);
        if (inP && !inE) drawHex(ctx, x, y, r - 1, 'rgba(74,158,255,0.18)', 'rgba(74,158,255,0.55)', 1.2 * scale);
        else if (inE && !inP) drawHex(ctx, x, y, r - 1, 'rgba(255,80,80,0.18)', 'rgba(255,80,80,0.5)', 1.2 * scale);
        else if (inP && inE)  drawHex(ctx, x, y, r - 1, 'rgba(220,200,0,0.15)', 'rgba(220,200,0,0.45)', 1.2 * scale);

        // Reachable highlight
        if (reachable.some(h => h.c === col && h.r === row)) {
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
        drawText(RESOURCE_DEF[res].icon, x, y + r * 0.05, r * 0.52, 'center', 'middle', '', 0.85);
      }
    }

    // ── Pass 3: grid labels
    ctx.save();
    ctx.font      = `${Math.round(7 * scale)}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = hexCenter(col, row, scale);
        ctx.fillText(String.fromCharCode(65 + col) + (row + 1), x, y + r * 0.9);
      }
    }
    ctx.restore();

    // ── Pass 4: cities
    cities.forEach(ci => {
      const { x, y } = hexCenter(ci.c, ci.r, scale);
      const ownerColor = ci.owner === 'player' ? '#4a9eff' : ci.owner === 'enemy' ? '#ff5050' : '#ffe066';
      // City ring
      ctx.beginPath();
      ctx.arc(x, y, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(0,0,0,0.4)';
      ctx.fill();
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth   = 1.5 * scale;
      ctx.stroke();
      // Icon
      drawText('🏰', x, y - r * 0.12, r * 0.58, 'center', 'middle');
      // Name
      ctx.save();
      ctx.font      = `bold ${Math.round(8.5 * scale)}px var(--font, sans-serif)`;
      ctx.fillStyle = ownerColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.shadowColor  = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur   = 4 * scale;
      ctx.fillText(ci.name, x, y + r * 0.5);
      ctx.restore();
    });

    // ── Pass 5: units
    units.forEach(u => {
      const { x, y }  = hexCenter(u.c, u.r, scale);
      const isSelected  = selectedUnit && selectedUnit.id === u.id;
      const isInGroup   = selectedGroup && selectedGroup.includes(u.id);
      const isPlayer    = u.owner === 'player';
      const def         = UNIT_TYPES[u.type];
      const col         = isPlayer ? '#4a9eff' : '#ff5050';
      const exhausted   = u.moves === 0;

      // Group highlight ring (solid green)
      if (isInGroup) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.58, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80,220,120,0.85)';
        ctx.lineWidth   = 2.5 * scale;
        ctx.stroke();
        ctx.restore();
      }

      // Selection pulse ring (dashed white)
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

      // Unit shadow
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y + 2 * scale, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fill();
      ctx.restore();

      // Unit circle
      ctx.beginPath();
      ctx.arc(x, y, r * 0.38, 0, Math.PI * 2);
      ctx.fillStyle   = exhausted ? '#3a3a3a' : col;
      ctx.fill();
      ctx.strokeStyle = isSelected ? '#fff' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth   = (isSelected ? 2 : 1.5) * scale;
      ctx.stroke();

      // Unit icon
      drawText(def.icon, x, y + 1, r * 0.38, 'center', 'middle');

      // HP bar (below unit)
      const barW = r * 0.7, barH = 3.5 * scale;
      const barX = x - barW / 2, barY = y + r * 0.46;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(barX, barY, barW, barH);
      const hpRatio = u.hp / u.maxHp;
      ctx.fillStyle = hpRatio > 0.6 ? '#4aaa44' : hpRatio > 0.3 ? '#e09030' : '#d05040';
      ctx.fillRect(barX, barY, barW * hpRatio, barH);

      // Move pips
      for (let i = 0; i < u.maxMoves; i++) {
        const px = x - ((u.maxMoves - 1) * 5 * scale) / 2 + i * 5 * scale;
        ctx.beginPath();
        ctx.arc(px, y + r * 0.6, 2.5 * scale, 0, Math.PI * 2);
        ctx.fillStyle = i < u.moves ? col : 'rgba(100,100,100,0.5)';
        ctx.fill();
      }
    });
  }

  // Helper: draw emoji/text
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

  return { init, draw, resize, getScale };
})();
