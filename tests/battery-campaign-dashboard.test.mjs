import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/battery/request-callback.js';
import { parseAudience, matchesRecipient, delivery } from '../Battery/campaign-model.js';

test('200 CSV customers retain all names, email, phone and job details', () => {
  const csv = '\uFEFFEmail,First Name,Last Name,Phone,Job ID\r\n' + Array.from({ length: 200 }, (_, i) => `customer${i}@example.com,Customer ${i},"Last, name",0400000000,J${i}`).join('\r\n');
  const parsed = parseAudience(csv);
  assert.equal(parsed.recipients.length, 200);
  assert.deepEqual(parsed.recipients[199], { email: 'customer199@example.com', firstName: 'Customer 199', lastName: 'Last, name', phone: '0400000000', jobId: 'J199' });
});
test('CSV reports invalid and duplicate rows instead of silently discarding them', () => {
  const parsed = parseAudience('Email,First Name\na@example.com,A\nA@example.com,Again\nbad,B\nc@example.com,');
  assert.equal(parsed.recipients.length, 1); assert.equal(parsed.duplicates, 1); assert.equal(parsed.invalid, 2);
  assert.throws(() => parseAudience('Email,First Name\na@example.com,"A'), /unclosed quote/);
});
test('engagement remains visible after unsubscribe and unknown send outcomes stay distinct', () => {
  const row = { first_name: 'Pat', email: 'pat@example.com', delivery_status: 'unsubscribed', sent_at: '2026-10-12T00:00:00Z', opened_at: '2026-10-12T00:01:00Z', clicked_at: '2026-10-12T00:02:00Z', unsubscribed_at: '2026-10-12T00:03:00Z' };
  for (const filter of ['sent', 'opened', 'clicked', 'unsubscribed']) assert.equal(matchesRecipient(row, 'pat', filter), true);
  assert.equal(matchesRecipient(row, 'other', 'all'), false);
  assert.equal(delivery({ delivery_status: 'sending', updated_at: '2020-01-01' }).label, 'Unconfirmed');
  assert.equal(delivery({ delivery_status: 'unknown' }).label, 'Unconfirmed');
});

