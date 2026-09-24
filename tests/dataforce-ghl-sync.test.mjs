import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizePhone,
  isCompletedAppointment,
  classifyDataforceProduct,
  pipelineMatchesProduct,
  findInstalledStage,
  isOpportunityAlreadyWon,
  directCallOpportunityName,
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

test('treats Won or Installed stages as already completed even when GHL status is open', () => {
  assert.equal(isOpportunityAlreadyWon({ status: 'open' }, 'Won/Installed'), true);
  assert.equal(isOpportunityAlreadyWon({ status: 'open' }, 'Installed'), true);
  assert.equal(isOpportunityAlreadyWon({ status: 'won' }, 'Quote Sent'), true);
  assert.equal(isOpportunityAlreadyWon({ status: 'open' }, 'Quote Sent'), false);
});

test('uses the required Direct Call opportunity naming format', () => {
  assert.equal(directCallOpportunityName('JANICE MARRIOTT'), 'JANICE MARRIOTT - Direct Call');
  assert.equal(directCallOpportunityName(''), 'Customer - Direct Call');
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

test('preview skips Won for an installed opportunity and proposes Direct Call creation when unmatched', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    DATAFORCE_GHL_SYNC_PIN: process.env.DATAFORCE_GHL_SYNC_PIN,
    DATAFORCE_CLIENT_ID: process.env.DATAFORCE_CLIENT_ID,
    DATAFORCE_CLIENT_SECRET: process.env.DATAFORCE_CLIENT_SECRET,
    GHL_API_KEY: process.env.GHL_API_KEY,
    GHL_LOCATION_ID: process.env.GHL_LOCATION_ID,
    SMOKE_ALARMS_PIPELINE_ID: process.env.SMOKE_ALARMS_PIPELINE_ID,
  };
  Object.assign(process.env, {
    DATAFORCE_GHL_SYNC_PIN: '4321',
    DATAFORCE_CLIENT_ID: 'client',
    DATAFORCE_CLIENT_SECRET: 'secret',
    GHL_API_KEY: 'ghl-key',
    GHL_LOCATION_ID: 'location-1',
    SMOKE_ALARMS_PIPELINE_ID: 'smoke-pipeline',
  });
  global.fetch = async url => {
    const value = String(url);
    if (value.endsWith('/authorization/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
    if (value.includes('/appointments/search')) return new Response(JSON.stringify({ totalCount: 2, records: [
      { appointmentId: 38445, jobId: 36679, customerId: 1, workTypeName: 'Smoke Alarm Installation', completionStatusDescription: 'Completed', completedDate: '2026-09-23T16:15:00', scheduledDate: '2026-09-23T09:00:00' },
      { appointmentId: 38366, jobId: 36601, customerId: 2, workTypeName: 'Smoke Alarm Installation', completionStatusDescription: 'Completed', actualCompletedDate: '2026-09-22T15:30:00', scheduledDate: '2026-09-22T09:00:00' },
    ] }), { status: 200 });
    if (value.includes('/customers/id/1')) return new Response(JSON.stringify({ firstname: 'RON', surname: 'ROBERT', email: 'driverron63@gmail.com', mobilePhone: '0416254285', state: 'QLD', streetNo: '1', streetName: 'Test', streetType: 'STREET', suburb: 'Brisbane', postCode: 4000 }), { status: 200 });
    if (value.includes('/customers/id/2')) return new Response(JSON.stringify({ firstname: 'JANICE', surname: 'MARRIOTT', email: 'janmarriott@ymail.com', mobilePhone: '0438051948', state: 'QLD', streetNo: '2', streetName: 'Sample', streetType: 'STREET', suburb: 'Brisbane', postCode: 4000 }), { status: 200 });
    if (value.includes('/appointments/38445/invoice')) return new Response(JSON.stringify({ productLines: [{ lineQty: 1, lineRateIncTax: 523 }] }), { status: 200 });
    if (value.includes('/appointments/38366/invoice')) return new Response(JSON.stringify({ productLines: [{ lineQty: 1, lineRateIncTax: 610 }] }), { status: 200 });
    if (value.includes('/opportunities/pipelines')) return new Response(JSON.stringify({ pipelines: [{ id: 'smoke-pipeline', name: 'Smoke Alarms', stages: [{ id: 'quote', name: 'Quote Sent' }, { id: 'installed', name: 'Won/Installed' }] }] }), { status: 200 });
    if (value.includes('/customFields?model=opportunity')) return new Response(JSON.stringify({ customFields: [
      { id: 'job-field', name: 'Job ID', fieldKey: 'opportunity.job_id', model: 'opportunity' },
      { id: 'install-field', name: 'Installation Date', fieldKey: 'opportunity.installation_date', model: 'opportunity' },
    ] }), { status: 200 });
    if (value.includes('/contacts/?') && (value.includes('driverron63%40gmail.com') || value.includes('0416254285'))) return new Response(JSON.stringify({ contacts: [{ id: 'ron-contact', name: 'RON ROBERT', email: 'driverron63@gmail.com', phone: '+61416254285' }] }), { status: 200 });
    if (value.includes('/contacts/?')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 });
    if (value.includes('/opportunities/search')) return new Response(JSON.stringify({ opportunities: [{ id: 'ron-opportunity', pipelineId: 'smoke-pipeline', pipelineStageId: 'installed', status: 'open', monetaryValue: 0 }] }), { status: 200 });
    throw new Error(`Unexpected request: ${value}`);
  };
  try {
    const response = responseRecorder();
    await handler({
      method: 'POST',
      headers: { 'x-dataforce-ghl-pin': '4321' },
      body: { action: 'dataforce-ghl-preview', startDate: '2026-09-22', endDate: '2026-09-23' },
    }, response);
    assert.equal(response.statusCode, 200);
    const ron = response.body.rows.find(row => row.jobId === '36679');
    const janice = response.body.rows.find(row => row.jobId === '36601');
    assert.equal(ron.proposedChanges.includes('Mark opportunity Won'), false);
    assert.equal(ron.proposedChanges.includes('Update revenue to $523.00'), true);
    assert.equal(ron.proposedChanges.includes('Set Job ID to 36679'), true);
    assert.equal(ron.proposedChanges.includes('Set Installation Date to 2026-09-23'), true);
    assert.equal(janice.createContact, true);
    assert.equal(janice.createOpportunity, true);
    assert.equal(janice.opportunityName, 'JANICE MARRIOTT - Direct Call');
    assert.equal(janice.opportunitySource, 'Direct Call');
    assert.equal(janice.targetStatus, 'won');
    assert.equal(janice.proposedRevenue, 610);
    assert.equal(janice.proposedChanges.includes('Set Job ID to 36601'), true);
    assert.equal(janice.proposedChanges.includes('Set Installation Date to 2026-09-22'), true);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
