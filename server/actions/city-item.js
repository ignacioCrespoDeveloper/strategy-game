// =============================================
//  actions/city-item.js — Apply a city item
//
//  POST /api/city/item-apply  { cityId, itemId }
//
//  Items are found by expeditions (DiscoveryRoll's 'item' category), land in
//  player.items — an empire-wide backpack — and are spent HERE, onto one city,
//  for a fixed number of hours. See js/data/items.js for the catalog and the
//  design rules; server/tick/catch-up.js is what actually pays the bonus out
//  and what drops the entry once it lapses.
//
//  There is NO slot limit and NO cost (Nacho's call, 2026-08-04): a city holds
//  as many active items as the player is willing to spend, and two of the same
//  item stack as two independent entries with their own expiries. The item was
//  already paid for by the expedition that found it.
//
//  State written:
//    player.items[itemId] -= 1   (key deleted at zero — see below)
//    city.activeItems     += { itemId, startedAt, expiresAt }
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { ITEM_DEFS, itemDurationMs }  from '../engine-loader.js';

export async function handleCityItemApply(req, res) {
  const { cityId, itemId } = req.body || {};
  if (!cityId) return res.status(400).json({ ok: false, error: 'Missing cityId' });
  if (!itemId) return res.status(400).json({ ok: false, error: 'Missing itemId' });

  const def = ITEM_DEFS[itemId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown item' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const city = cities[cityId];
  if (!city)                      return res.status(404).json({ ok: false, error: 'City not found' });
  if (city.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your city' });

  // The backpack is the only gate. Holding the item IS the permission.
  const held = Math.floor((player.items || {})[itemId] || 0);
  if (held < 1) return res.status(400).json({ ok: false, error: `You have no ${def.name} to use.` });

  player.items = player.items || {};
  if (held === 1) delete player.items[itemId];   // keep the backpack free of 0-count keys,
  else            player.items[itemId] = held - 1; // which would render as empty rows client-side

  // loadAndCatchUp already ran catchUp, so this city's production is credited
  // and lastResourceUpdate is stamped up to now — the new item therefore starts
  // earning from `now` and cannot retroactively boost hours already paid.
  const now = Date.now();
  city.activeItems = (city.activeItems || []).filter(e => !e || !e.expiresAt || now < e.expiresAt);
  city.activeItems.push({
    itemId,
    startedAt: now,
    expiresAt: now + itemDurationMs(itemId),
  });

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  // Schedule the expiry so the item lapses server-side even if the player never
  // comes back before it ends — same reason blessings do it (actions/blessing.js).
  // Not load-bearing: getCityItemEffects already stops paying at expiresAt and
  // catch-up prunes the entry on the next tick either way. This just makes the
  // tick happen on time instead of on next login.
  const expiresAt = city.activeItems[city.activeItems.length - 1].expiresAt;
  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'city_item',
    fire_at:   expiresAt,
    payload:   { cityId, itemId },
  });
  if (evtErr) console.warn('[city-item] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, player, city });
}
