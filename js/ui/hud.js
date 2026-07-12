// =============================================
//  hud.js — Persistent top bar (visible after login)
// =============================================

const HUD = (() => {
  let _lord    = null;
  let _player  = null;

  const RES = {
    coins: { icon: '💰', label: 'Gold'  },
    food:  { icon: '🌾', label: 'Food'  },
    wood:  { icon: '🪵', label: 'Wood'  },
    stone: { icon: '⛏',  label: 'Stone' },
    iron:  { icon: '⚒',  label: 'Iron'  },
  };

  function show(player, lord) {
    _player = player;
    _lord   = lord;
    const bar = document.getElementById('hud-bar');
    bar.innerHTML = _html();
    bar.classList.remove('hidden');
    document.body.classList.add('hud-active');
    _bindEvents();
    refresh();
  }

  function hide() {
    const bar = document.getElementById('hud-bar');
    bar.classList.add('hidden');
    bar.innerHTML = '';
    document.body.classList.remove('hud-active');
    _lord = _player = null;
  }

  function refresh() {
    const player = _player ? PlayerService.getById(_player.id) : null;
    if (!player) return;
    const res = _sumResources(player);
    Object.keys(RES).forEach(key => {
      const el = document.getElementById(`hud-r-${key}`);
      if (!el) return;
      el.textContent = key === 'coins' ? _fmt(player?.coins || 0) : _fmt(res[key] || 0);
    });
    const credEl = document.getElementById('hud-credits-amount');
    if (credEl) credEl.textContent = _fmt(player?.credits || 0);
  }

  function setLord(lord) { _lord = lord; refresh(); }

  function _html() {
    const race = RACES[_lord?.race] || {};
    return `
      <button class="hud-hamburger" id="hud-hamburger" title="Toggle sidebar">☰</button>

      <div class="hud-resources" id="hud-res-bar">
        ${Object.entries(RES).map(([key, r]) => `
          <div class="hud-res-item">
            <span class="hud-res-icon">${r.icon}</span>
            <div class="hud-res-values">
              <span class="hud-res-label">${r.label}</span>
              <span class="hud-res-amount" id="hud-r-${key}">0</span>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="hud-lord-center hud-lord-btn" id="hud-lord-btn" title="Empire Overview">
        <div class="hud-lord-portrait">${race.icon || '👤'}</div>
        <div class="hud-lord-text">
          <div class="hud-lord-name">${_player?.username || ''}</div>
          <div class="hud-lord-race">${_lord ? `${race.name || ''} · Lv ${_lord.level || 1}` : 'New Player'}</div>
        </div>
      </div>

      <div class="hud-right">
        <div class="hud-credits" title="Premium Credits — spend to finish actions instantly">
          <span class="hud-credits-icon">💎</span>
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
    document.getElementById('hud-lord-btn')?.addEventListener('click', () => {
      if (_player) EventBus.emit('overview:open', { player: _player, lord: _lord });
    });
    document.getElementById('hud-hamburger')?.addEventListener('click', () => {
      Nav.toggle(_player, _lord);
    });
    EventBus.on('resources:changed', refresh);
  }

  function _sumResources(player) {
    const totals = { food: 0, wood: 0, stone: 0, iron: 0 };
    CityService.getPlayerCities(player.id).forEach(c => {
      Object.keys(totals).forEach(k => { totals[k] += c.resources[k] || 0; });
    });
    return totals;
  }

  function _fmt(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
    return Math.floor(n).toString();
  }

  return { show, hide, refresh, setLord };
})();
