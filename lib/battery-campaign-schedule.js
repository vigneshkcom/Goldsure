const melbourneHour = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Melbourne', hour: '2-digit', hourCycle: 'h23',
});

// Local business hours, including Melbourne daylight-saving transitions.
export function batterySendingWindow(now = new Date()) {
  const hour = Number(melbourneHour.format(now));
  const allowed = hour >= 8 && hour < 18;
  if (allowed) return { allowed: true, nextSendAt: null };
  let next = Math.floor(now.getTime() / 3600000) * 3600000 + 3600000;
  for (let hours = 0; hours < 26; hours++, next += 3600000) {
    if (Number(melbourneHour.format(new Date(next))) === 8) {
      return { allowed: false, nextSendAt: new Date(next).toISOString() };
    }
  }
  throw new Error('Unable to calculate the next campaign sending window.');
}
