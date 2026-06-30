// =============================================
//  pregame.js — faction & leader selection
// =============================================

const PreGame = (() => {
  let _selFaction = null;
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
      <div class="pg-tagline">Elige tu facción y lidera la conquista</div>

      <div class="pg-divider"></div>
      <p class="pg-section-label">Elige tu Facción</p>
      <div class="pg-factions">
        ${FACTIONS.map(f => `
        <div class="pg-fc-card" data-fid="${f.id}" onclick="PreGame._pickFaction('${f.id}')"
             style="--fc:${f.color}">
          <div class="pg-fc-sym">${f.symbol}</div>
          <div class="pg-fc-name">${f.name}</div>
          <div class="pg-fc-desc">${f.desc}</div>
        </div>`).join('')}
      </div>

      <div id="pg-leaders-section" class="pg-leaders-section pg-hidden">
        <div class="pg-divider"></div>
        <p class="pg-section-label">Elige tu Líder</p>
        <div id="pg-leaders" class="pg-leaders"></div>
      </div>

      <div class="pg-footer">
        <button id="pg-start" class="pg-start" disabled onclick="PreGame._start()">
          Comenzar Campaña
        </button>
      </div>
    </div>`;
  }

  function _pickFaction(id) {
    _selFaction = FACTIONS.find(f => f.id === id);
    _selLeader  = null;

    document.querySelectorAll('.pg-fc-card').forEach(c =>
      c.classList.toggle('pg-selected', c.dataset.fid === id));

    const sec = document.getElementById('pg-leaders-section');
    sec.classList.remove('pg-hidden');

    document.getElementById('pg-leaders').innerHTML =
      _selFaction.leaders.map(l => {
        const traitBadges = (l.traits || []).map(tid => {
          const t = (typeof TRAITS !== 'undefined') && TRAITS[tid];
          return t ? `<span class="pg-trait-badge">${t.icon} ${t.name}</span>` : '';
        }).join('');
        return `
        <div class="pg-ldr-card" data-lid="${l.id}" onclick="PreGame._pickLeader('${l.id}')"
             style="--fc:${_selFaction.color}">
          <div class="pg-ldr-title">${l.title}</div>
          <div class="pg-ldr-name">${l.name}</div>
          <div class="pg-ldr-desc">${l.desc}</div>
          ${traitBadges ? `<div class="pg-trait-list">${traitBadges}</div>` : ''}
        </div>`;
      }).join('');

    document.getElementById('pg-start').disabled = true;
  }

  function _pickLeader(id) {
    _selLeader = _selFaction.leaders.find(l => l.id === id);
    document.querySelectorAll('.pg-ldr-card').forEach(c =>
      c.classList.toggle('pg-selected', c.dataset.lid === id));
    document.getElementById('pg-start').disabled = false;
  }

  function _start() {
    if (!_selFaction || !_selLeader) return;
    const screen = document.getElementById('pre-game-screen');
    screen.classList.add('pg-fadeout');
    setTimeout(() => {
      screen.style.display = 'none';
      _onStart(_selFaction, _selLeader);
    }, 550);
  }

  return { show, _pickFaction, _pickLeader, _start };
})();
