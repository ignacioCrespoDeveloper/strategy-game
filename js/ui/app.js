// =============================================
//  app.js — Top-level router / application shell
// =============================================

const App = (() => {
  const _root = () => document.getElementById('screen-root');

  // The currently-active screen's stop() function, if it has one.
  // OverviewScreen/LordScreen/CityView all run background setInterval timers
  // (activity-feed polling, action countdowns, recruitment ticks). None of
  // them were ever being stopped on navigation — worst case is
  // OverviewScreen's poll handler, which unconditionally overwrites
  // #screen-root with its own shell whenever a new pvp_result event arrives,
  // silently hijacking the user back to the Overview screen mid-battle no
  // matter what screen they'd since navigated to. Calling this before every
  // navigation closes that off for all three screens at once.
  let _currentStop = null;

  // ── Boot ──────────────────────────────────────────────────────
  async function init() {
    _registerEvents();

    // Supabase automatically restores the session from its own localStorage keys.
    // Also handles OAuth redirects (Google sends the user back with a code in the URL).
    const { data: { session } } = await SupabaseService.client.auth.getSession();
    if (!session) { _goto('auth'); return; }

    _root().innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                  color:#b8963c;font-size:1rem;letter-spacing:0.15em;font-family:inherit;">
        ⚔ &nbsp; CONNECTING…
      </div>`;

    try {
      // Re-hydrate from Supabase to get the latest world + player data
      const [storageResult, worldResult] = await Promise.all([
        SupabaseService.client.from('storage').select('key, value').eq('player_id', session.user.id),
        SupabaseService.client.from('world_state').select('key, value'),
      ]);

      const serverData = {};
      storageResult.data?.forEach(row => { serverData[row.key] = row.value; });
      worldResult.data?.forEach(row => { serverData[row.key] = row.value; });
      StorageService.hydrate(serverData);

      // Run server-side catch-up: completes any queues / HP regen that
      // accumulated while the player was offline. The server writes the
      // updated state to Supabase and returns it so we can overwrite the
      // just-hydrated localStorage in one extra round-trip.
      try {
        const syncRes = await fetch('/api/sync', {
          method:  'POST',
          headers: { Authorization: 'Bearer ' + session.access_token },
        });
        if (syncRes.ok) {
          const { state, events } = await syncRes.json();
          if (state) StorageService.hydrate(state);
          // Store any completion events (buildings, units, lords) so the
          // first screen can pick them up and show toasts.
          if (events?.length > 0) {
            window._pendingSyncEvents = events;
            // Process quest_result events immediately: add discoveries to local
            // storage so the quest log is populated when the player opens their lord.
            const playerId = session.user.id;
            for (const evt of events) {
              if (evt.type !== 'quest_result') continue;
              const def = (typeof DISCOVERY_DEFS !== 'undefined') ? DISCOVERY_DEFS[evt.defId] : null;
              if (!def) continue;
              if (evt.category === 'combat' && evt.record) {
                const all = StorageService.get('discoveries') || {};
                if (!all[playerId]) all[playerId] = [];
                all[playerId].push(evt.record);
                StorageService.set('discoveries', all);
              }
              if (typeof DiscoveryService !== 'undefined') {
                DiscoveryService.addLog(playerId, {
                  definitionId: evt.defId,
                  tileX:   evt.record?.tileX  ?? null,
                  tileY:   evt.record?.tileY  ?? null,
                  terrain: evt.record?.terrain ?? 'plains',
                  rewards: evt.rewards || [],
                  recordId: (evt.category === 'combat' && evt.record) ? evt.record.id : undefined,
                  lordId:   evt.lordId || undefined,
                  lordName: evt.lordName || undefined,
                });
              }
            }
          }
        }
      } catch (_) {
        // Non-fatal — server may be unreachable; cached state is used
      }

      // Re-populate session keys from Supabase session
      const username = session.user.user_metadata?.username
        || session.user.email?.split('@')[0];

      const players      = StorageService.get('players') || {};
      const existingData = players[session.user.id];

      players[session.user.id] = {
        ...(existingData || {}),
        id:           session.user.id,
        username:     username || 'Unknown',
        coins:        existingData?.coins   ?? 5000,
        credits:      existingData?.credits ?? 9999,
        lordId:       existingData?.lordId  ?? null,
        race:         existingData?.race    ?? session.user.user_metadata?.race ?? null,
        createdAt:    existingData?.createdAt ?? Date.now(),
        passwordHash: '__supabase__',
        // Restore honorPoints from Supabase dedicated key (survives server-side player rewrites)
        honorPoints:  serverData['honor_points'] ?? existingData?.honorPoints ?? 0,
      };

      localStorage.setItem('realms_players', JSON.stringify(players));
      localStorage.setItem('realms_session',  JSON.stringify({ playerId: session.user.id }));

    } catch (err) {
      // Server unreachable — continue with cached localStorage data
      console.warn('Hexfront: hydration failed, using cache:', err.message);
    }

    const player = PlayerService.getSession();
    if (!player) { _goto('auth'); return; }
    _afterAuth(player);
  }

  // ── Routing ───────────────────────────────────────────────────
  //
  // Screens that show live game state (army, city, lord, rankings…) always
  // resync with the server before rendering — like Ogame, where every tab
  // is its own page load through the server. Without this, navigating to a
  // screen just re-rendered whatever the last periodic background sync (up
  // to 30s old) or the last action's response happened to leave in the
  // local cache — e.g. opening a Lord's screen wouldn't show a PvP loss
  // that landed 5 seconds ago until the next unrelated action or poll tick.
  const _SYNC_ON_ENTER = new Set([
    'map', 'city', 'lord-screen', 'overview', 'activity',
    'tech-tree', 'attack-confirm', 'rankings', 'clan',
  ]);

  async function _goto(screen, data) {
    // Stop whatever background timer the previous screen had running before
    // switching away — see _currentStop's declaration above for why.
    if (_currentStop) { _currentStop(); _currentStop = null; }

    if (_SYNC_ON_ENTER.has(screen) && data?.player?.id) {
      const root = _root();
      root.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                    color:#b8963c;font-size:1rem;letter-spacing:0.15em;font-family:inherit;">
          ⚔ &nbsp; SYNCING…
        </div>`;
      await ServerActions.syncNow();
      // Re-read from the just-refreshed local cache instead of trusting
      // whatever `data` was captured with before the sync ran.
      data = { ...data, player: PlayerService.getById(data.player.id) || data.player };
      if (data.lord) data.lord = LordService.getById(data.lord.id) || data.lord;
      if (data.city) data.city = CityService.getById(data.city.id) || data.city;
    }

    const root = _root();
    switch (screen) {
      case 'auth':
        Nav.hide();
        HUD.hide();
        AuthView.render(root);
        break;
      case 'create-lord':
        Nav.hide();
        HUD.hide();
        LordView.render(root, data);
        break;
      case 'map':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'map');
        MapView.render(root, data);
        break;
      case 'city':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'home');
        CityView.render(root, data);
        _currentStop = CityView.stop;
        break;
      case 'lord-screen':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'home');
        LordScreen.render(root, data);
        _currentStop = LordScreen.stop;
        break;
      case 'overview':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'home');
        OverviewScreen.render(root, data);
        _currentStop = OverviewScreen.stop;
        break;
      case 'activity':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'activity');
        ActivityScreen.render(root, data);
        break;
      case 'tech-tree':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'tech-tree');
        TechTreeScreen.render(root, data);
        break;
      case 'attack-confirm':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'map');
        AttackConfirmView.render(root, data);
        break;
      case 'battle-simulator':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'battle-simulator');
        BattleSimulator.render(root, data);
        break;
      case 'rankings':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'rankings');
        RankingScreen.render(root, data);
        break;
      case 'clan':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'clan');
        ClanScreen.render(root, data);
        break;
      default:
        Nav.hide();
        HUD.hide();
        root.innerHTML = '';
    }
  }

  // ── State logic ───────────────────────────────────────────────
  function _afterAuth(player) {
    if (!player.race) {
      _goto('create-lord', { player });
      return;
    }
    const lord = player.lordId ? LordService.getById(player.lordId) : null;
    _goto('overview', { player, lord });
  }

  // ── Event bus wiring ──────────────────────────────────────────
  function _registerEvents() {
    EventBus.on('auth:success',  ({ player })             => _afterAuth(player));
    EventBus.on('race:selected', ({ player })             => _afterAuth(player));
    EventBus.on('lord:created',  ({ player })             => _afterAuth(player));
    EventBus.on('city:founded',  ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('city:open',     ({ city, lord, player }) => _goto('city', { city, lord, player }));
    EventBus.on('city:back',     ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('lord:open',     ({ lord, player })       => _goto('lord-screen', { lord, player }));
    EventBus.on('lord:back',     ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('overview:open', ({ player, lord })       => _goto('overview', { player, lord }));
    EventBus.on('player:logout', async () => {
      await SupabaseService.client.auth.signOut();
      PlayerService.logout();
      StorageService.clearAll();
      Nav.hide();
      HUD.hide();
      _goto('auth');
    });
  }

  function navigate(screen, data) {
    _goto(screen, data);
  }

  return { init, navigate };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
