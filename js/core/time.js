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

  // ── Wall-clock formatting ─────────────────────────────────────
  // Every timer in the game was a relative countdown until 2026-08-03 — there
  // was no way to answer "what time does my lord land?" without doing the sum
  // yourself, which is the one thing an OGame-style game always tells you.
  //
  // Same day → "18:42". Any later day → "18:42 Aug 5", because a build queue
  // can run for hundreds of hours and a bare clock time would be a lie by
  // omission. 24-hour clock: this game is played against a countdown, and
  // "18:42" is unambiguous where "6:42" needs a suffix to be.
  function formatClock(ms) {
    if (!ms && ms !== 0) return '';
    const then  = new Date(ms);
    const today = new Date();
    const hhmm  = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`;
    const sameDay = then.getFullYear() === today.getFullYear()
                 && then.getMonth()    === today.getMonth()
                 && then.getDate()     === today.getDate();
    if (sameDay) return hhmm;
    return `${hhmm} ${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }

  // The clock time an action running for `totalSeconds` more will finish at.
  // The pairing every countdown in the UI uses: formatDuration says how long,
  // formatEndsAt says when.
  function endsAtClock(totalSeconds) {
    return formatClock(now() + Math.max(0, totalSeconds || 0) * 1000);
  }

  return {
    now, serverNow, setSkew, secondsElapsed, hoursElapsed, secondsUntil,
    formatDuration, formatClock, endsAtClock,
  };
})();
