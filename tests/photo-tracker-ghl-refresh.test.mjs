import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/battery/request-callback.js';

const phone = '+61413980786';
const pipelines = [
  { id: 'aircon-pipe', name: 'Aircons', stages: [{ id: 'quote-sent', name: 'Quote Sent' }] },
  { id: 'hws-pipe', name: 'HWS Pipeline', stages: [{ id: 'other-stage', name: 'New Lead' }] },
];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

async function lookup(product = 'aircon') {
  const response = {
    status(code) { this.statusCode = code; return this; },
    setHeader() {},
    json(value) { this.body = value; return this; },
  };
  await handler({ method: 'GET', query: { action: 'ghl-opps', phones: phone, product } }, response);
  return response;
}

test('photo tracker refresh finds an opportunity created after an SMS photo link', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.GHL_API_KEY, location: process.env.GHL_LOCATION_ID };
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'test-location';
  let quoted = false;
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    if (path === '/opportunities/pipelines') return json({ pipelines });
    if (path === '/contacts/') return json({ contacts: [
      { id: 'sms-contact', firstName: 'Noorie', phone },
      { id: 'quote-contact', firstName: 'Noorie', phone },
    ] });
    if (path === '/opportunities/search') {
      const contact = new URL(url).searchParams.get('contact_id');
      if (contact === 'sms-contact') return json({ opportunities: [] });
      return json({ opportunities: quoted ? [
        { id: 'aircon-opp', contactId: 'quote-contact', pipelineId: 'aircon-pipe', pipelineStageId: 'quote-sent', status: 'open' },
      ] : [] });
    }
    throw new Error(`Unexpected GHL request: ${url}`);
  };
  try {
    const before = await lookup();
    assert.equal(before.statusCode, 200);
    assert.equal(before.body[phone].opportunityId, undefined);
    quoted = true;
    const after = await lookup();
    assert.equal(after.statusCode, 200);
    assert.equal(after.body[phone].opportunityId, 'aircon-opp');
    assert.equal(after.body[phone].contactId, 'quote-contact');
    assert.equal(after.body[phone].stage, 'Quote Sent');
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.GHL_API_KEY; else process.env.GHL_API_KEY = previous.key;
    if (previous.location === undefined) delete process.env.GHL_LOCATION_ID; else process.env.GHL_LOCATION_ID = previous.location;
  }
});

test('photo tracker does not show another product opportunity as an Aircon match', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.GHL_API_KEY, location: process.env.GHL_LOCATION_ID };
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'test-location';
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    if (path === '/opportunities/pipelines') return json({ pipelines });
    if (path === '/contacts/') return json({ contacts: [{ id: 'contact', phone }] });
    if (path === '/opportunities/search') return json({ opportunities: [
      { id: 'hws-opp', pipelineId: 'hws-pipe', pipelineStageId: 'other-stage', status: 'open' },
    ] });
    throw new Error(`Unexpected GHL request: ${url}`);
  };
  try {
    const response = await lookup();
    assert.equal(response.body[phone].opportunityId, undefined);
    assert.equal(response.body[phone].pipeline, undefined);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.GHL_API_KEY; else process.env.GHL_API_KEY = previous.key;
    if (previous.location === undefined) delete process.env.GHL_LOCATION_ID; else process.env.GHL_LOCATION_ID = previous.location;
  }
});

test('GHL lookup failures are errors, not confirmed missing opportunities', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.GHL_API_KEY, location: process.env.GHL_LOCATION_ID };
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'test-location';
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    if (path === '/opportunities/pipelines') return json({ pipelines });
    if (path === '/contacts/') return json({ contacts: [{ id: 'contact', phone }] });
    if (path === '/opportunities/search') return json({ error: 'unavailable' }, 400);
    throw new Error(`Unexpected GHL request: ${url}`);
  };
  try {
    const response = await lookup();
    assert.equal(response.body[phone].error, true);
    assert.equal(response.body[phone].none, undefined);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.GHL_API_KEY; else process.env.GHL_API_KEY = previous.key;
    if (previous.location === undefined) delete process.env.GHL_LOCATION_ID; else process.env.GHL_LOCATION_ID = previous.location;
  }
});
