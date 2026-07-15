// =============================================
//  lord-view.js — Lord creation screen
// =============================================

const LordView = (() => {
  let _player        = null;
  let _selectedRace  = null;
  let _selectedClass = null;

  function render(root, { player }) {
    _player        = player;
    _selectedRace  = null;
    _selectedClass = null;

    root.innerHTML = `
      <div class="lord-screen">
        <div class="auth-bg"></div>

        <div class="lord-card lord-card--wide">
          <div class="lord-card-header">
            <div class="auth-logo">⚔</div>
            <h1 class="auth-title">Create your Lord</h1>
            <p class="auth-tagline">Name your lord, choose a race and a class.</p>
          </div>

          <div class="lord-card-body lord-card-body--three">

            <!-- Col 1: Name + combined preview -->
            <div class="lord-name-col">
              <div class="form-group">
                <label class="form-label" for="lord-name">Lord Name</label>
                <input class="form-input" type="text" id="lord-name"
                       placeholder="Enter your lord's name" maxlength="30" autocomplete="off" />
              </div>
              <div class="lc-preview hidden" id="lc-preview"></div>
            </div>

            <!-- Col 2: Race grid -->
            <div class="lord-race-col">
              <div class="panel-section-title">Choose Race</div>
              <div class="race-grid" id="race-grid"></div>
            </div>

            <!-- Col 3: Class grid -->
            <div class="lord-class-col">
              <div class="panel-section-title">Choose Class</div>
              <div class="class-grid" id="class-grid"></div>
            </div>

          </div>

          <div class="lord-card-footer">
            <p class="form-error" id="lord-error"></p>
            <button class="auth-btn" id="lord-begin-btn">Begin your Legacy</button>
          </div>
        </div>

        <button class="signout-btn" id="lord-signout-btn">Sign out</button>
      </div>
    `;

    _buildRaceGrid();
    _buildClassGrid();
    _bindEvents();
  }

  function _buildRaceGrid() {
    const grid = document.getElementById('race-grid');
    grid.innerHTML = Object.values(RACES).map(race => `
      <div class="race-card" data-race="${race.id}">
        <div class="race-icon">${race.icon}</div>
        <div class="race-name">${race.name}</div>
        <div class="race-bonus">${race.bonusLabel}</div>
      </div>
    `).join('');
  }

  function _buildClassGrid() {
    const grid = document.getElementById('class-grid');
    grid.innerHTML = Object.values(LORD_CLASSES).map(cls => `
      <div class="class-card" data-class="${cls.id}" style="--cls-color:${cls.color}">
        <div class="class-card-icon">${cls.icon}</div>
        <div class="class-card-body">
          <div class="class-card-name">${cls.name}</div>
          <div class="class-card-passive">${cls.passive.icon} ${cls.passive.name}</div>
        </div>
        <div class="class-card-mods">
          ${Object.entries(cls.modifiers).map(([k, v]) =>
            `<span class="class-mod">+${v} ${k.charAt(0).toUpperCase() + k.slice(1)}</span>`
          ).join('')}
        </div>
      </div>
    `).join('');
  }

  function _bindEvents() {
    document.getElementById('race-grid').addEventListener('click', e => {
      const card = e.target.closest('.race-card');
      if (card) _selectRace(card.dataset.race);
    });

    document.getElementById('class-grid').addEventListener('click', e => {
      const card = e.target.closest('.class-card');
      if (card) _selectClass(card.dataset.class);
    });

    document.getElementById('lord-begin-btn').addEventListener('click', _onSubmit);
    document.getElementById('lord-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') _onSubmit();
    });
    document.getElementById('lord-signout-btn').addEventListener('click', () => {
      EventBus.emit('player:logout');
    });
  }

  function _selectRace(raceId) {
    if (!RACES[raceId]) return;
    _selectedRace = raceId;
    document.querySelectorAll('.race-card').forEach(c =>
      c.classList.toggle('race-card--selected', c.dataset.race === raceId)
    );
    _updatePreview();
  }

  function _selectClass(classId) {
    if (!LORD_CLASSES[classId]) return;
    _selectedClass = classId;
    document.querySelectorAll('.class-card').forEach(c =>
      c.classList.toggle('class-card--selected', c.dataset.class === classId)
    );
    _updatePreview();
  }

  function _updatePreview() {
    const preview = document.getElementById('lc-preview');
    const race = _selectedRace ? RACES[_selectedRace] : null;
    const cls  = _selectedClass ? LORD_CLASSES[_selectedClass] : null;

    if (!race && !cls) { preview.classList.add('hidden'); return; }

    const modList = cls
      ? Object.entries(cls.modifiers)
          .map(([k, v]) => `+${v} ${LORD_STAT_META[k]?.label || k}`)
          .join(' · ')
      : '';

    preview.classList.remove('hidden');
    preview.innerHTML = `
      ${race ? `
        <div class="lcp-row">
          <span class="lcp-icon">${race.icon}</span>
          <div class="lcp-body">
            <div class="lcp-title">${race.name}</div>
            <div class="lcp-sub">${race.bonusLabel}</div>
          </div>
        </div>
      ` : ''}
      ${cls ? `
        <div class="lcp-row lcp-row--class" style="border-left-color:${cls.color}">
          <span class="lcp-icon">${cls.icon}</span>
          <div class="lcp-body">
            <div class="lcp-title" style="color:${cls.color}">${cls.name}</div>
            <div class="lcp-sub">${modList}</div>
            <div class="lcp-desc">${cls.description}</div>
            <div class="lcp-passive">
              ${cls.passive.icon} <strong>${cls.passive.name}</strong> — ${cls.passive.description}
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }

  async function _onSubmit() {
    const name    = document.getElementById('lord-name').value;
    const errorEl = document.getElementById('lord-error');
    const btn     = document.getElementById('lord-begin-btn');
    errorEl.textContent = '';
    btn.disabled  = true;
    btn.textContent = 'Creating…';

    const result = await ServerActions.createLord(name, _selectedRace, _selectedClass);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Server error';
      btn.disabled = false;
      btn.textContent = 'Begin your Legacy';
      return;
    }

    const updatedPlayer = PlayerService.getById(_player.id);
    EventBus.emit('lord:created', { player: updatedPlayer, lord: result.lord });
  }

  return { render };
})();
