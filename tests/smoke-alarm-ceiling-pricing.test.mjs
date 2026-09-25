import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler from '../api/smoke-alarms/send.js';
import { buildReminderEmail } from '../api/smoke-alarms/send-reminder.js';

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function quoteBody(overrides = {}) {
  return {
    quote_token: 'ceiling-test-token',
    customer_name: 'Test Customer',
    customer_phone: '0412345678',
    customer_type: 'digital',
    to_email: 'customer@example.com',
    customer_address: '1 Test Street, Brisbane QLD 4000',
    agent_name: 'Vignesh',
    service_type: 'Installation Quote',
    ceiling_type: 'concrete',
    alarm_qty: 3,
    alarm_total: '$0.00',
    ctrl_qty: 0,
    ctrl_total: '$0.00',
    fee_label: 'Electrician Booking Fee',
    fee_amount: '$33.00',
    grand_total: '$0.00',
    pre_discount_total: '$0.00',
    offer_applied: false,
    offer_discount: 0,
    send_sms: false,
    ...overrides,
  };
}

test('sales app requires a ceiling choice and shows the concrete charge', () => {
  const html = readFileSync(new URL('../smoke-alarms/smoke-alarm.html', import.meta.url), 'utf8');
  assert.match(html, /name="ceilingType" value="normal"/);
  assert.match(html, /name="ceilingType" value="concrete"/);
  assert.match(html, /Concrete ceiling \(\+\$11 inc GST per smoke alarm\)/);
  assert.match(html, /serviceMode === 'install' && !getCeilingType\(\)/);
  assert.match(html, /ceiling_type:\s+serviceMode === 'install' \? ceilingType : null/);
  assert.match(html, /Concrete Ceiling Installation \(\$\{alarmQty\} × \$11\.00\)/);
});

test('server refuses an installation quote without a ceiling type before sending anything', async () => {
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => { fetchCount += 1; throw new Error('fetch should not run'); };
  try {
    const response = responseRecorder();
    await handler({ method: 'POST', body: quoteBody({ ceiling_type: '' }) }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /normal or concrete ceiling/i);
    assert.equal(fetchCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('server adds $11 inc GST per alarm for concrete ceilings and ignores browser totals', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    HOSTINGER_MAILBOX_RESOURCE_ID: process.env.HOSTINGER_MAILBOX_RESOURCE_ID,
    HOSTINGER_MAIL_API_TOKEN: process.env.HOSTINGER_MAIL_API_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GHL_API_KEY: process.env.GHL_API_KEY,
    GHL_LOCATION_ID: process.env.GHL_LOCATION_ID,
  };
  Object.assign(process.env, {
    HOSTINGER_MAILBOX_RESOURCE_ID: 'mailbox',
    HOSTINGER_MAIL_API_TOKEN: 'token',
    SUPABASE_URL: 'https://supabase.example',
    SUPABASE_ANON_KEY: 'anon',
  });
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
  let mailPayload;
  let storedQuote;
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.includes('raptor-smoke-alarm-datasheet.pdf')) return new Response('', { status: 404 });
    if (value.includes('api.mail.hostinger.com')) {
      mailPayload = JSON.parse(init.body);
      return new Response('', { status: 202 });
    }
    if (value === 'https://supabase.example/rest/v1/quote_emails') {
      storedQuote = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 1 }]), { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };
  try {
    const response = responseRecorder();
    await handler({ method: 'POST', body: quoteBody() }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.grand_total, '$360.00');
    assert.equal(response.body.ceiling_type, 'concrete');
    assert.equal(response.body.ceiling_total, 33);
    assert.match(mailPayload.html, /Concrete Ceiling Installation/);
    assert.match(mailPayload.html, />\$11\.00</);
    assert.match(mailPayload.html, />\$33\.00</);
    assert.equal(storedQuote.alarm_qty, 3);
    assert.equal(storedQuote.alarm_total, 327);
    assert.equal(storedQuote.alarm_unit_price, 109);
    assert.equal(storedQuote.grand_total, 360);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('normal ceilings add nothing to the server-calculated quote', async () => {
  const originalFetch = global.fetch;
  const previousEnv = {
    HOSTINGER_MAILBOX_RESOURCE_ID: process.env.HOSTINGER_MAILBOX_RESOURCE_ID,
    HOSTINGER_MAIL_API_TOKEN: process.env.HOSTINGER_MAIL_API_TOKEN,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    GHL_API_KEY: process.env.GHL_API_KEY,
    GHL_LOCATION_ID: process.env.GHL_LOCATION_ID,
  };
  Object.assign(process.env, {
    HOSTINGER_MAILBOX_RESOURCE_ID: 'mailbox', HOSTINGER_MAIL_API_TOKEN: 'token',
    SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'anon',
  });
  delete process.env.GHL_API_KEY;
  delete process.env.GHL_LOCATION_ID;
  let storedQuote;
  global.fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.includes('raptor-smoke-alarm-datasheet.pdf')) return new Response('', { status: 404 });
    if (value.includes('api.mail.hostinger.com')) return new Response('', { status: 202 });
    if (value === 'https://supabase.example/rest/v1/quote_emails') {
      storedQuote = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 2 }]), { status: 201 });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };
  try {
    const response = responseRecorder();
    await handler({ method: 'POST', body: quoteBody({ ceiling_type: 'normal' }) }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.grand_total, '$327.00');
    assert.equal(response.body.ceiling_total, 0);
    assert.equal(storedQuote.alarm_total, 294);
    assert.equal(storedQuote.alarm_unit_price, 98);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('online quote and reminder preserve the concrete ceiling line', () => {
  const quotePage = readFileSync(new URL('../smoke-alarms/quote.html', import.meta.url), 'utf8');
  assert.match(quotePage, /alarmUnitPrice=Number\(q\.alarm_unit_price\)\|\|98/);
  assert.match(quotePage, /name:'Concrete Ceiling Installation'/);

  const html = buildReminderEmail({
    quote_token: 'token', customer_name: 'Test Customer', customer_email: 'customer@example.com',
    service_type: 'Installation Quote', alarm_qty: 3, alarm_total: 327, alarm_unit_price: 109,
    ctrl_qty: 0, fee_label: 'Electrician Booking Fee', fee_amount: 33, grand_total_numeric: 360,
    reminder_count: 0, sent_at: '2026-09-25T00:00:00.000Z',
  });
  assert.match(html, /Concrete Ceiling Installation/);
  assert.match(html, />\$33\.00</);
  assert.match(html, />\$294\.00</);
});
