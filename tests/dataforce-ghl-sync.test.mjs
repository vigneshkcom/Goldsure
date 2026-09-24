import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizePhone,
  isCompletedAppointment,
  classifyDataforceProduct,
  pipelineMatchesProduct,
  findInstalledStage,
  chooseOpportunity,
  calculateDataforceRevenue,
  groupAppointmentsByJob,
} from '../lib/dataforce-ghl-sync.js';
import handler from '../api/smoke-alarms/google-key.js';

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('normalises exact customer identifiers', () => {
  assert.equal(normalizeEmail(' Jane@Example.COM '), 'jane@example.com');
  assert.equal(normalizePhone('+61 412 345 678'), '412345678');
  assert.equal(normalizePhone('0412 345 678'), '412345678');
  assert.equal(normalizePhone('1234'), '');
});

test('only treats explicit completed statuses as completed', () => {
  assert.equal(isCompletedAppointment({ completionStatusDescription: 'Completed' }), true);
  assert.equal(isCompletedAppointment({ completionStatusCode: 'C' }), true);
  assert.equal(isCompletedAppointment({ completionStatusDescription: 'Not Completed' }), false);
  assert.equal(isCompletedAppointment({ completionStatusDescription: 'Scheduled' }), false);
});

test('classifies product and state without confusing hot water split systems', () => {
  assert.equal(classifyDataforceProduct({ workType: 'Split System Hot Water', state: 'NSW' }), 'hws-nsw');
  assert.equal(classifyDataforceProduct({ workType: 'Air Conditioning Install', state: 'VIC' }), 'aircon');
  assert.equal(classifyDataforceProduct({ workType: 'Smoke Alarm Install', state: 'QLD' }), 'smoke');
  assert.equal(pipelineMatchesProduct('NSW HWS Pipeline', 'hws-nsw'), true);
  assert.equal(pipelineMatchesProduct('HWS Pipeline', 'hws-nsw'), false);
});

test('finds Installed and prefers the latest open opportunity', () => {
  const pipeline = { stages: [{ id: 'one', name: 'Quote Sent' }, { id: 'two', name: 'Won / Installed' }] };
  assert.equal(findInstalledStage(pipeline)?.id, 'two');
  const selected = chooseOpportunity([
    { id: 'won', pipelineId: 'p1', status: 'won', updatedAt: '2026-09-23T10:00:00Z' },
    { id: 'open', pipelineId: 'p1', status: 'open', updatedAt: '2026-09-22T10:00:00Z' },
    { id: 'other', pipelineId: 'p2', status: 'open', updatedAt: '2026-09-24T10:00:00Z' },
  ], ['p1']);
  assert.equal(selected.id, 'open');
});

test('calculates the full contract value and reports rebate separately', () => {
  const result = calculateDataforceRevenue({
    productLines: [{ lineQty: 2, lineRateIncTax: 1000 }],
    discountLines: [{ lineQty: 1, lineRateIncTax: 100 }],
    rebatePOSLine: [{ lineQty: 1, lineRateIncTax: 700 }],
  }, 'invoice');
  assert.deepEqual(result, {
    confident: true,
    source: 'invoice',
    revenue: 1900,
    productTotal: 2000,
    discountTotal: -100,
    rebateTotal: 700,
    customerAmountAfterRebates: 1200,
  });
});

test('groups multiple appointments under one Dataforce job', () => {
  const jobs = groupAppointmentsByJob([
    { appointmentId: 1, jobId: 99, completionStatusDescription: 'Scheduled', scheduledDate: '2026-09-20' },
    { appointmentId: 2, jobId: 99, completionStatusDescription: 'Completed', completedDate: '2026-09-21' },
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobId, '99');
  assert.equal(jobs[0].completed, true);
  assert.equal(jobs[0].representative.appointmentId, 2);
});

test('protects the live preview and rejects oversized date ranges before any API reads', async () => {
  const previous = process.env.DATAFORCE_GHL_SYNC_PIN;
  process.env.DATAFORCE_GHL_SYNC_PIN = '4321';
  try {
    const unauthorized = responseRecorder();
    await handler({ method: 'POST', headers: {}, body: { action: 'dataforce-ghl-preview' } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);

    const oversized = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'x-dataforce-ghl-pin': '4321' },
      body: { action: 'dataforce-ghl-preview', startDate: '2026-09-01', endDate: '2026-09-30' },
    }, oversized);
    assert.equal(oversized.statusCode, 400);
    assert.match(oversized.body.error, /1 and 14 days/);
  } finally {
    if (previous === undefined) delete process.env.DATAFORCE_GHL_SYNC_PIN;
    else process.env.DATAFORCE_GHL_SYNC_PIN = previous;
  }
});
