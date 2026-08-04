// =============================================
//  market-core.js — The Merchant: resources ⇄ gold
//
//  Pure, isomorphic. Loaded in the browser (index.html) AND on the
//  server via server/engine-loader.js — never duplicate these rates.
//  Plain data in, plain data out; no service dependencies.
//
//  WHY IT EXISTS: gold and resources were two sealed loops. Gold bought
//  units/lords/cities/mounts/blessings; resources bought buildings and
//  research; nothing converted either way. A player sitting on millions of
//  wood with no gold for a mount had no move to make — and, since 2026-08-04,
//  the reverse: a player rich in gold could not turn it into the stone a
//  building needed.
//
//  NOT THE MARKETPLACE, NOT A CITY (2026-08-04, Nacho's call, in two steps).
//  The Merchant first moved out of the Marketplace building's panel, then out
//  of the city view entirely. It is a GLOBAL counter on the main nav: it
//  trades the empire-wide resource pool against the empire-wide gold pile, so
//  attaching it to any one city was always a lie about what it touches. No
//  building gates it, no building sizes it. Nothing here reads `buildings`.
//
//  ── THE SPREAD IS THE WHOLE BALANCE MECHANISM ───────────────────────────
//  Both directions are deliberately worse than production parity (~8 wood : 1
//  gold at comparable investment), and BUYING is ~4x worse than SELLING. That
//  gap is what makes the merchant a convenience rather than a strategy:
//    · you cannot round-trip for profit — 20 wood sells for 1 gold, and that
//      gold buys 5 wood back, a 75% loss per lap. This holds for every pair,
//      and it is the ONE invariant that must never break (test-economy.js
//      checks every resource in both directions).
//    · selling stays a dump valve: 2.5x worse than growing the wood yourself.
//    · buying stays an emergency top-up: 5 wood per gold is a fraction of what
//      a Lumber Mill returns for the same investment.
//
//  ⚠ THE DAILY CAP IS OFF (2026-08-04, Nacho: "no hay limite diario, por
//  ahora"). It used to be the primary safety mechanism — 30,000 gold/day —
//  precisely because the rate alone does not bound a stockpile dump: at
//  endgame resource income (~3.09M/day, see scripts/economy-projection.js)
//  selling wood alone converts to ~154k gold/day against ~145k/day of all
//  other gold income combined. In other words the merchant can now be the
//  single largest gold channel in the game. That is a known, accepted state
//  while testing, not an oversight. Re-enabling is ONE number: set
//  MARKET_DAILY_GOLD_CAP back to 30000. Everything downstream — the ledger,
//  the partial-fill path, the "remaining today" display — is still wired and
//  still tested, so nothing has to be rebuilt to turn it back on.
// =============================================

