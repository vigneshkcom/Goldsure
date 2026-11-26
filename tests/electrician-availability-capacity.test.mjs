import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/electrician-availability.js';

test('fresh searches stop offering Gurdip at six and seven jobs, and exclude unknown counts', async () => {
  const originalFetch = global.fetch;
  const originalId = process.env.DATAFORCE_CLIENT_ID;
  const originalSecret = process.env.DATAFORCE_CLIENT_SECRET;
  const originalMapsKey = process.env.GOOGLE_MAPS_ROUTES_KEY;
  process.env.GOOGLE_MAPS_ROUTES_KEY = 'test';
  const RealDate = global.Date;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-11-26T00:00:00Z'])); } };
  process.env.DATAFORCE_CLIENT_ID = 'test';
  process.env.DATAFORCE_CLIENT_SECRET = 'test';
  let count = 5;
  let fail = false;
  let workerRequests = 0;
  global.fetch = async (url, init = {}) => {
    let payload;
    if (url.includes('routes.googleapis.com')) payload = {routes:[{legs:[{duration:'60s'},{duration:'60s'}]}]};
    else if (url.endsWith('/authorization/token')) payload = { access_token: 'test' };
    else if (url.endsWith('/appointments/search')) {
      const worker = JSON.parse(init.body).filterGroups[0].filters[0].value;
      if (worker === '1011') {
        workerRequests++;
        if (fail) return { ok: false, status: 503 };
        payload = { records: Array.from({ length: count }, (_, i) => ({
          appointmentId: i + 1, customerId: 1, duration:30,
          scheduledDate: i < 3 ? '2026-12-02T09:00:00' : '2026-12-02T14:00:00', completionStatusDescription: 'Scheduled'
        })) };
      } else if (worker === '1009') payload = {records: Array.from({length:9},(_, i)=>({
      duration:30, customerId: i < 3 ? 2 : 3,
      scheduledDate: i < 3 ? '2026-12-03T09:00:00' : '2026-12-03T14:00:00'
    }))}; else payload = { records: [] };
    } else if (url.endsWith('/customers/id/2')) payload = {suburb:'Elanora',postCode:'4221'};
    else if (url.endsWith('/customers/id/3')) payload = {suburb:'Cornubia',postCode:'4130'};
    else if (url.endsWith('/customers/id/1')) payload = { suburb: 'Morningside', postCode: '4170' };
    else throw new Error('Unexpected URL ' + url);
    return { ok: true, status: 200, json: async () => payload };
  };
  const request = async (body = { area: '4171' }) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: {}, body }, res);
    assert.equal(res.code, 200);
    return res.body;
  };
  try {
    let result = await request();
    assert.equal(result.matches.find(row => row.name === 'Gurdip')?.remaining, 1);
    assert.equal(result.counts.find(row => row.name === 'Gurdip' && row.date === '2026-12-02').jobCount, 5);
    for (count of [6, 7]) {
      result = await request();
      assert.ok(result.matches.every(row => row.name !== 'Gurdip'));
      assert.equal(result.counts.find(row => row.name === 'Gurdip' && row.date === '2026-12-02').jobCount, count);
    }
    assert.equal(workerRequests, 3, 'each search fetches fresh bookings');
    const cornubia = await request({area:'4130'});
    assert.ok(cornubia.matches.every(row => row.name !== 'Alex' || row.date !== '2026-12-03'), 'Dataforce six PM bookings exclude Alex despite four daily spaces');
    fail = true;
    result = await request();
    assert.ok(result.matches.every(row => row.name !== 'Gurdip'));
    assert.equal(result.incomplete, true);
    assert.equal(result.counts.find(row => row.name === 'Gurdip').jobCount, null);
  } finally {
    if (originalMapsKey === undefined) delete process.env.GOOGLE_MAPS_ROUTES_KEY; else process.env.GOOGLE_MAPS_ROUTES_KEY = originalMapsKey;
    global.fetch = originalFetch;
    global.Date = RealDate;
    if (originalId === undefined) delete process.env.DATAFORCE_CLIENT_ID; else process.env.DATAFORCE_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.DATAFORCE_CLIENT_SECRET; else process.env.DATAFORCE_CLIENT_SECRET = originalSecret;
  }
});
