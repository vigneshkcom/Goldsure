import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import handler from '../api/smoke-alarms/ghl.js';

const html = readFileSync(new URL('../smoke-alarms/quote-tracker.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(source => source.includes('function openQuoteGhlNotes'));

function trackerFixture(fetchImpl, dialog = null) {
  const opened = [];
  const toasts = [];
  const stageCell = { textContent: '', className: '', title: '' };
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById(id) { return id === 'ghl-1' ? stageCell : null; }, querySelector() { return dialog; } },
    fetch: fetchImpl,
    GoldsureGhlNotes: { open(details) { opened.push(details); } },
    AbortController, setTimeout, clearTimeout, console,
  });
  vm.runInContext(script, context);
  context.__toasts = toasts;
  vm.runInContext(`allQuotes = [{ id: 1, customer_email: 'person@example.com', customer_name: 'Test Customer' }]; showToast = message => __toasts.push(message);`, context);
  return { context, opened, toasts, stageCell };
}

test('notes open immediately when this quote is known, without waiting for the whole tracker', async () => {
  const fixture = trackerFixture(() => { throw new Error('No lookup should be needed'); });
  vm.runInContext(`ghlOppData = { 'person@example.com': { opportunityId: 'opp123', stage: 'Quote Sent' } }; ghlStagesLoaded = false;`, fixture.context);
  await vm.runInContext(`openQuoteGhlNotes('1')`, fixture.context);
  assert.equal(fixture.opened.length, 1);
  assert.equal(fixture.opened[0].opportunityId, 'opp123');
  assert.equal(fixture.toasts.length, 0);
});

test('notes request just the selected quote when its batch has not loaded', async () => {
  const requests = [];
  const fixture = trackerFixture(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ 'person@example.com': { opportunityId: 'opp456', stage: 'Follow-Up' } }), { status: 200 });
  });
  await vm.runInContext(`openQuoteGhlNotes('1')`, fixture.context);
  assert.deepEqual(requests, [{ emails: ['person@example.com'] }]);
  assert.equal(fixture.opened[0].opportunityId, 'opp456');
  assert.equal(fixture.stageCell.textContent, 'Follow-Up');
});

test('an unavailable GHL lookup is not reported as no matching opportunity', async () => {
  const fixture = trackerFixture(async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502 }));
  await vm.runInContext(`openQuoteGhlNotes('1')`, fixture.context);
  assert.equal(fixture.opened.length, 0);
  assert.match(fixture.toasts[0], /Could not load GHL details/);
});

test('a failed stage batch resolves its loading badge as unavailable', async () => {
  const fixture = trackerFixture(async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502 }));
  await vm.runInContext('loadGhlStages(allQuotes)', fixture.context);
  assert.equal(fixture.stageCell.textContent, 'Unavailable');
  assert.equal(vm.runInContext('ghlStagesLoaded', fixture.context), true);
});

test('the background stage loader pauses while a notes dialog is open', async () => {
  let onClose;
  let stageRequests = 0;
  const dialog = { open: true, addEventListener(_event, listener) { onClose = listener; } };
  const fixture = trackerFixture(async () => {
    stageRequests++;
    return new Response(JSON.stringify({ 'person@example.com': { opportunityId: 'opp123', stage: 'Quote Sent' } }), { status: 200 });
  }, dialog);
  vm.runInContext(`ghlOppData = { 'person@example.com': { opportunityId: 'opp123', stage: 'Quote Sent' } };`, fixture.context);
  await vm.runInContext(`openQuoteGhlNotes('1')`, fixture.context);
  assert.equal(fixture.opened.length, 1);
  const loading = vm.runInContext('loadGhlStages(allQuotes)', fixture.context);
  await Promise.resolve();
  assert.equal(stageRequests, 0);
  onClose();
  await loading;
  assert.equal(stageRequests, 1);
});

function response() {
  return { statusCode: 0, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('GHL lookup does not select a different contact or another pipeline', async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.GHL_API_KEY;
  const previousLocation = process.env.GHL_LOCATION_ID;
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location123';
  global.fetch = async url => {
    const path = new URL(url).pathname;
    if (path === '/opportunities/pipelines') return new Response(JSON.stringify({ pipelines: [{ id: 'smoke-pipeline', name: 'Smoke Alarms', stages: [] }] }), { status: 200 });
    if (path === '/contacts/') return new Response(JSON.stringify({ contacts: [{ id: 'other', email: 'someone-else@example.com' }] }), { status: 200 });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const res = response();
    await handler({ method: 'POST', body: { emails: ['person@example.com'] } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body['person@example.com'], null);
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = previousKey;
    if (previousLocation === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = previousLocation;
  }
});

test('GHL contact failure is marked unavailable, not as no opportunity', async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.GHL_API_KEY;
  const previousLocation = process.env.GHL_LOCATION_ID;
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location123';
  global.fetch = async url => {
    const path = new URL(url).pathname;
    if (path === '/opportunities/pipelines') return new Response(JSON.stringify({ pipelines: [{ id: 'smoke-pipeline', name: 'Smoke Alarms', stages: [] }] }), { status: 200 });
    if (path === '/contacts/') return new Response(JSON.stringify({ message: 'Unavailable' }), { status: 401 });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    const res = response();
    await handler({ method: 'POST', body: { emails: ['person@example.com'] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body['person@example.com'], { lookupError: true });
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GHL_API_KEY;
    else process.env.GHL_API_KEY = previousKey;
    if (previousLocation === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = previousLocation;
  }
});
