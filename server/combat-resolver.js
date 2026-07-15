// =============================================
//  combat-resolver.js — POST /api/pvp/resolve
//
//  Authoritative PvP battle resolution.
//
//  Flow:
//    1. Verify Supabase JWT → caller's UUID
//    2. Validate intent: { attackerLordId, targetTileX, targetTileY }
//    3. Server-side checks (ownership, stance, same-tile arrival)
//    4. Load attacker data via service-role key (bypasses RLS)
//    5. Collect ALL enemy lords on target tile (+ city garrison seam)
//    6. Load each defender's armies, lords, and activity_feed
//    7. Build one combined defending side; run BattleEngine.resolve()
//    8. Write losses to all participants atomically-ish (Promise.all)
//    9. Append vague "under attack" notification to each defender's feed
//   10. Return full BattleReport to caller
//
//  The client is never trusted for any outcome.
//  After a successful resolve, the client applies the attacker-side losses
//  from the returned report to its local localStorage cache directly
//  (no page refresh needed).
//
//  Known limitation (Phase 1): Army composition is still client-authoritative
//  at recruitment time. Making recruitment authoritative is a follow-on task.
//
//  Known limitation (Phase 1): Movement timing is client-authoritative.
//  The dodge window (travel time = defender's warning window) is honored for
//  honest clients, but a cheater could write a fake lord position to skip
//  travel. Server-authoritative movement (or a resolveAt timestamp) is the
//  hardening follow-on — identical to the existing recruitment caveat.
//
//  Known limitation (Phase 1): DB writes are not a true Postgres transaction.
//  If one write fails, others may succeed. Phase 2 hardening: wrap in a
//  Postgres function with SECURITY DEFINER.
// =============================================

import { createClient } from '@supabase/supabase-js';
import {
  BattleEngine,
  UNIT_DEFS,
  LORD_BASE_STATS,
  LORD_CLASSES,
  STANCE_DEFS,
} from './engine-loader.js';

// ── Supabase clients ──────────────────────────────────────────
//
//  Two separate clients:
//    _authClient()  — anon key  — only used for auth.getUser(jwt).
//                    Supabase auth endpoint rejects service role key here.
//    _adminClient() — service role key — bypasses RLS for all DB ops.

function _authClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function _adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// ── Pure helpers (no StorageService dependency) ───────────────

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

function _terrain(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  const keys = ['forest','forest','plains','plains','plains','hills','hills','marsh','mountain','desert'];
  return keys[h % keys.length];
}

function _unitRole(def) {
  if (def.category === 'ranged')   return 'ranged';
  if (def.category === 'cavalry')  return 'cavalry';
  if (def.category === 'monster' || def.category === 'legendary') return 'monster';
  if ((def.traits || []).includes('ranged')) return 'ranged';
  return 'infantry';
}

// ── Battle context builders ───────────────────────────────────

// Build a lord unit for the battle context.
// prefix: 'a' for attacker, 'd0'/'d1'/... for defenders.
// sourceId is always lord.id (unique globally) — no prefix needed.
function _makeLordUnit(lord, stats, prefix) {
  return {
    id:          `${prefix}_lord`,
    sourceId:    lord.id,
    name:        lord.name,
    role:        'lord',
    traits:      ['backline'],
    abilities:   [],
    maxHp:       stats.health,
    currentHp:   lord.currentHp ?? stats.health,
    attack:      stats.attack,
    defense:     stats.defense,
    speed:       stats.speed,
    leadership:  stats.leadership,
    count:       1,
    startCount:  1,
    isLord:      true,
    isRouting:   false,
    _frenzBonus: 0,
    _burning:    false,
  };
}

