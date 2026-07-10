// =============================================
//  auth-view.js — Register / Login screen
// =============================================

const AuthView = (() => {

  function render(root) {
    root.innerHTML = `
      <div class="auth-screen">
        <div class="auth-bg"></div>
        <div class="auth-card">
          <div class="auth-logo">⚔</div>
          <h1 class="auth-title">REALMS</h1>
          <p class="auth-tagline">Age of Lords</p>

          <div class="auth-tabs">
            <button class="auth-tab auth-tab--active" data-tab="login">Sign In</button>
            <button class="auth-tab" data-tab="register">Register</button>
          </div>

          <div class="auth-form" id="auth-form-login">
            <input class="auth-input" type="text" id="login-username" placeholder="Username" autocomplete="username" />
            <input class="auth-input" type="password" id="login-password" placeholder="Password" autocomplete="current-password" />
            <p class="auth-error" id="login-error"></p>
            <button class="auth-btn" id="login-btn">Enter the Realm</button>
          </div>

          <div class="auth-form auth-form--hidden" id="auth-form-register">
            <input class="auth-input" type="text" id="reg-username" placeholder="Choose a username" autocomplete="username" />
            <input class="auth-input" type="password" id="reg-password" placeholder="Choose a password" autocomplete="new-password" />
            <p class="auth-error" id="reg-error"></p>
            <button class="auth-btn" id="reg-btn">Found your Dynasty</button>
          </div>
        </div>
      </div>
    `;

    _bindEvents();
  }

  function _bindEvents() {
    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('auth-tab--active'));
        tab.classList.add('auth-tab--active');
        const target = tab.dataset.tab;
        document.getElementById('auth-form-login').classList.toggle('auth-form--hidden', target !== 'login');
        document.getElementById('auth-form-register').classList.toggle('auth-form--hidden', target !== 'register');
        document.getElementById('login-error').textContent = '';
        document.getElementById('reg-error').textContent = '';
      });
    });

    // Login
    document.getElementById('login-btn').addEventListener('click', _onLogin);
    document.getElementById('login-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') _onLogin();
    });

    // Register
    document.getElementById('reg-btn').addEventListener('click', _onRegister);
    document.getElementById('reg-password').addEventListener('keydown', e => {
      if (e.key === 'Enter') _onRegister();
    });
  }

  function _onLogin() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');
    errorEl.textContent = '';

    const result = PlayerService.login(username, password);
    if (!result.ok) {
      errorEl.textContent = result.error;
      return;
    }
    EventBus.emit('auth:success', { player: result.player });
  }

  function _onRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const errorEl  = document.getElementById('reg-error');
    errorEl.textContent = '';

    const result = PlayerService.register(username, password);
    if (!result.ok) {
      errorEl.textContent = result.error;
      return;
    }
    EventBus.emit('auth:success', { player: result.player });
  }

  return { render };
})();
