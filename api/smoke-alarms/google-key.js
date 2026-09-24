// Existing browser-safe Maps key bootstrap plus the protected Route Planner API.
// These actions share one Vercel function to keep the Hobby-plan function count unchanged.

import {
  normalizeEmail,
  normalizePhone,
  classifyDataforceProduct,
  pipelineMatchesProduct,
  findInstalledStage,
  isOpportunityAlreadyWon,
  directCallOpportunityName,
  chooseOpportunity,
  calculateDataforceRevenue,
  groupAppointmentsByJob,
} from '../../lib/dataforce-ghl-sync.js';

const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const DATAFORCE_GRANT_TYPE = 'client_credentials';
const CORE_FIELDWORKER = { id: 1007, name: 'Core Energy Group Pty Ltd', displayName: 'Core Energy Group' };
const BLAKE_FIELDWORKER = { id: 1008, name: 'Blake Harrison', displayName: 'Blake Harrison' };
const BLAKE_ACCESS_PIN = '1008';
// `active` is the current crew. Everyone else stays on the roster so their
// existing bookings keep showing on the calendar, but they are not offered as
// booking candidates and they share one muted colour.
const INACTIVE_COLOR = '#9699a6';
const TEAM_FIELDWORKERS = [
  { id: 1009, name: 'Alex Symonds', displayName: 'Alex Symonds', color: '#fdab3d', active: true },
  { id: 1011, name: 'Gurdip Singh', displayName: 'Gurdip Singh', color: '#0073ea', active: true },
  { id: 1007, name: 'Core Energy Group Pty Ltd', displayName: 'Surya', color: INACTIVE_COLOR, active: false },
  { id: 1008, name: 'Blake Harrison', displayName: 'Blake Harrison', color: INACTIVE_COLOR, active: false },
  { id: 1010, name: 'Liam Stuart', displayName: 'Liam Stuart', color: INACTIVE_COLOR, active: false },
  { id: 1005, name: 'Munesh Chand', displayName: 'Munesh Chand', color: INACTIVE_COLOR, active: false }
];
const TEAM_BOOKABLE = TEAM_FIELDWORKERS.filter(worker => worker.active);
const TEAM_ROUTE_CACHE_TTL_MS = 2 * 60 * 1000;
const teamRouteCache = new Map();
const TEAM_SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const TEAM_SUGGESTION_MAX_JOBS = 10;
const teamSuggestionCache = new Map();
const teamSuggestionRateLimits = new Map();

function send(res, status, payload) {
  res.status(status).json(payload);
}

function resolvePlannerFieldworker(req, res) {
  const corePin = String(process.env.ROUTE_PLANNER_ACCESS_PIN || process.env.DASHBOARD_PASSWORD || '');
  const supplied = String(req.headers['x-route-planner-pin'] || '');
  if (supplied === BLAKE_ACCESS_PIN) return BLAKE_FIELDWORKER;
  if (!corePin) {
    send(res, 503, { error: 'Route Planner access has not been configured yet. Add its PIN in Vercel.' });
    return null;
  }
  if (!supplied || supplied !== corePin) {
    send(res, 401, { error: 'Incorrect access PIN.' });
    return null;
  }
  return CORE_FIELDWORKER;
}

function dataforceConfig() {
  const clientId = String(process.env.DATAFORCE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.DATAFORCE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Dataforce is not connected yet. Add the read-only API key and secret in Vercel.');
  }
  return { instance: DATAFORCE_INSTANCE, clientId, clientSecret };
}

