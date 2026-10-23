import test from 'node:test';
import assert from 'node:assert/strict';
import { listPurchaseOrderJobs, purchaseOrderRows, recordPurchaseOrder } from '../lib/purchase-order-history.js';
import handler, { validatedPurchaseOrder } from '../api/smoke-alarms/reports/index.js';

const env = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const rate = key => ({ key, quantity: 2 });
const po = validatedPurchaseOrder({
  poNumber: 'PO for Alex Symonds - Week ending 11 Oct 2026',
  period: '5 Oct to 11 Oct 2026',
  weekEnding: '2026-10-11',
  electrician: { id: 1009, name: 'Alex Symonds', companyName: 'Alex Electrical', gstRegistered: true },
  jobs: [{ jobId: '36708', installedDate: '2026-10-06', address: '1 Test St', items: [rate('hardwired'), rate('battery')] }],
});

test('rows split a purchase order into one record plus one row per job', () => {
  const { order, jobs } = purchaseOrderRows(po);
  assert.equal(order.fieldworker_id, 1009);
  assert.equal(order.week_ending, '2026-10-11');
  assert.equal(order.jobs_count, 1);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].installed_date, '2026-10-06');
  assert.equal(jobs[0].hardwired, 2);
  assert.equal(jobs[0].battery, 2);
});

test('inspection-only jobs survive validation and history saving with their additional payment', () => {
  const inspection = validatedPurchaseOrder({
    ...po,
    jobs: [{ jobId: '37001', installedDate: '2026-10-06', items: [], pendingBalance: 20, cashCollected: true, cashOffset: 20 }],
    additionalLines: [{ description: 'Job 37001 | Inspection fee (fixed rate)', amountIncGst: 66 }],
  });
  assert.equal(inspection.jobs.length, 1);
  assert.equal(inspection.totals.totalIncGst, 46);
  const { order, jobs } = purchaseOrderRows(inspection);
  assert.equal(jobs[0].job_id, '37001');
  assert.equal(jobs[0].cash_offset, 20);
  assert.equal(order.additional_lines[0].amountIncGst, 66);
  assert.equal(validatedPurchaseOrder({ ...po, jobs: [{ jobId: '37001', items: [] }], additionalLines: [] }), null);
});

test('explicit save requires a PIN, stores the reviewed extras and offsets, and reports storage failures', async () => {
  const previousEnv = { PURCHASE_ORDER_PIN: process.env.PURCHASE_ORDER_PIN, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  const originalFetch = global.fetch;
  Object.assign(process.env, { ...env, PURCHASE_ORDER_PIN: '4321' });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return new Response(null, { status: 201 });
  };
  const request = { ...po, jobs: [{ ...po.jobs[0], pendingBalance: 30, cashCollected: true, cashOffset: 30 }], additionalLines: [{ description: 'Additional $150 for 3 no-show jobs', amountIncGst: 150 }] };
  const invoke = async (pin, purchaseOrder = request) => {
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: { 'x-purchase-order-pin': pin }, body: { purchaseOrderHistory: { action: 'save', purchaseOrder } } }, res);
    return res;
  };
  try {
    assert.equal((await invoke('wrong')).statusCode, 401);
    assert.equal((await invoke('4321', {})).statusCode, 400);
    assert.equal(calls.length, 0);
    const result = await invoke('4321');
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.success, true);
    const order = JSON.parse(calls[0].body), jobs = JSON.parse(calls[2].body);
    assert.equal(order.cash_offset, 30);
    assert.equal(order.additional_lines[0].amountIncGst, 150);
    assert.equal(order.total_inc_gst, 170.6);
    assert.equal(jobs[0].hardwired, 2);
    assert.equal(jobs[0].battery, 2);
    assert.equal(jobs[0].cash_offset, 30);
    assert.equal('exported_at' in order, false);
    global.fetch = async () => new Response('storage unavailable', { status: 503 });
    const failed = await invoke('4321');
    assert.equal(failed.statusCode, 500);
    assert.notEqual(failed.body.success, true);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('recording upserts the order, replaces its jobs and only sets the named event', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, ...init }); return new Response('', { status: 201 }); };
  await recordPurchaseOrder(po, 'emailed', { env, fetchImpl });
  assert.deepEqual(calls.map(c => `${c.method} ${new URL(c.url).pathname}`), ['POST /rest/v1/purchase_orders', 'DELETE /rest/v1/purchase_order_jobs', 'POST /rest/v1/purchase_order_jobs']);
  const order = JSON.parse(calls[0].body);
  assert.ok(order.emailed_at);
  assert.equal('xero_bill_at' in order, false);
  assert.equal('exported_at' in order, false);
  assert.match(calls[0].headers.Prefer, /merge-duplicates/);
  assert.equal(calls[0].headers.apikey, 'service-key');
});

test('a missing table gives a setup hint instead of a raw Supabase error', async () => {
  const fetchImpl = async () => new Response('{"code":"PGRST205"}', { status: 404 });
  await assert.rejects(recordPurchaseOrder(po, 'saved', { env, fetchImpl }), /schema\.sql/);
});

test('listing filters by installed date in the query and by electrician and search locally', async () => {
  let requested;
  const rows = [
    { job_id: '1', address: 'A St', po_number: 'P1', purchase_orders: { electrician_name: 'Alex Symonds' } },
    { job_id: '2', address: 'B St', po_number: 'P2', purchase_orders: { electrician_name: 'Mason Adams' } },
  ];
  const fetchImpl = async url => { requested = url; return new Response(JSON.stringify(rows), { status: 200 }); };
  const result = await listPurchaseOrderJobs({ from: '2026-10-01', to: '2026-10-31', electrician: 'Mason Adams' }, { env, fetchImpl });
  assert.match(requested, /installed_date=gte\.2026-10-01/);
  assert.match(requested, /installed_date=lte\.2026-10-31/);
  assert.deepEqual(result.map(job => job.job_id), ['2']);
  assert.deepEqual((await listPurchaseOrderJobs({ search: 'a st' }, { env, fetchImpl })).map(job => job.job_id), ['1']);
});
