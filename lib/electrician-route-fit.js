// Pure timetable checks plus driving verification for one additional stop.
// Existing appointments are never reordered or moved.
const MAX_DETOUR_KM = 4;
const BUFFER_MINUTES = 5;

export function appointmentMinutes(value) {
  const text = String(value || '').trim();
  const twelve = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\b/i);
  const clock = twelve || text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!clock) return null;
  let hour = Number(clock[1]), minute = Number(clock[2]);
  if (minute > 59 || hour > (twelve ? 12 : 23) || (twelve && hour < 1)) return null;
  if (twelve) hour = hour % 12 + (clock[3].toUpperCase() === 'PM' ? 12 : 0);
  return hour === 0 && minute === 0 ? null : hour * 60 + minute;
}

function km(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat-a.lat)*r/2)**2 + Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin((b.lon-a.lon)*r/2)**2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1,h)));
}

export function insertionCandidates(stops, target, base, window, durationMinutes = 60, exactWindowArea = false, startHour = 8) {
  if (!target || !base || !Number.isFinite(durationMinutes) || durationMinutes < 1) return [];
  if (stops.some(stop => stop.minute == null || !Number.isFinite(stop.duration) || stop.duration <= 0)) return [];
  const ordered = [...stops].sort((a,b)=>a.minute-b.minute);
  const from = window === 'AM' ? startHour * 60 : 720;
  const until = window === 'AM' ? 720 : 960;
  const result = [];
  for (let i=0;i<=ordered.length;i++) {
    const previous = ordered[i-1], next = ordered[i];
    const previousEnd = previous ? previous.minute + previous.duration : null;
    const nextStart = next ? next.minute : null;
    const earliest = Math.max(from, previousEnd ?? from);
    const latest = Math.min(960, nextStart ?? 960);
    if (earliest >= until || earliest + durationMinutes > latest) continue;
    const before = previous?.point || base, after = next?.point || base;
    const addedKm = Math.max(0,km(before,target)+km(target,after)-km(before,after));
    if (!exactWindowArea && addedKm > MAX_DETOUR_KM) continue;
    result.push({
      before, target, after, previousEnd, nextStart,
      windowStart:from, windowEnd:until, durationMinutes,
      insertPosition:i, addedKm
    });
  }
  return result.sort((a,b)=>a.addedKm-b.addedKm);
}

export async function verifyInsertion(plan, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('Driving route verification is not configured.');
  const waypoint = point => ({location:{latLng:{latitude:point.lat,longitude:point.lon}}});
  const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-Goog-Api-Key':apiKey,'X-Goog-FieldMask':'routes.legs.duration'},
    body:JSON.stringify({
      origin:waypoint(plan.before),destination:waypoint(plan.after),
      intermediates:[waypoint(plan.target)],travelMode:'DRIVE',
      routingPreference:'TRAFFIC_AWARE',computeAlternativeRoutes:false
    }),
    signal:AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Driving route verification failed ('+response.status+').');
  const payload = await response.json();
  const legs = payload.routes?.[0]?.legs;
  if (!Array.isArray(legs) || legs.length !== 2) throw new Error('Driving route legs are unavailable.');
  const minutes = legs.map(leg => /^\d+(?:\.\d+)?s$/.test(String(leg.duration || '')) ? Math.ceil(parseFloat(leg.duration)/60) : NaN);
  if (minutes.some(value=>!Number.isFinite(value))) throw new Error('Driving durations are unavailable.');
  return checkInsertionTiming(plan, minutes);
}
export function checkInsertionTiming(plan, minutes) {
  if (!Array.isArray(minutes) || minutes.length !== 2 || minutes.some(value => !Number.isFinite(value) || value < 0)) return null;
  const start = Math.max(plan.windowStart,
    plan.previousEnd == null ? plan.windowStart : plan.previousEnd + minutes[0] + BUFFER_MINUTES);
  const end = start + plan.durationMinutes;
  if (start >= plan.windowEnd || end > 960) return null;
  if (plan.nextStart != null && end + minutes[1] + BUFFER_MINUTES > plan.nextStart) return null;
  return {startMinute:start,endMinute:end,driveBeforeMinutes:minutes[0],driveAfterMinutes:minutes[1]};
}
