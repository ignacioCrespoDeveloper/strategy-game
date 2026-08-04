// =============================================
//  merchant-screen.js — The Merchant (global nav entry)
//
//  Trades the empire-wide resource pool against the empire-wide gold pile,
//  both directions. All rate maths comes from MarketCore, shared verbatim with
//  server/actions/market-sell.js and market-buy.js — this file renders the
//  quotes MarketCore returns and never computes a rate of its own.
//
//  WHY IT IS GLOBAL AND NOT A CITY TAB (2026-08-04, Nacho): it moved out of the
//  Marketplace building's panel into a city tab, then out of the city entirely
//  in the same day. Neither pool it touches belongs to a city — resources and
//  gold are both empire-wide — so opening it from inside Ravenholt while it
//  spends Highkeep's gold was a lie about scope. It is one card per tradable
//  resource, reachable from anywhere.
//
//  AMOUNT INPUTS, NOT JUST PRESET BUTTONS. The old in-city panel used fixed
//  "Sell ½ / Sell max" buttons specifically because the whole city view
//  re-rendered after every action and would wipe an input mid-typing. That
//  constraint is gone here: `_amounts` holds every field's value across
//  re-renders (and `_focusKey` restores the caret), so the player can type an
//  exact figure. The quick chips remain because "dump it all" is still the
//  common move.
// =============================================

