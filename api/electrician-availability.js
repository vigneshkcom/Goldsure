import {availableDates,getAvailabilityStartDate,dailyLimits,bookingLimit,bookingRule,bookingWindowLimits} from '../electrician-availability/availability.js';
import {lookupArea,suggestRoutes,appointmentWindow,routeIsBlocked,buildAreaRoutePreview} from '../lib/electrician-route-suggestions.js';
import {readScheduleCache,savedSchedule} from '../lib/electrician-schedule-cache.js';
const requestLimits=new Map();
function enforceRateLimit(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || String(req.headers['x-real-ip'] || 'local');
  const now = Date.now();
  for (const [ip, limit] of requestLimits) {
    if (now - limit.startedAt >= 60 * 1000) requestLimits.delete(ip);
  }
  const current = requestLimits.get(key);
  if (!current || now - current.startedAt >= 60 * 1000) {
    requestLimits.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 20) throw Object.assign(new Error('Too many availability checks. Please wait a minute and try again.'), { status: 429 });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const area = String(req.body?.area || '').trim();
  const alarmType = req.body?.alarmType ?? 'battery';
  const durationMinutes = Number(req.body?.durationMinutes ?? 60);
  if (![30, 60, 90, 120].includes(durationMinutes)) return res.status(400).json({ error: 'Select a valid job duration.' });
  if (!['battery', 'hardwired'].includes(alarmType)) {
    return res.status(400).json({ error: 'Select battery-only or hardwired / mixed alarms.' });
  }
  const target = area ? lookupArea(area) : null;
  if (area && (area.length > 100 || !target)) {
    return res.status(400).json({ error: 'Enter a suburb name or a four-digit postcode.' });
  }

  try {
    enforceRateLimit(req);
    const start = getAvailabilityStartDate();
    if (!availableDates.some(day => day.date >= start)) {
      return res.status(200).json({ matches: [], incomplete: false });
    }
    const snapshot = savedSchedule(await readScheduleCache(), availableDates);
    const schedule = snapshot.schedule.filter(row => row.date >= start);
    const metadata = {updatedAt:snapshot.updatedAt, stale:snapshot.stale, retryAt:snapshot.retryAt};
    // Counts and suggestions must come from the same fresh Dataforce snapshot.
    const counts = schedule.map(({ date, name, appointments }) => ({
      date, name, jobCount: appointments?.length ?? null,
      windowCounts: appointments ? {
        AM: appointments.filter(item => appointmentWindow(item.scheduledDate) === 'AM').length,
        PM: appointments.filter(item => appointmentWindow(item.scheduledDate) === 'PM').length,
        unknown: appointments.filter(item => !appointmentWindow(item.scheduledDate)).length
      } : null
    }));
    if (!area) {
      return res.status(200).json({ matches: counts, incomplete: counts.some(row => row.jobCount === null), ...metadata });
    }

    const upcoming = schedule.filter(row => !row.stale && row.date >= start && (
      row.appointments === null || (bookingLimit(row.date, row.name) != null
        
        && row.appointments.length > 0 && row.appointments.length < bookingLimit(row.date, row.name))
    ));
    const locations = snapshot.locations;
    const suggestions = suggestRoutes(upcoming, target, locations, dailyLimits, {
      alarmType, durationMinutes, maxOptions: 18
    });
    // Only the configured browser Maps key can verify driving routes.
    // Candidates remain explicitly unverified until the page checks both legs.
    return res.status(200).json({
      bookedRoutes: schedule.flatMap(row => {
        if (routeIsBlocked(row.name, row.date, target)) return [];
        const windows = new Map();
        for (const appointment of row.appointments || []) {
          const place = locations.get(appointment.customerId);
          if (!place || (target.postcode && place.postcode !== target.postcode)) continue;
          if (target.suburb && lookupArea(place.suburb)?.suburb !== target.suburb) continue;
          const window = appointmentWindow(appointment.scheduledDate);
          if (window) {
            if (!windows.has(window)) windows.set(window,new Set());
            windows.get(window).add([place.suburb,place.postcode].join(' '));
          }
        }
        return [...windows].map(([window,areas]) => {
          const limit=bookingLimit(row.date,row.name);
          const windowsLimit=bookingWindowLimits(row.date,row.name);
          const dailyFull=row.appointments.length>=limit;
          const windowFull=row.appointments.filter(a=>appointmentWindow(a.scheduledDate)===window).length>=windowsLimit?.[window];
          return {name:row.name,date:row.date,window,routePreview:buildAreaRoutePreview(row,target,locations,window),bookedArea:[...areas].join(' / '),
            full:dailyFull || windowFull,
            unavailableReason:row.stale ? 'Awaiting recent sync' : dailyFull ? 'Daily limit reached' :
              windowFull ? window+' limit reached' : 'No verified slot'};
        });
      }),
      matches: [], candidates: suggestions.matches.map(candidate=>({ ...candidate,
        routePreview:buildAreaRoutePreview(schedule.find(row=>row.name===candidate.name && row.date===candidate.date),target,locations,candidate.window)
      })), routeVerificationRequired: true,
      incomplete: suggestions.incomplete || snapshot.stale, counts, ...metadata
    });
  } catch (error) {
    console.error('Electrician availability lookup failed:', error);
    return res.status(error.status || 502).json({ error: 'Availability could not be checked. Please try again.' });
  }
}

