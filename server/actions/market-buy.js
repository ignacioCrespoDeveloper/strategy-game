// =============================================
//  actions/market-buy.js — POST /api/market/buy
//
//  Body: { resource: 'food'|'wood'|'stone', gold }
//
//  Buys resources from the merchant with gold, into the empire-wide pool.
//  The mirror of actions/market-sell.js; all rate math lives in
//  js/domain/market-core.js (shared with the client) — this handler only
//  authorises, applies and persists.
//
//  `gold` is what the player OFFERS to spend, not what they will necessarily
//  spend: marketBuyQuote clamps it to their real balance, so a "spend it all"
//  button stays honest if income ticked between the client's render and this
//  request. Read `purchase.spent` / `purchase.received` from the response
//  rather than assuming the requested amount went through.
//
//  DELIBERATELY NOT LEDGERED. The daily volume cap (currently off) bounds gold
//  ENTERING the economy; buying removes gold from it. Charging purchases
//  against the same allowance would throttle the harmless direction — and
//  would let a player lock themselves out of buying by having sold earlier.
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { MarketCore } from '../engine-loader.js';

export async function handleMarketBuy(req, res) {
  const { resource, gold } = req.body || {};
  if (!resource || gold == null) {
    return res.status(400).json({ ok: false, error: 'Missing resource or gold' });
  }
  if (!MarketCore.MARKET_RESOURCES.includes(resource)) {
    return res.status(400).json({ ok: false, error: `Cannot buy ${resource}.` });
  }

  const want = Math.floor(Number(gold));
  if (!Number.isFinite(want) || want <= 0) {
    return res.status(400).json({ ok: false, error: 'Gold must be a positive number.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const coins = Math.floor(player.coins || 0);
  const quote = MarketCore.marketBuyQuote(resource, want, coins);
  if (!quote.ok) return res.status(400).json({ ok: false, error: quote.error });

  // Apply: take exactly quote.spend gold, credit quote.receive resources.
  player.resources = player.resources || { wood: 0, stone: 0, food: 0 };
  player.coins = coins - quote.spend;
  player.resources[resource] = Math.floor(player.resources[resource] || 0) + quote.receive;

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({
    ok: true,
    player,
    purchase: {
      resource,
      spent:    quote.spend,
      received: quote.receive,
      rate:     quote.rate,
    },
  });
}
