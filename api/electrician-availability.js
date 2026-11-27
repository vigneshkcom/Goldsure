import { availableDates, getAvailabilityStartDate, dailyLimits, bookingLimit, bookingRule } from '../electrician-availability/availability.js';
import { lookupArea, suggestRoutes, appointmentWindow } from '../lib/electrician-route-suggestions.js';
import { normaliseFieldworker } from '../lib/dataforce-purchase-orders.js';

const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const DATAFORCE_GRANT_TYPE = 'client_credentials';
const workerIds = new Map([['Alex', 1009], ['Gurdip', 1011], ['Mason', 1012]]);
const cache = new Map();
const CACHE_TTL_MS = 30 * 1000;
let requestQueue = Promise.resolve();
async function limitedFetch(url, init) {
  const run = async () => {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await fetch(url, init);
      if (response.status !== 429) break;
      const retry = Number(response.headers?.get?.('retry-after'));
      const delay = retry > 0 ? Math.min(retry * 1000, 8000) : (attempt + 1) * 1500;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, delay));
    }
    await new Promise(resolve => setTimeout(resolve, 120));
    return response;
  };
  const pending = requestQueue.then(run, run);
  requestQueue = pending.then(() => {}, () => {});
  return pending;
}
const requestLimits = new Map();

function dataforceConfig() {
  const clientId = String(process.env.DATAFORCE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.DATAFORCE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Dataforce is not connected yet. Add the read-only API key and secret in Vercel.');
  }
  return { instance: DATAFORCE_INSTANCE, clientId, clientSecret };
}

async function dataforceToken() {
  return cached('token', loadDataforceToken);
}

