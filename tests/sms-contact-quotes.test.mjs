import test from 'node:test';
import assert from 'node:assert/strict';

import handler from '../api/battery/request-callback.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.end = () => res;
  return res;
}

async function withEnv(fn) {
  const saved = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  try { await fn(); } finally {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = saved.key;
  }
}

test('contact-quotes finds quotes across all four products by phone, newest first', () => withEnv(async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const u = String(url);
    if (u.includes('/quote_emails')) return jsonResponse([{ id: 'a1', quote_token: 'tok-smoke', status: 'Sent', grand_total: 549, sent_at: '2026-09-30T03:00:00Z', view_count: 2, customer_name: 'Soo Sie' }]);
    if (u.includes('/hotwater_quotes')) return jsonResponse([{ id: 'h1', quote_token: 'tok-hws', status: 'accepted', total_out_of_pocket: 1200, sent_at: '2026-09-20T03:00:00Z' }]);
    if (u.includes('/aircon_quotes')) return jsonResponse([{ id: 'c1', quote_token: 'tok-ac', status: 'sent', total_out_of_pocket: 3000, sent_at: '2026-09-25T03:00:00Z' }]);
    if (u.includes('/nsw_hws_quotes')) return jsonResponse([{ id: 'n1', quote_token: 'tok-nsw', status: 'sent', final_price: 2639, sent_at: '2026-09-28T03:00:00Z' }]);
    return jsonResponse([]);
  };
  const res = mockRes();
  await handler({ method: 'GET', query: { action: 'contact-quotes', phone: '+61421914691' }, headers: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.quotes.map(q => q.product), ['smoke', 'hotwater-nsw', 'aircon', 'hws']);
  const smoke = res.body.quotes[0];
  assert.equal(smoke.status, 'sent');
  assert.equal(smoke.total, 549);
  assert.equal(smoke.viewCount, 2);
  assert.equal(smoke.tracker, '/smoke-alarms/quote-tracker.html');
  assert.deepEqual(res.body.quotes.map(q => q.tracker).sort(), ['/aircons/quote-tracker.html', '/hotwater-nsw/quote-tracker.html', '/hotwater/quote-tracker.html', '/smoke-alarms/quote-tracker.html']);
  assert.match(smoke.url, /\/smoke-alarms\/quote\.html\?token=tok-smoke&source=tracker$/);
  assert.match(res.body.quotes.find(q => q.product === 'hws').url, /\/hotwater\/view\.html\?token=tok-hws&source=tracker$/);
  assert.match(res.body.quotes.find(q => q.product === 'aircon').url, /\/aircons\/view\.html\?token=tok-ac&source=tracker$/);
  assert.match(res.body.quotes.find(q => q.product === 'hotwater-nsw').url, /\/hotwater-nsw\/quote\.html\?token=tok-nsw&source=tracker$/);
  // Phone stored as "0421 914 691" must still match: wildcards between digit groups.
  assert.equal(urls.length, 4);
  for (const u of urls) assert.ok(u.includes('customer_phone=ilike.' + encodeURIComponent('*421*914*691*')), u);
}));

test('contact-quotes returns nothing for a non-phone thread and survives a failing table', () => withEnv(async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/quote_emails')) return jsonResponse({ message: 'boom' }, 500);
    return jsonResponse([]);
  };
  const short = mockRes();
  await handler({ method: 'GET', query: { action: 'contact-quotes', phone: 'GOLDSURE' }, headers: {} }, short);
  assert.deepEqual(short.body, { quotes: [] });

  const res = mockRes();
  await handler({ method: 'GET', query: { action: 'contact-quotes', phone: '0421914691' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.quotes, []);
}));

test('update-quote-status patches status (+accepted flag) and rejects bad input', () => withEnv(async () => {
  const patches = [];
  globalThis.fetch = async (url, options = {}) => {
    // Only the Supabase PATCH matters here; a rejection also makes read-only
    // lookups for the GHL sync, which are skipped (GHL isn't configured).
    if (options.method !== 'PATCH') return jsonResponse([]);
    patches.push({ url: String(url), options });
    return jsonResponse([{ id: 'x', quote_token: 't', status: JSON.parse(options.body).status }]);
  };
  const post = async (body) => {
    const res = mockRes();
    await handler({ method: 'POST', query: {}, headers: {}, body }, res);
    return res;
  };

  const ok = await post({ action: 'update-quote-status', table: 'aircon_quotes', id: 'x', status: 'accepted' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.status, 'accepted');
  assert.match(patches[0].url, /\/aircon_quotes\?id=eq\.x$/);
  assert.equal(patches[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(patches[0].options.body), { status: 'accepted', accepted: true });

  // Smoke alarm table has no `accepted` column.
  await post({ action: 'update-quote-status', table: 'quote_emails', id: 'x', status: 'rejected' });
  assert.deepEqual(JSON.parse(patches[1].options.body), { status: 'rejected' });

  // NSW also stamps updated_at.
  await post({ action: 'update-quote-status', table: 'nsw_hws_quotes', id: 'x', status: 'sent' });
  const nsw = JSON.parse(patches[2].options.body);
  assert.equal(nsw.status, 'sent'); assert.equal(nsw.accepted, false); assert.ok(nsw.updated_at);

  const before = patches.length;
  assert.equal((await post({ action: 'update-quote-status', table: 'sms_messages', id: 'x', status: 'sent' })).statusCode, 400);
  assert.equal((await post({ action: 'update-quote-status', table: 'aircon_quotes', id: 'x', status: 'bogus' })).statusCode, 400);
  assert.equal((await post({ action: 'update-quote-status', table: 'aircon_quotes', status: 'sent' })).statusCode, 400);
  assert.equal(patches.length, before, 'invalid requests must not reach Supabase');
}));
