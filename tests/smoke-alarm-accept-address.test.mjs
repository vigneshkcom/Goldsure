import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import acceptHandler from '../api/smoke-alarms/accept.js';

test('smoke alarm acceptance page requires and saves the customer property address', async () => {
  const source = await readFile(new URL('../accept-quote.html', import.meta.url), 'utf8');

  assert.match(source, /id="propertyAddress"[\s\S]*?required/);
  assert.match(source, /id="propertySuburb"[\s\S]*?required/);
  assert.match(source, /id="propertyPostcode"[\s\S]*?required/);
  assert.match(source, /customer_address:\s*propertyAddress/);
  assert.match(source, /property_street:\s*propertyStreet/);
  assert.match(source, /property_state:\s*'QLD'/);
  assert.match(source, /\['Property Address',\s*row\.customer_address/);

  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
});

test('smoke alarm acceptance endpoint rejects a missing property address', async () => {
  const req = {
    method: 'POST',
    body: {
      quote_token: 'quote-token',
      customer_name: 'Test Customer',
      customer_email: 'customer@example.com',
      customer_address: '',
    },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  await acceptHandler(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Missing required fields.' });
});

test('smoke alarm acceptance endpoint rejects an internal accepted status before side effects', async () => {
  const saved = {
    fetch: globalThis.fetch,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_ANON_KEY,
  };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify([{
      customer_name: 'Test Customer',
      customer_email: 'customer@example.com',
      customer_phone: '0412 345 678',
      customer_address: '12 Example Street, Brisbane QLD 4000',
      status: 'accepted',
      accepted: true,
      accepted_at: null,
    }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const req = {
      method: 'POST',
      body: {
        quote_token: 'quote-token',
        customer_name: 'Test Customer',
        customer_email: 'customer@example.com',
        customer_address: '12 Example Street, Brisbane QLD 4000',
        property_street: '12 Example Street',
        property_suburb: 'Brisbane',
        property_state: 'QLD',
        property_postcode: '4000',
      },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };

    await acceptHandler(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.reason, 'quote-not-customer-accepted');
    assert.equal(calls.length, 1, 'only the acceptance verification lookup may run');
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.key;
  }
});