const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
async function callApi(fetchImpl, body, query = {}) {
  const originalFetch = global.fetch;
  const names = ['DASHBOARD_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HOSTINGER_MAILBOX_RESOURCE_ID', 'HOSTINGER_MAIL_API_TOKEN', 'GHL_API_KEY', 'GHL_LOCATION_ID', 'BATTERY_PIPELINE_ID'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  Object.assign(process.env, { DASHBOARD_PASSWORD: 'fixture-password', SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'fixture-key', HOSTINGER_MAILBOX_RESOURCE_ID: 'fixture-mailbox', HOSTINGER_MAIL_API_TOKEN: 'fixture-token' });
  Object.assign(process.env, { GHL_API_KEY: 'fixture-ghl', GHL_LOCATION_ID: 'fixture-location', BATTERY_PIPELINE_ID: '' });
  global.fetch = fetchImpl;
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  try { await handler({ method: body ? 'POST' : 'GET', body, query, headers: {} }, res); return res; }
  finally { global.fetch = originalFetch; for (const key of names) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } }
}
const campaign = { id: 'campaign-1', name: 'Fixture campaign', status: 'ready' };
const callbackToken = '12345678-1234-4234-8234-123456789abc';
test('callback context exposes only the first name and never sends or writes', async () => {
  const result = await callApi(async (input, options) => {
    assert.equal(options.method, undefined);
    assert.equal(new URL(input).searchParams.get('select'), 'id,first_name');
    return response([{ id: 'r1', first_name: 'Pat' }]);
  }, null, { action: 'battery-callback-context', t: callbackToken });
  assert.deepEqual(result.data, { firstName: 'Pat' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('invalid callback token cannot send or create a lead', async () => {
  const result = await callApi(() => { throw new Error('Must not contact services'); }, { action: 'battery-callback-request', campaignRecipientToken: 'bad' });
  assert.equal(result.statusCode, 404);
});
test('previously requested callback does not send another notification', async () => {
  let reads = 0;
  const result = await callApi(async (input, options) => {
    assert.equal(options.method, undefined); reads++;
    return response([{ id: 'r1', callback_requested_at: '2026-10-12' }]);
  }, { action: 'battery-callback-request', campaignRecipientToken: callbackToken });
  assert.equal(reads, 1); assert.equal(result.data.alreadyRequested, true);
});
for (const phone of ['0400000000', '']) test(`callback uses saved identity, staff time and Battery Customers opportunity (${phone ? 'phone' : 'email only'})`, async () => {
  let mail, note, opportunity, tracked = false;
  const result = await callApi(async (input, options = {}) => {
    const url = new URL(input);
    const data = options.body ? JSON.parse(options.body) : null;
    if (url.hostname === 'api.mail.hostinger.com') { mail = data; return response({}); }
    if (url.hostname === 'database.example') {
      if (options.method === 'PATCH') { tracked = !!data.callback_requested_at; return response([]); }
      if (options.method === 'POST') return response([]);
      return response([{ id: 'r1', first_name: 'Pat', last_name: 'Citizen', email: 'pat@example.com', phone, job_id: 'J123' }]);
    }
    if (url.pathname === '/contacts/') return response({ contacts: [{ id: 'contact1', phone, email: 'pat@example.com' }] });
    if (url.pathname === '/contacts/contact1/notes') { note = data.body; return response({}); }
    if (url.pathname === '/opportunities/pipelines') return response({ pipelines: [{ id: 'battery', name: 'Battery Customers', stages: [{ id: 'new', name: 'New Lead' }] }] });
    if (url.pathname === '/opportunities/search') return response({ opportunities: [] });
    if (url.pathname === '/opportunities/') { opportunity = data; return response({ opportunity: { id: 'opp1' } }); }
    throw new Error('Unexpected request ' + url);
  }, { action: 'battery-callback-request', campaignRecipientToken: callbackToken, preferredCallbackTime: 'Afternoon', fullName: 'Forged identity', email: 'forged@example.com', phone: '9999999999' });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(mail.to, ['vignesh@goldsure.com.au']);
  assert.match(mail.html, /Afternoon/); assert.match(mail.html, /J123/);
  assert.match(mail.html, /Pat Citizen/); assert.doesNotMatch(mail.html, /Forged|forged@example/);
  assert.match(note, /Preferred callback time: Afternoon/);
  assert.equal(opportunity.pipelineId, 'battery'); assert.equal(opportunity.pipelineStageId, 'new');
  assert.equal(opportunity.contactId, 'contact1'); assert.equal(tracked, true);
});
test('live-schema constraint failure is identified before contacting the mail provider', async () => {
  let providerCalls = 0;
  const result = await callApi(async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.mail.hostinger.com') { providerCalls++; throw new Error('Must not send'); }
    if (url.pathname.endsWith('/email_campaigns')) return response([{ ...campaign, status: 'sending' }]);
    if (options.method === 'PATCH') return new Response(JSON.stringify({ code: '23514', message: 'new row violates check constraint' }), { status: 400 });
    return response([{ id: 'recipient-1', tracking_token: '12345678-1234-4234-8234-123456789abc', email: 'fixture@example.com', first_name: 'Fixture' }]);
  }, { action: 'battery-campaign-send-next', password: 'fixture-password' });
  assert.equal(result.statusCode, 500);
  assert.equal(result.data.code, 'CAMPAIGN_RECIPIENT_CLAIM_FAILED');
  assert.match(result.data.error, /before contacting Hostinger/);
  assert.match(result.data.error, /database migration/);
  assert.equal(providerCalls, 0);
});
test('customer details require authentication without making any database request', async () => {
  const result = await callApi(() => { throw new Error('Unexpected database access'); }, { action: 'battery-campaign-recipients' });
  assert.equal(result.statusCode, 401);
});
test('authenticated customer list returns every page and all engagement fields', async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => ({ id: i, email: `customer${i}@example.com`, sent_at: '2026-10-12', opened_at: '2026-10-12', clicked_at: '2026-10-12' }));
  const offsets = [];
  const result = await callApi(async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('/email_campaigns')) return response([campaign]);
    const offset = Number(url.searchParams.get('offset')); offsets.push(offset);
    assert.match(url.searchParams.get('select'), /callback_requested_at/);
    return response(rows.slice(offset, offset + 500));
  }, { action: 'battery-campaign-recipients', password: 'fixture-password' });
  assert.equal(result.statusCode, 200); assert.equal(result.data.recipients.length, 1205);
  assert.deepEqual(offsets, [0, 500, 1000]); assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('repeat import preserves existing sent and unsubscribed customers', async () => {
  const result = await callApi(async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/email_campaigns')) return response(options.method === 'PATCH' ? [] : [campaign]);
    assert.equal(options.method, 'POST');
    assert.match(options.headers.Prefer, /resolution=ignore-duplicates/);
    return response([JSON.parse(options.body)[1]]);
  }, { action: 'battery-campaign-import', password: 'fixture-password', recipients: [{ email: 'existing@example.com', firstName: 'Existing' }, { email: 'new@example.com', firstName: 'New' }] });
  assert.equal(result.data.imported, 1); assert.equal(result.data.skipped, 1);
});
test('aggregate sent total still includes a sent customer who later unsubscribed', async () => {
  const result = await callApi(async input => {
    if (new URL(input).pathname.endsWith('/email_campaigns')) return response([campaign]);
    return response([{ delivery_status: 'unsubscribed', sent_at: '2026-10-12', unsubscribed_at: '2026-10-12', opened_at: '2026-10-12' }, { delivery_status: 'pending' }]);
  }, null, { action: 'battery-campaign-stats' });
  assert.equal(result.data.sent, 1); assert.equal(result.data.unsubscribed, 1); assert.equal(result.data.pending, 1);
});
test('provider timeout records unconfirmed instead of claiming a definite failure', async () => {
  const patches = [];
  const recipient = { id: 'recipient-1', email: 'fixture@example.com', first_name: 'Fixture', tracking_token: '12345678-1234-4234-8234-123456789abc' };
  const result = await callApi(async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.mail.hostinger.com') throw new DOMException('Timed out', 'AbortError');
    if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return response(options.headers.Prefer === 'return=representation' ? [recipient] : []); }
    if (url.pathname.endsWith('/email_campaigns')) return response([{ ...campaign, status: 'sending' }]);
    if (url.pathname.endsWith('/email_campaign_recipients')) return response([recipient]);
    return response([]);
  }, { action: 'battery-campaign-send-next', password: 'fixture-password' });
  assert.equal(result.data.needsReview, true); assert.equal(result.data.state, 'paused');
  assert.ok(patches.some(p => p.delivery_status === 'unknown'));
  assert.ok(!patches.some(p => p.delivery_status === 'failed'));
});

