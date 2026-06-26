// =============================================
//  hex.js — hexagonal grid math
// =============================================

const HEX_R   = 36;                       // circumradius (px, unscaled)
const HEX_H   = Math.sqrt(3) * HEX_R;     // flat row height

function hexKey(c, r) { return `${c},${r}`; }

function parseKey(k) {
  const [c, r] = k.split(',').map(Number);
  return { c, r };
}

// Pixel centre of a hex (before canvas scale)
function hexCenter(col, row, scale = 1) {
  const ox = 42, oy = 44;
  const x = ox + col * HEX_R * 1.74;
  const y = oy + row * HEX_H + (col % 2) * (HEX_H / 2);
  return { x: x * scale, y: y * scale };
}

// Draw a regular hexagon
function drawHex(ctx, x, y, r, fill, stroke, lineWidth = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + r * Math.cos(a);
    const py = y + r * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

// Neighbours (offset coords, skipping water + out-of-bounds)
function neighbors(c, r, passableCheck) {
  const dirs = (c % 2 === 0)
    ? [[1,0],[1,-1],[0,-1],[-1,-1],[-1,0],[0,1]]
    : [[1,1],[1, 0],[0,-1],[-1, 0],[-1,1],[0,1]];
  return dirs
    .map(([dc, dr]) => ({ c: c + dc, r: r + dr }))
    .filter(n =>
      n.c >= 0 && n.c < COLS &&
      n.r >= 0 && n.r < ROWS &&
      (passableCheck ? passableCheck(n.c, n.r) : true)
    );
}

// BFS reachability — returns array of {c,r} reachable within maxMoves
function bfsReach(startC, startR, maxMoves, isPassable, isBlocked) {
  const visited = { [hexKey(startC, startR)]: 0 };
  const queue   = [{ c: startC, r: startR, cost: 0 }];
  const reach   = [];

  while (queue.length) {
    const cur = queue.shift();
    if (cur.cost > 0 && !isBlocked(cur.c, cur.r)) reach.push({ c: cur.c, r: cur.r });
    if (cur.cost >= maxMoves) continue;

    neighbors(cur.c, cur.r, isPassable).forEach(n => {
      const k    = hexKey(n.c, n.r);
      const cost = cur.cost + (TERRAIN_DEF[TERRAIN_MAP[n.r][n.c]]?.move ?? 1);
      if (!(k in visited) || visited[k] > cost) {
        visited[k] = cost;
        if (cost <= maxMoves) queue.push({ c: n.c, r: n.r, cost });
      }
    });
  }
  return reach;
}

// Nearest hex from pixel coordinates
function pixelToHex(px, py, scale) {
  let best = null, bestDist = Infinity;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const { x, y } = hexCenter(col, row, scale);
      const d = Math.hypot(px - x, py - y);
      if (d < bestDist) { bestDist = d; best = { c: col, r: row }; }
    }
  }
  return bestDist < HEX_R * scale ? best : null;
}
