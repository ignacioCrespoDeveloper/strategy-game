// =============================================
//  actions/lord-mounts.js — POST /api/lord/mounts
//
//  Body: { lordId, mountId }
//
//  Equips (or swaps) a mount, unlocked at level 5. Unlike talents,
//  mount choice is not permanent — a lord may re-equip a different
//  mount at any time once unlocked. Each equip costs MOUNT_POOL[id].cost
//  gold, deducted from the player on every swap (re-equipping the same
//  mount you already have is a no-op, no charge).
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MOUNT_POOL } from '../engine-loader.js';

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
  if ((lord.level || 1) < 5)      return res.status(400).json({ ok: false, error: 'Mounts unlock at level 5.' });

  const mount = MOUNT_POOL?.[mountId];
  if (!mount) return res.status(400).json({ ok: false, error: 'Unknown mount.' });

  if (lord.mountId !== mountId) {
    const cost = mount.cost || 0;
    if ((player.coins || 0) < cost) {
      return res.status(400).json({ ok: false, error: `Need ${cost}💰, have ${player.coins || 0}💰.` });
    }
    player.coins = (player.coins || 0) - cost;
    lord.mountId = mountId;
  }

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord, player });
}
