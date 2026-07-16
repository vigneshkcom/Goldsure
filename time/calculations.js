(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimeCalculations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SLOT_MINUTES = 15;
  const ROUND_UP_THRESHOLD_MINUTES = 10;
  const UNPAID_MARKER = /\[time-unpaid-minutes:(\d+)\]/;

  function roundedWorkedMinutes(minutes) {
    const worked = Math.max(0, Math.floor(Number(minutes) || 0));
    const fullSlots = Math.floor(worked / SLOT_MINUTES);
    const remaining = worked % SLOT_MINUTES;
    return (fullSlots + (remaining >= ROUND_UP_THRESHOLD_MINUTES ? 1 : 0)) * SLOT_MINUTES;
  }

  function unpaidMinutesFromNote(note) {
    const match = String(note || '').match(UNPAID_MARKER);
    return match ? Math.max(0, Number(match[1]) || 0) : 0;
  }

  return {
    SLOT_MINUTES,
    ROUND_UP_THRESHOLD_MINUTES,
    roundedWorkedMinutes,
    unpaidMinutesFromNote,
  };
});
