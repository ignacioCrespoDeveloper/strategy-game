// =============================================
//  combat-resolver.js — POST /api/pvp/resolve
//
//  Authoritative PvP battle resolution.
//
//  Flow:
//    1. Verify Supabase JWT → caller's UUID
//    2. Validate intent: { attackerLordId, targetTileX, targetTileY }
//    3. Server-side checks (ownership, stance, range, visibility)
//    4. Read BOTH sides' state using service-role key (bypasses RLS)
//    5. Run BattleEngine.resolve() server-side
//    6. Write losses to both players' storage rows + insert battle_report
//    7. Return full BattleReport to caller
//
//  The client is never trusted for any outcome.
//  For PvP battles, the client must NOT call ArmyService.applyBattleLosses()
//  locally — the server writes the canonical army state and the client will
//  see it on next hydration from Supabase.
//
//  Known limitation (Phase 1): Army composition is still client-authoritative
//  at recruitment time, so a cheater can inflate their army before attacking.
//  Making recruitment authoritative is a follow-on task.
// =============================================

import { createClient } from '@supabase/supabase-js';
import {
  BattleEngine,
  UNIT_DEFS,
  LORD_BASE_STATS,
  LORD_CLASSES,
  STANCE_DEFS,
} from './engine-loader.js';

// ── Admin Supabase client (bypasses RLS) ──────────────────────

function _adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Pure helpers (no StorageService dependency) ───────────────

// Mirrors LordService.getEffectiveStats() without StorageService.
function _effectiveStats(lord) {
  const base = lord.baseStats || { ...LORD_BASE_STATS };
  const cls  = LORD_CLASSES[lord.classId];
  const mods = cls?.modifiers || {};
  const result = {};
  for (const key of Object.keys(LORD_BASE_STATS)) {
    result[key] = (base[key] ?? LORD_BASE_STATS[key]) + (mods[key] || 0);
  }
  return result;
}

// Mirrors VisibilityService.getVisibilityScore() + canBeAttacked().
const _ARMY_TIERS = [
  { min: 0,  max: 0,  score: 0  },
  { min: 1,  max: 3,  score: 20 },
  { min: 4,  max: 6,  score: 40 },
  { min: 7,  max: 9,  score: 65 },
  { min: 10, max: 10, score: 90 },
];
const _CLASS_VIS_MULT = { rogue: 0.35 };

function _visibilityScore(lord, armyUnits) {
  const count = (armyUnits || []).reduce((s, u) => s + u.count, 0);
  const tier  = _ARMY_TIERS.find(t => count >= t.min && count <= t.max) || _ARMY_TIERS[0];
  let score   = tier.score;
  const stanceDef = STANCE_DEFS[lord.stance?.id || 'idle'];
  if (stanceDef?.visibilityMult != null) score *= stanceDef.visibilityMult;
  const cm = _CLASS_VIS_MULT[lord.classId];
  if (cm != null) score *= cm;
  return Math.round(Math.min(100, Math.max(0, score)));
}

