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

  function setPage(page) {
    _page = page;
    document.querySelectorAll('.nav-link[data-nav-page]').forEach(el => {
      el.classList.toggle('nav-link--active', el.dataset.navPage === page);
    });
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

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className   = 'toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function _html() {
    const unseenCount = _player ? ActivityService.getUnseenCount(_player.id) : 0;

    const hasNotif = unseenCount > 0;
    const links = [
      { page: 'home',      icon: '🏠', label: 'Home' },
      { page: 'map',       icon: '🗺',  label: 'World Map' },
      { page: 'activity',  icon: '📋', label: 'Activity', badge: unseenCount, notif: hasNotif },
      { page: 'tech-tree', icon: '📚', label: 'Tech Tree' },
      { page: 'rankings',  icon: '📊', label: 'Rankings' },
      { page: 'account',   icon: '⚙',  label: 'Account' },
    ];

    return `
      <div class="nav-header">
        <div class="nav-brand">⚔ HEXFRONT</div>
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
          <span class="nav-link-icon">🚪</span>
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

    document.querySelector('[data-nav-page="tech-tree"]')?.addEventListener('click', () => {
      const player = PlayerService.getSession();
      const lord   = player?.lordId ? LordService.getById(player.lordId) : null;
      App.navigate('tech-tree', { player, lord });
    });

    document.querySelector('[data-nav-page="rankings"]')?.addEventListener('click', () => {
      _toast('Rankings — coming soon!');
    });

    document.querySelector('[data-nav-page="account"]')?.addEventListener('click', () => {
      _toast('Account settings — coming soon!');
    });

    document.getElementById('nav-logout-btn')?.addEventListener('click', () => {
      EventBus.emit('player:logout');
    });
  }

  return { show, hide, toggle, setPage, refreshBadge };
})();