async function loadDataforceToken() {
  const { clientId, clientSecret } = dataforceConfig();
  const body = new URLSearchParams({
    grant_type: DATAFORCE_GRANT_TYPE,
    scope: 'appointment customer fieldworker job'
  });
  const response = await limitedFetch(`${DATAFORCE_BASE_URL}/authorization/token`, {
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
  const response = await limitedFetch(`${DATAFORCE_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    console.error('Dataforce availability upstream', response.status, (await response.text()).slice(0,1000));
    throw new Error(`Dataforce request failed (${response.status}).`);
  }
  return response.json();
}

async function dataforceOptionalFetch(token, path) {
  const response = await limitedFetch(`${DATAFORCE_BASE_URL}${path}`, {
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

function appointmentIsBooked(appointment) {
  const status = String(appointment && appointment.completionStatusDescription || '').toLowerCase();
  return !/(cancel|abort)/.test(status);
}

async function dataforceWorkerAppointments(token, fieldworkerId, startDate, endDate) {
  const appointments = [];
  for (let start = startDate; start < endDate;) {
    let end = start;
    for (let day = 0; day < 7 && end < endDate; day++) end = nextDate(end);
    appointments.push(...await dataforceAppointmentRange(token, fieldworkerId, start, end));
    start = end;
  }
  return appointments;
}

async function dataforceAppointmentRange(token, fieldworkerId, startDate, endDate) {
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
    if (!Array.isArray(result.records)) throw new Error('Dataforce appointment records are unavailable.');
    const page = result.records;
    if (page.length && appointments.some(item => item.appointmentId === page[0].appointmentId)) {
      throw new Error('Dataforce repeated a search page.');
    }
    appointments.push(...page);
    after += page.length;
    // Dataforce reports the number of records on the current page in totalCount.
    if (page.length < 100) break;
  }

  return appointments.filter(appointmentIsBooked);
}

async function cached(key, load) {
  const now = Date.now();
  const current = cache.get(key);
  if (current && current.expiresAt > now) return current.value;
  const value = load();
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  try {
    return await value;
  } catch (error) {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  }
}

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

function listFromPayload(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['records', ...keys]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

async function availabilitySchedule(fresh = false) {
  if (fresh) return loadAvailabilitySchedule();
  return cached('schedule', async () => {
    const rows = await loadAvailabilitySchedule();
    if (rows.some(row => row.appointments === null)) cache.delete('schedule');
    return rows;
  });
}
async function loadAvailabilitySchedule() {
  const token = await dataforceToken();
  const { instance } = dataforceConfig();
  const start = availableDates[0].date;
  const end = nextDate(availableDates.at(-1).date);
  const electricians = [...new Set(availableDates.flatMap(day => day.electricians))];
  const workers = new Map(workerIds);
  if (electricians.includes('Josh')) {
    const josh = await dataforceOptionalFetch(token, '/' + encodeURIComponent(instance) + '/fieldworkers')
      .then(payload => listFromPayload(payload, ['fieldworkers', 'workers'])
        .map(normaliseFieldworker)
        .filter(worker => worker.id > 0 && /\bJosh(?:ua)? Brindley\b/i.test(worker.name)))
      .catch(() => []);
    if (josh.length === 1) workers.set('Josh', josh[0].id);
  }

  const appointmentsByWorker = new Map(await Promise.all(electricians.map(async name => {
    const id = workers.get(name);
    if (!id) return [name, null];
    try {
      const appointments = await dataforceWorkerAppointments(token, id, start, end);
      const byDate = new Map();
      for (const appointment of appointments) {
        const date = scheduleDateKey(appointment.scheduledDate);
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date).push(appointment);
      }
      return [name, byDate];
    } catch (error) {
      console.error('Availability schedule failed for fieldworker', id, error);
      return [name, null];
    }
  })));

  return availableDates.flatMap(({ date, electricians: names }) => names.map(name => {
    const appointments = appointmentsByWorker.get(name);
    return { date, name, appointments: appointments ? appointments.get(date) || [] : null };
  }));
}

async function availabilityAreas(schedule) {
  const missingDurations = schedule.flatMap(row => row.appointments || []).filter(appointment =>
    !(Number(appointment.duration) > 0) && appointment.appointmentId);
  if (missingDurations.length) {
    const token = await dataforceToken();
    await mapWithConcurrency(missingDurations, 2, async appointment => {
      const details = await cached('appointment/' + appointment.appointmentId, () =>
        dataforceOptionalFetch(token, '/' + DATAFORCE_INSTANCE + '/appointments/' + appointment.appointmentId)).catch(() => null);
      appointment.duration = details?.duration;
    });
  }
  const ids = [...new Set(schedule.flatMap(row => (row.appointments || [])
    .map(appointment => appointment.customerId)).filter(Boolean))];
  if (!ids.length) return new Map();

  const token = await dataforceToken();
  const { instance } = dataforceConfig();
  const entries = await mapWithConcurrency(ids, 2, async id => {
    const customer = await cached('customer/' + id, () => dataforceOptionalFetch(token, '/' + encodeURIComponent(instance)
      + '/customers/id/' + encodeURIComponent(id))).catch(() => null);
    return [id, {
      suburb: String(customer?.suburb || '').trim(),
      postcode: String(customer?.postCode || '').trim()
    }];
  });
  return new Map(entries);
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
    const schedule = (await availabilitySchedule(Boolean(area)))
      .filter(row => row.date >= start);
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
      return res.status(200).json({ matches: counts, incomplete: counts.some(row => row.jobCount === null) });
    }

    const upcoming = schedule.filter(row => row.date >= start && (
      row.appointments === null || (bookingLimit(row.date, row.name) != null
        && (row.appointments.length > 0 || bookingRule(row.date, row.name))
        && row.appointments.length < bookingLimit(row.date, row.name))
    ));
    const locations = await availabilityAreas(schedule);
    const suggestions = suggestRoutes(upcoming, target, locations, dailyLimits, {
      alarmType, durationMinutes, maxOptions: 18
    });
    // Only the configured browser Maps key can verify driving routes.
    // Candidates remain explicitly unverified until the page checks both legs.
    return res.status(200).json({
      bookedRoutes: schedule.flatMap(row => {
        const windows = new Set();
        for (const appointment of row.appointments || []) {
          const place = locations.get(appointment.customerId);
          if (!place || (target.postcode && place.postcode !== target.postcode)) continue;
          if (target.suburb && lookupArea(place.suburb)?.suburb !== target.suburb) continue;
          const window = appointmentWindow(appointment.scheduledDate);
          if (window) windows.add(window);
        }
        return [...windows].map(window => ({name:row.name,date:row.date,window}));
      }),
      matches: [], candidates: suggestions.matches, routeVerificationRequired: true,
      incomplete: suggestions.incomplete, counts
    });
  } catch (error) {
    console.error('Electrician availability lookup failed:', error);
    return res.status(error.status || 502).json({ error: 'Availability could not be checked. Please try again.' });
  }
}

