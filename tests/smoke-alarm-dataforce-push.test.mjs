import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPushDataforceHandler } from '../api/smoke-alarms/push-dataforce.js';

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test('tracker only renders the Dataforce action for verified customer acceptance rows', async () => {
  const html = await readFile(new URL('../smoke-alarms/quote-tracker.html', import.meta.url), 'utf8');
  assert.match(html, /const customerAccepted = !!q\.accepted_at/);
  assert.match(html, /customerAccepted && q\.quote_token/);
  assert.match(html, />Push to Dataforce<\/button>/);
  assert.match(html, /\/api\/smoke-alarms\/push-dataforce/);
});

test('Dataforce push endpoint requires the portal password', async () => {
  const previous = process.env.DATAFORCE_PUSH_PIN;
  process.env.DATAFORCE_PUSH_PIN = '2468';
  let called = false;
  const handler = createPushDataforceHandler({ sync: async () => { called = true; } });
  const response = responseRecorder();

  await handler({ method: 'POST', body: { quoteToken: 'token', pin: 'wrong' } }, response);

  assert.equal(response.statusCode, 403);
  assert.equal(called, false);
  if (previous === undefined) delete process.env.DATAFORCE_PUSH_PIN;
  else process.env.DATAFORCE_PUSH_PIN = previous;
});

test('Dataforce push endpoint returns the idempotent Dataforce job result', async () => {
  const previous = process.env.DATAFORCE_PUSH_PIN;
  process.env.DATAFORCE_PUSH_PIN = '2468';
  let receivedToken = '';
  const handler = createPushDataforceHandler({
    sync: async ({ quoteToken }) => {
      receivedToken = quoteToken;
      return { synced: true, reason: 'already-exists', jobId: 36820, appointmentId: 91, waiting: true };
    },
  });
  const response = responseRecorder();

  await handler({ method: 'POST', body: { quoteToken: 'customer-accepted-token', pin: '2468' } }, response);

  assert.equal(receivedToken, 'customer-accepted-token');
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  assert.equal(response.payload.jobId, 36820);
  assert.equal(response.payload.reason, 'already-exists');
  if (previous === undefined) delete process.env.DATAFORCE_PUSH_PIN;
  else process.env.DATAFORCE_PUSH_PIN = previous;
});

test('Dataforce push endpoint rejects internally accepted quotes', async () => {
  const previous = process.env.DATAFORCE_PUSH_PIN;
  process.env.DATAFORCE_PUSH_PIN = '2468';
  const handler = createPushDataforceHandler({
    sync: async () => ({ synced: false, reason: 'quote-not-customer-accepted' }),
  });
  const response = responseRecorder();

  await handler({ method: 'POST', body: { quoteToken: 'internal-token', pin: '2468' } }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.error, /Only a quote accepted by the customer/);
  if (previous === undefined) delete process.env.DATAFORCE_PUSH_PIN;
  else process.env.DATAFORCE_PUSH_PIN = previous;
});
