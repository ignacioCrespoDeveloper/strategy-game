// =============================================
//  app.js — Top-level router / application shell
// =============================================

const App = (() => {
  const _root = () => document.getElementById('screen-root');

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

      // Re-populate session keys from Supabase session
      const username = session.user.user_metadata?.username
        || session.user.email?.split('@')[0];

      const players      = StorageService.get('players') || {};
      const existingData = players[session.user.id];

      players[session.user.id] = {
        id:           session.user.id,
        username:     username || 'Unknown',
        coins:        existingData?.coins   ?? 100000,
        credits:      existingData?.credits ?? 9999,
        lordId:       existingData?.lordId  ?? null,
        createdAt:    existingData?.createdAt ?? Date.now(),
        passwordHash: '__supabase__',
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
  function _goto(screen, data) {
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
        break;
      case 'lord-screen':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'home');
        LordScreen.render(root, data);
        break;
      case 'overview':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'home');
        OverviewScreen.render(root, data);
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
      case 'battle-result':
        Nav.hide();
        HUD.hide();
        BattleResultView.render(root, data);
        break;
      case 'battle-simulator':
        HUD.show(data.player, data.lord);
        Nav.show(data.player, data.lord, 'battle-simulator');
        BattleSimulator.render(root, data);
        break;
      default:
        Nav.hide();
        HUD.hide();
        root.innerHTML = '';
    }
  }

  // ── State logic ───────────────────────────────────────────────
  function _afterAuth(player) {
    const lord = player.lordId ? LordService.getById(player.lordId) : null;
    _goto('overview', { player, lord });
  }

  // ── Event bus wiring ──────────────────────────────────────────
  function _registerEvents() {
    EventBus.on('auth:success',  ({ player })             => _afterAuth(player));
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
