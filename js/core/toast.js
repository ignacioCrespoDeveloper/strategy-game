// =============================================
//  toast.js — Shared toast notification service
// =============================================

const ToastService = (() => {
  function show(msg, durationMs = 3200) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  }

  return { show };
})();
