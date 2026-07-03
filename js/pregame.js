// =============================================
//  pregame.js — Legendary Lord selection screen
// =============================================

const PreGame = (() => {
  let _selectedLord = null;
  let _onStart      = null;

  function show(cb) {
    _onStart = cb;
    _selectedLord = null;
    const el = document.getElementById('pre-game-screen');
    el.innerHTML = _buildHTML();
    el.style.display = 'flex';
  }

  function _buildHTML() {
    const lordCards = LEGENDARY_LORDS.map(lord => `
      <div class="pg-ll-card" data-lid="${lord.id}" onclick="PreGame._pickLord('${lord.id}')"
           style="--lc:${lord.color}">
        <div class="pg-ll-card-portrait">${lord.portrait}</div>
        <div class="pg-ll-card-body">
          <div class="pg-ll-card-name">${lord.name}</div>
          <div class="pg-ll-card-type">${lord.playstyle}</div>
        </div>
      </div>`).join('');

    return `
    <div class="pg-frame pg-ll-frame">
      <div class="pg-ll-header">
        <div class="pg-logo">⚔ HEXFRONT</div>
        <div class="pg-tagline">CHOOSE YOUR LEGENDARY LORD</div>
      </div>
      <div class="pg-ll-layout">
        <div class="pg-ll-roster">
          <div class="pg-ll-roster-label">LEGENDARY LORDS</div>
          ${lordCards}
        </div>
        <div class="pg-ll-info" id="pg-ll-info">
          <div class="pg-ll-placeholder">
            <div class="pg-ll-placeholder-icon">⚔</div>
            <div class="pg-ll-placeholder-text">Select a Legendary Lord<br>to begin your campaign</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function _pickLord(id) {
    _selectedLord = LEGENDARY_LORDS.find(l => l.id === id);
    if (!_selectedLord) return;

    // Highlight selected card
    document.querySelectorAll('.pg-ll-card').forEach(c =>
      c.classList.toggle('pg-ll-selected', c.dataset.lid === id));

    // Render info panel
    document.getElementById('pg-ll-info').innerHTML = _buildInfoPanel(_selectedLord);
  }

  function _buildInfoPanel(lord) {
    const res = lord.startingResources;
    const resHtml = [
      res.gold  ? `<span class="pg-ll-res">💰 ${res.gold}</span>` : '',
      res.food  ? `<span class="pg-ll-res">🌾 ${res.food}</span>` : '',
      res.iron  ? `<span class="pg-ll-res">⚙️ ${res.iron}</span>` : '',
      res.wood  ? `<span class="pg-ll-res">🌲 ${res.wood}</span>` : '',
    ].filter(Boolean).join('');

    const armyHtml = lord.startingUnits.map(type => {
      const def = (typeof UNIT_TYPES !== 'undefined') ? UNIT_TYPES[type] : null;
      return def ? `<span class="pg-ll-unit" title="${def.name}">${def.icon}</span>` : '';
    }).join('');

    const strengthsHtml = lord.strengths.map(s =>
      `<div class="pg-ll-sw-row pg-ll-str">✓ ${s}</div>`).join('');
    const weaknessesHtml = lord.weaknesses.map(w =>
      `<div class="pg-ll-sw-row pg-ll-wk">✗ ${w}</div>`).join('');

    const mechanicDesc = lord.mechanics && lord.mechanics.length
      ? lord.mechanics.map(m => _mechLabel(m)).join(' · ')
      : 'Standard campaign';

    const ageHtml = lord.age ? `<span class="pg-ll-info-age">Age ${lord.age}</span>` : '';

    return `
      <div class="pg-ll-info-header" style="--lc:${lord.color}">
        <div class="pg-ll-info-portrait" style="color:${lord.color}">${lord.portrait}</div>
        <div class="pg-ll-info-identity">
          <div class="pg-ll-info-name" style="color:${lord.color}">${lord.name}</div>
          <div class="pg-ll-info-title">${lord.title}</div>
          ${ageHtml}
        </div>
      </div>

      <div class="pg-ll-info-desc">${lord.description}</div>

      <div class="pg-ll-sw">
        <div class="pg-ll-sw-col">
          <div class="pg-ll-sw-label">Strengths</div>
          ${strengthsHtml}
        </div>
        <div class="pg-ll-sw-col">
          <div class="pg-ll-sw-label">Weaknesses</div>
          ${weaknessesHtml}
        </div>
      </div>

      <div class="pg-ll-victory" style="--lc:${lord.color}">
        <div class="pg-ll-victory-label">${lord.victoryCondition.icon} VICTORY CONDITION</div>
        <div class="pg-ll-victory-short">${lord.victoryCondition.short}</div>
        <div class="pg-ll-victory-desc">${lord.victoryCondition.description}</div>
      </div>

      <div class="pg-ll-bonuses">
        <div class="pg-ll-bonus-row">
          <span class="pg-ll-bonus-lbl">Starting Resources</span>
          <span class="pg-ll-bonus-val">${resHtml}</span>
        </div>
        <div class="pg-ll-bonus-row">
          <span class="pg-ll-bonus-lbl">Starting Army</span>
          <span class="pg-ll-bonus-val pg-ll-army">${armyHtml}</span>
        </div>
        <div class="pg-ll-bonus-row">
          <span class="pg-ll-bonus-lbl">Unique Mechanics</span>
          <span class="pg-ll-bonus-val pg-ll-mech">${mechanicDesc}</span>
        </div>
      </div>

      <button class="pg-start pg-ll-start" onclick="PreGame._start()">
        ⚔ Begin Campaign as ${lord.name}
      </button>`;
  }

  function _mechLabel(mechId) {
    const labels = {
      imperial_reforms:    'Imperial Reforms',
      dragon:              '🐉 Dragon (permanent death)',
      infection:           '☠ Infection Spread',
      corruption:          'City Corruption',
      naval_warfare:       '⚓ Naval Warfare',
      raiding:             'Coastal Raiding',
      cannibal_dragon:     '🗡️ The Cannibal',
      dragon_hunter_order: 'Hunter Order',
      blood_curse:         '🦇 Blood Curse',
      court_influence:     'Court Influence',
      espionage:           'Espionage',
    };
    return labels[mechId] || mechId;
  }

  function _start() {
    if (!_selectedLord) return;
    const screen = document.getElementById('pre-game-screen');
    screen.classList.add('pg-fadeout');
    setTimeout(() => {
      screen.style.display = 'none';
      _onStart(_selectedLord);
    }, 550);
  }

  return { show, _pickLord, _start };
})();
