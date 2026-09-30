import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import acceptHandler from '../api/smoke-alarms/accept.js';

test('smoke alarm acceptance page requires and saves the customer property address', async () => {
  const source = await readFile(new URL('../accept-quote.html', import.meta.url), 'utf8');

  assert.match(source, /id="propertyAddress"[\s\S]*?required/);
  assert.match(source, /customer_address:\s*propertyAddress/);
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
