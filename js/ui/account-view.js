// =============================================
//  account-view.js — Account settings screen
//
//  Scope (design call 2026-07-29): show the account's identity info and
//  change the password. Deliberately nothing else — no delete-account
//  (needs a real server cleanup endpoint), no Google-link status (the
//  provider isn't enabled yet). Logout already lives in the nav rail.
//
//  Password change is Supabase-native and needs no game-server endpoint:
//  the current password is verified with signInWithPassword (which just
//  re-issues the same user's session on success), then auth.updateUser
//  applies the new one. Both run under the player's own JWT — nothing
//  here can touch another account.
//
//  Routed as 'account' from js/ui/app.js; entered from the nav rail.
// =============================================

const AccountScreen = (() => {

  let _player = null;

  // ── Identity panel ────────────────────────────────────────────

  function _crestHtml(race) {
    if (race?.portrait) {
      return `
        <img src="${race.portrait}" class="acc-crest-img" alt="${race.name}"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="acc-crest-icon" style="display:none">${race.icon || gi('crossed-swords')}</div>`;
    }
    return `<div class="acc-crest-icon">${race?.icon || gi('crossed-swords')}</div>`;
  }

  function _identityHtml() {
    const race = (typeof RACES !== 'undefined' && RACES[_player.race]) || null;
    return `
      <section class="acc-panel acc-identity" aria-label="Account details">
        <div class="acc-id-top">
          <div class="acc-crest">${_crestHtml(race)}</div>
          <div class="acc-id-main">
            <div class="acc-username">${_player.username || 'Unknown'}</div>
            <div class="acc-race-line">${race ? `${race.icon} <span>${race.name}</span>` : ''}</div>
          </div>
        </div>
        <div class="acc-rows">
          <div class="acc-row">
            <span class="acc-row-label">${gi('scroll-unfurled')} Email</span>
            <span class="acc-row-value" id="acc-email">…</span>
          </div>
          <div class="acc-row">
            <span class="acc-row-label">${gi('hourglass')} Member since</span>
            <span class="acc-row-value" id="acc-joined">…</span>
          </div>
        </div>
      </section>`;
  }

  // Email + join date live on the Supabase auth user, not the player blob —
  // fetched after first paint so the screen never blocks on the auth call.
  // textContent only (never gi() output — see icons.js rule).
  async function _fillAuthInfo(root) {
    let user = null;
    try {
      ({ data: { user } } = await SupabaseService.client.auth.getUser());
    } catch { /* fall through to placeholders */ }
    const emailEl = root.querySelector('#acc-email');
    const joinEl  = root.querySelector('#acc-joined');
    if (emailEl) emailEl.textContent = user?.email || '—';
    const joinedMs = user?.created_at ? Date.parse(user.created_at) : _player.createdAt;
    if (joinEl) joinEl.textContent = joinedMs
      ? new Date(joinedMs).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
  }

  // ── Change password panel ─────────────────────────────────────

  function _passwordHtml() {
    return `
      <section class="acc-panel" aria-label="Change password">
        <h2 class="acc-panel-title">${gi('padlock')} Change Password</h2>
        <form id="acc-pw-form" novalidate>
          <label class="acc-label" for="acc-pw-current">Current password</label>
          <input class="acc-input" type="password" id="acc-pw-current" autocomplete="current-password">
          <label class="acc-label" for="acc-pw-new">New password</label>
          <input class="acc-input" type="password" id="acc-pw-new" autocomplete="new-password" placeholder="Min 6 characters">
          <label class="acc-label" for="acc-pw-confirm">Confirm new password</label>
          <input class="acc-input" type="password" id="acc-pw-confirm" autocomplete="new-password">
          <div class="acc-error" id="acc-pw-error" aria-live="polite"></div>
          <button class="acc-submit-btn" id="acc-pw-submit" type="submit">Update Password</button>
        </form>
      </section>`;
  }

  function _setError(form, msg) {
    const el = form.querySelector('#acc-pw-error');
    if (el) el.textContent = msg || '';
  }

  // Busy state lives on the form ELEMENT, not the module — a re-render swaps
  // in a fresh form, so a stale in-flight call's `finally` can only ever
  // clear the old detached form's flag, never disarm the live one.
  async function _changePassword(form) {
    if (form._busy) return;
    const cur  = form.querySelector('#acc-pw-current')?.value || '';
    const next = form.querySelector('#acc-pw-new')?.value || '';
    const conf = form.querySelector('#acc-pw-confirm')?.value || '';

    _setError(form, '');
    if (!cur)             return _setError(form, 'Enter your current password.');
    if (next.length < 6)  return _setError(form, 'New password must be at least 6 characters.');
    if (next !== conf)    return _setError(form, 'New passwords do not match.');
    if (next === cur)     return _setError(form, 'New password is the same as the current one.');

    const btn = form.querySelector('#acc-pw-submit');
    form._busy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try {
      const { data: { user } } = await SupabaseService.client.auth.getUser();
      if (!user?.email) return _setError(form, 'Could not read your account — please refresh.');

      // Verify the current password really is theirs before changing
      // anything. Supabase reports network drops as { error } too, so only a
      // 400 means bad credentials — anything else is a connection problem.
      const { error: verifyErr } = await SupabaseService.client.auth.signInWithPassword({
        email: user.email, password: cur,
      });
      if (verifyErr) {
        return _setError(form, verifyErr.status === 400
          ? 'Current password is incorrect.'
          : 'Could not verify your password — check your connection and try again.');
      }

      const { error: updateErr } = await SupabaseService.client.auth.updateUser({ password: next });
      if (updateErr) return _setError(form, updateErr.message || 'Password update failed — try again.');

      ToastService.show('Password updated');
      ['#acc-pw-current', '#acc-pw-new', '#acc-pw-confirm']
        .forEach(id => { const el = form.querySelector(id); if (el) el.value = ''; });
    } catch {
      _setError(form, 'Connection problem — password unchanged. Try again.');
    } finally {
      form._busy = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
    }
  }

  // ── Render ────────────────────────────────────────────────────

  function _html() {
    return `
      <div class="acc-screen">
        <div class="acc-header">
          <h1 class="acc-title">${gi('gears')} Account</h1>
        </div>
        <div class="acc-body">
          <div class="acc-col">
            ${_identityHtml()}
            ${_passwordHtml()}
          </div>
        </div>
      </div>`;
  }

  function render(root, { player }) {
    _player = PlayerService.getById(player.id) || player;
    root.innerHTML = _html();
    const form = root.querySelector('#acc-pw-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      _changePassword(form);
    });
    _fillAuthInfo(root);
  }

  return { render };
})();
