// Existing browser-safe Maps key bootstrap plus the protected Route Planner API.
// These actions share one Vercel function to keep the Hobby-plan function count unchanged.

const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const DATAFORCE_GRANT_TYPE = 'client_credentials';
const CORE_FIELDWORKER = { id: 1007, name: 'Core Energy Group Pty Ltd', displayName: 'Core Energy Group' };
const BLAKE_FIELDWORKER = { id: 1008, name: 'Blake Harrison', displayName: 'Blake Harrison' };
const BLAKE_ACCESS_PIN = '1008';
const TEAM_FIELDWORKERS = [
  { id: 1007, name: 'Core Energy Group Pty Ltd', displayName: 'Surya', color: '#a25ddc' },
  { id: 1008, name: 'Blake Harrison', displayName: 'Blake Harrison', color: '#0073ea' },
  { id: 1009, name: 'Alex Symonds', displayName: 'Alex Symonds', color: '#fdab3d' },
  { id: 1010, name: 'Liam Stuart', displayName: 'Liam Stuart', color: '#00a86b' },
  { id: 1005, name: 'Munesh Chand', displayName: 'Munesh Chand', color: '#009eb5' }
];
const TEAM_ROUTE_CACHE_TTL_MS = 2 * 60 * 1000;
const teamRouteCache = new Map();
const TEAM_SUGGESTION_CACHE_TTL_MS = 5 * 60 * 1000;
const TEAM_SUGGESTION_MAX_JOBS = 10;
const TEAM_SUGGESTION_MAX_EXTRA_SECONDS = 20 * 60;
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
  return { id: fieldworker.id, name: fieldworker.displayName, color: fieldworker.color };
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

function scheduleSplitIndex(appointments) {
  const hours = appointments.map(appointment => scheduleHour(appointment.scheduledDate));
  const hasUsefulTimes = hours.some(hour => Number.isFinite(hour) && hour > 0);
  if (!hasUsefulTimes) return Math.ceil(appointments.length / 2);
  const firstPm = hours.findIndex(hour => Number.isFinite(hour) && hour >= 12);
  return firstPm < 0 ? appointments.length : firstPm;
}

function teamMapsKey() {
  const apiKey = process.env.GOOGLE_MAPS_ROUTES_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) throw Object.assign(new Error('Google route estimates are not configured yet.'), { status: 503 });
  return apiKey;
}