async function dataforceToken() {
  const { clientId, clientSecret } = dataforceConfig();
  const body = new URLSearchParams({
    grant_type: DATAFORCE_GRANT_TYPE,
    scope: 'appointment customer fieldworker job'
  });
  const response = await fetch(`${DATAFORCE_BASE_URL}/authorization/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });
  if (!response.ok) throw new Error(`Dataforce authentication failed (${response.status}).`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Dataforce did not return an access token.');
  return payload.access_token;
}

async function dataforceFetch(token, path, init = {}) {
  const response = await fetch(`${DATAFORCE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Dataforce request failed (${response.status}).`);
  return response.json();
}

async function dataforceOptionalFetch(token, path) {
  const response = await fetch(`${DATAFORCE_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Dataforce request failed (${response.status}).`);
  return response.json();
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function scheduleDateKey(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dataforce = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!dataforce) return '';
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(dataforce[2].toLowerCase());
  if (month < 0) return '';
  return `${dataforce[3]}-${String(month + 1).padStart(2, '0')}-${String(dataforce[1]).padStart(2, '0')}`;
}

function customerName(customer) {
  if (!customer) return 'Customer';
  return String(customer.companyName || '').trim()
    || `${customer.firstname || ''} ${customer.surname || ''}`.trim()
    || 'Customer';
}

function customerAddress(customer) {
  if (!customer) return '';
  const unit = [customer.unitType, customer.unitNo].filter(Boolean).join(' ');
  const street = [customer.streetNo, customer.streetName, customer.streetType, customer.streetTypeSuffix].filter(Boolean).join(' ');
  return [customer.buildingName, unit, street, customer.suburb, customer.state, customer.postCode, 'Australia'].filter(Boolean).join(', ');
}

async function dataforceSchedule(date, fieldworker) {
  const { instance } = dataforceConfig();
  const token = await dataforceToken();
  const appointments = [];
  let after = 0;

  while (true) {
    const result = await dataforceFetch(token, `/${encodeURIComponent(instance)}/appointments/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'fieldworkerId', value: String(fieldworker.id), operator: 'EQ' },
          { propertyName: 'scheduledDate', value: `${date}T00:00:00`, operator: 'GTE' },
          { propertyName: 'scheduledDate', value: `${nextDate(date)}T00:00:00`, operator: 'LT' }
        ] }],
        sorts: [{ propertyName: 'appointmentId', direction: 'asc' }],
        limit: 100,
        after
      })
    });
    const page = result.records || [];
    appointments.push(...page);
    after += page.length;
    if (!page.length || page.length < 100 || after >= (result.totalCount || 0)) break;
  }

  const customerIds = [...new Set(appointments.map(item => item.customerId).filter(Boolean))];
  const entries = await Promise.all(customerIds.map(async id => [
    id,
    await dataforceFetch(token, `/${encodeURIComponent(instance)}/customers/id/${id}`)
  ]));
  const customers = new Map(entries);
  const jobs = appointments.map(appointment => {
    const customer = customers.get(appointment.customerId);
    return {
      appointmentId: appointment.appointmentId,
      jobId: appointment.jobId,
      customerId: appointment.customerId,
      customerName: customerName(customer),
      address: customerAddress(customer),
      scheduledDate: appointment.scheduledDate || '',
      mobile: customer && (customer.mobilePhone || customer.homePhone),
      workType: appointment.workTypeName,
      status: appointment.completionStatusDescription,
      source: 'dataforce'
    };
  }).filter(job => job.address).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  return { fieldworker, jobs };
}

async function dataforceUpcoming(startDate, days, fieldworker) {
  const { instance } = dataforceConfig();
  const token = await dataforceToken();
  const endDate = addDays(startDate, days);
  const appointments = [];
  let after = 0;

  while (true) {
    const result = await dataforceFetch(token, `/${encodeURIComponent(instance)}/appointments/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'fieldworkerId', value: String(fieldworker.id), operator: 'EQ' },
          { propertyName: 'scheduledDate', value: `${startDate}T00:00:00`, operator: 'GTE' },
          { propertyName: 'scheduledDate', value: `${endDate}T00:00:00`, operator: 'LT' }
        ] }],
        sorts: [{ propertyName: 'scheduledDate', direction: 'asc' }],
        limit: 100,
        after
      })
    });
    const page = result.records || [];
    appointments.push(...page);
    after += page.length;
    if (!page.length || page.length < 100 || after >= (result.totalCount || 0)) break;
  }

  const counts = new Map();
  appointments.forEach(appointment => {
    const date = scheduleDateKey(appointment.scheduledDate);
    if (date) counts.set(date, (counts.get(date) || 0) + 1);
  });
  const dates = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  return { fieldworker, startDate, endDate, dates };
}

function appointmentIsBooked(appointment) {
  const status = String(appointment && appointment.completionStatusDescription || '').toLowerCase();
  return !/(cancel|abort)/.test(status);
}

async function dataforceWorkerAppointments(token, fieldworkerId, startDate, endDate) {
  const { instance } = dataforceConfig();
  const appointments = [];
  let after = 0;

  while (true) {
    const result = await dataforceFetch(token, `/${encodeURIComponent(instance)}/appointments/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'fieldworkerId', value: String(fieldworkerId), operator: 'EQ' },
          { propertyName: 'scheduledDate', value: `${startDate}T00:00:00`, operator: 'GTE' },
          { propertyName: 'scheduledDate', value: `${endDate}T00:00:00`, operator: 'LT' }
        ] }],
        sorts: [{ propertyName: 'scheduledDate', direction: 'asc' }],
        limit: 100,
        after
      })
    });
    const page = result.records || [];
    appointments.push(...page);
    after += page.length;
    if (!page.length || page.length < 100 || after >= (result.totalCount || 0)) break;
  }

  return appointments.filter(appointmentIsBooked);
}

function publicTeamWorker(fieldworker) {
  return { id: fieldworker.id, name: fieldworker.displayName, color: fieldworker.color, active: Boolean(fieldworker.active) };
}

async function cachedTeamRoute(key, load) {
  const now = Date.now();
  const current = teamRouteCache.get(key);
  if (current && current.expiresAt > now) return current.value;
  const value = load();
  teamRouteCache.set(key, { value, expiresAt: now + TEAM_ROUTE_CACHE_TTL_MS });
  try {
    return await value;
  } catch (error) {
    if (teamRouteCache.get(key)?.value === value) teamRouteCache.delete(key);
    throw error;
  }
}

