// =============================================
//  a11y.js — keyboard/screen-reader helpers
// =============================================
//
// Makes click-only card elements operable by keyboard without touching
// their existing click handlers: adds role="button" + tabindex, and
// forwards Enter/Space on a focused match to a real .click() so whatever
// click listener is already bound (delegated or per-element) still fires.

const A11y = (() => {
  const NATIVE_INTERACTIVE = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);

  function markInteractive(el) {
    if (NATIVE_INTERACTIVE.has(el.tagName)) return;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
  }

  // container: the ancestor to query within and to attach the (idempotent)
  // keydown listener on. selector: matches the clickable card elements.
  function makeClickable(container, selector) {
    if (!container) return;
    container.querySelectorAll(selector).forEach(markInteractive);

    if (container._a11ySelectors?.has(selector)) return;
    if (!container._a11ySelectors) container._a11ySelectors = new Set();
    container._a11ySelectors.add(selector);

    container.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest(selector);
      if (!el || !container.contains(el)) return;
      e.preventDefault();
      el.click();
    });
  }

  return { makeClickable };
})();
