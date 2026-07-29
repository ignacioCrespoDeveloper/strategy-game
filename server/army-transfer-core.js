// =============================================
//  army-transfer-core.js — Pure troop-exchange math
//
//  Zero imports on purpose: this is the one piece of the
//  /api/army/transfer endpoint with fiddly edge cases (damaged
//  front models, stack merges), so it lives here where a plain
//  `node` script can unit-test it without touching Supabase or
//  the engine loader. All ownership/position/cap validation
//  stays in actions/army-transfer.js.
//
//  Damaged-model rules (mirrors army.js's "only the front model
//  of a stack can be damaged" invariant):
//    - A partial move takes fresh models first; the damaged front
//      model only travels when `damaged: true` is requested or the
//      whole stack moves.
//    - Merging a damaged model into a stack that already has one
//      keeps the LOWER currentHp — conservative, so shuffling
//      troops can never wash battle damage away.
// =============================================

// moves: [{ unitId, count, damaged? }] — aggregates duplicates per unitId.
function _aggregate(moves) {
  const byUnit = new Map();
  for (const m of moves || []) {
    const prev = byUnit.get(m.unitId) || { unitId: m.unitId, count: 0, damaged: false };
    prev.count   += m.count;
    prev.damaged  = prev.damaged || !!m.damaged;
    byUnit.set(m.unitId, prev);
  }
  return [...byUnit.values()];
}

// Removes the moved models from `units` (mutates), returning what travels:
// [{ unitId, count, currentHp }] where currentHp is non-null only when the
// damaged front model is among the movers.
function _removeAll(units, moves) {
  const moved = [];
  for (const { unitId, count, damaged } of moves) {
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, error: 'Transfer counts must be whole numbers of at least 1.' };
    }
    const stack = units.find(u => u.unitId === unitId);
    if (!stack || stack.count < count) {
      return { ok: false, error: `Not enough ${unitId} to transfer.` };
    }
    const hasDamaged  = stack.currentHp != null;
    const moveDamaged = hasDamaged && (damaged || count === stack.count);
    const carriedHp   = moveDamaged ? stack.currentHp : null;
    stack.count -= count;
    if (moveDamaged) stack.currentHp = null;
    moved.push({ unitId, count, currentHp: carriedHp });
  }
  return { ok: true, moved };
}

// Merges travelling models into `units` (mutates).
function _addAll(units, moved) {
  for (const { unitId, count, currentHp } of moved) {
    const stack = units.find(u => u.unitId === unitId);
    if (!stack) {
      const fresh = { unitId, count };
      if (currentHp != null) fresh.currentHp = currentHp;
      units.push(fresh);
    } else {
      stack.count += count;
      if (currentHp != null) {
        stack.currentHp = stack.currentHp != null ? Math.min(stack.currentHp, currentHp) : currentHp;
      }
    }
  }
}

// The whole exchange, both directions, atomically: returns fresh unit lists
// (inputs are not mutated) or { ok: false, error }.
// unitsA/unitsB: [{ unitId, count, currentHp? }]
// toB/toA:       [{ unitId, count, damaged? }]
export function applyExchange(unitsA, unitsB, toB, toA) {
  const a = (unitsA || []).map(u => ({ ...u }));
  const b = (unitsB || []).map(u => ({ ...u }));

  // Remove from BOTH sides before adding to either, so a same-unit swap in
  // both directions validates against the original stacks, not half-applied
  // state.
  const outB = _removeAll(a, _aggregate(toB));
  if (!outB.ok) return outB;
  const outA = _removeAll(b, _aggregate(toA));
  if (!outA.ok) return outA;

  _addAll(b, outB.moved);
  _addAll(a, outA.moved);

  return {
    ok: true,
    unitsA: a.filter(u => u.count > 0),
    unitsB: b.filter(u => u.count > 0),
  };
}
