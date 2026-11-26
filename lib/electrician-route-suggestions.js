import centroids from './queensland-locality-centroids.js';
import { bookingRule, bookingLimit, bookingWindowLimits } from '../electrician-availability/availability.js';

const MAX_OPTIONS = 6;
const NEARBY_KM = 12;
const ON_ROUTE_KM = 18;
const JOSH_PRIORITY_KM = 50;
const MAX_EXTRA_KM = 4;

const startingAreas = {
  Alex: ["D'Aguilar", '4514'],
  Gurdip: ['Mango Hill', '4509'],
  Josh: ['Bray Park', '4500'],
  Mason: ['Elanora', '4221'],
  Munesh: ['Greenbank', '4124']
};

const normalise = value => String(value || '').toLowerCase().trim().replace(/\u2019/g, "'").replace(/\s+/g, ' ');

export function lookupArea(value) {
  const text = value.trim();
  const match = text.match(/^(?:(.*?)\s*[, ]\s*)?(\d{4})$/);
  const suburb = normalise(match ? match[1] : text);
  const postcode = match?.[2] || '';
  if ((!suburb && !postcode) || !/^[\p{L}\p{M}\s.'\u2019()-]*$/u.test(suburb)) return null;
  return { suburb, postcode };
}

const bySuburbAndPostcode = new Map();
const bySuburb = new Map();
const byPostcode = new Map();
for (const [suburb, postcode, weight, lat, lon] of centroids) {
  const name = normalise(suburb);
  const point = { lat, lon };
  const key = name + '/' + postcode;
  if (!bySuburbAndPostcode.has(key)) bySuburbAndPostcode.set(key, point);
  if (!bySuburb.has(name)) bySuburb.set(name, point);
  const total = byPostcode.get(postcode) || { count: 0, lat: 0, lon: 0 };
  total.count += weight;
  total.lat += lat * weight;
  total.lon += lon * weight;
  byPostcode.set(postcode, total);
}

function position({ suburb, postcode }) {
  const name = normalise(suburb);
  if (name && postcode) return bySuburbAndPostcode.get(name + '/' + postcode);
  if (name) return bySuburb.get(name);
  const total = byPostcode.get(postcode);
  return total && { lat: total.lat / total.count, lon: total.lon / total.count };
}

function distanceKm(from, to) {
  const rad = Math.PI / 180;
  const dLat = (to.lat - from.lat) * rad;
  const dLon = (to.lon - from.lon) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}

// Dataforce's scheduled time is authoritative. Never infer window bookings
// from distance, route position, or unused daily capacity.
export function appointmentWindow(value) {
  const text = String(value || '').trim();
  const twelveHour = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)\b/i);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    return hour >= 1 && hour <= 12 && Number(twelveHour[2]) < 60
      ? twelveHour[3].toUpperCase() : null;
  }
  const clock = text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) return null;
  // Midnight is Dataforce's date-only / unallocated-time placeholder.
  if (Number(clock[1]) === 0 && Number(clock[2]) === 0) return null;
  return Number(clock[1]) < 12 ? 'AM' : 'PM';
}

function routeWindows(stops, limits) {
  if (stops.some(stop => !stop.window)) return null;
  const groups = {
    AM: stops.filter(stop => stop.window === 'AM'),
    PM: stops.filter(stop => stop.window === 'PM')
  };
  return Object.entries(groups).map(([window, stops]) => ({
    window, stops, remaining: Math.max(0, limits[window] - stops.length)
  })).filter(group => group.remaining > 0);
}

// Southern Gold Coast: Robina / Burleigh and suburbs farther south.
// Coordinates also include nearby hinterland; northern Gold Coast stays on normal routes.
export function isSouthGoldCoast(area) {
  if (!area.suburb && ['4213', '4220', '4221', '4223', '4224', '4225', '4226', '4227', '4228'].includes(area.postcode)) return true;
  const point = position(area);
  return !!point && point.lat <= -28.065 && point.lat >= -28.20
    && point.lon >= 153.28 && point.lon <= 153.56;
}

