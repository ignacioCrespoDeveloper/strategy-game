// =============================================
//  actions/lord-mount-sell.js — POST /api/lord/mount-sell
//
//  Body: { lordId }
//
//  Sells the lord's current mount back for a fraction of its price and
//  leaves the lord unmounted. The lord may then equip anything else in
//  its race pool at full price (server/actions/lord-mounts.js).
//
//  WHY THIS EXISTS. Equipping charges full price on every swap and never
//  refunded, which at 300k–1.5M made the pick effectively permanent — a
//  player who bought the wrong level-10 mount was simply stuck with it.
//  Selling gives the decision a way back without making it free.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MOUNT_POOL, resolveMountId, mountSellValue } from '../engine-loader.js';
import { lordBusyReason } from '../lord-busy.js';

export async function handleLordMountSell(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  // The equip twin's rule, for the same reason (server/lord-busy.js): selling
  // mid-march would strip speed and PWR cap out from under an order already
  // under way — and it is the one move that can leave an army over its cap.
  const busy = lordBusyReason(lord);
  if (busy) {
    return res.status(400).json({ ok: false, error: `${busy} — mounts can only be changed between orders.` });
  }

  // Price the RESOLVED mount, not the raw stored id. A lord carrying a
  // pre-race-split id is riding its race's equivalent everywhere else in the
  // game, so that is what it sells — and because slots are equal-priced
  // within a level, it refunds against exactly what the player paid.
  // An unresolvable id means the lord is effectively unmounted already.
  const mountId = resolveMountId(lord.mountId, lord.race);
  const mount   = mountId ? MOUNT_POOL[mountId] : null;
  if (!mount) return res.status(400).json({ ok: false, error: 'No mount to sell.' });

  // Shared with the client's Sell button (MOUNT_SELL_REFUND lives in
  // js/data/lord-classes.js) so the price shown is the price paid.
  const refund = mountSellValue(mount);

  player.coins = (player.coins || 0) + refund;
  lord.mountId = null;

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // `sold` and `refund` drive the toast — the client should never re-derive
  // the number, since the refund fraction lives here.
  return res.json({ ok: true, lord, player, sold: mount.name, refund });
}