// Build an army stack unit.
// Attacker: sourceId = stack.unitId (no prefix) so client cache update works.
// Defenders: sourceId = `${prefix}_${stack.unitId}` (unique per-defender) so
//   multi-defender loss application can route losses back to the right army.
function _makeStack(stack, prefix, idx, usePrefix) {
  const def = UNIT_DEFS[stack.unitId];
  if (!def) return null;
  return {
    id:          `${prefix}_${idx}`,
    sourceId:    usePrefix ? `${prefix}_${stack.unitId}` : stack.unitId,
    name:        def.name,
    role:        _unitRole(def),
    traits:      [...(def.traits || [])],
    abilities:   [...(def.abilities || [])],
    maxHp:       def.combatStats?.hp      ?? 100,
    currentHp:   stack.currentHp          ?? (def.combatStats?.hp ?? 100),
    attack:      def.combatStats?.attack  ?? 5,
    defense:     def.combatStats?.defense ?? 5,
    speed:       def.combatStats?.speed   ?? 5,
    leadership:  0,
    count:       stack.count,
    startCount:  stack.count,
    isLord:      false,
    isRouting:   false,
    _frenzBonus: 0,
    _burning:    false,
  };
}

// Build a full BattleContext from attacker data + array of defender entries.
// defenders: [{ lord, army: { lordId, units: [{ unitId, count, currentHp? }] } }]
//
// Defender unit sourceIds are prefixed (d0_dreadspears, d1_dreadspears) so
// _applyDefLosses can route casualties back to the correct army even when
// multiple defenders share the same unit types.
//
// TODO Phase 2: append city garrison stacks here once BUILDING_DEFS is loaded
// via engine-loader. Shape: { unitId, count } from CityService.getGarrison().
function _buildMultiContext(atkLord, atkArmy, defenders, terrain) {
  const atkStats = _effectiveStats(atkLord);

  const defUnits = [];
  defenders.forEach(({ lord, army }, dIdx) => {
    const stats  = _effectiveStats(lord);
    const prefix = `d${dIdx}`;
    defUnits.push(_makeLordUnit(lord, stats, prefix));
    (army?.units || []).forEach((stack, sIdx) => {
      const u = _makeStack(stack, prefix, sIdx, true); // usePrefix = true for defenders
      if (u) defUnits.push(u);
    });
  });

  const maxDefLeadership = defenders.reduce(
    (m, { lord }) => Math.max(m, _effectiveStats(lord).leadership), 0
  );

  return {
    terrain,
    attacker: {
      id:    atkLord.playerId,
      units: [
        _makeLordUnit(atkLord, atkStats, 'a'),
        ...(atkArmy?.units || []).map((s, i) => _makeStack(s, 'a', i, false)).filter(Boolean),
      ],
      morale: Math.min(100, 75 + atkStats.leadership * 1.5),
    },
    defender: {
      id:    defenders.map(d => d.lord.playerId).join('+'),
      units: defUnits,
      morale: Math.min(100, 75 + maxDefLeadership * 1.5),
    },
  };
}

// ── Loss application ──────────────────────────────────────────

// Apply attacker-side losses to their armies blob.
// Attacker army stack sourceIds have no prefix (= stack.unitId).
function _applyAtkLosses(armiesObj, lord, sideReport) {
  const army = armiesObj[lord.id] || { lordId: lord.id, units: [] };
  sideReport.unitsStart.forEach(({ sourceId }) => {
    if (sourceId === lord.id) return; // lord unit — HP handled by _applyLordHp
    const surviving = sideReport.unitsSurviving.find(s => s.sourceId === sourceId);
    const stack     = army.units.find(u => u.unitId === sourceId);
    if (!stack) return;
    stack.count = surviving?.count ?? 0;
    if (surviving && stack.count > 0) stack.currentHp = Math.round(surviving.avgHp);
  });
  army.units        = army.units.filter(u => u.count > 0);
  armiesObj[lord.id] = army;
}

