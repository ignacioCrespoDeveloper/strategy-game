// =============================================
//  nav.js — Persistent left sidebar navigation
// =============================================

const Nav = (() => {
  let _player = null;
  let _lord   = null;
  let _page   = null;
  let _listenerRegistered = false;

  function show(player, lord, page) {
    _player = player;
    _lord   = lord;
    _page   = page || null;
    const el = document.getElementById('nav-sidebar');
    if (!el) return;
    el.innerHTML = _html();
    el.classList.remove('hidden');
    document.body.classList.add('nav-open');
    _bindEvents();
    if (!_listenerRegistered) {
      _listenerRegistered = true;
      EventBus.on('activity:added', ({ playerId }) => {
        if (_player && playerId === _player.id) refreshBadge();
      });
    }
  }

  function hide() {
    const el = document.getElementById('nav-sidebar');
    if (el) el.classList.add('hidden');
    document.body.classList.remove('nav-open');
  }

  // Toggle called by the HUD hamburger — remembers last player/lord/page
  function toggle(player, lord) {
    const el = document.getElementById('nav-sidebar');
    if (!el || el.classList.contains('hidden')) {
      show(player || _player, lord || _lord, _page);
    } else {
      hide();
    }
  }

  // Update the activity badge count without re-rendering the whole nav
  function refreshBadge() {
    if (!_player) return;
    const count = ActivityService.getUnseenCount(_player.id);
    const badge = document.getElementById('nav-activity-badge');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.toggle('nav-badge--hidden', count === 0);
    }
    // Toggle notif highlight on the Activity nav link
    const actBtn = document.querySelector('[data-nav-page="activity"]');
    if (actBtn) actBtn.classList.toggle('nav-link--notif', count > 0);
  }

  function _toast(msg) { ToastService.show(msg); }

  function _html() {
    const unseenCount = _player ? ActivityService.getUnseenCount(_player.id) : 0;

    const hasNotif = unseenCount > 0;
    const links = [
      { page: 'home',             icon: gi('house'), label: 'Home' },
      { page: 'map',              icon: gi('treasure-map'),  label: 'World Map' },
      { page: 'activity',         icon: gi('scroll-quill'), label: 'Activity', badge: unseenCount, notif: hasNotif },
      { page: 'merchant',         icon: gi('shop'), label: 'Merchant' },
      { page: 'research',         icon: gi('open-book'), label: 'Research' },
      { page: 'tech-tree',        icon: gi('book-pile'), label: 'Tech Tree' },
      { page: 'battle-simulator', icon: gi('crossed-swords'),  label: 'Battle Sim' },
      { page: 'rankings',         icon: gi('histogram'), label: 'Rankings' },
      { page: 'clan',             icon: gi('round-shield'),  label: 'Clan' },
      { page: 'account',          icon: gi('gears'),  label: 'Account' },
    ];

    return `
      <div class="nav-header">
        <div class="nav-brand">${gi('crossed-swords')} HEXFRONT</div>
        <button class="nav-close-btn" id="nav-close-btn" title="Close sidebar">✕</button>
      </div>
      <div class="nav-links">
        ${links.map(l => {
          const isActive = _page === l.page;
          const classes  = ['nav-link', isActive && 'nav-link--active', l.notif && 'nav-link--notif'].filter(Boolean).join(' ');
          const badgeHtml = l.badge !== undefined
            ? l.badge > 0
              ? `<span class="nav-badge" id="nav-activity-badge">${l.badge > 99 ? '99+' : l.badge}</span>`
              : `<span class="nav-badge nav-badge--hidden" id="nav-activity-badge"></span>`
            : '';
          return `
            <button class="${classes}" data-nav-page="${l.page}">
              <span class="nav-link-icon">${l.icon}</span>
              <span class="nav-link-label">${l.label}</span>
              ${badgeHtml}
            </button>
          `;
        }).join('')}
      </div>
      <div class="nav-footer">
        <button class="nav-link nav-link--logout" id="nav-logout-btn">
          <span class="nav-link-icon">${gi('exit-door')}</span>
          <span class="nav-link-label">Logout</span>
        </button>
      </div>
    `;
  }

  function _bindEvents() {
    document.getElementById('nav-close-btn')?.addEventListener('click', () => {
      hide();
    });

    document.querySelector('[data-nav-page="home"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      EventBus.emit('overview:open', { player, lord });
    });

    document.querySelector('[data-nav-page="map"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('map', { player, lord });
    });

    document.querySelector('[data-nav-page="activity"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('activity', { player, lord });
    });

    document.querySelector('[data-nav-page="merchant"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('merchant', { player, lord });
    });

    document.querySelector('[data-nav-page="research"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('research', { player, lord });
    });

    document.querySelector('[data-nav-page="tech-tree"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('tech-tree', { player, lord });
    });

    document.querySelector('[data-nav-page="battle-simulator"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('battle-simulator', { player, lord });
    });

    document.querySelector('[data-nav-page="rankings"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('rankings', { player, lord });
    });

    document.querySelector('[data-nav-page="clan"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('clan', { player, lord });
    });

    document.querySelector('[data-nav-page="account"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('account', { player, lord });
    });

    document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
      EventBus.emit('player:logout');
    });
  }

  return { show, hide, toggle, refreshBadge };
})();
