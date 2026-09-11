import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/smoke-alarms/google-key.js';

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function installDataforceMock(overrides = {}, googleSeconds = 600) {
  const records = { ...{
    1007: [
      { appointmentId: 1, customerId: 11, scheduledDate: '2026-09-15T09:00:00', completionStatusDescription: 'Booked' },
    ],
    1008: [],
    1009: [
      { appointmentId: 2, customerId: 12, scheduledDate: '2026-09-15T10:00:00', completionStatusDescription: 'Booked' },
      { appointmentId: 3, customerId: 13, scheduledDate: '2026-09-15T11:00:00', completionStatusDescription: 'Booked' },
      { appointmentId: 4, customerId: 14, scheduledDate: '2026-09-15T12:00:00', completionStatusDescription: 'Cancelled' },
    ],
    1010: [],
    1005: [],
  }, ...overrides };
  const customers = {
    11: { suburb: 'Logan', postCode: '4114', streetNo: '1', streetName: 'Private' },
    12: { suburb: 'Ipswich', postCode: '4305', mobilePhone: '0400000000' },
    13: { suburb: 'Springfield', postCode: '4300', companyName: 'Private Customer' },
  };

  global.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/authorization/token')) return jsonResponse({ access_token: 'test-token' });
    if (String(url).includes('routes.googleapis.com/directions/v2:computeRoutes')) {
      const body = JSON.parse(init.body);
      const pointCount = 2 + (body.intermediates || []).length;
      return jsonResponse({ routes: [{ legs: Array.from({ length: pointCount - 1 }, () => ({ duration: `${googleSeconds}s` })) }] });
    }
    if (String(url).includes('/appointments/search')) {
      const body = JSON.parse(init.body);
      const workerFilter = body.filterGroups[0].filters.find(filter => filter.propertyName === 'fieldworkerId');
      return jsonResponse({ records: records[Number(workerFilter.value)] || [], totalCount: (records[Number(workerFilter.value)] || []).length });
    }
    const customerId = Number(String(url).split('/').pop());
    return jsonResponse(customers[customerId] || {});
  };
}

test.beforeEach(() => {
  process.env.DATAFORCE_CLIENT_ID = 'test-client';
  process.env.DATAFORCE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_MAPS_ROUTES_KEY = 'test-google-key';
  installDataforceMock();
});

test('team calendar returns booked counts without cancelled appointments', async () => {
  const req = { method: 'POST', body: { action: 'team-schedule-summary', startDate: '2026-09-01', days: 42 }, headers: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dates.length, 1);
  assert.equal(res.body.dates[0].totalJobs, 3);
  assert.deepEqual(res.body.dates[0].workers.map(worker => [worker.name, worker.jobCount]), [
    ['Surya', 1],
    ['Alex Symonds', 2],
  ]);
  assert.equal(res.body.workers.some(worker => worker.name === 'Test Electrician'), false);
});

test('selected day returns suburb routes only and no customer details', async () => {
  const req = { method: 'POST', body: { action: 'team-day-routes', date: '2026-09-15' }, headers: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.totalJobs, 3);
  const alex = res.body.workers.find(worker => worker.name === 'Alex Symonds');
  assert.deepEqual(alex.route, ['Ipswich 4305', 'Springfield 4300']);
  assert.equal(JSON.stringify(res.body).includes('0400000000'), false);
  assert.equal(JSON.stringify(res.body).includes('Private Customer'), false);
  assert.equal(JSON.stringify(res.body).includes('streetName'), false);
});

test('team driving route returns mapped addresses without customer identity or contact details', async () => {
  const req = { method: 'POST', body: { action: 'team-worker-schedule', date: '2026-09-15', workerId: 1007 }, headers: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.fieldworker.name, 'Surya');
  assert.equal(res.body.jobs.length, 1);
  assert.equal(res.body.jobs[0].customerName, 'Stop 1');
  assert.match(res.body.jobs[0].address, /Logan/);
  assert.equal(JSON.stringify(res.body).includes('0400000000'), false);
  assert.equal(JSON.stringify(res.body).includes('Private Customer'), false);
  assert.equal(JSON.stringify(res.body).includes('customerId'), false);
});

