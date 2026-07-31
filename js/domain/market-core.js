// =============================================
//  market-core.js — The Merchant: resources → gold
//
//  Pure, isomorphic. Loaded in the browser (index.html) AND on the
//  server via server/engine-loader.js — never duplicate these rates.
//  Plain data in, plain data out; no service dependencies.
//
//  WHY IT EXISTS: gold and resources were two sealed loops. Gold bought
//  units/lords/cities/mounts/blessings; resources bought buildings and
//  research; nothing converted either way. A player sitting on millions of
//  wood with no gold for a mount had no move to make.
//
//  WHY IT IS DELIBERATELY BAD VALUE: resources are the over-supplied pool —
//  run `node scripts/economy-projection.js` for the live ratio rather than
//  trusting a number written here (this header used to claim ~3.1M/day against
//  ~250k gold/day, both measured with the tuning dials at 1.0 and never
//  updated; the real curve is roughly a third of that). At a fair rate the
//  merchant would become the primary gold strategy and drown the gold economy.
//  So it is a DUMP VALVE, not an income channel:
//    · the rate is ~2.5x worse than production parity, and
//    · a hard daily volume cap means it can never scale with your stockpile.
//  The cap is the real safety mechanism. The rate alone would not be enough:
//  a single tier-3 expedition find is up to 187,200 of one resource.
// =============================================

var MarketCore = (() => {

  // Resource units required per 1 gold. Anchored on production parity: at
  // comparable investment a city yields ~98 gold/h against ~778 wood/h, so
  // "fair" is roughly 8 wood : 1 gold. These are ~2x worse than that on
  // purpose. Stone is cheapest per gold because stone is the tightest of the
  // three (quarry costs grow x1.6 vs x1.5 and the apex tier is stone-heavy);
  // food is dearest because march cost is its only sink.
  const MARKET_RATES = { wood: 20, stone: 15, food: 25 };

  // Daily sell allowance, in GOLD RECEIVED, per level of the player's best
  // Marketplace. At Marketplace 10 that is 30,000 gold/day. This finally gives
  // the Marketplace a reason to level beyond its +8%/level passive gold trickle.
  //
  // That was sized as "about 12% of endgame gold income" against a dials-at-1.0
  // figure. Re-measured 2026-07-30 it was ~27% — over the 25% its own test
  // asserted, which the test failed to catch because it held the same stale
  // number. Phase 1 of ECONOMY-REBALANCE-PLAN.md (questGold 0.25 → 0.60) lifted
  // endgame gold income to ~145k/day, so the cap is now ~21%: a minority
  // channel again, on measured numbers. test-economy.js bounds it at 25%.
  const MARKET_GOLD_PER_MK_LEVEL = 3000;

  // Marketplace level needed to trade at all.
  const MARKET_MIN_MARKETPLACE = 1;

  const MARKET_RESOURCES = ['food', 'wood', 'stone'];

  function marketDailyCap(marketplaceLevel) {
    const lvl = Math.max(0, Math.floor(marketplaceLevel || 0));
    if (lvl < MARKET_MIN_MARKETPLACE) return 0;
    return lvl * MARKET_GOLD_PER_MK_LEVEL;
  }

  // UTC date key, same shape as the expedition tile-depletion counter in
  // server/actions/lord-action.js so both age out the same way. A ledger from
  // a previous day simply reads as zero sold — no migration, no cleanup job.
  function marketDayKey(nowMs) {
    return new Date(nowMs == null ? Date.now() : nowMs).toISOString().slice(0, 10);
  }

  // ledger: { date: 'YYYY-MM-DD', gold: <gold sold that day> } | null
  function marketSoldToday(ledger, nowMs) {
    if (!ledger || ledger.date !== marketDayKey(nowMs)) return 0;
    return Math.max(0, Math.floor(ledger.gold || 0));
  }

  function marketRemainingToday(marketplaceLevel, ledger, nowMs) {
    return Math.max(0, marketDailyCap(marketplaceLevel) - marketSoldToday(ledger, nowMs));
  }

  // What selling `amount` of `resource` would actually do right now.
  //
  // PARTIAL FILLS ARE INTENTIONAL: if the daily cap can only absorb part of the
  // requested amount we convert that part rather than rejecting, and `spend` is
  // always an exact multiple of the rate so the player never loses a remainder
  // to rounding. `capped` lets the UI say why it sold less than asked.
  //
  // Returns { ok, error?, gold, spend, rate, remaining, capped }.
  function marketQuote(resource, amount, marketplaceLevel, ledger, nowMs) {
    const rate = MARKET_RATES[resource];
    const fail = error => ({ ok: false, error, gold: 0, spend: 0, rate: rate || 0, remaining: 0, capped: false });

    if (!rate) return fail(`${resource} cannot be sold.`);
    if (marketplaceLevel < MARKET_MIN_MARKETPLACE) {
      return fail(`Requires a Marketplace (level ${MARKET_MIN_MARKETPLACE}+) in one of your cities.`);
    }

    const want = Math.floor(amount || 0);
    if (want < rate) return fail(`Minimum sale is ${rate} ${resource} (1 gold).`);

    const remaining = marketRemainingToday(marketplaceLevel, ledger, nowMs);
    if (remaining <= 0) {
      return fail(`The merchant has bought all he can today. Cap is ${marketDailyCap(marketplaceLevel).toLocaleString()} gold/day.`);
    }

    const goldWanted = Math.floor(want / rate);
    const gold       = Math.min(goldWanted, remaining);

    return {
      ok: true,
      gold,
      spend: gold * rate,   // exact — no remainder is taken
      rate,
      remaining,
      capped: gold < goldWanted,
    };
  }

  // Fold a completed sale into the ledger. Resets automatically on date change.
  function marketRecord(ledger, gold, nowMs) {
    return { date: marketDayKey(nowMs), gold: marketSoldToday(ledger, nowMs) + Math.max(0, Math.floor(gold || 0)) };
  }

  return {
    marketDailyCap, marketDayKey, marketSoldToday, marketRemainingToday,
    marketQuote, marketRecord,
    MARKET_RATES, MARKET_GOLD_PER_MK_LEVEL, MARKET_MIN_MARKETPLACE, MARKET_RESOURCES,
  };
})();
