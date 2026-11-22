import centroids from './queensland-locality-centroids.js';
import { bookingRule, bookingLimit } from '../electrician-availability/availability.js';

const MAX_OPTIONS = 3;
const NEARBY_KM = 12;
const ON_ROUTE_KM = 18;
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

function bookedSlot(value) {
  const text = String(value || '');
  const iso = text.match(/T(\d{2}):\d{2}/);
  if (iso) return +iso[1] === 0 ? '' : +iso[1] < 12 ? 'AM' : 'PM';
  const time = text.match(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  return time?.[1].toUpperCase() || '';
}

function pickWindow(stops, radial, targetHome, anchor) {
  const distances = radial.map(item => item.distance);
  if (distances.length > 1 && distances[0] - distances.at(-1) >= 6) {
    return targetHome >= (distances[0] + distances.at(-1)) / 2 ? 'AM' : 'PM';
  }
  const times = new Set(stops.filter(stop => stop.suburb === anchor.suburb && stop.postcode === anchor.postcode).map(stop => stop.slot).filter(Boolean));
  if (times.size === 1) return [...times][0];
  if (times.size > 1) {
    const am = stops.filter(stop => stop.slot === 'AM').length;
    const pm = stops.filter(stop => stop.slot === 'PM').length;
    return am <= pm ? 'AM' : 'PM';
  }
  return targetHome >= 18 ? 'AM' : 'PM';
}

// Southern Gold Coast: Robina / Burleigh and suburbs farther south.
// Coordinates also include nearby hinterland; northern Gold Coast stays on normal routes.
export function isSouthGoldCoast(area) {
  if (!area.suburb && ['4213', '4220', '4221', '4223', '4224', '4225', '4226', '4227', '4228'].includes(area.postcode)) return true;
  const point = position(area);
  return !!point && point.lat <= -28.065 && point.lat >= -28.20
    && point.lon >= 153.28 && point.lon <= 153.56;
}

export function suggestRoutes(schedule, area, locations, dailyLimits) {
  let incomplete = schedule.some(row => row.appointments === null);
  const target = position(area);
  const south = isSouthGoldCoast(area);
  const options = [];
  let unknownSouthPriority = false;
  for (const row of schedule) {
    const rule = bookingRule(row.date, row.name);
    if (rule?.southGoldCoast && !south) continue;
    if (row.appointments === null) {
      if (rule?.southGoldCoast && south) unknownSouthPriority = true;
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
      stops.push({ ...place, exact, point, slot: bookedSlot(appointment.scheduledDate) });
    }
    const remaining = limit - row.appointments.length;
    // Reserve the southern area for Mason even when his day has no route yet.
    if (rule?.southGoldCoast && south) {
      options.push({ date: row.date, name: row.name, window: 'AM / PM',
        bookedArea: 'South Gold Coast', nearby: false, proximity: 0,
        remaining, rank: rule.rank, batteryOnly: false, exact: false });
      continue;
    }
    // Josh's priority day can be started around his base before it has bookings.
    if (!row.appointments.length && rule && target && distanceKm(target, base) <= ON_ROUTE_KM) {
      options.push({ date: row.date, name: row.name, window: 'AM / PM',
        bookedArea: [suburb, postcode].join(' '), nearby: true,
        proximity: distanceKm(target, base), remaining, rank: rule.rank,
        batteryOnly: !!rule.batteryOnly, exact: false });
      continue;
    }
    if (!stops.length) continue;
    const exact = stops.some(stop => stop.exact);
    if (!exact && !target) continue;
    const radial = stops.map(stop => ({ ...stop, distance: distanceKm(stop.point, base) }))
      .sort((a, b) => b.distance - a.distance);
    const nearby = radial.map(stop => ({
      ...stop, proximity: exact ? Number(!stop.exact) : distanceKm(stop.point, target)
    })).sort((a, b) => a.proximity - b.proximity);
    const anchor = exact ? nearby.find(stop => stop.exact) : nearby[0];
    const furthest = radial[0];
    const targetHome = exact ? anchor.distance : distanceKm(target, base);
    const onWayHome = !exact && targetHome <= furthest.distance
      && distanceKm(furthest.point, target) + targetHome - furthest.distance <= MAX_EXTRA_KM;
    if (!exact && anchor.proximity > NEARBY_KM
        && !(onWayHome && anchor.proximity <= ON_ROUTE_KM)) continue;
    options.push({
      date: row.date, name: row.name, window: pickWindow(stops, radial, targetHome, anchor),
      bookedArea: [anchor.suburb, anchor.postcode].join(' '), nearby: !exact,
      proximity: anchor.proximity, remaining, rank: rule?.rank,
      batteryOnly: !!rule?.batteryOnly, exact
    });
  }

  // Show only the first priority that can serve this area until its target is met.
  // Missing Mason counts must not silently release South Gold Coast to other dates.
  if (south && unknownSouthPriority) return { matches: [], incomplete: true };
  const priorities = options.filter(option => option.rank != null);
  let selected;
  if (priorities.length) {
    const rank = Math.min(...priorities.map(option => option.rank));
    selected = priorities.filter(option => option.rank === rank);
  } else {
    selected = options.some(option => option.exact) ? options.filter(option => option.exact) : options;
  }
  selected.sort((a, b) => a.proximity - b.proximity || a.date.localeCompare(b.date) || b.remaining - a.remaining);
  const dates = new Set();
  const matches = [];
  for (const option of selected) {
    if (dates.has(option.date)) continue;
    dates.add(option.date);
    const { date, name, window, bookedArea, nearby, batteryOnly, rank, remaining } = option;
    matches.push({ date, name, window, bookedArea, nearby, batteryOnly,
      priority: rank != null, remaining });
    if (matches.length === MAX_OPTIONS) break;
  }
  matches.sort((a, b) => a.date.localeCompare(b.date));
  return { matches, incomplete };
}