// Apply defender-side losses to each defender's armies blob.
// Defender army stack sourceIds are prefixed: `d${idx}_${unitId}`.
function _applyDefLosses(defenders, defArmiesByPlayer, sideReport) {
  defenders.forEach(({ lord, playerId }, dIdx) => {
    const prefix  = `d${dIdx}`;
    const armies  = defArmiesByPlayer[playerId] || {};
    const army    = armies[lord.id] || { lordId: lord.id, units: [] };

    sideReport.unitsStart.forEach(({ sourceId }) => {
      if (!sourceId.startsWith(prefix + '_')) return; // belongs to another defender
      const unitId    = sourceId.slice(prefix.length + 1);
      const surviving = sideReport.unitsSurviving.find(s => s.sourceId === sourceId);
      const stack     = army.units.find(u => u.unitId === unitId);
      if (!stack) return;
      stack.count = surviving?.count ?? 0;
      if (surviving && stack.count > 0) stack.currentHp = Math.round(surviving.avgHp);
    });

    army.units           = army.units.filter(u => u.count > 0);
    armies[lord.id]      = army;
    defArmiesByPlayer[playerId] = armies;
  });
}

// Update lord HP and downtime from the battle report's surviving units list.
// winner: 'attacker'|'defender'|'draw'
// side:   'attacker'|'defender' — which side this lord fought on
// Eliminated defenders against a winning attacker are 'captured'; all others are 'defeated'.
function _applyLordHp(lordsObj, lordId, unitsSurviving, winner, side) {
  const lord = lordsObj[lordId];
  if (!lord) return;
  const unit = unitsSurviving.find(u => u.sourceId === lordId);
  if (unit) {
    lord.currentHp      = Math.max(1, Math.round(unit.avgHp));
    lord.downtimeUntil  = null;
    lord.downtimeReason = null;
  } else {
    lord.currentHp      = 0;
    lord.downtimeUntil  = Date.now() + 60 * 60 * 1000; // 1 hour
    lord.downtimeReason = (side === 'defender' && winner === 'attacker') ? 'captured' : 'defeated';
  }
  lordsObj[lordId] = lord;
}

// ── Tile scanner ─────────────────────────────────────────────
//
//  POST /api/scan/tile
//
//  Called client-side when a Search Area action completes.
//  Returns all enemy lords on the given tile that pass the
//  canBeAttacked() visibility check, computed server-side against
//  the actual army data (which is not accessible from the client's
//  localStorage — only own-player data is cached there).
//
//  Response: { ok, discoveries: [{ type, tileX, tileY, ttl, rawData }] }

export async function scanTile(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try { authClient = _authClient(); admin = _adminClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;
  const { tileX, tileY } = req.body || {};
  const x = Number(tileX), y = Number(tileY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'tileX and tileY required' });
  }

  // Load the scanning lord's class (for Rogue quality-tier bonus).
  const { data: callerStorageRows } = await admin.from('storage')
    .select('key, value').eq('player_id', callerId).eq('key', 'lords');
  const callerLords   = Object.values(callerStorageRows?.[0]?.value || {});
  const scanningLord  = callerLords.find(l => l.x === x && l.y === y);
  const isRogue       = scanningLord?.classId === 'rogue';

  // Load all lords, armies, and player profiles server-side.
  const [lordResult, armyResult, playerResult] = await Promise.all([
    admin.from('storage').select('player_id, value').eq('key', 'lords'),
    admin.from('storage').select('player_id, value').eq('key', 'armies'),
    admin.from('storage').select('player_id, value').eq('key', 'player'),
  ]);

  const armyByPlayer   = {};
  const profileByPlayer = {};
  (armyResult.data || []).forEach(r => { armyByPlayer[r.player_id]   = r.value || {}; });
  (playerResult.data || []).forEach(r => { profileByPlayer[r.player_id] = r.value || {}; });

  const discoveries = [];
  for (const row of (lordResult.data || [])) {
    if (row.player_id === callerId) continue;
    const username = profileByPlayer[row.player_id]?.username || null;
    Object.values(row.value || {}).forEach(lord => {
      if (lord.x !== x || lord.y !== y) return;
      if (lord.downtimeUntil && Date.now() < lord.downtimeUntil) return; // downed — not visible

      const armyObj   = armyByPlayer[row.player_id] || {};
      const armyUnits = (armyObj[lord.id] || {}).units || [];
      const stanceDef   = STANCE_DEFS[lord.stance?.id || 'idle'];
      const unitsSummary = armyUnits.map(u => ({ unitId: u.unitId, count: u.count }));
      const armyPoints   = armyUnits.reduce((s, u) => s + u.count, 0);
      discoveries.push({
        type:    'enemy_lord',
        tileX:   x,
        tileY:   y,
        ttl:     30 * 60 * 1000,
        rawData: {
          lordId:         lord.id,
          lordName:       lord.name,
          lordRace:       lord.race,
          lordLevel:      lord.level || 1,
          lordClass:      lord.classId,
          playerUsername: username,
          armyCapacity:   armyPoints,
          units:          unitsSummary,
          lastActivity:   lord.actionQueue?.length > 0 ? lord.actionQueue[0].actionId : 'idle',
          stanceId:       isRogue ? (lord.stance?.id || 'idle') : null,
          stanceName:     isRogue ? (stanceDef?.name || null) : null,
        },
      });
    });
  }

  return res.json({ ok: true, discoveries });
}