const MerchantScreen = (() => {
  let _player = null;
  let _lord   = null;
  let _root   = null;

  // Typed amounts, keyed `${side}:${resource}` — survives the re-render that
  // follows every trade. Sell fields are in RESOURCE units, buy fields in GOLD.
  let _amounts  = {};
  // Which field had focus when we re-rendered, so typing is not interrupted.
  let _focusKey = null;

  const RES = {
    wood:  { icon: () => gi('wood-pile'), name: 'Wood'  },
    stone: { icon: () => gi('war-pick'),  name: 'Stone' },
    food:  { icon: () => gi('wheat'),     name: 'Food'  },
  };

  // Display order matches the HUD: wood → stone → food.
  const ORDER = ['wood', 'stone', 'food'];

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord }) {
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = lord ? LordService.getById(lord.id) : null;
    _amounts = {};
    _focusKey = null;
    root.innerHTML = _shell();
    _bindEvents();
  }

  function _rerender() {
    if (!_root) return;
    _root.innerHTML = _shell();
    _bindEvents();
    if (_focusKey) {
      const el = _root.querySelector(`[data-amount="${_focusKey}"]`);
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  function _toast(msg) { ToastService.show(msg); }

  // ── State helpers ─────────────────────────────────────────────

  function _held(res)  { return Math.floor((_player?.resources || {})[res] || 0); }
  function _coins()    { return Math.floor(_player?.coins || 0); }
  function _amount(key) {
    const n = parseInt(_amounts[key] ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    const ledger = _player?.marketLedger || null;
    const capped = MarketCore.marketHasDailyCap();
    // Only rendered when a cap is actually in force. Printing "Infinity gold
    // remaining" would be worse than printing nothing.
    const capLine = capped
      ? `Today: <b>${MarketCore.marketRemainingToday(ledger, TimeService.now()).toLocaleString()}</b>
         of ${Number(MarketCore.marketDailyCap()).toLocaleString()} gold remaining
         <span class="mk-cap-hint">(resets daily)</span>`
      : `<b>No daily limit</b> <span class="mk-cap-hint">(trade as much as you like)</span>`;

    return `
      <div class="mk-screen">
        <div class="mk-head">
          <div class="mk-head-title">${gi('shop')} The Merchant</div>
          <div class="mk-head-purse">${gi('two-coins')} <b>${_coins().toLocaleString()}</b> gold</div>
        </div>
        <div class="mk-cap">${capLine}</div>

        <div class="mk-cards">
          ${ORDER.map(res => _resourceCardHtml(res)).join('')}
        </div>

        <div class="mk-note">
          The merchant buys low and sells high — you always lose on a round trip, by design.
          This is a way to unstick a surplus you cannot spend, or cover a shortfall in a hurry;
          it is never cheaper than producing the resource yourself.
        </div>
      </div>
    `;
  }

  // One card per resource: what you hold, both rates, and a sell row and a buy
  // row. Every figure shown is the number MarketCore would actually apply — the
  // preview under each input is a real quote, not an estimate.
  function _resourceCardHtml(res) {
    const meta     = RES[res];
    const held     = _held(res);
    const sellRate = MarketCore.MARKET_SELL_RATES[res];
    const buyRate  = MarketCore.MARKET_BUY_RATES[res];
    const ledger   = _player?.marketLedger || null;
    const now      = TimeService.now();

    const sellKey = `sell:${res}`;
    const buyKey  = `buy:${res}`;

    // Sell: the field is in resource units, clamped to what is held.
    const sellWant  = Math.min(_amount(sellKey), held);
    const sellQuote = sellWant > 0 ? MarketCore.marketSellQuote(res, sellWant, ledger, now) : null;

    // Buy: the field is in gold, clamped to the purse.
    const buyWant  = Math.min(_amount(buyKey), _coins());
    const buyQuote = buyWant > 0 ? MarketCore.marketBuyQuote(res, buyWant, _coins()) : null;

    const sellPreview = sellQuote?.ok
      ? `Give ${sellQuote.spend.toLocaleString()} ${meta.name.toLowerCase()} → get ${gi('two-coins')}<b>${sellQuote.gold.toLocaleString()}</b>${sellQuote.capped ? ' (daily limit)' : ''}`
      : `<span class="mk-preview-muted">${sellQuote ? sellQuote.error : `Minimum ${sellRate} ${meta.name.toLowerCase()}`}</span>`;

    const buyPreview = buyQuote?.ok
      ? `Spend ${gi('two-coins')}${buyQuote.spend.toLocaleString()} → get <b>${buyQuote.receive.toLocaleString()}</b> ${meta.name.toLowerCase()}`
      : `<span class="mk-preview-muted">${buyQuote ? buyQuote.error : 'Minimum 1 gold'}</span>`;

    return `
      <div class="mk-card">
        <div class="mk-card-head">
          <span class="mk-card-res">${meta.icon()} ${meta.name}</span>
          <span class="mk-card-held">${held.toLocaleString()} held</span>
        </div>

        <div class="mk-side mk-side--sell">
          <div class="mk-side-head">
            <span class="mk-side-label">Sell</span>
            <span class="mk-side-rate">${sellRate} ${meta.name.toLowerCase()} → 1 gold</span>
          </div>
          <div class="mk-side-input">
            <input class="mk-amount" type="number" min="0" inputmode="numeric"
                   data-amount="${sellKey}" placeholder="0"
                   value="${_amounts[sellKey] ?? ''}" aria-label="Amount of ${meta.name} to sell" />
            <button class="mk-chip" data-fill="${sellKey}" data-fill-value="${Math.floor(held / 2)}">½</button>
            <button class="mk-chip" data-fill="${sellKey}" data-fill-value="${held}">All</button>
          </div>
          <div class="mk-preview">${sellPreview}</div>
          <button class="mk-trade-btn mk-trade-btn--sell" data-sell="${res}" ${sellQuote?.ok ? '' : 'disabled'}>
            Sell
          </button>
        </div>

        <div class="mk-side mk-side--buy">
          <div class="mk-side-head">
            <span class="mk-side-label">Buy</span>
            <span class="mk-side-rate">1 gold → ${buyRate} ${meta.name.toLowerCase()}</span>
          </div>
          <div class="mk-side-input">
            <input class="mk-amount" type="number" min="0" inputmode="numeric"
                   data-amount="${buyKey}" placeholder="0"
                   value="${_amounts[buyKey] ?? ''}" aria-label="Gold to spend on ${meta.name}" />
            <button class="mk-chip" data-fill="${buyKey}" data-fill-value="${Math.floor(_coins() / 2)}">½</button>
            <button class="mk-chip" data-fill="${buyKey}" data-fill-value="${_coins()}">All</button>
          </div>
          <div class="mk-preview">${buyPreview}</div>
          <button class="mk-trade-btn mk-trade-btn--buy" data-buy="${res}" ${buyQuote?.ok ? '' : 'disabled'}>
            Buy
          </button>
        </div>
      </div>
    `;
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    // Typing re-renders so the preview under the field tracks the number, and
    // so the Sell/Buy button enables the moment the amount becomes valid.
    _root.querySelectorAll('.mk-amount[data-amount]').forEach(input => {
      input.addEventListener('input', () => {
        const key = input.dataset.amount;
        _amounts[key] = input.value;
        _focusKey     = key;
        _rerender();
      });
    });

    _root.querySelectorAll('.mk-chip[data-fill]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.fill;
        _amounts[key] = String(Math.max(0, parseInt(btn.dataset.fillValue || '0', 10)));
        _focusKey     = key;
        _rerender();
      });
    });

    // The server clamps to real holdings and (when enabled) the remaining daily
    // volume, so we report what it ACTUALLY traded, not what we asked for.
    _root.querySelectorAll('.mk-trade-btn[data-sell]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = btn.dataset.sell;
        btn.disabled = true;
        const result = await ServerActions.marketSell(res, _amount(`sell:${res}`));
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _afterTrade(`sell:${res}`);
        const s = result.sale || {};
        _toast(s.capped
          ? `Sold ${(s.spent || 0).toLocaleString()} ${res} for ${(s.gold || 0).toLocaleString()} gold — daily limit reached.`
          : `Sold ${(s.spent || 0).toLocaleString()} ${res} for ${(s.gold || 0).toLocaleString()} gold.`);
      });
    });

    _root.querySelectorAll('.mk-trade-btn[data-buy]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = btn.dataset.buy;
        btn.disabled = true;
        const result = await ServerActions.marketBuy(res, _amount(`buy:${res}`));
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _afterTrade(`buy:${res}`);
        const p = result.purchase || {};
        _toast(`Bought ${(p.received || 0).toLocaleString()} ${res} for ${(p.spent || 0).toLocaleString()} gold.`);
      });
    });
  }

  // Clear only the field that was just spent — leaving a stale number under a
  // now-empty stockpile invites a second click that can only fail.
  function _afterTrade(key) {
    _amounts[key] = '';
    _focusKey     = null;
    _player       = PlayerService.getById(_player.id);
    _rerender();
    EventBus.emit('resources:changed');
    HUD.refresh();
  }

  return { render };
})();
