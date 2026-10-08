import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { opportunityNotes } from '../lib/ghl-opportunity-notes.js';

function response() {
  return { statusCode: 0, body: null, setHeader() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fixture({ notesStatus = 200, notesStatuses = null } = {}) {
  const originalFetch = global.fetch;
  const oldEnv = Object.fromEntries(['GHL_API_KEY', 'GHL_LOCATION_ID', 'GHL_NOTES_STAFF_IDS'].map(key => [key, process.env[key]]));
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location123';
  delete process.env.GHL_NOTES_STAFF_IDS;
  const calls = [];
  let noteReadCount = 0;
  global.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body, version: options.headers?.Version });
    const json = value => new Response(JSON.stringify(value), { status: 200 });
    if (path === '/opportunities/opp123') return json({ opportunity: { id: 'opp123', name: 'Test opportunity', contactId: 'contact123', locationId: 'location123' } });
    if (path === '/contacts/contact123') return json({ contact: { id: 'contact123', name: 'Test Customer', email: 'test@example.com', phone: '+61412345678', locationId: 'location123' } });
    if (path === '/contacts/contact123/notes' && method === 'GET') {
      const status = notesStatuses?.[noteReadCount++] ?? notesStatus;
      return status === 200
        ? json({ notes: [{ id: 'contact-note', body: 'Existing contact note', dateAdded: '2026-10-05T01:00:00Z' }] })
        : new Response(JSON.stringify({ message: 'Unavailable' }), { status, headers: { 'retry-after': '0' } });
    }
    if (path === '/contacts/contact123/notes' && method === 'POST') return new Response(JSON.stringify({ note: { id: 'created123', body: body.body, userId: body.userId } }), { status: 201 });
    if (path === '/users/') return json({ users: [{ id: 'staff123', firstName: 'Shanira', deleted: false }] });
    throw new Error(`Unexpected GHL request ${method} ${path}`);
  };
  return { calls, restore() { global.fetch = originalFetch; for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } } };
}

test('reads the existing GHL contact notes for the verified opportunity customer', async () => {
  const mock = fixture();
  try {
    const res = response();
    await opportunityNotes({ method: 'GET', query: { opportunityId: 'opp123', expectedPhone: '0412 345 678', staffName: 'Shanira' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.notes.map(note => note.source), ['Contact']);
    assert.equal(res.body.noteScope, 'contact');
    assert.equal(res.body.authorReady, true);
    assert.equal(mock.calls.find(call => call.path === '/opportunities/opp123')?.version, 'v3');
    assert.ok(mock.calls.some(call => call.path === '/contacts/contact123/notes' && call.method === 'GET'));
    assert.ok(mock.calls.every(call => call.path !== '/notes/search' && call.path !== '/notes/'));
  } finally { mock.restore(); }
});

test('retries a rate-limited notes read and returns the notes without writing', async () => {
  const mock = fixture({ notesStatuses: [429, 200] });
  try {
    const res = response();
    await opportunityNotes({ method: 'GET', query: { opportunityId: 'opp123', expectedEmail: 'test@example.com' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.notes[0].body, 'Existing contact note');
    assert.equal(mock.calls.filter(call => call.path === '/contacts/contact123/notes' && call.method === 'GET').length, 2);
    assert.ok(mock.calls.every(call => call.method !== 'POST'));
  } finally { mock.restore(); }
});

test('an exhausted GHL rate limit reports a retryable error, never empty notes', async () => {
  const mock = fixture({ notesStatuses: [429, 429, 429] });
  try {
    const res = response();
    await opportunityNotes({ method: 'GET', query: { opportunityId: 'opp123', expectedEmail: 'test@example.com' } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /rate-limiting notes/);
    assert.ok(mock.calls.every(call => call.method !== 'POST'));
  } finally { mock.restore(); }
});

test('refuses to save if the contact note history cannot be verified', async () => {
  const mock = fixture({ notesStatus: 401 });
  try {
    const res = response();
    await opportunityNotes({ method: 'POST', body: { opportunityId: 'opp123', expectedPhone: '0412345678', body: 'Do not save', staffName: 'Shanira' } }, res);
    assert.equal(res.statusCode, 502);
    assert.ok(mock.calls.every(call => call.path !== '/contacts/contact123/notes' || call.method !== 'POST'));
  } finally { mock.restore(); }
});

test('shows an unavailable author without reporting a note as saved', async () => {
  const mock = fixture();
  try {
    const res = response();
    await opportunityNotes({ method: 'GET', query: { opportunityId: 'opp123', expectedEmail: 'test@example.com', staffName: 'David' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.authorReady, false);
    assert.match(res.body.authorIssue, /unique user match/);
    assert.ok(mock.calls.every(call => call.path !== '/contacts/contact123/notes' || call.method !== 'POST'));
  } finally { mock.restore(); }
});

test('saves through the existing GHL contact-note path with the selected user', async () => {
  const mock = fixture();
  try {
    const res = response();
    await opportunityNotes({ method: 'POST', body: { opportunityId: 'opp123', expectedEmail: 'TEST@example.com', body: 'Call back tomorrow', staffName: 'Shanira' } }, res);
    assert.equal(res.statusCode, 201, res.body?.error);
    const write = mock.calls.find(call => call.path === '/contacts/contact123/notes' && call.method === 'POST');
    assert.equal(write.version, '2021-07-28');
    assert.equal(write.body.userId, 'staff123');
    assert.equal(write.body.body, 'Call back tomorrow');
    assert.equal(res.body.noteScope, 'contact');
  } finally { mock.restore(); }
});

test('rejects mismatched customers and missing customer identity before any write', async () => {
  const mock = fixture();
  try {
    const mismatched = response();
    await opportunityNotes({ method: 'POST', body: { opportunityId: 'opp123', expectedEmail: 'wrong@example.com', body: 'Wrong customer', staffName: 'Shanira' } }, mismatched);
    assert.equal(mismatched.statusCode, 409);
    const missing = response();
    await opportunityNotes({ method: 'POST', body: { opportunityId: 'opp123', body: 'No customer identifier', staffName: 'Shanira' } }, missing);
    assert.equal(missing.statusCode, 400);
    assert.ok(mock.calls.every(call => call.path !== '/contacts/contact123/notes' || call.method !== 'POST'));
  } finally { mock.restore(); }
});

test('SMS and four quote trackers compile and include the shared notes action', () => {
  const files = ['sms/index.html', 'smoke-alarms/quote-tracker.html', 'aircons/quote-tracker.html', 'hotwater/quote-tracker.html', 'hotwater-nsw/quote-tracker.html'];
  for (const path of files) {
    const html = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const [, script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script, { filename: path });
    assert.match(html, /ghl-opportunity-notes\.js/);
    assert.match(html, /View GHL notes/);
  }
  const sms = readFileSync(new URL('../sms/index.html', import.meta.url), 'utf8');
  assert.match(sms, /sessionStorage\.setItem\('smsStaffName'/);
  new vm.Script(readFileSync(new URL('../assets/ghl-opportunity-notes.js', import.meta.url), 'utf8'));
});