async function googleRouteLegDurations(addresses) {
  if (addresses.length < 2) return [];
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal: AbortSignal.timeout(12000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': teamMapsKey(),
      'X-Goog-FieldMask': 'routes.legs.duration'
    },
    body: JSON.stringify({
      origin: { address: addresses[0] },
      destination: { address: addresses[addresses.length - 1] },
      intermediates: addresses.slice(1, -1).map(address => ({ address })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      optimizeWaypointOrder: false,
      languageCode: 'en-AU',
      units: 'METRIC'
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Google route suggestion error', response.status, detail.slice(0, 300));
    throw Object.assign(new Error('Google could not estimate the additional driving for this address.'), { status: 422 });
  }
  const payload = await response.json();
  const legs = payload.routes && payload.routes[0] && payload.routes[0].legs;
  if (!Array.isArray(legs) || legs.length !== addresses.length - 1) {
    throw Object.assign(new Error('Google could not map one or more route stops.'), { status: 422 });
  }
  return legs.map(leg => durationSeconds(leg.duration));
}

function insertionExtraSeconds(position, jobCount, baselineLegs, toJob, fromJob) {
  if (position === 0) return toJob[0];
  if (position === jobCount) return fromJob[jobCount - 1];
  return Math.max(0, fromJob[position - 1] + toJob[position] - baselineLegs[position - 1]);
}

function nearestRouteLabels(position, jobs) {
  if (!jobs.length) return [];
  const labels = position === 0
    ? [jobs[0].routeLabel]
    : position === jobs.length
      ? [jobs[jobs.length - 1].routeLabel]
      : [jobs[position - 1].routeLabel, jobs[position].routeLabel];
  return collapseRoute(labels).filter(Boolean);
}

async function evaluateTeamBookingRoute(candidateAddress, schedule) {
  const jobs = schedule.jobs;
  const jobCount = jobs.length;
  const baselinePromise = jobCount > 1
    ? googleRouteLegDurations(jobs.map(job => job.address))
    : Promise.resolve([]);
  const chunks = [];
  for (let start = 0; start < jobCount; start += 5) {
    chunks.push({ start, jobs: jobs.slice(start, start + 5) });
  }
  const probePromises = chunks.map(async chunk => {
    const addresses = [candidateAddress];
    chunk.jobs.forEach(job => addresses.push(job.address, candidateAddress));
    return { start: chunk.start, count: chunk.jobs.length, legs: await googleRouteLegDurations(addresses) };
  });
  const [baselineLegs, ...probes] = await Promise.all([baselinePromise, ...probePromises]);
  const toJob = new Array(jobCount);
  const fromJob = new Array(jobCount);
  probes.forEach(probe => {
    for (let index = 0; index < probe.count; index += 1) {
      toJob[probe.start + index] = probe.legs[index * 2];
      fromJob[probe.start + index] = probe.legs[index * 2 + 1];
    }
  });
  const extras = Array.from({ length: jobCount + 1 }, (_, position) => ({
    position,
    seconds: insertionExtraSeconds(position, jobCount, baselineLegs, toJob, fromJob)
  }));
  const splitIndex = scheduleSplitIndex(jobs);
  const slots = [
    { name: 'AM', options: extras.filter(option => option.position <= splitIndex) },
    { name: 'PM', options: extras.filter(option => option.position >= splitIndex) }
  ];
  return slots.map(slot => {
    const best = slot.options.sort((a, b) => a.seconds - b.seconds)[0];
    if (!best) return null;
    return {
      date: schedule.date,
      electrician: publicTeamWorker(schedule.fieldworker),
      slot: slot.name,
      jobCount: schedule.appointments.length,
      addedSeconds: best.seconds,
      addedMinutes: Math.max(1, Math.ceil(best.seconds / 60)),
      near: nearestRouteLabels(best.position, jobs)
    };
  }).filter(suggestion => suggestion && suggestion.addedSeconds <= TEAM_SUGGESTION_MAX_EXTRA_SECONDS);
}

function normaliseQueenslandSearchAddress(value) {
  const address = String(value || '').trim().replace(/\s+/g, ' ');
  if (/\b(QLD|Queensland|Australia)\b/i.test(address)) return address;
  return `${address}, Queensland, Australia`;
}

async function dataforceTeamBookingSuggestions(address, startDate, days) {
  const { instance } = dataforceConfig();
  teamMapsKey();
  const token = await dataforceToken();
  const endDate = addDays(startDate, days);
  const workerSchedules = await Promise.all(TEAM_FIELDWORKERS.map(async fieldworker => ({
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
    return { addressType: /^\d{4}$/.test(address) ? 'postcode' : 'address', maxExtraMinutes: 20, suggestions: [] };
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
  const schedules = eligible.map(schedule => ({
    ...schedule,
    jobs: schedule.appointments.map(appointment => {
      const customer = customers.get(appointment.customerId);
      return {
        address: customerAddress(customer),
        routeLabel: customerRouteLabel(customer),
        scheduledDate: appointment.scheduledDate || ''
      };
    }).filter(job => job.address)
  })).filter(schedule => schedule.jobs.length > 0 && schedule.jobs.length === schedule.appointments.length);
  const candidateAddress = normaliseQueenslandSearchAddress(address);
  let successfulRoutes = 0;
  const evaluated = await mapWithConcurrency(schedules, 3, async schedule => {
    try {
      const suggestions = await evaluateTeamBookingRoute(candidateAddress, schedule);
      successfulRoutes += 1;
      return suggestions;
    } catch (error) {
      console.warn('Skipped route suggestion', schedule.date, schedule.fieldworker.id, error.message);
      return [];
    }
  });
  if (schedules.length && !successfulRoutes) {
    throw Object.assign(new Error('That address could not be matched to the electrician routes. Check it and try again.'), { status: 422 });
  }
  const workerOrder = new Map(TEAM_FIELDWORKERS.map((worker, index) => [worker.id, index]));
  const suggestions = evaluated.flat().sort((a, b) =>
    a.addedSeconds - b.addedSeconds
    || a.date.localeCompare(b.date)
    || workerOrder.get(a.electrician.id) - workerOrder.get(b.electrician.id)
    || a.slot.localeCompare(b.slot)
  ).slice(0, 3).map(({ addedSeconds, ...suggestion }) => suggestion);
  return {
    addressType: /^\d{4}$/.test(address) ? 'postcode' : 'address',
    maxExtraMinutes: 20,
    suggestions
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

export default async function handler(req, res) {
  // Preserve the existing endpoint contract used by quote/address pages.
  if (req.method === 'GET') {
    return send(res, 200, { key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const action = req.body && req.body.action;
  try {
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