// Chebyshev distance (diagonal = 1 tile, mirrors LordService movement).
function _chebyshev(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

// Mirrors WorldService.getTerrain() — deterministic from coordinates.
const _TERRAIN_KEYS = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
function _terrain(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  return _TERRAIN_KEYS[h % _TERRAIN_KEYS.length];
}

// Derive role from unit definition — mirrors BattleEngine._unitRole().
function _unitRole(def) {
  if (def.category === 'ranged')   return 'ranged';
  if (def.category === 'cavalry')  return 'cavalry';
  if (def.category === 'monster' || def.category === 'legendary') return 'monster';
  if ((def.traits || []).includes('ranged')) return 'ranged';
  return 'infantry';
}

// Build a BattleContext from raw storage objects.
// Mirrors BattleEngine.buildContext() but without LordService/ArmyService deps.
function _buildContext(atkLord, atkArmy, defLord, defArmy, terrain) {
  const atkStats = _effectiveStats(atkLord);
  const defStats = _effectiveStats(defLord);

  function makeLordUnit(lord, stats, prefix) {
    return {
      id:         prefix + '_lord',
      sourceId:   lord.id,
      name:       lord.name,
      role:       'lord',
      traits:     ['backline'],
      abilities:  [],
      maxHp:      stats.health,
      currentHp:  lord.currentHp ?? stats.health,
      attack:     stats.attack,
      defense:    stats.defense,
      speed:      stats.speed,
      leadership: stats.leadership,
      count:      1,
      startCount: 1,
      isLord:     true,
      isRouting:  false,
      _frenzBonus: 0,
      _burning:   false,
    };
  }

  function makeStack(stack, prefix, idx) {
    const def = UNIT_DEFS[stack.unitId];
    if (!def) return null;
    return {
      id:         `${prefix}_${idx}`,
      sourceId:   stack.unitId,
      name:       def.name,
      role:       _unitRole(def),
      traits:     [...(def.traits || [])],
      abilities:  [...(def.abilities || [])],
      maxHp:      def.combatStats?.hp     ?? 100,
      currentHp:  stack.currentHp         ?? (def.combatStats?.hp ?? 100),
      attack:     def.combatStats?.attack ?? 5,
      defense:    def.combatStats?.defense ?? 5,
      speed:      def.combatStats?.speed  ?? 5,
      leadership: 0,
      count:      stack.count,
      startCount: stack.count,
      isLord:     false,
      isRouting:  false,
      _frenzBonus: 0,
      _burning:   false,
    };
  }

  return {
    terrain,
    attacker: {
      id:    atkLord.playerId,
      units: [
        makeLordUnit(atkLord, atkStats, 'a'),
        ...(atkArmy?.units || []).map((s, i) => makeStack(s, 'a', i)).filter(Boolean),
      ],
      morale: Math.min(100, 75 + atkStats.leadership * 1.5),
    },
    defender: {
      id:    defLord.playerId,
      units: [
        makeLordUnit(defLord, defStats, 'd'),
        ...(defArmy?.units || []).map((s, i) => makeStack(s, 'd', i)).filter(Boolean),
      ],
      morale: Math.min(100, 75 + defStats.leadership * 1.5),
    },
  };
}

// Apply a sideReport's losses to a raw armies map object. Mutates in place.
function _applyLosses(armiesObj, lordId, sideReport) {
  const army = armiesObj[lordId] || { lordId, units: [] };
  sideReport.unitsStart.forEach(({ sourceId, count: startCount }) => {
    const surviving = sideReport.unitsSurviving.find(s => s.sourceId === sourceId);
    const newCount  = surviving?.count ?? 0;
    const stack     = army.units.find(u => u.unitId === sourceId);
    if (!stack) return;
    stack.count = Math.max(0, newCount);
    if (surviving && stack.count > 0) stack.currentHp = Math.round(surviving.avgHp);
  });
  army.units       = army.units.filter(u => u.count > 0);
  armiesObj[lordId] = army;
}

// ── Main handler ──────────────────────────────────────────────

export async function resolvePvpAttack(req, res) {
  // 1. Authenticate: extract Bearer JWT, verify with Supabase.
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let admin;
  try { admin = _adminClient(); } catch (e) {
    return res.status(500).json({ error: 'Server misconfiguration: ' + e.message });
  }

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id; // Supabase UUID == our player_id

  // 2. Parse input.
  const { attackerLordId, targetTileX, targetTileY } = req.body || {};
  if (!attackerLordId || targetTileX == null || targetTileY == null) {
    return res.status(400).json({ error: 'Required: attackerLordId, targetTileX, targetTileY' });
  }
  const tX = Number(targetTileX);
  const tY = Number(targetTileY);
  if (!Number.isInteger(tX) || !Number.isInteger(tY) || tX < 0 || tY < 0) {
    return res.status(400).json({ error: 'targetTileX/Y must be non-negative integers' });
  }

  // 3. Load attacker's data.
  const { data: atkRows, error: atkErr } = await admin.from('storage')
    .select('key, value')
    .eq('player_id', callerId)
    .in('key', ['lords', 'armies']);
  if (atkErr) return res.status(500).json({ error: 'Failed to load attacker data' });

  const atkData    = Object.fromEntries((atkRows || []).map(r => [r.key, r.value]));
  const atkLords   = atkData.lords   || {};
  const atkArmies  = atkData.armies  || {};
  const attackerLord = atkLords[attackerLordId];

  if (!attackerLord) return res.status(404).json({ error: 'Attacking lord not found' });
  if (attackerLord.playerId !== callerId) return res.status(403).json({ error: 'Lord does not belong to you' });

  // 4. Stance + action-queue check.
  if ((attackerLord.actionQueue || []).length > 0) {
    return res.status(400).json({ error: 'Lord is busy with another action' });
  }
  const atkStance = STANCE_DEFS[attackerLord.stance?.id || 'idle'];
  if (atkStance?.restrictions?.includes('action')) {
    return res.status(400).json({ error: `Cannot attack while in ${atkStance.name} stance` });
  }

  // 5. Range check: Chebyshev distance ≤ 2 tiles.
  const { x: atkX, y: atkY } = attackerLord;
  if (atkX == null || atkY == null) {
    return res.status(400).json({ error: 'Attacking lord has no map position' });
  }
  const dist = _chebyshev(atkX, atkY, tX, tY);
  if (dist === 0) return res.status(400).json({ error: 'Target tile is your lord\'s own tile' });
  if (dist > 2)  return res.status(400).json({ error: `Target is out of range (distance ${dist}, max 2)` });

  // 6. Find enemy lord at target tile (reads all players' lords via service role).
  const { data: allLordRows, error: lordErr } = await admin.from('storage')
    .select('player_id, value')
    .eq('key', 'lords');
  if (lordErr) return res.status(500).json({ error: 'Failed to scan lords' });

  let defenderLord   = null;
  let defenderPlayerId = null;
  for (const row of (allLordRows || [])) {
    if (row.player_id === callerId) continue;
    const found = Object.values(row.value || {}).find(l => l.x === tX && l.y === tY);
    if (found) { defenderLord = found; defenderPlayerId = row.player_id; break; }
  }
  if (!defenderLord) return res.status(404).json({ error: 'No enemy lord at target tile' });

  // 7. Load defender's army.
  const { data: defRows, error: defErr } = await admin.from('storage')
    .select('key, value')
    .eq('player_id', defenderPlayerId)
    .eq('key', 'armies');
  if (defErr) return res.status(500).json({ error: 'Failed to load defender data' });

  const defArmies   = (defRows?.[0]?.value) || {};
  const defArmy     = defArmies[defenderLord.id] || { lordId: defenderLord.id, units: [] };
  const atkArmy     = atkArmies[attackerLord.id] || { lordId: attackerLord.id, units: [] };

  // 8. Visibility check: defender must be detectable.
  if (_visibilityScore(defenderLord, defArmy.units) === 0) {
    return res.status(400).json({ error: 'Target lord is undetectable (visibility score 0)' });
  }

  // 9. Build context + resolve.
  const terrain = _terrain(tX, tY);
  const ctx     = _buildContext(attackerLord, atkArmy, defenderLord, defArmy, terrain);
  const report  = BattleEngine.resolve(ctx);

  // 10. Apply losses to raw armies blobs.
  const updatedAtkArmies = { ...atkArmies };
  const updatedDefArmies = { ...defArmies };
  _applyLosses(updatedAtkArmies, attackerLord.id, report.attacker);
  _applyLosses(updatedDefArmies, defenderLord.id, report.defender);

  // 11. Write results.
  // Not a true DB transaction — if one write fails the others may still succeed.
  // Phase 2 hardening: wrap in a Postgres function with SECURITY DEFINER.
  const [atkWrite, defWrite, reportInsert] = await Promise.all([
    admin.from('storage').upsert(
      { player_id: callerId,      key: 'armies', value: updatedAtkArmies },
      { onConflict: 'player_id,key' }
    ),
    admin.from('storage').upsert(
      { player_id: defenderPlayerId, key: 'armies', value: updatedDefArmies },
      { onConflict: 'player_id,key' }
    ),
    admin.from('battle_reports').insert({
      attacker_id:      callerId,
      defender_id:      defenderPlayerId,
      attacker_lord_id: attackerLord.id,
      defender_lord_id: defenderLord.id,
      tile_x:           tX,
      tile_y:           tY,
      terrain,
      winner:           report.winner,
      reason:           report.reason,
      rounds:           report.rounds,
      report_json:      report,
    }),
  ]);

  const writeError = atkWrite.error || defWrite.error || reportInsert.error;
  if (writeError) {
    console.error('[combat-resolver] write error:', writeError.message);
    return res.status(500).json({ error: 'Battle resolved but failed to persist: ' + writeError.message });
  }

  // 12. Return canonical report to caller.
  return res.status(200).json({ ok: true, report, terrain });
}
