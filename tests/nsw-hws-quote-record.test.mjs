import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateQuote } from '../api/hotwater-nsw/pricing.js';
import { nswQuotePricingRecord, NSW_QUOTE_PRICING_COLUMNS } from '../lib/nsw-hws-quote-record.js';
import handler from '../api/hotwater-nsw/send.js';

const schema = readFileSync(new URL('../hotwater-nsw/nsw-hws-quotes-schema.sql', import.meta.url), 'utf8');
test('persisted pricing fields exist in the schema and exclude internal metadata', () => {
  const calc = calculateQuote({ existing_system: 'gas', heat_pump_model: 'EG-330FR', tank_staying: true, finance_requested: true });
  const row = nswQuotePricingRecord({ ...calc, future_internal_flag: true });
  for (const field of NSW_QUOTE_PRICING_COLUMNS) {
    assert.match(schema, new RegExp('^\\s+' + field + '\\s+(numeric|text|boolean|integer|jsonb)\\b', 'm'));
    assert.deepEqual(row[field], calc[field]);
  }
  assert.deepEqual(Object.keys(calc).filter(field => !NSW_QUOTE_PRICING_COLUMNS.includes(field)), ['loan_minimum_adjustment', 'finance_available']);
  assert.equal(row.final_price, 2000);
  assert.equal(row.amount_financed, 2000);
  assert.equal(row.fortnightly_repayment, 7.69);
  assert.equal(row.monthly_repayment, 16.67);
  assert.ok(!('finance_available' in row));
  assert.ok(!('loan_minimum_adjustment' in row));
  assert.ok(!('future_internal_flag' in row));
});

for (const financeRequested of [true, false]) test(`sender saves supported fields before email (${financeRequested ? 'loan' : 'upfront'})`, async () => {
  const originalFetch = global.fetch;
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'HOSTINGER_MAILBOX_RESOURCE_ID', 'HOSTINGER_MAIL_API_TOKEN', 'GHL_API_KEY', 'GHL_LOCATION_ID'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SUPABASE_URL: 'https://database.example', SUPABASE_ANON_KEY: 'fixture', HOSTINGER_MAILBOX_RESOURCE_ID: 'fixture', HOSTINGER_MAIL_API_TOKEN: 'fixture', GHL_API_KEY: '', GHL_LOCATION_ID: '' });
  let saved, emailCalls = 0; const emails = [];
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'database.example') {
      assert.equal(options.method, 'POST');
      saved = JSON.parse(options.body);
      for (const field of Object.keys(saved)) assert.match(schema, new RegExp('^\\s+' + field + '\\s+(uuid|numeric|text|boolean|integer|jsonb|timestamptz)\\b', 'm'));
      assert.equal(saved.final_price, financeRequested ? 2000 : 1999);
      assert.equal(saved.amount_financed, financeRequested ? 2000 : 0);
      return new Response(JSON.stringify([{ id: 'fixture', ...saved }]), { status: 201 });
    }
    if (url.hostname === 'api.mail.hostinger.com') {
      assert.ok(saved); emailCalls++;
      const email = JSON.parse(options.body); emails.push(email);
      assert.match(email.html, financeRequested ? /2,000\.00/ : /1,999\.00/);
      assert.doesNotMatch(email.html, /loan_minimum_adjustment|finance_available/);
      return new Response('{}', { status: 200 });
    }
    if (url.pathname.endsWith('.pdf')) return new Response('fixture brochure', { status: 200 });
    throw new Error('Unexpected external request: ' + url.hostname);
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  try {
    await handler({ method: 'POST', body: { customer_name: 'Fixture Customer', customer_email: 'fixture@example.com', existing_system: 'gas', heat_pump_model: 'EG-330FR', tank_staying: true, finance_requested: financeRequested, send_sms: false } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.data.success, true); assert.equal(emailCalls, 2);
    // The customer gets the brochure; the info@ copy is a separate message with no attachment.
    assert.deepEqual(emails[0].to, ['fixture@example.com']); assert.ok(!emails[0].bcc); assert.ok(emails[0].attachments?.length);
    assert.deepEqual(emails[1].to, ['info@goldsure.com.au']); assert.ok(!emails[1].attachments);
  } finally {
    global.fetch = originalFetch;
    for (const key of names) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
