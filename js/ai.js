// =============================================
//  ai.js — simple enemy AI
// =============================================

const AI = (() => {
  function takeTurn() {
    return; // enemies stay put — player approaches to trigger combat
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

        // Check for player units at target hex — army combat
        const playersAtTarget = Units.getAllAt(best.c, best.r).filter(u => u.owner === 'player');
        if (playersAtTarget.length > 0) {
          // Gather all enemy units on same hex as this enemy
          const enemyArmy = Units.getAllAt(enemy.c, enemy.r).filter(u => u.owner === 'enemy');
          const terrain   = TERRAIN_MAP[best.r]?.[best.c] || 'plains';
          const result    = Combat.resolveBattle(enemyArmy, playersAtTarget, terrain);

          result.survivingAtt.forEach(({ id, hp }) => {
            const u = Units.getAll().find(u => u.id === id); if (u) u.hp = hp;
          });
          result.survivingDef.forEach(({ id, hp }) => {
            const u = Units.getAll().find(u => u.id === id); if (u) u.hp = hp;
          });
          enemyArmy.filter(u => !result.survivingAtt.find(s => s.id === u.id)).forEach(u => Units.remove(u.id));
          playersAtTarget.filter(u => !result.survivingDef.find(s => s.id === u.id)).forEach(u => Units.remove(u.id));

          if (result.winner === 'attacker') {
            enemyArmy.filter(u => Units.getAll().find(uu => uu.id === u.id)).forEach(u => {
              u.c = best.c; u.r = best.r;
              u.moves = Math.max(0, u.moves - 1);
            });
            GameMap.processCapture(best.c, best.r, 'enemy');
            Cities.captureAt(best.c, best.r, 'enemy');
          } else {
            enemyArmy.forEach(u => { u.moves = 0; });
          }
          break; // combat ends this unit's turn
        }

        const result = Units.move(enemy, best.c, best.r);
        if (result.result === 'moved') {
          GameMap.processCapture(enemy.c, enemy.r, 'enemy');
          Cities.captureAt(enemy.c, enemy.r, 'enemy');
        }
        if (enemy.moves <= 0) break;
      }
    });
  }

  function dist(a, b) {
    return Math.hypot(a.c - b.c, a.r - b.r);
  }

  return { takeTurn };
})();
