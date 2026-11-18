import test from 'node:test';
import assert from 'node:assert/strict';
import { readLive, dateKey, timeLabel, activeAppointment } from '../api/rescheduling/_dataforce.js';

const env = { DATAFORCE_CLIENT_ID: 'id', DATAFORCE_CLIENT_SECRET: 'secret' };
const ok = body => ({ ok: true, status: 200, json: async () => body });

test('date and time parsing handles ISO and Dataforce formats', () => {
  assert.equal(dateKey('2026-11-26T09:30:00'), '2026-11-26');
  assert.equal(dateKey('26-Nov-2026 02:00 PM'), '2026-11-26');
  assert.equal(timeLabel('2026-11-26T14:00:00'), '2:00PM');
  assert.equal(timeLabel('26-Nov-2026 09:30 AM'), '9:30AM');
  assert.equal(dateKey(''), '');
});

test('active appointment ignores cancelled ones and takes the latest', () => {
  const a = activeAppointment([
    { appointmentId: 1, scheduledDate: '2026-11-30T14:00:00', completionStatusDescription: 'Cancelled' },
    { appointmentId: 2, scheduledDate: '2026-12-14T09:00:00', completionStatusDescription: 'Scheduled' },
  ]);
  assert.equal(a.appointmentId, 2);
  assert.equal(activeAppointment([{ completionStatusDescription: 'Cancelled' }]), null);
});

test('readLive returns each job and the real load per day, and never writes', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.endsWith('/authorization/token')) return ok({ access_token: 't' });
    if (url.includes('/jobs/36905/appointments')) return ok({ records: [{ appointmentId: 9, scheduledDate: '2026-11-26T08:30:00', fieldworkerId: 1009, completionStatusDescription: 'Scheduled' }] });
    if (url.includes('/jobs/37192/appointments')) return ok({ records: [] });
    if (url.includes('/jobs/1/appointments')) return { ok: false, status: 500, json: async () => ({}) };
    if (url.endsWith('/appointments/search')) {
      const body = JSON.parse(init.body);
      const worker = body.filterGroups[0].filters[0].value;
      const date = body.filterGroups[0].filters[1].value.slice(0, 10);
      if (body.after > 0) return ok({ records: [] });
      if (worker === '1009' && date === '2026-11-26') return ok({ records: [
        { jobId: 111, scheduledDate: '2026-11-26T08:00:00', completionStatusDescription: 'Scheduled' },
        { jobId: 36905, scheduledDate: '2026-11-26T08:30:00', completionStatusDescription: 'Scheduled' },
        { jobId: 222, scheduledDate: '2026-11-26T13:00:00', completionStatusDescription: 'Cancelled' },
      ] });
      return ok({ records: [] });
    }
    throw new Error('unexpected ' + url);
  };
  const out = await readLive({ jobIds: [36905, 37192, 1], fetchImpl, env });
  assert.equal(out.jobs[36905].date, '2026-11-26');
  assert.equal(out.jobs[36905].slot, 'AM');
  assert.equal(out.jobs[37192].found, false);
  assert.ok(out.jobs[1].error);
  assert.equal(out.days['2026-11-26'].items.length, 2);
  assert.equal(out.days['2026-12-14'].items.length, 0);
  assert.ok(calls.every(c => c.method === 'GET' || c.url.endsWith('/authorization/token') || c.url.endsWith('/appointments/search')));
});

test('missing credentials give a clear not-connected error', async () => {
  await assert.rejects(readLive({ jobIds: [1], fetchImpl: async () => ok({}), env: {} }), /not connected/);
});
