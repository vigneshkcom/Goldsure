// Existing browser-safe Maps key bootstrap plus the protected Route Planner API.
// These actions share one Vercel function to keep the Hobby-plan function count unchanged.

const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const DATAFORCE_GRANT_TYPE = 'client_credentials';
const CORE_FIELDWORKER = { id: 1007, name: 'Core Energy Group Pty Ltd', displayName: 'Core Energy Group' };
const BLAKE_FIELDWORKER = { id: 1008, name: 'Blake Harrison', displayName: 'Blake Harrison' };
const BLAKE_ACCESS_PIN = '1008';

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
  const fieldworker = resolvePlannerFieldworker(req, res);
  if (!fieldworker) return;

  try {
    const action = req.body && req.body.action;
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
