// =============================================
//  actions/lord-mounts.js — POST /api/lord/mounts
//
//  Body: { lordId, mountId }
//
//  Equips (or swaps) a mount. Unlike talents, mount choice is not
//  permanent — a lord may re-equip a different mount at any time once
//  unlocked. Each equip costs MOUNT_POOL[id].cost gold, deducted from
//  the player on every swap (re-equipping the same mount you already
//  have is a no-op, no charge).
//
//  Mounts unlock in tiers (lv 5 / 8 / 10) — the gate is per-mount via
//  MOUNT_POOL[id].unlockLevel, not one flat level for the whole pool.
//  Mounts are also race-exclusive since 2026-07-30, gated below.
//  See the ladder writeup above MOUNT_POOL in js/data/lord-classes.js.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MOUNT_POOL, resolveMountId } from '../engine-loader.js';
import { lordBusyReason } from '../lord-busy.js';

export async function handleLordMounts(req, res) {
  const { lordId, mountId } = req.body || {};
  if (!lordId)  return res.status(400).json({ ok: false, error: 'Missing lordId' });
  if (!mountId) return res.status(400).json({ ok: false, error: 'Missing mountId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  // Mounts are chosen between orders (server/lord-busy.js). A mount changes
  // speed and the army PWR cap, so swapping one mid-march would re-time a
  // journey already in flight and could push the marching army over its cap.
  const busy = lordBusyReason(lord);
  if (busy) {
    return res.status(400).json({ ok: false, error: `${busy} — mounts can only be changed between orders.` });
  }

  // Own-property check, not a plain lookup: `mountId: 'constructor'` (or any
  // Object.prototype member) would otherwise sail past a truthiness test and
  // get written to lord.mountId as a free, level-5, zero-cost "mount".
  const mount = Object.prototype.hasOwnProperty.call(MOUNT_POOL, mountId) ? MOUNT_POOL[mountId] : null;
  if (!mount) return res.status(400).json({ ok: false, error: 'Unknown mount.' });

  // RACE GATE. Mounts became race-exclusive on 2026-07-30 and the client only
  // ever renders the lord's own pool — but the client is not the gate. Without
  // this check a hand-rolled POST puts a Dwarf on a Manticore, which is both a
  // stat profile that race is not meant to have and a mount that would then
  // silently migrate away on the next read (resolveMountId rewrites foreign
  // ids), i.e. the player would be charged 1.5M for something that evaporates.
  if (mount.race !== lord.race) {
    return res.status(400).json({ ok: false, error: 'That mount belongs to another race.' });
  }

  const required = mount.unlockLevel || 5;
  if ((lord.level || 1) < required) {
    return res.status(400).json({ ok: false, error: `${mount.name} unlocks at level ${required}.` });
  }

  // Compare against the RESOLVED current mount, not the raw stored id. A lord
  // carrying a pre-race-split id is already riding its race's equivalent
  // everywhere else in the game (resolveMountId), so charging them again to
  // "equip" the mount they are visibly on would be taking 300k–1.5M for
  // nothing. This branch also normalises the stored id for free, which is the
  // only place lord.mountId is ever rewritten.
  const currentId = resolveMountId(lord.mountId, lord.race);
  if (currentId !== mountId) {
    const cost = mount.cost || 0;
    if ((player.coins || 0) < cost) {
      return res.status(400).json({ ok: false, error: `Need ${cost} gold, have ${player.coins || 0}.` });
    }
    player.coins = (player.coins || 0) - cost;
  }
  lord.mountId = mountId;

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