// ── Attack declaration ────────────────────────────────────────
//
//  POST /api/attack/declare
//  Called when the attacker confirms the attack order (before travel begins).
//  Writes a pvp_threat notification to every defender on the target tile
//  so they see the incoming attack immediately.
//
//  Body: { attackerLordId, targetTileX, targetTileY, etaSecs }
//  Response: { ok }

export async function declareAttack(req, res) {
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try { authClient = _authClient(); admin = _adminClient(); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;
  const { attackerLordId, targetTileX, targetTileY, etaSecs } = req.body || {};
  const tX = Number(targetTileX), tY = Number(targetTileY);
  if (!attackerLordId || !Number.isFinite(tX) || !Number.isFinite(tY)) {
    return res.status(400).json({ error: 'Required: attackerLordId, targetTileX, targetTileY' });
  }

  // Get attacker lord name
  const { data: atkRows } = await admin.from('storage')
    .select('value').eq('player_id', callerId).eq('key', 'lords').single();
  const atkLords = atkRows?.value || {};
  const atkLord  = atkLords[attackerLordId];
  const atkName  = atkLord?.name || 'Lord enemigo';

  // Find all defenders on that tile
  const [lordResult, feedResult] = await Promise.all([
    admin.from('storage').select('player_id, value').eq('key', 'lords'),
    admin.from('storage').select('player_id, value').eq('key', 'activity_feed'),
  ]);

  const feedByPlayer = {};
  (feedResult.data || []).forEach(r => { feedByPlayer[r.player_id] = r.value || {}; });

  const MAX_FEED = 50;
  const defPlayerIds = new Set();
  for (const row of (lordResult.data || [])) {
    if (row.player_id === callerId) continue;
    const lords = Object.values(row.value || {});
    if (lords.some(l => l.x === tX && l.y === tY)) {
      defPlayerIds.add(row.player_id);
    }
  }

  const etaStr = etaSecs > 0
    ? `ETA ${Math.ceil(etaSecs / 60)} min`
    : 'inmediato';

  const writes = [];
  for (const defId of defPlayerIds) {
    const feed = feedByPlayer[defId] || {};
    if (!feed[defId]) feed[defId] = [];
    const entry = {
      id:       'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
      at:       Date.now(),
      etaAt:    Date.now() + (Number(etaSecs) || 0) * 1000,
      type:     'pvp_threat',
      icon:     '⚔',
      title:    `Incoming attack from ${atkName}!`,
      detail:   `Arriving at (${tX}, ${tY}) · ${etaStr}`,
      lordName: atkName,
    };
    feed[defId].unshift(entry);
    if (feed[defId].length > MAX_FEED) feed[defId] = feed[defId].slice(0, MAX_FEED);
    writes.push(admin.from('storage').upsert(
      { player_id: defId, key: 'activity_feed', value: feed },
      { onConflict: 'player_id,key' }
    ));
  }

  if (writes.length > 0) await Promise.all(writes);
  return res.json({ ok: true, notified: defPlayerIds.size });
}

// ── Main handler ──────────────────────────────────────────────

export async function resolvePvpAttack(req, res) {
  // 1. Authenticate.
  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  let authClient, admin;
  try {
    authClient = _authClient();
    admin      = _adminClient();
  } catch (e) {
    return res.status(500).json({ error: 'Server misconfiguration: ' + e.message });
  }

  const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' });

  const callerId = user.id;

  // 2. Parse + coerce input.
  const { attackerLordId, targetTileX, targetTileY } = req.body || {};
  if (!attackerLordId || targetTileX == null || targetTileY == null) {
    return res.status(400).json({ error: 'Required: attackerLordId, targetTileX, targetTileY' });
  }
  const tX = Number(targetTileX);
  const tY = Number(targetTileY);
  if (!Number.isInteger(tX) || !Number.isInteger(tY) || tX < 0 || tY < 0) {
    return res.status(400).json({ error: 'targetTileX/Y must be non-negative integers' });
  }

  // 3. Load attacker data.
  const { data: atkRows, error: atkErr } = await admin.from('storage')
    .select('key, value')
    .eq('player_id', callerId)
    .in('key', ['lords', 'armies']);
  if (atkErr) {
    console.error('[pvp] attacker data fetch failed:', atkErr);
    return res.status(500).json({ error: 'Failed to load attacker data', detail: atkErr.message });
  }

  const atkData   = Object.fromEntries((atkRows || []).map(r => [r.key, r.value]));
  const atkLords  = atkData.lords  || {};
  const atkArmies = atkData.armies || {};
  const attackerLord = atkLords[attackerLordId];

  if (!attackerLord) return res.status(404).json({ error: 'Attacking lord not found' });
  if (attackerLord.playerId !== callerId) return res.status(403).json({ error: 'Lord does not belong to you' });

  // 4. Stance + busy check.
  if (attackerLord.downtimeUntil && Date.now() < attackerLord.downtimeUntil) {
    return res.status(400).json({ error: 'Attacking lord is incapacitated' });
  }
  if ((attackerLord.actionQueue || []).length > 0) {
    return res.status(400).json({ error: 'Lord is busy with another action' });
  }
  const atkStance = STANCE_DEFS[attackerLord.stance?.id || 'idle'];
  if (atkStance?.restrictions?.includes('action')) {
    return res.status(400).json({ error: `Cannot attack while in ${atkStance.name} stance` });
  }

  // 5. Same-tile arrival check.
  // The attack-move order (enqueued client-side with intent:'attack') sets the
  // lord's position on the target tile when the move completes. The client then
  // calls this endpoint. If position doesn't match, the lord hasn't arrived yet.
  //
  // Known limitation: position is client-authoritative. A cheater could write a
  // fake position to skip travel time. Server-authoritative movement is the
  // Phase 2 hardening (resolveAt timestamp approach).
  if (attackerLord.x !== tX || attackerLord.y !== tY) {
    return res.status(400).json({
      error: `Attacker has not arrived at (${tX}, ${tY}) yet — current position is (${attackerLord.x}, ${attackerLord.y})`,
    });
  }

  // 6. Find ALL enemy lords on the target tile.
  const { data: allLordRows, error: lordErr } = await admin.from('storage')
    .select('player_id, value')
    .eq('key', 'lords');
  if (lordErr) return res.status(500).json({ error: 'Failed to scan lords' });

  const defenderEntries = []; // [{ playerId, lord }]
  for (const row of (allLordRows || [])) {
    if (row.player_id === callerId) continue;
    Object.values(row.value || {}).forEach(l => {
      if (l.x === tX && l.y === tY) {
        if (l.downtimeUntil && Date.now() < l.downtimeUntil) return; // downed lords can't be attacked
        defenderEntries.push({ playerId: row.player_id, lord: l });
      }
    });
  }

  // TODO Phase 2: also collect city garrison at (tX, tY) for enemy cities.
  // Requires BUILDING_DEFS to be loaded in engine-loader and _garrisonUnits() here.
  // Shape: a synthetic defender entry { playerId: cityOwnerId, lord: syntheticGarrisonLord, army: garrisonArmy }

  if (defenderEntries.length === 0) {
    return res.status(404).json({ error: 'No enemy lords at target tile' });
  }

  // 7. Load each defender's storage + attacker's activity_feed in one batched query.
  const defPlayerIds = [...new Set(defenderEntries.map(e => e.playerId))];
  const [defResult, atkFeedResult] = await Promise.all([
    admin.from('storage')
      .select('player_id, key, value')
      .in('player_id', defPlayerIds)
      .in('key', ['armies', 'lords', 'activity_feed']),
    admin.from('storage')
      .select('value')
      .eq('player_id', callerId)
      .eq('key', 'activity_feed')
      .maybeSingle(),
  ]);
  if (defResult.error) return res.status(500).json({ error: 'Failed to load defender data' });

  const defArmiesByPlayer   = {};
  const defLordsByPlayer    = {};
  const defActivityByPlayer = {};
  for (const row of (defResult.data || [])) {
    if (row.key === 'armies')        defArmiesByPlayer[row.player_id]   = row.value || {};
    if (row.key === 'lords')         defLordsByPlayer[row.player_id]    = row.value || {};
    if (row.key === 'activity_feed') defActivityByPlayer[row.player_id] = row.value || {};
  }
  const atkActivityFeed = atkFeedResult.data?.value || {};

  // Attach army to each defender entry.
  const defenders = defenderEntries.map(({ playerId, lord }) => ({
    playerId,
    lord,
    army: (defArmiesByPlayer[playerId] || {})[lord.id] || { lordId: lord.id, units: [] },
  }));

  // 8. Visibility check: at least one defender must be detectable.
  const anyVisible = defenders.some(({ lord, army }) =>
    _visibilityScore(lord, army.units) > 0
  );
  if (!anyVisible) {
    return res.status(400).json({ error: 'All defenders are undetectable (visibility score 0)' });
  }

  // 9. Build context and resolve.
  const terrain = _terrain(tX, tY);
  const ctx     = _buildMultiContext(attackerLord, atkArmies[attackerLord.id], defenders, terrain);
  const report  = BattleEngine.resolve(ctx);

  // 10. Apply losses.
  const updatedAtkArmies = { ...atkArmies };
  _applyAtkLosses(updatedAtkArmies, attackerLord, report.attacker);
  _applyDefLosses(defenders, defArmiesByPlayer, report.defender);

  // Update lord HP for attacker.
  _applyLordHp(atkLords, attackerLord.id, report.attacker.unitsSurviving, report.winner, 'attacker');

  // Update lord HP for each defender.
  defenders.forEach(({ lord, playerId }) => {
    _applyLordHp(defLordsByPlayer[playerId] || {}, lord.id, report.defender.unitsSurviving, report.winner, 'defender');
  });

  // 11. Write battle result notifications to BOTH players' Supabase activity feeds.
  // Defender: gets the result so their client picks it up on next poll.
  // Attacker: also written to Supabase so future sessions / other devices stay in sync.
  const now     = Date.now();
  const rndTag  = () => Math.random().toString(36).slice(2, 5);
  const atkIcon = report.winner === 'attacker' ? '⚔' : report.winner === 'draw' ? '🤝' : '☠';
  const atkTitle = report.winner === 'attacker' ? 'PvP Victory' : report.winner === 'draw' ? 'PvP Draw' : 'PvP Defeat';
  const atkDetail = `${report.rounds} rounds · casualties: ${report.attacker.modelsLost} · +${report.xpEarned || 0}⭐`;

  // Attacker's feed
  if (!atkActivityFeed[callerId]) atkActivityFeed[callerId] = [];
  atkActivityFeed[callerId].unshift({
    id: `act_pvp_atk_${now}_${rndTag()}`, at: now, type: 'pvp_result',
    icon: atkIcon, title: atkTitle, detail: atkDetail,
    lordName: attackerLord.name, lordId: attackerLordId,
    outcome: report.winner === 'attacker' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat',
    report, terrain, rounds: report.rounds, modelsLost: report.attacker.modelsLost, xpEarned: report.xpEarned || 0,
  });
  atkActivityFeed[callerId] = atkActivityFeed[callerId].slice(0, 50);

  // Defender feeds
  defPlayerIds.forEach(pid => {
    const defIcon  = report.winner === 'defender' ? '🛡' : report.winner === 'draw' ? '🤝' : '☠';
    const defTitle = report.winner === 'defender' ? 'Attack repelled!' : report.winner === 'draw' ? 'Battle draw' : '☠ Defeat — lord attacked';
    const defDetail = `${attackerLord.name} attacked at (${tX},${tY}) · ${report.rounds} rounds · casualties: ${report.defender.modelsLost}`;
    const feed = defActivityByPlayer[pid] || {};
    if (!feed[pid]) feed[pid] = [];
    // Remove pvp_threat entries from this attacker — the battle has resolved
    feed[pid] = feed[pid].filter(e => !(e.type === 'pvp_threat' && e.lordName === attackerLord.name));
    const defLordId = defenders.find(d => d.playerId === pid)?.lord?.id || null;
    const defLordName = defenders.find(d => d.playerId === pid)?.lord?.name || '?';
    feed[pid].unshift({
      id: `act_pvp_def_${now}_${rndTag()}`, at: now, type: 'pvp_result',
      icon: defIcon, title: defTitle, detail: defDetail,
      lordName: defLordName, lordId: defLordId,
      outcome: report.winner === 'defender' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat',
      report, terrain, rounds: report.rounds, modelsLost: report.defender.modelsLost, xpEarned: 0,
    });
    feed[pid] = feed[pid].slice(0, 50);
    defActivityByPlayer[pid] = feed;
  });

  // 12. Write all results (not a true transaction — see known limitation above).
  const primaryDefender = defenders[0];
  const writes = [
    // Attacker armies, lords, activity_feed
    admin.from('storage').upsert(
      { player_id: callerId, key: 'armies', value: updatedAtkArmies },
      { onConflict: 'player_id,key' }
    ),
    admin.from('storage').upsert(
      { player_id: callerId, key: 'lords', value: atkLords },
      { onConflict: 'player_id,key' }
    ),
    admin.from('storage').upsert(
      { player_id: callerId, key: 'activity_feed', value: atkActivityFeed },
      { onConflict: 'player_id,key' }
    ),
    // Each defender player (armies + lords + activity feed)
    ...defPlayerIds.flatMap(pid => [
      admin.from('storage').upsert(
        { player_id: pid, key: 'armies', value: defArmiesByPlayer[pid] || {} },
        { onConflict: 'player_id,key' }
      ),
      admin.from('storage').upsert(
        { player_id: pid, key: 'lords', value: defLordsByPlayer[pid] || {} },
        { onConflict: 'player_id,key' }
      ),
      admin.from('storage').upsert(
        { player_id: pid, key: 'activity_feed', value: defActivityByPlayer[pid] || {} },
        { onConflict: 'player_id,key' }
      ),
    ]),
    // Battle report
    admin.from('battle_reports').insert({
      attacker_id:      callerId,
      defender_id:      primaryDefender.playerId,
      attacker_lord_id: attackerLord.id,
      defender_lord_id: primaryDefender.lord.id,
      tile_x:           tX,
      tile_y:           tY,
      terrain,
      winner:           report.winner,
      reason:           report.reason,
      rounds:           report.rounds,
      report_json:      report,
    }),
  ];

  const results   = await Promise.all(writes);
  const writeError = results.find(r => r.error)?.error;
  if (writeError) {
    console.error('[combat-resolver] write error:', writeError.message);
    return res.status(500).json({ error: 'Battle resolved but failed to persist: ' + writeError.message });
  }

  // 13. Return canonical report to caller.
  return res.status(200).json({ ok: true, report, terrain });
}
