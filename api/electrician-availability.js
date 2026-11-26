import { verifyInsertion } from '../lib/electrician-route-fit.js';
import { availableDates, getAvailabilityStartDate, dailyLimits, bookingLimit, bookingRule } from '../electrician-availability/availability.js';
import { lookupArea, suggestRoutes, appointmentWindow } from '../lib/electrician-route-suggestions.js';
import { normaliseFieldworker } from '../lib/dataforce-purchase-orders.js';

const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const DATAFORCE_GRANT_TYPE = 'client_credentials';
const workerIds = new Map([['Alex', 1009], ['Gurdip', 1011], ['Mason', 1012]]);
const cache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
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
    appointments.push(...page);
    after += page.length;
    // Dataforce reports the number of records on the current page in totalCount.
    if (page.length < 100) break;
  }

  return mapWithConcurrency(appointments.filter(appointmentIsBooked), 8, async appointment => {
    if (Number.isFinite(Number(appointment.duration)) && Number(appointment.duration) > 0) return appointment;
    if (!appointment.appointmentId) return appointment;
    const details = await dataforceOptionalFetch(token, '/' + encodeURIComponent(instance)
      + '/appointments/' + encodeURIComponent(appointment.appointmentId)).catch(() => null);
    return { ...appointment, duration: details?.duration };
  });
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

async function availabilitySchedule() {
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
  const ids = [...new Set(schedule.flatMap(row => (row.appointments || [])
    .map(appointment => appointment.customerId)).filter(Boolean))];
  if (!ids.length) return new Map();

  const token = await dataforceToken();
  const { instance } = dataforceConfig();
  const entries = await mapWithConcurrency(ids, 8, async id => {
    const customer = await dataforceOptionalFetch(token, '/' + encodeURIComponent(instance)
      + '/customers/id/' + encodeURIComponent(id)).catch(() => null);
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
    const schedule = (await availabilitySchedule())
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
    const locations = await availabilityAreas(upcoming);
    const suggestions = suggestRoutes(upcoming, target, locations, dailyLimits, {
      alarmType, durationMinutes, maxOptions: 18
    });
    let incomplete = suggestions.incomplete;
    const verificationDeadline = Date.now() + 20000;
    const verified = await mapWithConcurrency(suggestions.matches, 4, async match => {
      const { routePlans = [], ...publicMatch } = match;
      for (const plan of routePlans) {
        if (Date.now() > verificationDeadline) { incomplete = true; return null; }
        try {
          const timing = await verifyInsertion(plan, {
            apiKey: process.env.GOOGLE_MAPS_ROUTES_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
          });
          if (timing) return { ...publicMatch, windowRemaining: 1, routeChecked: true, durationMinutes };
        } catch (error) {
          incomplete = true;
          console.error('Availability driving verification failed:', error.message);
          return null;
        }
      }
      return null;
    });
    return res.status(200).json({ matches: verified.filter(Boolean).slice(0,6), incomplete, counts });
  } catch (error) {
    console.error('Electrician availability lookup failed:', error);
    return res.status(error.status || 502).json({ error: 'Availability could not be checked. Please try again.' });
  }
}

