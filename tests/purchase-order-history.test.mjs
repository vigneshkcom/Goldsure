import test from 'node:test';
import assert from 'node:assert/strict';
import { listPurchaseOrderJobs, purchaseOrderRows, recordPurchaseOrder } from '../lib/purchase-order-history.js';
import { validatedPurchaseOrder } from '../api/smoke-alarms/reports/index.js';

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
