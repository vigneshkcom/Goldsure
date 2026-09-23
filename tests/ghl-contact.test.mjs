import test from 'node:test';
import assert from 'node:assert/strict';

import { findOrCreateGhlContact } from '../lib/ghl-contact.js';

const originalFetch = global.fetch;
const originalApiKey = process.env.GHL_API_KEY;
const originalLocationId = process.env.GHL_LOCATION_ID;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GHL_API_KEY;
  else process.env.GHL_API_KEY = originalApiKey;
  if (originalLocationId === undefined) delete process.env.GHL_LOCATION_ID;
  else process.env.GHL_LOCATION_ID = originalLocationId;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('reuses an existing GHL contact by exact email when no phone is supplied', async () => {
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location-1';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ contacts: [{ id: 'contact-1', email: 'customer@example.com' }] });
  };

  const result = await findOrCreateGhlContact({ email: 'Customer@Example.com' });

  assert.deepEqual(result, { contactId: 'contact-1', created: false });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /query=customer%40example\.com/);
  assert.equal(calls[0].options.method, undefined);
});

test('creates a GHL contact when neither phone nor email already exists', async () => {
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location-1';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === 'POST') return jsonResponse({ contact: { id: 'new-contact' } }, 201);
    return jsonResponse({ contacts: [] });
  };

  const result = await findOrCreateGhlContact({
    email: 'new@example.com',
    firstName: 'New',
    lastName: 'Customer',
    address: '1 Test Street',
  });

  assert.deepEqual(result, { contactId: 'new-contact', created: true });
  const create = calls.find(call => call.options.method === 'POST');
  assert.deepEqual(JSON.parse(create.options.body), {
    locationId: 'location-1',
    firstName: 'New',
    lastName: 'Customer',
    email: 'new@example.com',
    address1: '1 Test Street',
  });
});