test('team driving route rejects electricians outside the approved team list', async () => {
  const req = { method: 'POST', body: { action: 'team-worker-schedule', date: '2026-09-15', workerId: 9999 }, headers: {} };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Choose a valid electrician.');
});

test('team route popup hides controls and preserves the Dataforce stop order', () => {
  const html = readFileSync(new URL('../route-planner/index.html', import.meta.url), 'utf8');

  assert.match(html, /body\.team-route-mode \.controls/);
  assert.match(html, /elements\.routeMode\.value = 'scheduled'/);
  assert.match(html, /Dataforce stop order/);
});

test('booking candidate routes return only working electricians under capacity', async () => {
  const req = { method: 'POST', body: { action: 'team-booking-suggestions', address: '4000', startDate: '2026-09-15', days: 1 }, headers: { 'x-forwarded-for': 'test-1' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.maxExtraMinutes, 20);
  assert.equal(res.body.addressType, 'postcode');
  assert.equal(res.body.candidates.length, 2);
  assert.equal(res.body.candidates.every(item => item.jobCount > 0 && item.jobCount < 10), true);
  assert.equal(res.body.candidates.every(item => item.jobs.length === item.jobCount), true);
  assert.equal(res.body.candidates.every(item => item.jobs.every(job => job.address && ['AM', 'PM', ''].includes(job.scheduledSlot))), true);
  const serialised = JSON.stringify(res.body);
  assert.equal(serialised.includes('Private Customer'), false);
  assert.equal(serialised.includes('0400000000'), false);
  assert.equal(serialised.includes('customerId'), false);
});

test('booking suggestions exclude an electrician who already has 10 jobs', async () => {
  const fullDay = Array.from({ length: 10 }, (_, index) => ({
    appointmentId: 100 + index,
    customerId: 11,
    scheduledDate: `2026-09-15T${String(8 + index).padStart(2, '0')}:00:00`,
    completionStatusDescription: 'Booked'
  }));
  installDataforceMock({ 1007: fullDay });
  const req = { method: 'POST', body: { action: 'team-booking-suggestions', address: 'Capacity test 4001', startDate: '2026-09-15', days: 1 }, headers: { 'x-forwarded-for': 'test-2' } };
  const res = responseRecorder();

  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.candidates.some(item => item.electrician.name === 'Surya'), false);
});

test('booking suggestion controls are rendered above the selected day routes', () => {
  const html = readFileSync(new URL('../smoke-alarms/smoke-alarm.html', import.meta.url), 'utf8');

  assert.ok(html.indexOf('id="bookingSuggestForm"') > html.indexOf('id="calKey"'));
  assert.ok(html.indexOf('id="bookingSuggestForm"') < html.indexOf('id="calDay"'));
  assert.match(html, /maximum 20 minutes added to the whole route/);
  assert.match(html, /team-booking-suggestions/);
  assert.match(html, /best\.seconds > 20 \* 60/);
  assert.match(html, /optimizeWaypointOrder: false/);
  assert.match(html, /routingPreference: 'TRAFFIC_UNAWARE'/);
  assert.match(html, /insertPosition: best\.position/);
  assert.match(html, /previousDriveMinutes/);
  assert.match(html, /Whole-route increase: about/);
  assert.match(html, /Show inserted route/);
  assert.match(html, /goldsure_team_route_preview/);
  assert.match(html, /preview=1/);
  assert.doesNotMatch(html, /suggestedAddress=/);
});

test('suggested route preview inserts and highlights the unbooked address', () => {
  const html = readFileSync(new URL('../route-planner/index.html', import.meta.url), 'utf8');

  assert.match(html, /withSuggestedPreview/);
  assert.match(html, /routeJobs\.splice\(position, 0/);
  assert.match(html, /isSuggested: true/);
  assert.match(html, /Suggested booking, not booked/);
  assert.match(html, /new PinElement/);
  assert.match(html, /background: '#12b76a'/);
  assert.match(html, /applySuggestedRouteTimes/);
  assert.match(html, /baseDurationSeconds/);
  assert.match(html, /Previous stop → here/);
  assert.match(html, /Dataforce order preserved/);
  assert.match(html, /This is a preview and has not been booked/);
});
