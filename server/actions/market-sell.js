// =============================================
//  actions/market-sell.js — POST /api/market/sell
//
//  Body: { resource: 'food'|'wood'|'stone', amount }
//
//  Sells resources from the empire-wide pool to the merchant for gold.
//  All rate/cap math lives in js/domain/market-core.js (shared with the
//  client) — this handler only authorises, applies and persists.
//
//  The buying half lives in actions/market-buy.js — one file per endpoint,
//  same as the rest of server/actions.
//
//  NO BUILDING GATES THIS (2026-08-04). The Merchant used to require a
//  Marketplace and size its daily cap off that building's highest level across
//  the player's cities; it is now a global empire counter, so this handler
//  never looks at `cities` at all. See market-core.js.
//
//  The daily volume ledger lives ON THE PLAYER as `player.marketLedger`
//  ({ date, gold }), deliberately NOT in a separate storage key the way
//  lord-action.js keeps 'search_fatigue'. That key exists because tile
//  depletion is bulky per-tile data the client never needs; this ledger is two
//  fields the UI must read to show remaining volume, and the player object is
//  already synced. Keeping it here means no extra plumbing and no way for the
//  client's display to disagree with the server's cap.
//
//  ⚠ The cap is currently OFF (MARKET_DAILY_GOLD_CAP = null). The ledger is
//  still written on every sale so re-enabling it cannot hand anyone a fresh
//  allowance they had already spent.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MarketCore } from '../engine-loader.js';

export async function handleMarketSell(req, res) {
  const { resource, amount } = req.body || {};
  if (!resource || amount == null) {
    return res.status(400).json({ ok: false, error: 'Missing resource or amount' });
  }
  if (!MarketCore.MARKET_RESOURCES.includes(resource)) {
    return res.status(400).json({ ok: false, error: `Cannot sell ${resource}.` });
  }

  const want = Math.floor(Number(amount));
  if (!Number.isFinite(want) || want <= 0) {
    return res.status(400).json({ ok: false, error: 'Amount must be a positive number.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const ledger = player.marketLedger || null;
  const now    = Date.now();

  // Never sell more than the player actually holds. Clamping instead of
  // erroring keeps a "sell all" button honest when production ticked between
  // the client's render and this request.
  player.resources = player.resources || { wood: 0, stone: 0, food: 0 };
  const held  = Math.floor(player.resources[resource] || 0);
  const asked = Math.min(want, held);
  if (asked <= 0) {
    return res.status(400).json({ ok: false, error: `You have no ${resource} to sell.` });
  }

  const quote = MarketCore.marketSellQuote(resource, asked, ledger, now);
  if (!quote.ok) return res.status(400).json({ ok: false, error: quote.error });

  // Apply: take exactly quote.spend, credit quote.gold.
  player.resources[resource] = held - quote.spend;
  player.coins = Math.floor(player.coins || 0) + quote.gold;
  player.marketLedger = MarketCore.marketRecord(ledger, quote.gold, now);

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({
    ok: true,
    player,
    sale: {
      resource,
      spent:     quote.spend,
      gold:      quote.gold,
      capped:    quote.capped,
      remaining: MarketCore.marketRemainingToday(player.marketLedger, now),
      dailyCap:  MarketCore.marketDailyCap(),
    },
  });
}
