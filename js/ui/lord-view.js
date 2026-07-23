// =============================================
//  lord-view.js — Race selection screen
//  Shown when a player has no race set yet
//  (new account or Google OAuth user).
// =============================================

const LordView = (() => {
  let _player       = null;
  let _selectedRace = null;

  function render(root, { player }) {
    _player       = player;
    _selectedRace = null;

    root.innerHTML = `
      <div class="lord-screen">
        <div class="auth-bg"></div>

        <div class="lord-card lord-card--wide">
          <div class="lord-card-header">
            <div class="auth-logo">⚔</div>
            <h1 class="auth-title">Choose your Race</h1>
            <p class="auth-tagline">Your race shapes your lords and your cities.</p>
          </div>

          <div class="lord-card-body lord-card-body--flow">
            <div class="race-grid race-grid--wide" id="race-select-grid"></div>
          </div>

          <div class="lord-card-footer">
            <p class="form-error" id="race-select-error"></p>
            <button class="auth-btn" id="race-select-btn">Begin your Legacy</button>
          </div>
        </div>

        <button class="signout-btn" id="race-signout-btn">Sign out</button>
      </div>
    `;

    _buildGrid();
    _bindEvents();
  }

  function _buildGrid() {
    const grid = document.getElementById('race-select-grid');
    grid.innerHTML = Object.values(RACES).map(race => `
      <div class="race-card" data-race="${race.id}">
        <div class="race-icon">${race.icon}</div>
        <div class="race-name">${race.name}</div>
        <div class="race-bonus">${race.bonusLabel}</div>
      </div>
    `).join('');
  }

  function _bindEvents() {
    const grid = document.getElementById('race-select-grid');
    grid.addEventListener('click', e => {
      const card = e.target.closest('.race-card');
      if (!card) return;
      _selectedRace = card.dataset.race;
      document.querySelectorAll('.race-card').forEach(c =>
        c.classList.toggle('race-card--selected', c.dataset.race === _selectedRace)
      );
    });
    A11y.makeClickable(grid, '.race-card');

    document.getElementById('race-select-btn').addEventListener('click', _onConfirm);

    document.getElementById('race-signout-btn').addEventListener('click', () => {
      EventBus.emit('player:logout');
    });
  }

  async function _onConfirm() {
    const errorEl = document.getElementById('race-select-error');
    const btn     = document.getElementById('race-select-btn');
    errorEl.textContent = '';

    if (!_selectedRace) {
      errorEl.textContent = 'Please choose a race.';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Saving…';

    const result = await ServerActions.setPlayerRace(_selectedRace);
    if (!result.ok) {
      errorEl.textContent = result.error || 'Server error';
      btn.disabled    = false;
      btn.textContent = 'Begin your Legacy';
      return;
    }

    const updatedPlayer = PlayerService.getById(_player.id);
    EventBus.emit('race:selected', { player: updatedPlayer });
  }

  return { render };
})();
