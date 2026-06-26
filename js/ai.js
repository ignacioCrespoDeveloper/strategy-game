// =============================================
//  ai.js — simple enemy AI
// =============================================

const AI = (() => {
  function takeTurn() {
    const enemies = Units.byOwner('enemy');
    const players = Units.byOwner('player');

    enemies.forEach(enemy => {
      enemy.moves = enemy.maxMoves;
      if (!players.length) return;

      // Find nearest player unit
      const target = players.reduce((a, b) =>
        dist(a, enemy) < dist(b, enemy) ? a : b
      );

      // Try to step toward target
      for (let step = 0; step < enemy.moves; step++) {
        const reachable = bfsReach(
          enemy.c, enemy.r, 1,
          (c, r) => !GameMap.isWater(c, r),
          (c, r) => {
            const u = Units.getAt(c, r);
            return u && u.owner === 'enemy';
          }
        );

        if (!reachable.length) break;

        // Pick step that minimises distance to target
        const best = reachable.reduce((a, b) =>
          dist(a, target) < dist(b, target) ? a : b
        );

        const result = Units.move(enemy, best.c, best.r);
        if (result.result === 'combat' || result.result === 'blocked') break;
        if (enemy.moves <= 0) break;
      }
    });
  }

  function dist(a, b) {
    return Math.hypot(a.c - b.c, a.r - b.r);
  }

  return { takeTurn };
})();
