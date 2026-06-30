// =============================================
//  pregame.js — Kingdom → House → Leader selection
// =============================================

const PreGame = (() => {
  let _selKingdom = null;
  let _selHouse   = null;
  let _selLeader  = null;
  let _onStart    = null;

  function show(cb) {
    _onStart = cb;
    const el = document.getElementById('pre-game-screen');
    el.innerHTML = _buildHTML();
    el.style.display = 'flex';
  }

  function _buildHTML() {
    return `
    <div class="pg-frame">
      <div class="pg-logo">⚔ HEXFRONT</div>
      <div class="pg-tagline">Choose your Kingdom, House, and Leader</div>

      <div class="pg-divider"></div>
      <p class="pg-section-label">Choose your Kingdom</p>
      <div class="pg-factions">
        ${KINGDOMS.map(k => `
        <div class="pg-fc-card" data-kid="${k.id}" onclick="PreGame._pickKingdom('${k.id}')"
             style="--fc:${k.color}">
          <div class="pg-fc-sym">${k.symbol}</div>
          <div class="pg-fc-name">${k.name}</div>
          <div class="pg-fc-desc">${k.desc}</div>
        </div>`).join('')}
      </div>

      <div id="pg-houses-section" class="pg-leaders-section pg-hidden">
        <div class="pg-divider"></div>
        <p class="pg-section-label">Choose your Noble House</p>
        <div id="pg-houses" class="pg-leaders"></div>
      </div>

      <div id="pg-leaders-section" class="pg-leaders-section pg-hidden">
        <div class="pg-divider"></div>
        <p class="pg-section-label">Choose your Leader</p>
        <div id="pg-leaders" class="pg-leaders"></div>
      </div>

      <div class="pg-footer">
        <button id="pg-start" class="pg-start" disabled onclick="PreGame._start()">
          Begin Campaign
        </button>
      </div>
    </div>`;
  }

  function _pickKingdom(id) {
    _selKingdom = KINGDOMS.find(k => k.id === id);
    _selHouse   = null;
    _selLeader  = null;

    document.querySelectorAll('.pg-fc-card').forEach(c =>
      c.classList.toggle('pg-selected', c.dataset.kid === id));

    // Hide leader section when re-picking kingdom
    document.getElementById('pg-leaders-section').classList.add('pg-hidden');
    document.getElementById('pg-start').disabled = true;

    const houses = NOBLE_HOUSES.filter(h => h.kingdomId === id);
    document.getElementById('pg-houses').innerHTML = houses.map(h => {
      const bloodlineName = h.bloodlineId && typeof BLOODLINES !== 'undefined' && BLOODLINES[h.bloodlineId]
        ? `<span class="pg-trait-badge">🩸 ${BLOODLINES[h.bloodlineId].name}</span>`
        : '';
      return `
      <div class="pg-ldr-card" data-hid="${h.id}" onclick="PreGame._pickHouse('${h.id}')"
           style="--fc:${h.color}">
        <div class="pg-ldr-title">${h.crest} ${h.name}</div>
        <div class="pg-ldr-name">${h.reputation.charAt(0).toUpperCase() + h.reputation.slice(1)}</div>
        <div class="pg-ldr-desc">${h.description}</div>
        ${bloodlineName ? `<div class="pg-trait-list">${bloodlineName}</div>` : ''}
      </div>`;
    }).join('');

    document.getElementById('pg-houses-section').classList.remove('pg-hidden');
  }

  function _pickHouse(id) {
    _selHouse  = NOBLE_HOUSES.find(h => h.id === id);
    _selLeader = null;

    document.querySelectorAll('[data-hid]').forEach(c =>
      c.classList.toggle('pg-selected', c.dataset.hid === id));

    document.getElementById('pg-leaders').innerHTML = _selHouse.leaders.map(l => {
      const traitBadges = (l.traits || []).map(tid => {
        const t = (typeof TRAITS !== 'undefined') && TRAITS[tid];
        return t ? `<span class="pg-trait-badge">${t.icon} ${t.name}</span>` : '';
      }).join('');
      return `
      <div class="pg-ldr-card" data-lid="${l.id}" onclick="PreGame._pickLeader('${l.id}')"
           style="--fc:${_selHouse.color}">
        <div class="pg-ldr-title">${l.title}</div>
        <div class="pg-ldr-name">${l.name}</div>
        <div class="pg-ldr-desc">${l.desc}</div>
        ${traitBadges ? `<div class="pg-trait-list">${traitBadges}</div>` : ''}
      </div>`;
    }).join('');

    document.getElementById('pg-leaders-section').classList.remove('pg-hidden');
    document.getElementById('pg-start').disabled = true;
  }

  function _pickLeader(id) {
    _selLeader = _selHouse.leaders.find(l => l.id === id);
    document.querySelectorAll('[data-lid]').forEach(c =>
      c.classList.toggle('pg-selected', c.dataset.lid === id));
    document.getElementById('pg-start').disabled = false;
  }

  function _start() {
    if (!_selKingdom || !_selHouse || !_selLeader) return;
    const screen = document.getElementById('pre-game-screen');
    screen.classList.add('pg-fadeout');
    setTimeout(() => {
      screen.style.display = 'none';
      _onStart(_selKingdom, _selHouse, _selLeader);
    }, 550);
  }

  return { show, _pickKingdom, _pickHouse, _pickLeader, _start };
})();