var MarketCore = (() => {

  // SELL — resource units the player hands over per 1 gold received.
  // Anchored on production parity: at comparable investment a city yields ~98
  // gold/h against ~778 wood/h, so "fair" is roughly 8 wood : 1 gold. These are
  // ~2.5x worse than that on purpose. Stone is cheapest per gold because stone
  // is the tightest of the three (quarry costs grow x1.6 vs x1.5 and the apex
  // tier is stone-heavy); food is dearest because march cost is its only sink.
  const MARKET_SELL_RATES = { wood: 20, stone: 15, food: 25 };

  // BUY — resource units the player receives per 1 gold spent.
  // Roughly a quarter of the matching sell rate (the exact ratios are 4.00 /
  // 3.75 / 4.17 — these are round numbers a player can hold in their head, not
  // a formula). The ORDERING is what matters and is asserted in the tests:
  // buyRate must stay well under sellRate for every resource, or the merchant
  // becomes a money pump.
  const MARKET_BUY_RATES = { wood: 5, stone: 4, food: 6 };

  // Daily sell allowance in GOLD RECEIVED, or null for "no limit".
  // null = OFF, by design — see the header. Set to a number to re-enable; the
  // ledger below keeps recording either way, so switching it back on does not
  // hand anyone a fresh allowance they had already spent.
  const MARKET_DAILY_GOLD_CAP = null;

  const MARKET_RESOURCES = ['wood', 'stone', 'food'];

  // Returns null when there is no cap. Callers must handle null rather than
  // treating it as 0 — a falsy check here would read "no trading allowed",
  // which is the exact opposite of what null means.
  function marketDailyCap() {
    return MARKET_DAILY_GOLD_CAP;
  }

  function marketHasDailyCap() {
    return typeof MARKET_DAILY_GOLD_CAP === 'number' && isFinite(MARKET_DAILY_GOLD_CAP);
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

  // Gold the merchant will still pay out today. Infinity when uncapped, so
  // arithmetic against it (Math.min in the quote) needs no special case.
  function marketRemainingToday(ledger, nowMs) {
    if (!marketHasDailyCap()) return Infinity;
    return Math.max(0, MARKET_DAILY_GOLD_CAP - marketSoldToday(ledger, nowMs));
  }

  // ── SELL: resources → gold ────────────────────────────────────
  //
  // PARTIAL FILLS ARE INTENTIONAL: if a daily cap is in force and can only
  // absorb part of the requested amount we convert that part rather than
  // rejecting, and `spend` is always an exact multiple of the rate so the
  // player never loses a remainder to rounding. `capped` lets the UI say why
  // it sold less than asked. With the cap off, `capped` is always false.
  //
  // Returns { ok, error?, gold, spend, rate, remaining, capped }.
  function marketSellQuote(resource, amount, ledger, nowMs) {
    const rate = MARKET_SELL_RATES[resource];
    const fail = error => ({ ok: false, error, gold: 0, spend: 0, rate: rate || 0, remaining: 0, capped: false });

    if (!rate) return fail(`${resource} cannot be sold.`);

    const want = Math.floor(amount || 0);
    if (want < rate) return fail(`Minimum sale is ${rate} ${resource} (1 gold).`);

    const remaining = marketRemainingToday(ledger, nowMs);
    if (remaining <= 0) {
      return fail(`The merchant has bought all he can today. Cap is ${Number(MARKET_DAILY_GOLD_CAP).toLocaleString()} gold/day.`);
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

  // ── BUY: gold → resources ─────────────────────────────────────
  //
  // `gold` is what the player offers to spend; `coins` is what they actually
  // hold. Clamping instead of erroring keeps a "spend it all" button honest
  // when income ticked between the client's render and the request — the same
  // rule the sell path uses for resources.
  //
  // NOT subject to the daily ledger: that cap exists to bound gold ENTERING
  // the economy, and buying removes gold from it. Capping this direction would
  // limit the harmless half of the trade.
  //
  // Returns { ok, error?, spend, receive, rate }.
  function marketBuyQuote(resource, gold, coins) {
    const rate = MARKET_BUY_RATES[resource];
    const fail = error => ({ ok: false, error, spend: 0, receive: 0, rate: rate || 0 });

    if (!rate) return fail(`${resource} cannot be bought.`);

    const held  = Math.max(0, Math.floor(coins || 0));
    const spend = Math.min(Math.floor(gold || 0), held);

    if (spend < 1) {
      return fail(held < 1 ? 'You have no gold to spend.' : 'Minimum purchase is 1 gold.');
    }

    return { ok: true, spend, receive: spend * rate, rate };
  }

  // Fold a completed sale into the ledger. Resets automatically on date change.
  // Still recorded while the cap is off — see the note on MARKET_DAILY_GOLD_CAP.
  function marketRecord(ledger, gold, nowMs) {
    return { date: marketDayKey(nowMs), gold: marketSoldToday(ledger, nowMs) + Math.max(0, Math.floor(gold || 0)) };
  }

  return {
    marketDailyCap, marketHasDailyCap, marketDayKey, marketSoldToday, marketRemainingToday,
    marketSellQuote, marketBuyQuote, marketRecord,
    MARKET_SELL_RATES, MARKET_BUY_RATES, MARKET_DAILY_GOLD_CAP, MARKET_RESOURCES,
  };
})();
