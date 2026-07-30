// =============================================
//  hud.js — Persistent top bar (visible after login)
// =============================================

const HUD = (() => {
  let _lord        = null;
  let _player      = null;
  let _rank        = null;
  let _clockTimer  = null;
  let _alertTimer  = null;
  let _alertTick   = 0;
  let _lastSeenFeedId = null;

  // Render order = economic weight: gold, then wood → stone → food
  // (food is the scarcest/most expensive produced resource).
  const RES = {
    coins: { icon: gi('two-coins'), label: 'Gold'  },
    wood:  { icon: gi('wood-pile'), label: 'Wood'  },
    stone: { icon: gi('war-pick'),  label: 'Stone' },
    food:  { icon: gi('wheat'), label: 'Food'  },
  };

  function _updateClock() {
    const el = document.getElementById('hud-clock');
    if (!el) return;
    const d = new Date(TimeService.serverNow());
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }

  function show(player, lord) {
    _player = player;
    _lord   = lord;
    const bar = document.getElementById('hud-bar');
    bar.innerHTML = _html();
    bar.classList.remove('hidden');
    document.body.classList.add('hud-active');
    _bindEvents();
    refresh();
    _refreshRank();
    _updateClock();
    if (_clockTimer) clearInterval(_clockTimer);
    _clockTimer = setInterval(_updateClock, 1000);
    _startAlertPolling();
  }

  async function _refreshRank() {
    if (!_player) return;
    try {
      const score = RankingService.computeScore(_player);
      await RankingService.saveScore(_player, score);
      const board = await RankingService.fetchLeaderboard();
      _rank = RankingService.getPlayerRank(_player.id, board);
      const el = document.getElementById('hud-rank-badge');
      if (el) el.textContent = _rank ? `(#${_rank})` : '';
    } catch (e) {
      console.warn('[HUD] rank refresh failed', e);
    }
  }

  function hide() {
    if (_clockTimer) { clearInterval(_clockTimer); _clockTimer = null; }
    _stopAlertPolling();
    const bar = document.getElementById('hud-bar');
    bar.classList.add('hidden');
    bar.innerHTML = '';
    document.body.classList.remove('hud-active');
    _lord = _player = null;
  }

  // ── PvP alert polling — runs on EVERY screen, not just Overview ──
  //
  // Previously this lived only in overview-screen.js's own poll timer, which
  // only ran while that specific screen was mounted. A defender sitting on
  // the map, a city, or their lord screen when an attack resolved got zero
  // notification — the activity_feed entry just sat in Supabase until they
  // either navigated back to Overview or did a full page reload (which
  // always lands on Overview via App._afterAuth, incidentally "fixing" it).
  // Hosting it here instead means it's live everywhere HUD is shown, which
  // is effectively every authenticated screen.
  function _startAlertPolling() {
    _stopAlertPolling();
    _alertTick = 0;
    _alertTimer = setInterval(() => {
      _alertTick++;
      _pollActivityFeed();
    }, 10000);
    _pollActivityFeed(); // don't wait a full 10s for the first check
  }

  function _stopAlertPolling() {
    if (_alertTimer) { clearInterval(_alertTimer); _alertTimer = null; }
  }

  async function _pollActivityFeed() {
    if (!_player) return;
    try {
      const { data: { session } } = await SupabaseService.client.auth.getSession();
      if (!session?.user?.id) return;
      const pid = session.user.id;

      const { data } = await SupabaseService.client
        .from('storage')
        .select('value')
        .eq('player_id', pid)
        .eq('key', 'activity_feed')
        .maybeSingle();

      const remoteEntries = (data?.value?.[pid] || []);
      if (remoteEntries.length === 0) return;

      const latestId = remoteEntries[0]?.id;
      if (latestId === _lastSeenFeedId) return;
      _lastSeenFeedId = latestId;

      // Merge new server entries into local storage
      const localFeed    = StorageService.get('activity_feed') || {};
      const localEntries = localFeed[pid] || [];
      const localIds     = new Set(localEntries.map(e => e.id));
      const newEntries   = remoteEntries.filter(e => !localIds.has(e.id));
      if (newEntries.length === 0) return;

      localFeed[pid] = [...newEntries, ...localEntries].slice(0, 50);
      StorageService.set('activity_feed', localFeed);
      Nav.refreshBadge();

      // Show toasts for pvp notifications regardless of which screen is active.
      // (pvp_threat no longer exists — attacks arrive unannounced by design.)
      const pvpNew = newEntries.filter(e => e.type === 'pvp_result' || e.type === 'lord_captured' || e.type === 'lord_fallen');
      pvpNew.forEach(e => _toast(e.title));

      // Save battle history + sync lord HP for both sides from activity_feed
      // entries. The server dispatcher writes the authoritative result; this
      // just hydrates local cache so the Battles tab / lord state stay current
      // no matter what screen the player was on when it happened.
      newEntries.filter(e => e.type === 'pvp_result' && e.lordId && e.report).forEach(e => {
        const alreadySaved = BattleHistoryService.getForLord(e.lordId).some(b => b.at === e.at);
        if (!alreadySaved) {
          BattleHistoryService.save(e.lordId, {
            outcome:      e.outcome || 'defeat',
            campName:     e.opponentName || 'Enemy Lord',
            campIcon:     e.opponentType === 'city' ? gi('guarded-tower') : gi('crossed-swords'),
            campLevel:    null,
            lordLevel:    e.lordLevel || null,
            terrain:      e.terrain || null,
            goldEarned:   e.goldEarned || 0,
            resourceLoot: e.resourceLoot || null,
            xpEarned:     e.xpEarned || 0,
            modelsLost:   e.modelsLost || 0, rounds: e.rounds || 0,
            reason: e.report?.reason || '', report: e.report,
            honorEarned: e.honorEarned || 0,
          });
        }
        // Update local lord HP from the battle report for whichever side this player was on.
        const defStart = e.report?.defender?.unitsStart || [];
        if (defStart.some(u => u.sourceId === e.lordId)) {
          const lordsStorage = StorageService.get('lords') || {};
          const lordRec      = lordsStorage[e.lordId];
          if (lordRec) {
            const defLordUnit = (e.report.defender.unitsSurviving || []).find(s => s.sourceId === e.lordId);
            if (defLordUnit) {
              lordRec.currentHp      = Math.max(1, Math.round(defLordUnit.avgHp));
              lordRec.downtimeUntil  = null;
              lordRec.downtimeReason = null;
            } else {
              const isCapture = e.report?.winner === 'attacker';
              lordRec.currentHp      = 0;
              // Captured: far-future sentinel, same trick as the server's
              // _applyLordHp (see combat-resolver.js) — no countdown makes
              // sense for an indefinite capture. capturedByPlayerId is left
              // unset here (this feed entry doesn't reliably carry the
              // attacker's player id) and fills in on the next full sync;
              // until then the UI just shows the old-style countdown branch,
              // which self-corrects and isn't authoritative for anything.
              lordRec.downtimeUntil  = isCapture ? TimeService.now() + 100 * 365 * 24 * 3600 * 1000 : TimeService.now() + 3600000;
              lordRec.downtimeReason = isCapture ? 'captured' : 'defeated';
            }
            lordsStorage[e.lordId] = lordRec;
            StorageService.set('lords', lordsStorage);
          }
        }
      });

      if (_player) refresh();

      // Let whichever screen is currently mounted decide how to react (e.g.
      // Overview re-renders its dashboard) without HUD needing to know about
      // every screen's internals.
      if (pvpNew.length > 0) {
        EventBus.emit('pvp:alert', { newEntries, pvpNew });
      } else if (newEntries.length > 0) {
        EventBus.emit('activity:updated', { newEntries });
      }

      // Full state sync every 30s (3rd tick) — picks up server-resolved
      // outcomes (building completions, recruitment, lord moves) the same
      // way overview-screen.js's own tick used to, but now runs everywhere.
      if (_alertTick % 3 === 0) {
        try {
          await ServerActions.syncNow();
          if (_lord)   _lord   = LordService.getById(_lord.id);
          if (_player) _player = PlayerService.getById(_player.id);
          refresh();
        } catch (_) {}
      }
    } catch (_) {
      // Non-fatal — polling will retry next interval
    }
  }

  function _toast(msg) { ToastService.show(msg); }

  function refresh() {
    const player = _player ? PlayerService.getById(_player.id) : null;
    if (!player) return;

    const cities = CityService.getPlayerCities(player.id);

    // Empire-wide resource pool lives on player.resources
    const playerRes = player.resources || {};
    const totals = {
      food:  Math.floor(playerRes.food  || 0),
      wood:  Math.floor(playerRes.wood  || 0),
      stone: Math.floor(playerRes.stone || 0),
    };

    // Production rates: sum across all cities
    const rates  = { food: 0, wood: 0, stone: 0 };
    cities.forEach(city => {
      const cityRates = ProductionService.getRates(city);
      ['food', 'wood', 'stone'].forEach(k => {
        rates[k] += cityRates[k] || 0;
      });
    });

    // Gold: player treasury + net rate across empire
    const goldNet = ProductionService.getNetGoldRate(player.id);

    const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    _set('hud-r-coins',       _fmt(player.coins || 0));
    _set('hud-r-coins-rate',  _fmtRate(goldNet));
    document.getElementById('hud-r-coins-rate')?.classList.toggle('hud-res-rate--neg', goldNet < 0);
    document.getElementById('hud-r-coins-rate')?.classList.toggle('hud-res-rate--pos', goldNet > 0);

    ['food', 'wood', 'stone'].forEach(k => {
      _set(`hud-r-${k}`,       _fmt(totals[k]));
      _set(`hud-r-${k}-rate`,  _fmtRate(rates[k]));
      document.getElementById(`hud-r-${k}-rate`)?.classList.toggle('hud-res-rate--pos', rates[k] > 0);
    });

    const credEl = document.getElementById('hud-credits-amount');
    if (credEl) credEl.textContent = _fmt(player?.credits || 0);

    const honor   = player.honorPoints || 0;
    const tagEl   = document.getElementById('hud-honor-tag');
    const honorEl = document.getElementById('hud-honor-display');
    if (tagEl && honorEl) {
      const tier = getHonorTier(honor);
      const sign = honor > 0 ? '+' : honor < 0 ? '−' : '';
      const cls  = honor > 0 ? 'hud-honor--pos' : honor < 0 ? 'hud-honor--neg' : 'hud-honor--zero';
      tagEl.innerHTML      = honorCrestHtml(tier);
      honorEl.textContent = `(${sign}${_fmtHonor(Math.abs(honor))})`;
      honorEl.className   = `hud-honor-display ${cls}`;
    }
  }

  function _fmtHonor(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function _html() {
    const race = RACES[_player?.race] || {};
    return `
      <button class="hud-hamburger" id="hud-hamburger" title="Toggle sidebar">☰</button>

      <div class="hud-resources" id="hud-res-bar">
        ${Object.entries(RES).map(([key, r]) => `
          <div class="hud-res-item">
            <span class="hud-res-icon">${r.icon}</span>
            <div class="hud-res-values">
              <span class="hud-res-amount" id="hud-r-${key}">0</span>
              <span class="hud-res-rate" id="hud-r-${key}-rate">—</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="hud-lord-center hud-lord-btn" id="hud-lord-btn" title="Empire Overview">
        <div class="hud-lord-portrait">${race.icon || gi('person')}</div>
        <div class="hud-lord-text">
          <div class="hud-lord-name">
            <span id="hud-honor-tag" class="hud-honor-tag"></span>${_player?.username || ''}
            <span id="hud-honor-display" class="hud-honor-display hud-honor--zero"></span>
            <span id="hud-rank-badge" class="hud-rank-badge">${_rank ? `(#${_rank})` : ''}</span>
          </div>
          <div class="hud-lord-race">${race.name || 'New Player'}</div>
        </div>
      </div>

      <div class="hud-right">
        <div class="hud-server-clock" title="Server time (UTC)">
          <span class="hud-clock-label">UTC</span>
          <span class="hud-clock-time" id="hud-clock">--:--:--</span>
        </div>
        <div class="hud-credits" title="Premium Credits — spend to finish actions instantly">
          <span class="hud-credits-icon">${gi('cut-diamond')}</span>
          <div class="hud-credits-text">
            <span class="hud-credits-label">Credits</span>
            <span class="hud-credits-amount" id="hud-credits-amount">0</span>
          </div>
        </div>
        <button class="hud-signout-btn" id="hud-signout-btn">Sign Out</button>
      </div>
    `;
  }

  function _bindEvents() {
    document.getElementById('hud-signout-btn')?.addEventListener('click', () => {
      EventBus.emit('player:logout');
    });
    const lordBtn = document.getElementById('hud-lord-btn');
    lordBtn?.addEventListener('click', () => {
      if (_player) EventBus.emit('overview:open', { player: _player, lord: _lord });
    });
    if (lordBtn) A11y.makeClickable(lordBtn.parentElement, '#hud-lord-btn');
    document.getElementById('hud-hamburger')?.addEventListener('click', () => {
      Nav.toggle(_player, _lord);
    });
    EventBus.on('resources:changed', refresh);
  }

  function _fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return Math.floor(n).toString();
  }

  function _fmtRate(n) {
    const r = Math.round(n);
    if (r === 0) return '—';
    return (r > 0 ? '+' : '') + _fmt(Math.abs(r)) + '/h';
  }

  return { show, hide, refresh };
})();
