import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/smoke-alarms/google-key.js';

function jsonResponse(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function installDataforceMock() {
  const records = {
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
  };
  const customers = {
    11: { suburb: 'Logan', postCode: '4114', streetNo: '1', streetName: 'Private' },
    12: { suburb: 'Ipswich', postCode: '4305', mobilePhone: '0400000000' },
    13: { suburb: 'Springfield', postCode: '4300', companyName: 'Private Customer' },
  };

  global.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/authorization/token')) return jsonResponse({ access_token: 'test-token' });
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
