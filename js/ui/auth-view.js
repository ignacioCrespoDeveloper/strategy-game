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

          <!-- LOGIN -->
          <div class="auth-form" id="auth-form-login">
            <input class="auth-input" type="email"    id="login-email"    placeholder="Email" autocomplete="email" />
            <input class="auth-input" type="password" id="login-password" placeholder="Password" autocomplete="current-password" />
            <p class="auth-error" id="login-error"></p>
            <button class="auth-btn" id="login-btn">Enter the Realm</button>

            <div class="auth-divider"><span>or</span></div>
            <button class="auth-btn auth-btn--google" id="google-btn">
              <svg width="18" height="18" viewBox="0 0 48 48" style="margin-right:8px;vertical-align:middle">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.6 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.2 3l5.7-5.7C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.9 0 20-7.9 20-21 0-1.4-.1-2.7-.4-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 6 1.1 8.2 3l5.7-5.7C34.5 5.1 29.5 3 24 3 16.3 3 9.6 7.9 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 45c5.2 0 10-1.8 13.7-4.8l-6.3-5.2C29.4 36.6 26.8 37 24 37c-5.3 0-9.6-3.4-11.3-8l-6.6 5.1C9.6 40.8 16.3 45 24 45z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.8l6.3 5.2C41.1 35.6 44 30.2 44 24c0-1.4-.1-2.7-.4-4z"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <!-- REGISTER -->
          <div class="auth-form auth-form--hidden" id="auth-form-register">
            <input class="auth-input" type="text"     id="reg-username" placeholder="Username (letters, numbers, _)" autocomplete="username" />
            <input class="auth-input" type="email"    id="reg-email"    placeholder="Email" autocomplete="email" />
            <input class="auth-input" type="password" id="reg-password" placeholder="Password (min 6 chars)" autocomplete="new-password" />
            <p class="auth-error" id="reg-error"></p>
            <button class="auth-btn" id="reg-btn">Found your Dynasty</button>

            <div class="auth-divider"><span>or</span></div>
            <button class="auth-btn auth-btn--google" id="google-btn-reg">
              <svg width="18" height="18" viewBox="0 0 48 48" style="margin-right:8px;vertical-align:middle">
                <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.6 29.3 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.2 3l5.7-5.7C34.5 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.9 0 20-7.9 20-21 0-1.4-.1-2.7-.4-4z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 6 1.1 8.2 3l5.7-5.7C34.5 5.1 29.5 3 24 3 16.3 3 9.6 7.9 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 45c5.2 0 10-1.8 13.7-4.8l-6.3-5.2C29.4 36.6 26.8 37 24 37c-5.3 0-9.6-3.4-11.3-8l-6.6 5.1C9.6 40.8 16.3 45 24 45z"/>
                <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.8l6.3 5.2C41.1 35.6 44 30.2 44 24c0-1.4-.1-2.7-.4-4z"/>
              </svg>
              Continue with Google
            </button>
          </div>

        </div>
      </div>
    `;
    _bindEvents();
  }

  function _bindEvents() {
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('auth-tab--active'));
        tab.classList.add('auth-tab--active');
        const target = tab.dataset.tab;
        document.getElementById('auth-form-login').classList.toggle('auth-form--hidden', target !== 'login');
        document.getElementById('auth-form-register').classList.toggle('auth-form--hidden', target !== 'register');
        document.getElementById('login-error').textContent = '';
        document.getElementById('reg-error').textContent   = '';
      });
    });

    document.getElementById('login-btn').addEventListener('click', _onLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') _onLogin(); });
    document.getElementById('reg-btn').addEventListener('click', _onRegister);
    document.getElementById('reg-password').addEventListener('keydown', e => { if (e.key === 'Enter') _onRegister(); });
    document.getElementById('google-btn').addEventListener('click', _onGoogle);
    document.getElementById('google-btn-reg').addEventListener('click', _onGoogle);
  }

  // ── Login ─────────────────────────────────────────────────────

  async function _onLogin() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl  = document.getElementById('login-error');
    const btn      = document.getElementById('login-btn');
    errorEl.textContent = '';

    if (!email || !password) { errorEl.textContent = 'Please fill in all fields.'; return; }

    btn.disabled = true; btn.textContent = 'Signing in…';

    const { data, error } = await SupabaseService.client.auth.signInWithPassword({ email, password });

    btn.disabled = false; btn.textContent = 'Enter the Realm';

    if (error) { errorEl.textContent = _friendlyError(error.message); return; }
    await _hydrateSession(data.session, data.user);
  }

  // ── Register ──────────────────────────────────────────────────

  async function _onRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errorEl  = document.getElementById('reg-error');
    const btn      = document.getElementById('reg-btn');
    errorEl.textContent = '';

    if (!username || !email || !password) { errorEl.textContent = 'Please fill in all fields.'; return; }
    if (username.length < 3)              { errorEl.textContent = 'Username must be at least 3 characters.'; return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { errorEl.textContent = 'Username: only letters, numbers and underscores.'; return; }
    if (password.length < 6)              { errorEl.textContent = 'Password must be at least 6 characters.'; return; }

    btn.disabled = true; btn.textContent = 'Creating dynasty…';

    const { data, error } = await SupabaseService.client.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });

    btn.disabled = false; btn.textContent = 'Found your Dynasty';

    if (error) { errorEl.textContent = _friendlyError(error.message); return; }

    if (!data.session) {
      // Email confirmation is enabled — ask user to confirm
      document.getElementById('reg-error').style.color = '#4caf50';
      errorEl.textContent = '✓ Account created! Check your email to confirm, then sign in.';
      return;
    }

    await _hydrateSession(data.session, data.user);
  }

  // ── Google OAuth ──────────────────────────────────────────────

  async function _onGoogle() {
    const { error } = await SupabaseService.client.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: window.location.origin },
    });
    if (error) alert('Google sign-in failed: ' + error.message);
  }

  // ── Session hydration (shared by all auth paths) ──────────────

  async function _hydrateSession(session, user) {
    const [storageResult, worldResult] = await Promise.all([
      SupabaseService.client.from('storage').select('key, value').eq('player_id', user.id),
      SupabaseService.client.from('world_state').select('key, value'),
    ]);

    const serverData = {};
    storageResult.data?.forEach(row => { serverData[row.key] = row.value; });
    worldResult.data?.forEach(row => { serverData[row.key] = row.value; });
    StorageService.hydrate(serverData);

    const username     = user.user_metadata?.username || user.email?.split('@')[0];
    const players      = StorageService.get('players') || {};
    const existingData = players[user.id];

    const player = {
      ...(existingData || {}),
      id:           user.id,
      username,
      coins:        existingData?.coins    ?? 5000,
      credits:      existingData?.credits  ?? 9999,
      lordId:       existingData?.lordId   ?? null,
      createdAt:    existingData?.createdAt ?? Date.now(),
      passwordHash: '__supabase__',
    };

    players[user.id] = player;
    localStorage.setItem('realms_players', JSON.stringify(players));
    localStorage.setItem('realms_session',  JSON.stringify({ playerId: user.id }));

    EventBus.emit('auth:success', { player });
  }

  // ── Helpers ───────────────────────────────────────────────────

  function _friendlyError(msg) {
    if (msg.includes('Invalid login credentials')) return 'Incorrect email or password.';
    if (msg.includes('User already registered'))   return 'An account with this email already exists.';
    if (msg.includes('Password should be'))        return 'Password must be at least 6 characters.';
    if (msg.includes('Unable to validate'))        return 'Could not reach the server. Please try again.';
    if (msg.includes('Email not confirmed'))       return 'Please confirm your email before signing in.';
    return msg;
  }

  // Called by app.js after OAuth redirect
  function hydrateFromSession(session, user) {
    return _hydrateSession(session, user);
  }

  return { render, hydrateFromSession };
})();
