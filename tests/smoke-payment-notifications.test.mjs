import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { bookingFeeNotice, hasReceivedBookingFee } from '../lib/smoke-booking-notice.js';
import webhook from '../api/smoke-alarms/stripe-webhook.js';

const read = p => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const token = '123e4567-e89b-12d3-a456-426614174000';

test('only a confirmed full booking fee earns the green received banner', () => {
  for (const row of [{}, { booking_fee_amount: 33 }, { booking_fee_paid_at: 'invalid', booking_fee_amount: 33 }, { booking_fee_paid_at: new Date().toISOString(), booking_fee_amount: 0 }]) {
    assert.equal(hasReceivedBookingFee(row), false);
  }
  assert.equal(hasReceivedBookingFee({ booking_fee_paid_at: new Date().toISOString(), booking_fee_amount: '33.00' }), true);
  assert.match(bookingFeeNotice({ received: true }), /\$33 RECEIVED/);
  assert.match(bookingFeeNotice({ received: true }), /background:#dcfce7/);
  assert.match(bookingFeeNotice({ payingOnline: true }), /PAYMENT PENDING/);
  assert.doesNotMatch(bookingFeeNotice({}), />\$33 RECEIVED</);
});

async function acceptancePage(row, query = '') {
  const html = await read('accept-quote.html');
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1].split('// Run on load')[0];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, value: '', innerText: '', innerHTML: '', textContent: '', classList: { toggle() {} }, before() {} });
    return elements.get(id);
  };
  const context = vm.createContext({
    URLSearchParams, Date, console, setTimeout: fn => fn(),
    location: { search: `?token=${token}${query}` }, window: { location: { search: `?token=${token}${query}` } },
    document: { getElementById: element, createElement: () => ({}) },
    fetch: async () => ({ ok: true, json: async () => [row] }),
  });
  vm.runInContext(script, context);
  await vm.runInContext('processAcceptance()', context);
  return { elements, context, html };
}

for (const age of [3, 5]) {
  test(`an unaccepted ${age}-day-old quote opens current online payment choices`, async () => {
    const row = { customer_name: 'Example', sent_at: new Date(Date.now() - age * 86400000).toISOString(), status: 'sent', alarm_qty: 5, grand_total: 523, service_type: 'Installation Quote', customer_address: '12 Example Street, Brisbane QLD 4000' };
    const { elements, context, html } = await acceptancePage(row);
    assert.equal(elements.get('stateConfirm').style.display, 'block');
    assert.equal(vm.runInContext('currentQuoteToken', context), token);
    assert.match(html, /value="pay-online">Accept &amp; pay \$33/);
    assert.match(await read('smoke-alarms/quote.html'), /\/accept-quote\.html\?token=/);
  });
}

test('expired old quotes remain expired', async () => {
  const { elements } = await acceptancePage({ sent_at: new Date(Date.now() - 22 * 86400000).toISOString(), status: 'sent' });
  assert.equal(elements.get('stateExpired').style.display, 'block');
});

test('a forged paid return URL cannot claim the booking fee was received', async () => {
  const { elements } = await acceptancePage({ accepted_at: new Date().toISOString(), customer_name: 'Example' }, '&paid=1');
  assert.equal(elements.get('feeStepTitle').textContent, 'Payment confirmation pending');
  assert.doesNotMatch(elements.get('successSubtitle').innerHTML, /has been paid/);
});

test('a confirmed stored payment shows received on the return page', async () => {
  const { elements } = await acceptancePage({ accepted_at: new Date().toISOString(), booking_fee_paid_at: new Date().toISOString(), booking_fee_amount: 33 }, '&paid=1');
  assert.equal(elements.get('feeStepTitle').textContent, 'Booking fee paid - $33.00');
});

test('Stripe records payment and GHL notes without sending any staff email', async t => {
  const sent = [];
  const notes = [];
  let paymentNoteFailures = 1;
  const envBefore = { ...process.env };
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; for (const k of Object.keys(process.env)) if (!(k in envBefore)) delete process.env[k]; Object.assign(process.env, envBefore); });
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
  process.env.HOSTINGER_MAILBOX_RESOURCE_ID = 'fixture';
  process.env.HOSTINGER_MAIL_API_TOKEN = 'fixture';
  process.env.GHL_API_KEY = 'ghl-fixture';
  process.env.GHL_LOCATION_ID = 'location-fixture';
  let paid = false;
  global.fetch = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/smoke_acceptance_notifications')) return new Response(JSON.stringify(init.method === 'POST' ? [] : [{ quote_token: token, due_at: new Date().toISOString(), payload: {} }]));
    if (String(url).includes('/rest/v1/quote_emails')) {
      if (init.method === 'PATCH') {
        const rows = paid ? [] : [{ customer_name: 'Example Customer' }]; paid = true;
        return new Response(JSON.stringify(rows));
      }
      return new Response(JSON.stringify([{
        customer_name: 'Example Customer', customer_email: 'example@example.com',
        customer_address: '12 Example Street, Brisbane QLD 4000',
        accepted_at: new Date().toISOString(),
        ...(paid ? { booking_fee_paid_at: new Date().toISOString(), booking_fee_amount: 33, stripe_checkout_session_id: 'cs_fixture' } : {}),
      }]));
    }
    if (String(url).includes('/contacts/?')) return new Response(JSON.stringify({ contacts: [{ id: 'contact-fixture', email: 'example@example.com' }] }));
    if (String(url).endsWith('/contacts/contact-fixture/notes')) {
      if (init.method === 'POST') {
        const note = JSON.parse(init.body);
        if (note.body.startsWith('$33 paid via Stripe') && paymentNoteFailures-- > 0) return new Response('{}', { status: 503 });
        notes.push(note);
        return new Response(JSON.stringify({ note: { id: `note-${notes.length}` } }));
      }
      return new Response(JSON.stringify({ notes }));
    }
    if (String(url).startsWith('https://api.mail.hostinger.com/')) { sent.push(JSON.parse(init.body)); return new Response('{}'); }
    throw new Error(`Unexpected request ${url}`);
  };
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_fixture', payment_status: 'paid', amount_total: 3300, currency: 'aud', metadata: { purpose: 'smoke-booking-fee', quote_token: token } } } };
  async function invoke(value, valid = true) {
    const raw = JSON.stringify(value), timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', valid ? 'whsec_fixture' : 'wrong').update(`${timestamp}.${raw}`).digest('hex');
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await webhook({ method: 'POST', body: raw, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } }, res);
    return res;
  }
  assert.equal((await invoke(event, false)).code, 400);
  assert.equal(sent.length, 0);
  const unpaid = structuredClone(event); unpaid.data.object.payment_status = 'unpaid';
  assert.equal((await invoke(unpaid)).body.ignored, true);
  assert.equal(sent.length, 0);
  assert.equal((await invoke(event)).code, 500, 'GHL failures must ask Stripe to retry');
  assert.equal(sent.length, 0);
  assert.equal((await invoke(event)).code, 200);
  assert.equal(sent.length, 0, 'Only the delayed queue may send staff email');
  assert.equal(notes.length, 2);
  assert.match(notes[0].body, /^Smoke alarm quote accepted/);
  assert.match(notes[1].body, /^\$33 paid via Stripe/);
  assert.match(notes[1].body, /Stripe checkout: cs_fixture/);
  assert.equal((await invoke(event)).code, 200);
  assert.equal(notes.length, 2, 'Stripe retries must not add a second payment note');
});
