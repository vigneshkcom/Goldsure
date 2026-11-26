import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/electrician-availability.js';

test('API shows only December onward and hides past dates even with a cached schedule', async () => {
  const originalFetch = global.fetch;
  const originalId = process.env.DATAFORCE_CLIENT_ID;
  const originalSecret = process.env.DATAFORCE_CLIENT_SECRET;
  const RealDate = global.Date;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-11-23T00:00:00Z'])); } };
  process.env.DATAFORCE_CLIENT_ID = 'test';
  process.env.DATAFORCE_CLIENT_SECRET = 'test';
  const requestedWorkers = [];
  global.fetch = async (url, init = {}) => {
    let payload;
    if (url.endsWith('/authorization/token')) payload = { access_token: 'test' };
    else if (url.endsWith('/fieldworkers')) payload = [{ fieldworkerId: 1013, firstName: 'Josh', lastName: 'Brindley' }];
    else if (url.endsWith('/appointments/search')) {
      const body = JSON.parse(init.body);
      requestedWorkers.push(body.filterGroups[0].filters[0].value);
      assert.equal(body.filterGroups[0].filters[1].value, '2026-12-01T00:00:00');
      payload = { records: [] };
    } else throw new Error('Unexpected URL ' + url);
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: {}, body: { area: 'Bray Park 4500' } }, res);
    assert.equal(res.code, 200);
    assert.ok(!requestedWorkers.includes('1013'));
    assert.deepEqual(res.body.matches.map(x => [x.name, x.date, x.batteryOnly, x.remaining]), []);
    await handler({ method: 'POST', headers: {}, body: { area: 'Elanora 4221', alarmType: 'hardwired' } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.matches.map(x => [x.name, x.date, x.batteryOnly, x.remaining]), []);
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.code, 200);
    assert.ok(res.body.matches.length > 0);
    assert.ok(res.body.matches.every(row => row.date >= '2026-12-01'));
    global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-12-07T14:30:00Z'])); } };
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.ok(res.body.matches.length > 0);
    assert.ok(res.body.matches.every(row => row.date >= '2026-12-08'));
    await handler({ method: 'POST', headers: {}, body: { area: 'Elanora 4221' } }, res);
    assert.ok(res.body.matches.every(row => row.date >= '2026-12-08'));
    global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2027-01-01T00:00:00Z'])); } };
    await handler({ method: 'POST', headers: {}, body: {} }, res);
    assert.deepEqual(res.body, { matches: [], incomplete: false });
    await handler({ method: 'POST', headers: {}, body: { area: '4104', alarmType: 'invalid' } }, res);
    assert.equal(res.code, 400);
  } finally {
    global.fetch = originalFetch;
    global.Date = RealDate;
    if (originalId === undefined) delete process.env.DATAFORCE_CLIENT_ID; else process.env.DATAFORCE_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.DATAFORCE_CLIENT_SECRET; else process.env.DATAFORCE_CLIENT_SECRET = originalSecret;
  }
});
