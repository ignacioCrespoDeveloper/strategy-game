// =============================================
//  app.js — Top-level router / application shell
// =============================================

const App = (() => {
  const _root = () => document.getElementById('screen-root');

  // ── Boot ──────────────────────────────────────────────────────
  function init() {
    _registerEvents();

    const player = PlayerService.getSession();
    if (!player) { _goto('auth'); return; }
    _afterAuth(player);
  }

  // ── Routing ───────────────────────────────────────────────────
  function _goto(screen, data) {
    const root = _root();
    switch (screen) {
      case 'auth':
        HUD.hide();
        AuthView.render(root);
        break;
      case 'create-lord':
        HUD.hide();
        LordView.render(root, data);
        break;
      case 'map':
        HUD.show(data.player, data.lord);
        MapView.render(root, data);
        break;
      case 'city':
        HUD.show(data.player, data.lord);
        CityView.render(root, data);
        break;
      case 'lord-screen':
        HUD.show(data.player, data.lord);
        LordScreen.render(root, data);
        break;
      case 'overview':
        HUD.show(data.player, data.lord);
        OverviewScreen.render(root, data);
        break;
      default:
        HUD.hide();
        root.innerHTML = '';
    }
  }

  // ── State logic ───────────────────────────────────────────────
  function _afterAuth(player) {
    if (!player.lordId) {
      _goto('create-lord', { player });
      return;
    }
    const lord = LordService.getById(player.lordId);
    _goto('overview', { player, lord });
  }

  // ── Event bus wiring ──────────────────────────────────────────
  function _registerEvents() {
    EventBus.on('auth:success',  ({ player })             => _afterAuth(player));
    EventBus.on('lord:created',  ({ player })             => _afterAuth(player));
    EventBus.on('city:founded',  ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('city:open',     ({ city, lord, player }) => _goto('city', { city, lord, player }));
    EventBus.on('city:back',     ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('lord:open',    ({ lord, player })       => _goto('lord-screen', { lord, player }));
    EventBus.on('lord:back',    ({ player, lord })       => _goto('map', { player, lord }));
    EventBus.on('overview:open',({ player, lord })       => _goto('overview', { player, lord }));
    EventBus.on('player:logout', () => { PlayerService.logout(); HUD.hide(); _goto('auth'); });
  }

  function navigate(screen, data) {
    _goto(screen, data);
  }

  return { init, navigate };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