export function suggestRoutes(schedule, area, locations, dailyLimits, { alarmType = 'battery' } = {}) {
  let incomplete = schedule.some(row => row.appointments === null);
  const target = position(area);
  const south = isSouthGoldCoast(area);
  const options = [];
  for (const row of schedule) {
    const rule = bookingRule(row.date, row.name);
    if (alarmType === 'hardwired' && (row.date < '2026-12-01' || rule?.batteryOnly)) continue;
    if (rule?.southGoldCoast && !south) continue;
    if (row.appointments === null) {
      continue;
    }
    const limit = bookingLimit(row.date, row.name) ?? dailyLimits[row.name];
    if (limit == null || row.appointments.length >= limit) continue;
    const [suburb, postcode] = startingAreas[row.name] || [];
    const base = position({ suburb, postcode });
    if (!base) { incomplete = true; continue; }
    const stops = [];
    for (const appointment of row.appointments) {
      const place = locations.get(appointment.customerId);
      const point = place && position(place);
      if (!point) { incomplete = true; continue; }
      const exact = (!area.suburb || normalise(place.suburb) === area.suburb)
        && (!area.postcode || place.postcode === area.postcode);
      stops.push({ ...place, exact, point, window: appointmentWindow(appointment.scheduledDate) });
    }
    // Every booked job must participate in the route split.
    if (stops.length !== row.appointments.length) { incomplete = true; continue; }
    const radial = stops.map(stop => ({ ...stop, distance: distanceKm(stop.point, base) }))
      .sort((a, b) => b.distance - a.distance);
    const windowLimits = bookingWindowLimits(row.date, row.name)
      ?? { AM: Math.ceil(limit / 2), PM: Math.floor(limit / 2) };
    const windows = routeWindows(radial, windowLimits);
    if (windows === null) { incomplete = true; continue; }
    if (!windows.length) continue;
    const priorityWindow = windows.map(group => group.window).join(' / ');
    const remaining = limit - row.appointments.length;
    // Fill Josh's battery-only Brisbane day before assigning nearby November alternatives.
    // An empty route must not restrict him to suburbs around his home base.
    if (row.name === 'Josh' && rule?.batteryOnly && target
        && distanceKm(target, base) <= JOSH_PRIORITY_KM) {
      options.push({ date: row.date, name: row.name, window: priorityWindow,
        bookedArea: 'Brisbane priority area', nearby: false,
        proximity: distanceKm(target, base), remaining, rank: rule.rank,
        batteryOnly: true, exact: false });
      continue;
    }
    // Reserve the southern area for Mason even when his day has no route yet.
    if (rule?.southGoldCoast && south) {
      options.push({ date: row.date, name: row.name, window: priorityWindow,
        bookedArea: 'South Gold Coast', nearby: false, proximity: 0,
        remaining, rank: rule.rank, batteryOnly: false, exact: false });
      continue;
    }
    // Josh's priority day can be started around his base before it has bookings.
    if (!row.appointments.length && rule && target && distanceKm(target, base) <= ON_ROUTE_KM) {
      options.push({ date: row.date, name: row.name, window: priorityWindow,
        bookedArea: [suburb, postcode].join(' '), nearby: true,
        proximity: distanceKm(target, base), remaining, rank: rule.rank,
        batteryOnly: !!rule.batteryOnly, exact: false });
      continue;
    }
    if (!stops.length) continue;
    // Match the enquiry against the route in a window that still has capacity.
    // A nearby morning stop cannot justify an afternoon booking in a distant area.
    const candidates = [];
    for (const group of windows) {
      if (!group.stops.length) continue;
      const exact = group.stops.some(stop => stop.exact);
      if (!exact && !target) continue;
      const nearby = group.stops.map(stop => ({
        ...stop, proximity: exact ? Number(!stop.exact) : distanceKm(stop.point, target)
      })).sort((a, b) => a.proximity - b.proximity);
      const anchor = exact ? nearby.find(stop => stop.exact) : nearby[0];
      const furthest = group.stops[0];
      const targetHome = exact ? anchor.distance : distanceKm(target, base);
      const onWayHome = !exact && targetHome <= furthest.distance
        && distanceKm(furthest.point, target) + targetHome - furthest.distance <= MAX_EXTRA_KM;
      if (!exact && anchor.proximity > NEARBY_KM
          && !(onWayHome && anchor.proximity <= ON_ROUTE_KM)) continue;
      candidates.push({
        date: row.date, name: row.name, window: group.window,
        bookedArea: [anchor.suburb, anchor.postcode].join(' '), nearby: !exact,
        proximity: anchor.proximity, remaining, windowRemaining: Math.min(remaining, group.remaining),
        rank: rule?.rank, batteryOnly: !!rule?.batteryOnly, exact
      });
    }
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || a.proximity - b.proximity);
    if (candidates.length) options.push(candidates[0]);
  }

  // Priorities rank results; they must not hide the following available dates.
  const selected = options;
  selected.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)
    || a.proximity - b.proximity || a.remaining - b.remaining
    || a.date.localeCompare(b.date));
  const dates = new Set();
  const matches = [];
  for (const option of selected) {
    if (dates.has(option.date)) continue;
    dates.add(option.date);
    const { date, name, window, bookedArea, nearby, batteryOnly, rank, remaining, windowRemaining } = option;
    matches.push({ date, name, window, bookedArea, nearby, batteryOnly,
      priority: rank != null, remaining, ...(windowRemaining != null ? { windowRemaining } : {}) });
    if (matches.length === MAX_OPTIONS) break;
  }
  return { matches, incomplete };
}