function shortHash(value) {
  let hash = 2166136261;
  const text = String(value || '').toLowerCase().trim();
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function cachedTeamSuggestion(key, load) {
  const now = Date.now();
  const current = teamSuggestionCache.get(key);
  if (current && current.expiresAt > now) return current.value;
  const value = load();
  teamSuggestionCache.set(key, { value, expiresAt: now + TEAM_SUGGESTION_CACHE_TTL_MS });
  try {
    return await value;
  } catch (error) {
    if (teamSuggestionCache.get(key)?.value === value) teamSuggestionCache.delete(key);
    throw error;
  }
}

function enforceSuggestionRateLimit(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || String(req.headers['x-real-ip'] || 'local');
  const now = Date.now();
  const current = teamSuggestionRateLimits.get(key);
  if (!current || now - current.startedAt >= 60 * 1000) {
    teamSuggestionRateLimits.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > 20) throw Object.assign(new Error('Too many date checks. Please wait a minute and try again.'), { status: 429 });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function dataforceTeamSummary(startDate, days) {
  const token = await dataforceToken();
  const endDate = addDays(startDate, days);
  const schedules = await Promise.all(TEAM_FIELDWORKERS.map(async fieldworker => ({
    fieldworker,
    appointments: await dataforceWorkerAppointments(token, fieldworker.id, startDate, endDate)
  })));
  const dates = new Map();

  schedules.forEach(({ fieldworker, appointments }) => {
    appointments.forEach(appointment => {
      const date = scheduleDateKey(appointment.scheduledDate);
      if (!date) return;
      if (!dates.has(date)) dates.set(date, { date, totalJobs: 0, workers: [] });
      const entry = dates.get(date);
      let worker = entry.workers.find(item => item.id === fieldworker.id);
      if (!worker) {
        worker = { ...publicTeamWorker(fieldworker), jobCount: 0 };
        entry.workers.push(worker);
      }
      worker.jobCount += 1;
      entry.totalJobs += 1;
    });
  });

  const order = new Map(TEAM_FIELDWORKERS.map((worker, index) => [worker.id, index]));
  const resultDates = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
  resultDates.forEach(entry => entry.workers.sort((a, b) => order.get(a.id) - order.get(b.id)));
  return { startDate, endDate, workers: TEAM_FIELDWORKERS.map(publicTeamWorker), dates: resultDates };
}

function customerRouteLabel(customer) {
  if (!customer) return '';
  const suburb = String(customer.suburb || '').trim();
  const postCode = String(customer.postCode || '').trim();
  return [suburb, postCode].filter(Boolean).join(' ');
}

function collapseRoute(labels) {
  return labels.filter(Boolean).filter((label, index, all) => index === 0 || label !== all[index - 1]);
}

async function dataforceTeamDay(date) {
  const { instance } = dataforceConfig();
  const token = await dataforceToken();
  const endDate = nextDate(date);
  const schedules = await Promise.all(TEAM_FIELDWORKERS.map(async fieldworker => ({
    fieldworker,
    appointments: await dataforceWorkerAppointments(token, fieldworker.id, date, endDate)
  })));
  const customerIds = [...new Set(schedules.flatMap(item => item.appointments.map(appointment => appointment.customerId)).filter(Boolean))];
  const entries = await Promise.all(customerIds.map(async id => {
    try {
      return [id, await dataforceFetch(token, `/${encodeURIComponent(instance)}/customers/id/${id}`)];
    } catch (_) {
      return [id, null];
    }
  }));
  const customers = new Map(entries);
  const workers = schedules.map(({ fieldworker, appointments }) => ({
    ...publicTeamWorker(fieldworker),
    jobCount: appointments.length,
    route: collapseRoute(appointments.map(appointment => customerRouteLabel(customers.get(appointment.customerId))))
  }));
  return { date, totalJobs: workers.reduce((sum, worker) => sum + worker.jobCount, 0), workers };
}

async function dataforceTeamWorkerSchedule(date, fieldworker) {
  const { instance } = dataforceConfig();
  const token = await dataforceToken();
  const appointments = await dataforceWorkerAppointments(token, fieldworker.id, date, nextDate(date));
  const customerIds = [...new Set(appointments.map(appointment => appointment.customerId).filter(Boolean))];
  const entries = await Promise.all(customerIds.map(async id => {
    try {
      return [id, await dataforceFetch(token, `/${encodeURIComponent(instance)}/customers/id/${id}`)];
    } catch (_) {
      return [id, null];
    }
  }));
  const customers = new Map(entries);
  const jobs = appointments.map((appointment, index) => ({
    appointmentId: appointment.appointmentId || `team-${fieldworker.id}-${index + 1}`,
    customerName: `Stop ${index + 1}`,
    address: customerAddress(customers.get(appointment.customerId)),
    workType: appointment.workTypeName || 'Scheduled job',
    status: appointment.completionStatusDescription || '',
    source: 'dataforce'
  })).filter(job => job.address);
  return {
    date,
    fieldworker: { ...publicTeamWorker(fieldworker), displayName: fieldworker.displayName },
    jobs
  };
}

function scheduleHour(value) {
  const text = String(value || '').trim();
  const iso = text.match(/T(\d{1,2}):(\d{2})/);
  if (iso) return Number(iso[1]);
  const dataforce = text.match(/\s(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!dataforce) return null;
  let hour = Number(dataforce[1]);
  const marker = dataforce[3].toUpperCase();
  if (marker === 'PM' && hour < 12) hour += 12;
  if (marker === 'AM' && hour === 12) hour = 0;
  return hour;
}

async function dataforceTeamBookingSuggestions(address, startDate, days) {
  const { instance } = dataforceConfig();
  const token = await dataforceToken();
  const endDate = addDays(startDate, days);
  const workerSchedules = await Promise.all(TEAM_BOOKABLE.map(async fieldworker => ({
    fieldworker,
    appointments: await dataforceWorkerAppointments(token, fieldworker.id, startDate, endDate)
  })));
  const eligible = [];
  workerSchedules.forEach(({ fieldworker, appointments }) => {
    const byDate = new Map();
    appointments.forEach(appointment => {
      const date = scheduleDateKey(appointment.scheduledDate);
      if (!date) return;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(appointment);
    });
    byDate.forEach((dayAppointments, date) => {
      if (dayAppointments.length > 0 && dayAppointments.length < TEAM_SUGGESTION_MAX_JOBS) {
        eligible.push({ date, fieldworker, appointments: dayAppointments });
      }
    });
  });
  if (!eligible.length) {
    return { addressType: /^\d{4}$/.test(address) ? 'postcode' : 'address', maxExtraMinutes: 20, candidates: [] };
  }

  const customerIds = [...new Set(eligible.flatMap(schedule => schedule.appointments.map(appointment => appointment.customerId)).filter(Boolean))];
  const customerEntries = await mapWithConcurrency(customerIds, 8, async id => {
    try {
      return [id, await dataforceFetch(token, `/${encodeURIComponent(instance)}/customers/id/${id}`)];
    } catch (_) {
      return [id, null];
    }
  });
  const customers = new Map(customerEntries);
  const candidates = eligible.map(schedule => ({
    date: schedule.date,
    electrician: publicTeamWorker(schedule.fieldworker),
    jobCount: schedule.appointments.length,
    jobs: schedule.appointments.map(appointment => {
      const customer = customers.get(appointment.customerId);
      const hour = scheduleHour(appointment.scheduledDate);
      return {
        address: customerAddress(customer),
        routeLabel: customerRouteLabel(customer),
        scheduledSlot: Number.isFinite(hour) && hour > 0 ? (hour >= 12 ? 'PM' : 'AM') : ''
      };
    })
  })).filter(schedule => schedule.jobs.length > 0 && schedule.jobs.every(job => job.address));
  return {
    addressType: /^\d{4}$/.test(address) ? 'postcode' : 'address',
    maxExtraMinutes: 20,
    candidates
  };
}

function durationSeconds(value) {
  return value ? Math.round(Number(String(value).replace('s', ''))) : 0;
}

function googleMapsDirectionsUrl(addresses) {
  const params = new URLSearchParams({
    api: '1',
    origin: addresses[0],
    destination: addresses[addresses.length - 1],
    travelmode: 'driving'
  });
  const waypoints = addresses.slice(1, -1);
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

async function planRoute(body) {
  const jobs = Array.isArray(body.jobs) ? body.jobs.filter(job => job && job.address) : [];
  if (jobs.length < 2) throw Object.assign(new Error('At least two valid job addresses are required.'), { status: 400 });
  if (jobs.length > 23) throw Object.assign(new Error('This version supports up to 23 jobs in one route.'), { status: 400 });
  const apiKey = process.env.GOOGLE_MAPS_ROUTES_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) throw Object.assign(new Error('Google Routes is not configured yet.'), { status: 503 });

  const startAddress = String(body.startAddress || '').trim();
  const hasManualStart = Boolean(startAddress);
  const returnToStart = Boolean(startAddress && body.returnToStart);
  const origin = hasManualStart ? startAddress : jobs[0].address;
  const destination = returnToStart ? startAddress : jobs[jobs.length - 1].address;
  const intermediateJobs = hasManualStart ? (returnToStart ? jobs : jobs.slice(0, -1)) : jobs.slice(1, -1);
  const lockedStart = hasManualStart ? undefined : jobs[0];
  const lockedEnd = returnToStart || hasManualStart ? (returnToStart ? undefined : jobs[jobs.length - 1]) : jobs[jobs.length - 1];

  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex,routes.legs.distanceMeters,routes.legs.duration,routes.legs.startLocation,routes.legs.endLocation'
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      intermediates: intermediateJobs.map(job => ({ address: job.address })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      optimizeWaypointOrder: Boolean(body.optimize && intermediateJobs.length > 1),
      languageCode: 'en-AU',
      units: 'METRIC'
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Google Routes error', response.status, detail.slice(0, 500));
    throw Object.assign(new Error(`Google could not calculate this route (${response.status}). Check the addresses and Routes API access.`), { status: 502 });
  }
  const result = await response.json();
  const route = result.routes && result.routes[0];
  if (!route || !route.polyline || !route.polyline.encodedPolyline || !route.legs || !route.legs.length) {
    throw Object.assign(new Error('Google did not return a drivable route for these addresses.'), { status: 422 });
  }

  const order = route.optimizedIntermediateWaypointIndex && route.optimizedIntermediateWaypointIndex.length
    ? route.optimizedIntermediateWaypointIndex
    : intermediateJobs.map((_, index) => index);
  const orderedIntermediate = order.map(index => intermediateJobs[index]);
  const orderedJobs = [lockedStart, ...orderedIntermediate, lockedEnd].filter(Boolean);
  const addresses = [origin, ...orderedIntermediate.map(job => job.address), destination];
  const waypointJobs = [lockedStart, ...orderedIntermediate, lockedEnd];
  const points = [route.legs[0].startLocation, ...route.legs.map(leg => leg.endLocation)];
  const waypoints = points.map((point, index) => ({
    label: waypointJobs[index] && waypointJobs[index].customerName
      ? waypointJobs[index].customerName
      : index === 0 ? 'Start' : index === points.length - 1 ? 'Finish' : `Stop ${index}`,
    address: addresses[index],
    stopId: waypointJobs[index] && waypointJobs[index].appointmentId,
    latitude: point && point.latLng ? point.latLng.latitude : 0,
    longitude: point && point.latLng ? point.latLng.longitude : 0
  }));
  return {
    distanceMeters: route.distanceMeters || route.legs.reduce((sum, leg) => sum + (leg.distanceMeters || 0), 0),
    durationSeconds: durationSeconds(route.duration) || route.legs.reduce((sum, leg) => sum + durationSeconds(leg.duration), 0),
    encodedPolyline: route.polyline.encodedPolyline,
    orderedStopIds: orderedJobs.map(job => job.appointmentId),
    waypoints,
    googleMapsUrl: googleMapsDirectionsUrl(addresses)
  };
}

function resolveDataforceGhlSyncAccess(req, res) {
  const expected = String(process.env.DATAFORCE_GHL_SYNC_PIN || process.env.DASHBOARD_PASSWORD || '').trim();
  const supplied = String(req.headers['x-dataforce-ghl-pin'] || '').trim();
  if (!expected) {
    send(res, 503, { error: 'Dataforce to GHL preview access has not been configured.' });
    return false;
  }
  if (!supplied || supplied !== expected) {
    send(res, 401, { error: 'Incorrect access PIN.' });
    return false;
  }
  return true;
}

async function dataforceAppointmentsBetween(token, startDate, endDate) {
  const { instance } = dataforceConfig();
  const appointments = [];
  let after = 0;
  while (appointments.length < 1000) {
    const result = await dataforceFetch(token, `/${encodeURIComponent(instance)}/appointments/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: 'scheduledDate', value: `${startDate}T00:00:00`, operator: 'GTE' },
          { propertyName: 'scheduledDate', value: `${nextDate(endDate)}T00:00:00`, operator: 'LT' },
       ] }],
        sorts: [{ propertyName: 'scheduledDate', direction: 'desc' }],
        limit: 100,
        after,
      }),
    });
    const page = result.records || [];
    appointments.push(...page);
    after += page.length;
    if (!page.length || page.length < 100 || after >= (result.totalCount || 0)) break;
  }
  return appointments;
}

function ghlSyncConfig() {
  const apiKey = String(process.env.GHL_API_KEY || '').trim();
  const locationId = String(process.env.GHL_LOCATION_ID || '').trim();
  if (!apiKey || !locationId) throw new Error('GHL is not configured for the Dataforce preview.');
  return { apiKey, locationId };
}

async function ghlSyncFetch(apiKey, path, version = '2021-07-28') {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(`https://services.leadconnectorhq.com${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: version, Accept: 'application/json' },
    });
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
    const waitMs = Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 4000) : 400 * (2 ** attempt);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  if (!response?.ok) throw new Error(`GHL request failed (${response?.status || 'network error'}).`);
  return response.json();
}

function customerDisplayName(customer) {
  return String(customer?.companyName || '').trim()
    || `${customer?.firstname || ''} ${customer?.surname || ''}`.trim()
    || 'Customer';
}

function customerPhoneValues(customer) {
  return [...new Set([
    customer?.mobilePhone,
    [customer?.areaCode, customer?.homePhone].filter(Boolean).join(''),
    customer?.homePhone,
  ].map(value => String(value || '').trim()).filter(Boolean))];
}

async function findExactGhlContact(apiKey, locationId, customer) {
  const email = normalizeEmail(customer?.email);
  const phones = customerPhoneValues(customer).map(normalizePhone).filter(Boolean);
  const queries = [...new Set([
    ...(email ? [email] : []),
    ...customerPhoneValues(customer),
  ])];
  const matches = new Map();
  const matchedBy = new Map();
  const payloads = await Promise.all(queries.map(async query => ghlSyncFetch(
    apiKey,
    `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=20`,
  )));
  for (const payload of payloads) {
    for (const contact of payload.contacts || []) {
      const emailMatch = email && normalizeEmail(contact.email) === email;
      const phoneMatch = phones.length && phones.includes(normalizePhone(contact.phone));
      if (!emailMatch && !phoneMatch) continue;
      matches.set(contact.id, contact);
      const reasons = matchedBy.get(contact.id) || new Set();
      if (emailMatch) reasons.add('email');
      if (phoneMatch) reasons.add('phone');
      matchedBy.set(contact.id, reasons);
    }
  }
  if (!matches.size) return { status: 'unmatched', contact: null, matchedBy: [] };
  if (matches.size > 1) {
    return {
      status: 'conflict',
      contact: null,
      matchedBy: [],
      candidates: [...matches.values()].map(contact => ({ id: contact.id, name: contact.name || '' })),
    };
  }
  const contact = [...matches.values()][0];
  return { status: 'matched', contact, matchedBy: [...(matchedBy.get(contact.id) || [])] };
}

function configuredPipelineIds(pipelines, product) {
  const configured = product === 'aircon' ? process.env.AIRCON_PIPELINE_ID
    : product === 'hws-nsw' ? process.env.NSW_HWS_PIPELINE_ID
      : (product === 'hws-vic' || product === 'hws') ? process.env.HWS_PIPELINE_ID
        : product === 'smoke' ? process.env.SMOKE_ALARMS_PIPELINE_ID
          : '';
  return [...new Set([
    ...(configured && pipelines.some(pipeline => pipeline.id === configured) ? [configured] : []),
    ...pipelines.filter(pipeline => pipelineMatchesProduct(pipeline.name, product)).map(pipeline => pipeline.id),
  ])];
}

function dataforceJobIdField(customFields) {
  const normal = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return (customFields || []).find(field => field.model === 'opportunity' && [
    'dataforce job id', 'dataforce jobid',
  ].includes(normal(field.name))) || (customFields || []).find(field => String(field.fieldKey || '').toLowerCase().endsWith('.dataforce_job_id')) || null;
}

async function dataforceRevenueForJob(token, instance, representative, jobId) {
  const appointmentId = representative?.appointmentId;
  if (appointmentId) {
    const invoice = await dataforceOptionalFetch(
      token,
      `/${encodeURIComponent(instance)}/appointments/${encodeURIComponent(appointmentId)}/invoice`,
    );
    const calculated = calculateDataforceRevenue(invoice, 'appointment invoice');
    if (calculated.confident) return calculated;
  }
  const quote = await dataforceOptionalFetch(
    token,
    `/${encodeURIComponent(instance)}/jobs/${encodeURIComponent(jobId)}/quote`,
  );
  return calculateDataforceRevenue(quote, quote ? 'job quote' : '');
}

async function dataforceGhlPreview(startDate, endDate) {
  const token = await dataforceToken();
  const { instance } = dataforceConfig();
  const { apiKey, locationId } = ghlSyncConfig();
  const appointments = await dataforceAppointmentsBetween(token, startDate, endDate);
  const jobs = groupAppointmentsByJob(appointments);
  const customerIds = [...new Set(jobs.map(job => job.representative?.customerId).filter(Boolean))];
  const customerEntries = await mapWithConcurrency(customerIds, 8, async customerId => [
    String(customerId),
    await dataforceFetch(token, `/${encodeURIComponent(instance)}/customers/id/${encodeURIComponent(customerId)}`),
  ]);
  const customers = new Map(customerEntries);
  const pipelinePayload = await ghlSyncFetch(
    apiKey,
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  );
  const pipelines = pipelinePayload.pipelines || [];
  let customFields = [];
  try {
    const fieldsPayload = await ghlSyncFetch(
      apiKey,
      `/locations/${encodeURIComponent(locationId)}/customFields?model=opportunity`,
      '2021-07-28',
    );
    customFields = fieldsPayload.customFields || [];
  } catch (error) {
    console.warn('Could not inspect GHL opportunity custom fields:', error.message);
  }
  const jobIdField = dataforceJobIdField(customFields);

  const rows = await mapWithConcurrency(jobs, 4, async job => {
    const appointment = job.representative || {};
    const customer = customers.get(String(appointment.customerId));
    const product = classifyDataforceProduct({ workType: appointment.workTypeName, state: customer?.state });
    const base = {
      jobId: job.jobId,
      appointmentId: appointment.appointmentId || null,
      customerId: appointment.customerId || null,
      customerName: customerDisplayName(customer),
      email: String(customer?.email || '').trim(),
      phone: String(customer?.mobilePhone || customer?.homePhone || '').trim(),
      address: customerAddress(customer),
      state: String(customer?.state || '').trim(),
      workType: String(appointment.workTypeName || '').trim(),
      scheduledDate: appointment.scheduledDate || '',
      dataforceStatus: appointment.completionStatusDescription || '',
      completed: job.completed,
      product,
      matchStatus: 'unmatched',
      matchedBy: [],
      proposedChanges: [],
    };
    if (!customer) return { ...base, issue: 'Dataforce customer could not be loaded.' };
    const pipelineIds = configuredPipelineIds(pipelines, product);
    const targetPipeline = pipelines.find(item => pipelineIds.includes(item.id));
    const installedStage = findInstalledStage(targetPipeline);
    const match = await findExactGhlContact(apiKey, locationId, customer);
    if (match.status === 'conflict') {
      return {
        ...base,
        matchStatus: match.status,
        issue: 'Email and phone matched more than one GHL contact. Creation is blocked to prevent a duplicate.',
        candidates: match.candidates || [],
      };
    }

    if (product === 'unknown') {
      return { ...base, matchStatus: match.status, issue: 'Work type could not be mapped to a GHL pipeline.' };
    }
    if (!targetPipeline) {
      return { ...base, matchStatus: match.status, issue: 'The matching GHL pipeline could not be found.' };
    }

    let revenue = { confident: false, source: '', revenue: null };
    if (job.completed) revenue = await dataforceRevenueForJob(token, instance, appointment, job.jobId);
    const jobFieldChange = jobIdField
      ? `Set Dataforce Job ID to ${job.jobId}`
      : `Set Dataforce Job ID to ${job.jobId} (GHL field needs setup)`;

    if (match.status === 'unmatched') {
      const opportunityName = directCallOpportunityName(base.customerName);
      const detailNames = [base.customerName && 'name', base.email && 'email', base.phone && 'phone', base.address && 'property address'].filter(Boolean);
      const proposedChanges = [
        `Create GHL contact with ${detailNames.join(', ')}`,
        `Create ${targetPipeline.name} opportunity: ${opportunityName}`,
        'Set source to Direct Call',
        jobFieldChange,
      ];
      if (job.completed && installedStage) proposedChanges.push(`Create in ${installedStage.name}`);
      if (job.completed) proposedChanges.push('Create opportunity as Won');
      if (job.completed && revenue.confident) proposedChanges.push(`Set revenue to $${revenue.revenue.toFixed(2)}`);
      return {
        ...base,
        matchStatus: 'unmatched',
        createContact: true,
        createOpportunity: true,
        opportunityName,
        opportunitySource: 'Direct Call',
        pipeline: targetPipeline.name,
        currentRevenue: null,
        targetStage: job.completed ? (installedStage?.name || '') : '',
        targetStatus: job.completed ? 'won' : 'open',
        proposedRevenue: revenue.confident ? revenue.revenue : null,
        revenue,
        proposedChanges,
        issue: job.completed && !installedStage ? 'The matching pipeline has no Installed stage.' : '',
      };
    }

    const contact = match.contact;
    const opportunityPayload = await ghlSyncFetch(
      apiKey,
      `/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=100`,
    );
    const opportunity = chooseOpportunity(opportunityPayload.opportunities || [], pipelineIds);
    const matchedBase = {
      ...base,
      matchStatus: 'matched',
      matchedBy: match.matchedBy,
      ghlContactId: contact.id,
      ghlContactName: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '),
      ghlLink: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contact.id}`,
    };
    if (!opportunity) {
      const opportunityName = directCallOpportunityName(base.customerName);
      const proposedChanges = [
        `Create ${targetPipeline.name} opportunity: ${opportunityName}`,
        'Set source to Direct Call',
        jobFieldChange,
      ];
      if (job.completed && installedStage) proposedChanges.push(`Create in ${installedStage.name}`);
      if (job.completed) proposedChanges.push('Create opportunity as Won');
      if (job.completed && revenue.confident) proposedChanges.push(`Set revenue to $${revenue.revenue.toFixed(2)}`);
      return {
        ...matchedBase,
        createOpportunity: true,
        opportunityName,
        opportunitySource: 'Direct Call',
        pipeline: targetPipeline.name,
        currentRevenue: null,
        targetStage: job.completed ? (installedStage?.name || '') : '',
        targetStatus: job.completed ? 'won' : 'open',
        proposedRevenue: revenue.confident ? revenue.revenue : null,
        revenue,
        proposedChanges,
        issue: job.completed && !installedStage ? 'The matching pipeline has no Installed stage.' : '',
      };
    }

    const pipeline = pipelines.find(item => item.id === opportunity.pipelineId);
    const currentStage = pipeline?.stages?.find(stage => stage.id === opportunity.pipelineStageId);
    const opportunityInstalledStage = findInstalledStage(pipeline);
    const proposedChanges = [jobFieldChange];
    if (job.completed && opportunityInstalledStage && opportunity.pipelineStageId !== opportunityInstalledStage.id) {
      proposedChanges.push(`Move stage to ${opportunityInstalledStage.name}`);
    }
    if (job.completed && !isOpportunityAlreadyWon(opportunity, currentStage?.name)) {
      proposedChanges.push('Mark opportunity Won');
    }
    if (job.completed && revenue.confident && Number(opportunity.monetaryValue || 0) !== revenue.revenue) {
      proposedChanges.push(`Update revenue to $${revenue.revenue.toFixed(2)}`);
    }
    return {
      ...matchedBase,
      pipeline: pipeline?.name || '',
      currentStage: currentStage?.name || '',
      currentStatus: opportunity.status || '',
      currentRevenue: Number(opportunity.monetaryValue || 0),
      opportunityId: opportunity.id,
      targetStage: job.completed ? (opportunityInstalledStage?.name || '') : '',
      targetStatus: job.completed && !isOpportunityAlreadyWon(opportunity, currentStage?.name) ? 'won' : '',
      proposedRevenue: revenue.confident ? revenue.revenue : null,
      revenue,
      proposedChanges,
      issue: job.completed && !opportunityInstalledStage ? 'The matching pipeline has no Installed stage.' : '',
    };
  });

  rows.sort((a, b) => String(b.scheduledDate || '').localeCompare(String(a.scheduledDate || '')));
  return {
    mode: 'preview',
    readOnly: true,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    jobIdField: jobIdField ? { id: jobIdField.id, name: jobIdField.name } : null,
    summary: {
      appointments: appointments.length,
      jobs: rows.length,
      completedJobs: rows.filter(row => row.completed).length,
      matched: rows.filter(row => row.matchStatus === 'matched').length,
      conflicts: rows.filter(row => row.matchStatus === 'conflict').length,
      unmatched: rows.filter(row => row.matchStatus === 'unmatched').length,
      proposedCreates: rows.filter(row => row.createContact || row.createOpportunity).length,
      proposedUpdates: rows.filter(row => row.proposedChanges.length).length,
    },
    rows,
  };
}

export default async function handler(req, res) {
  // Preserve the existing endpoint contract used by quote/address pages.
  if (req.method === 'GET') {
    return send(res, 200, { key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const action = req.body && req.body.action;
  try {
    if (action === 'dataforce-ghl-preview') {
      if (!resolveDataforceGhlSyncAccess(req, res)) return;
      const startDate = String(req.body.startDate || '');
      const endDate = String(req.body.endDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return send(res, 400, { error: 'Choose a valid start and end date.' });
      }
      const start = new Date(`${startDate}T00:00:00Z`);
      const end = new Date(`${endDate}T00:00:00Z`);
      const days = Math.round((end - start) / 86400000) + 1;
      if (!Number.isFinite(days) || days < 1 || days > 14) {
        return send(res, 400, { error: 'Choose a date range between 1 and 14 days.' });
      }
      return send(res, 200, await dataforceGhlPreview(startDate, endDate));
    }

    // The sales team view is intentionally PIN-free. Calendar and suggestion
    // actions never return customer names, contact details or customer IDs.
    if (action === 'team-schedule-summary') {
      const startDate = String(req.body.startDate || '');
      const days = Math.min(62, Math.max(1, Math.trunc(Number(req.body.days) || 42)));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return send(res, 400, { error: 'Choose a valid start date.' });
      return send(res, 200, await cachedTeamRoute(`summary:${startDate}:${days}`, () => dataforceTeamSummary(startDate, days)));
    }
    if (action === 'team-day-routes') {
      const date = String(req.body.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Choose a valid route date.' });
      return send(res, 200, await cachedTeamRoute(`day:${date}`, () => dataforceTeamDay(date)));
    }
    if (action === 'team-worker-schedule') {
      const date = String(req.body.date || '');
      const workerId = Number(req.body.workerId);
      const fieldworker = TEAM_FIELDWORKERS.find(worker => worker.id === workerId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Choose a valid route date.' });
      if (!fieldworker) return send(res, 400, { error: 'Choose a valid electrician.' });
      return send(res, 200, await cachedTeamRoute(`worker:${date}:${workerId}`, () => dataforceTeamWorkerSchedule(date, fieldworker)));
    }
    if (action === 'team-booking-suggestions') {
      const address = String(req.body.address || '').trim();
      const startDate = String(req.body.startDate || '');
      const days = Math.min(62, Math.max(1, Math.trunc(Number(req.body.days) || 42)));
      if (address.length < 4 || address.length > 180) return send(res, 400, { error: 'Enter a valid address or four-digit postcode.' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return send(res, 400, { error: 'Choose a valid search start date.' });
      enforceSuggestionRateLimit(req);
      const cacheKey = `suggestions:${startDate}:${days}:${shortHash(address)}`;
      return send(res, 200, await cachedTeamSuggestion(cacheKey, () => dataforceTeamBookingSuggestions(address, startDate, days)));
    }

    const fieldworker = resolvePlannerFieldworker(req, res);
    if (!fieldworker) return;
    if (action === 'auth-check') return send(res, 200, { ok: true, fieldworker });
    if (action === 'dataforce-schedule') {
      const date = String(req.body.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, { error: 'Choose a valid schedule date.' });
      return send(res, 200, await dataforceSchedule(date, fieldworker));
    }
    if (action === 'dataforce-upcoming') {
      const startDate = String(req.body.startDate || '');
      const days = Math.min(60, Math.max(1, Math.trunc(Number(req.body.days) || 30)));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return send(res, 400, { error: 'Choose a valid start date.' });
      return send(res, 200, await dataforceUpcoming(startDate, days, fieldworker));
    }
    if (action === 'route-plan') return send(res, 200, await planRoute(req.body));
    return send(res, 400, { error: 'Unknown Route Planner action.' });
  } catch (error) {
    console.error('Route Planner API error:', error);
    return send(res, error.status || 502, { error: error.message || 'Route Planner request failed.' });
  }
}
