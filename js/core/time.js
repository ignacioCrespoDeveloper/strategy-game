// =============================================
//  time.js — Timestamp utilities
//  All game progression is calculated from timestamps, never polled.
// =============================================

const TimeService = (() => {
  let _skew = 0; // offset between server clock and local clock, set on each /api/sync

  function now() {
    return Date.now(); // milliseconds since epoch
  }

  // Server-adjusted timestamp. Use for displays that should reflect server time.
  function serverNow() { return Date.now() + _skew; }

  // Called after /api/sync with (serverTime - Date.now()) to calibrate the clock.
  function setSkew(offsetMs) { _skew = offsetMs; }

  function secondsElapsed(sinceMs) {
    return (now() - sinceMs) / 1000;
  }

  function hoursElapsed(sinceMs) {
    return secondsElapsed(sinceMs) / 3600;
  }

  // Returns how many seconds remain until a future timestamp.
  // Negative means it already passed.
  function secondsUntil(futureMs) {
    return (futureMs - now()) / 1000;
  }

  // Format a duration in seconds into "Xh Ym Zs" for display.
  function formatDuration(totalSeconds) {
    if (totalSeconds <= 0) return '0s';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return { now, serverNow, setSkew, secondsElapsed, hoursElapsed, secondsUntil, formatDuration };
})();
