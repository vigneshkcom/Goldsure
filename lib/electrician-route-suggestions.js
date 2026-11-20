import centroids from './queensland-locality-centroids.js';

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

const normalise = value => String(value || '').toLowerCase().trim().replace(/’/g, "'").replace(/\s+/g, ' ');

export function lookupArea(value) {
  const text = value.trim();
  const match = text.match(/^(?:(.*?)\s*[, ]\s*)?(\d{4})$/);
  const suburb = normalise(match ? match[1] : text);
  const postcode = match?.[2] || '';
  if ((!suburb && !postcode) || !/^[\p{L}\p{M}\s.'’()-]*$/u.test(suburb)) return null;
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

export function suggestRoutes(schedule, area, locations, dailyLimits) {
  let incomplete = schedule.some(row => row.appointments === null);
  const rows = [];
  for (const row of schedule) {
    if (!row.appointments?.length) continue;
    const [suburb, postcode] = startingAreas[row.name] || [];
    const base = position({ suburb, postcode });
    if (!base) { incomplete = true; continue; }
    const stops = [];
    for (const appointment of row.appointments) {
      const place = locations.get(appointment.customerId);
      const point = place && position(place);
      if (!point) {
        incomplete = true;
        continue;
      }
      const exact = (!area.suburb || normalise(place.suburb) === area.suburb)
        && (!area.postcode || place.postcode === area.postcode);
      stops.push({ ...place, exact, point, slot: bookedSlot(appointment.scheduledDate) });
    }
    if (stops.length) rows.push({ ...row, base, stops });
  }
  if (!rows.length) return { matches: [], incomplete };

  const hasExact = rows.some(row => row.stops.some(stop => stop.exact));
  const candidates = hasExact ? rows.filter(row => row.stops.some(stop => stop.exact)) : rows;
  const target = position(area);
  if (!hasExact && !target) return { matches: [], incomplete };
  const options = [];
  for (const { date, name, base, stops, appointments } of candidates) {
    const radial = stops.map(stop => ({ ...stop, distance: distanceKm(stop.point, base) }))
      .sort((a, b) => b.distance - a.distance);
    const nearby = radial.map(stop => ({
      ...stop, proximity: hasExact ? Number(!stop.exact) : distanceKm(stop.point, target)
    })).sort((a, b) => a.proximity - b.proximity);
    const anchor = hasExact ? nearby.find(stop => stop.exact) : nearby[0];
    if (!anchor) continue;
    const furthest = radial[0];
    const targetHome = hasExact ? anchor.distance : distanceKm(target, base);
    const onWayHome = !hasExact && targetHome <= furthest.distance
      && distanceKm(furthest.point, target) + targetHome - furthest.distance <= MAX_EXTRA_KM;
    if (!hasExact && anchor.proximity > NEARBY_KM
        && !(onWayHome && anchor.proximity <= ON_ROUTE_KM)) continue;

    options.push({
      date, name, window: pickWindow(stops, radial, targetHome, anchor),
      bookedArea: [anchor.suburb, anchor.postcode].join(' '),
      nearby: !hasExact,
      proximity: anchor.proximity,
      remaining: dailyLimits[name] == null ? 0 : dailyLimits[name] - appointments.length
    });
  }

  options.sort((a, b) => a.proximity - b.proximity || a.date.localeCompare(b.date) || b.remaining - a.remaining);
  const dates = new Set();
  const matches = [];
  for (const option of options) {
    if (dates.has(option.date)) continue;
    dates.add(option.date);
    const { date, name, window, bookedArea, nearby } = option;
    matches.push({ date, name, window, bookedArea, nearby });
    if (matches.length === MAX_OPTIONS) break;
  }
  matches.sort((a, b) => a.date.localeCompare(b.date));
  return { matches, incomplete };
}
