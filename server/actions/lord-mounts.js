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
//  See the ladder writeup above MOUNT_POOL in js/data/lord-classes.js.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MOUNT_POOL, getMountForRace } from '../engine-loader.js';

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

  // Own-property check, not a plain lookup: `mountId: 'constructor'` (or any
  // Object.prototype member) would otherwise sail past a truthiness test and
  // get written to lord.mountId as a free, level-5, zero-cost "mount".
  const mount = Object.prototype.hasOwnProperty.call(MOUNT_POOL, mountId) ? MOUNT_POOL[mountId] : null;
  if (!mount) return res.status(400).json({ ok: false, error: 'Unknown mount.' });

  const required = mount.unlockLevel || 5;
  if ((lord.level || 1) < required) {
    // Name it the way this lord's race sees it, so a Dark Elf reads
    // "Black Dragon unlocks at level 10" and not "Dragon".
    const shown = getMountForRace(mountId, lord.race) || mount;
    return res.status(400).json({ ok: false, error: `${shown.name} unlocks at level ${required}.` });
  }

  if (lord.mountId !== mountId) {
    const cost = mount.cost || 0;
    if ((player.coins || 0) < cost) {
      return res.status(400).json({ ok: false, error: `Need ${cost} gold, have ${player.coins || 0}.` });
    }
    player.coins = (player.coins || 0) - cost;
    lord.mountId = mountId;
  }

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