test('campaign with an unresolved send pauses instead of announcing completion', async () => {
  const patches = [];
  const result = await callApi(async (input, options = {}) => {
    const url = new URL(input);
    assert.notEqual(url.hostname, 'api.mail.hostinger.com');
    if (options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return response([]); }
    if (url.pathname.endsWith('/email_campaigns')) return response([{ ...campaign, status: 'sending' }]);
    if (url.searchParams.get('delivery_status') === 'eq.pending') return response([]);
    return response([{ delivery_status: 'unknown' }]);
  }, { action: 'battery-campaign-send-next', password: 'fixture-password' });
  assert.equal(result.data.state, 'paused'); assert.equal(result.data.needsReview, true);
  assert.ok(patches.some(p => p.status === 'paused'));
  assert.ok(!patches.some(p => p.status === 'completed'));
});

test('successful sending retains unsubscribe state and includes unsubscribe in plain text', async () => {
  const recipient = { id: 'recipient-1', email: 'fixture@example.com', first_name: 'Fixture', tracking_token: '12345678-1234-4234-8234-123456789abc' };
  let providerCalls = 0;
  const result = await callApi(async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.mail.hostinger.com') { providerCalls++; assert.match(JSON.parse(options.body).text, /Unsubscribe: https:/); return response({}); }
    if (options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      if (patch.delivery_status === 'sent') assert.equal(url.searchParams.get('delivery_status'), 'eq.sending');
      if (patch.delivery_status === 'sending') { assert.equal(url.searchParams.get('unsubscribed_at'), 'is.null'); assert.equal(url.searchParams.get('sent_at'), 'is.null'); return response([recipient]); }
      return response([]);
    }
    if (url.pathname.endsWith('/email_campaigns')) return response([{ ...campaign, status: 'sending' }]);
    if (url.pathname.endsWith('/email_campaign_recipients')) return response([recipient]);
    return response([]);
  }, { action: 'battery-campaign-send-next', password: 'fixture-password' });
  assert.equal(result.data.sent, true); assert.equal(providerCalls, 1);
});
