// =============================================
//  events.js — Application event bus
//
//  Decouples domain services from UI views.
//  Domain emits → UI listens. Domain never imports UI.
// =============================================

const EventBus = (() => {
  const _handlers = {};

  function on(event, handler) {
    if (!_handlers[event]) _handlers[event] = [];
    _handlers[event].push(handler);
  }

  function off(event, handler) {
    if (!_handlers[event]) return;
    _handlers[event] = _handlers[event].filter(h => h !== handler);
  }

  function emit(event, data) {
    (_handlers[event] || []).slice().forEach(h => h(data));
  }

  return { on, off, emit };
})();
