import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAcceptedPropertyAddress,
  splitDataforceStreet,
  syncAcceptedSmokeQuoteToDataforce,
} from '../lib/dataforce-smoke-quote.js';

const env = {
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_ANON_KEY: 'anon',
  DATAFORCE_CLIENT_ID: 'client',
  DATAFORCE_CLIENT_SECRET: 'secret',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const acceptedQuote = {
  customer_name: 'Test Customer',
  customer_email: 'test@example.com',
  customer_phone: '0412 345 678',
  customer_address: 'Unit 3/12 Example Street, Brisbane QLD 4000',
  customer_type: 'letterbox',
  service_type: 'Installation Quote',
  alarm_qty: 5,
  alarm_unit_price: 109,
  ctrl_qty: 1,
  grand_total: 621,
  status: 'accepted',
  accepted: true,
};

test('parses the accepted QLD address into Dataforce fields', () => {
  assert.deepEqual(parseAcceptedPropertyAddress('Unit 3/12 Example Street, Brisbane QLD 4000, Australia'), {
    street: 'Unit 3/12 Example Street',
    suburb: 'Brisbane',
    state: 'QLD',
    postcode: '4000',
    formatted: 'Unit 3/12 Example Street, Brisbane QLD 4000',
  });
  assert.deepEqual(splitDataforceStreet('3/12 Example Street'), {
    unitNo: '3', streetNo: '12', streetName: 'Example', streetType: 'STREET',
  });
});

test('creates a customer, accepted job and unassigned waiting-list appointment', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.includes('/rest/v1/quote_emails')) return json([acceptedQuote]);
    if (value.endsWith('/authorization/token')) return json({ access_token: 'token' });
    if (value.endsWith('/jobs/search')) return json({ totalCount: 0, records: [] });
    if (value.endsWith('/customers/search')) return json({ totalCount: 0, records: [] });
    if (value.includes('/customers/ref/')) return json({ message: 'not found' }, 404);
    if (value.endsWith('/customers')) return json({ customerId: 501 });
    if (value.endsWith('/jobs')) return json({ jobId: 601 });
    if (value.endsWith('/jobs/601/appointments')) return json({ records: [] });
    if (value.endsWith('/appointments')) {
      return json({ appointmentId: 701, completionStatusDescription: 'Waiting', fieldworkerId: 0, scheduledDate: null });
    }
    throw new Error(`Unexpected request: ${value}`);
  };

  const result = await syncAcceptedSmokeQuoteToDataforce({ quoteToken: 'abc-123', fetchImpl, env });

  assert.equal(result.synced, true);
  assert.equal(result.jobId, 601);
  assert.equal(result.waiting, true);

  const customerCall = calls.find(call => call.url.endsWith('/customers') && call.options.method === 'POST');
  const customer = JSON.parse(customerCall.options.body);
  assert.equal(customer.firstname, 'Test');
  assert.equal(customer.surname, 'Customer');
  assert.equal(customer.unitNo, '3');
  assert.equal(customer.streetNo, '12');
  assert.equal(customer.streetName, 'Example');
  assert.equal(customer.streetType, 'STREET');
  assert.equal(customer.suburb, 'Brisbane');
  assert.equal(customer.postCode, 4000);

  const jobCall = calls.find(call => call.url.endsWith('/jobs') && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(jobCall.options.body), {
    customerId: 501,
    quotationStatus: 'Accepted',
    agentId: 1,
    clientId: 1,
    trackingCode: 'SMOKE-GSQ-abc123',
  });

  const appointmentCall = calls.find(call => call.url.endsWith('/appointments') && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(appointmentCall.options.body), {
    jobId: 601,
    workTypeId: 62,
    jobInstruction: '5 Smoke Alarms | Concrete ceiling | 1 Controller | Accepted quote $621.00',
    duration: 60,
  });
});

test('reuses the quote-tracked job and waiting appointment on retry', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.includes('/rest/v1/quote_emails')) return json([acceptedQuote]);
    if (value.endsWith('/authorization/token')) return json({ access_token: 'token' });
    if (value.endsWith('/jobs/search')) return json({ records: [{ jobId: 601 }] });
    if (value.endsWith('/jobs/601/appointments')) return json({ records: [{
      appointmentId: 701,
      workTypeId: 62,
      completionStatusDescription: 'Waiting',
      fieldworkerId: 0,
      scheduledDate: null,
    }] });
    throw new Error(`Unexpected request: ${value}`);
  };

  const result = await syncAcceptedSmokeQuoteToDataforce({ quoteToken: 'abc-123', fetchImpl, env });

  assert.equal(result.reason, 'already-exists');
  assert.equal(result.jobId, 601);
  assert.equal(calls.some(call => call.options.method === 'POST' && call.url.endsWith('/jobs')), false);
  assert.equal(calls.some(call => call.options.method === 'POST' && call.url.endsWith('/appointments')), false);
});

test('reuses an existing Dataforce customer only when email and property address match', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.includes('/rest/v1/quote_emails')) return json([acceptedQuote]);
    if (value.endsWith('/authorization/token')) return json({ access_token: 'token' });
    if (value.endsWith('/jobs/search')) return json({ records: [] });
    if (value.endsWith('/customers/search')) return json({ records: [{ customerId: 501 }] });
    if (value.endsWith('/customers/id/501')) return json({
      customerId: 501,
      email: 'test@example.com',
      unitNo: '3',
      unitType: 'UNIT',
      streetNo: '12',
      streetName: 'Example',
      streetType: 'STREET',
      suburb: 'Brisbane',
      state: 'QLD',
      postCode: 4000,
    });
    if (value.endsWith('/jobs')) return json({ jobId: 601 });
    if (value.endsWith('/jobs/601/appointments')) return json({ records: [] });
    if (value.endsWith('/appointments')) return json({ appointmentId: 701 });
    throw new Error(`Unexpected request: ${value}`);
  };

  await syncAcceptedSmokeQuoteToDataforce({ quoteToken: 'abc-123', fetchImpl, env });

  const jobCall = calls.find(call => call.url.endsWith('/jobs') && call.options.method === 'POST');
  assert.equal(JSON.parse(jobCall.options.body).customerId, 501);
  assert.equal(calls.some(call => call.url.endsWith('/customers') && call.options.method === 'POST'), false);
});

test('does not call Dataforce for an unaccepted quote', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return json([{ ...acceptedQuote, accepted: false, status: 'sent' }]);
  };

  const result = await syncAcceptedSmokeQuoteToDataforce({ quoteToken: 'abc-123', fetchImpl, env });

  assert.deepEqual(result, { synced: false, reason: 'quote-not-accepted' });
  assert.equal(calls.length, 1);
});
