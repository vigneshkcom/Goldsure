import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import handler from '../api/smoke-alarms/quotes.js';
import { buildBookingFeeReminder } from '../lib/smoke-booking-reminder.js';

const token = '123e4567-e89b-12d3-a456-426614174000';
const quote = { quote_token: token, customer_name: 'Pam <Whitehouse>', customer_email: 'customer@example.com', accepted_at: '2026-11-25T00:00:00Z', status: 'accepted', reminder_count: 0 };
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
function res() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
async function request(row, action, extra = {}) {
  const saved = { ...process.env }, originalFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'test', STRIPE_SECRET_KEY: 'sk_test_mock', HOSTINGER_MAILBOX_RESOURCE_ID: 'box', HOSTINGER_MAIL_API_TOKEN: 'mock' });
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('api.stripe.com')) return response({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
    if (String(url).includes('api.mail.hostinger.com')) return response({});
    if (init.method === 'PATCH') return response({});
    return response(row ? [row] : []);
  };
  try {
    const result = res();
    await handler({ method: 'POST', body: { action, token, ...extra } }, result);
    return { result, calls };
  } finally { globalThis.fetch = originalFetch; process.env = saved; }
}

test('previously accepted unpaid quotes can resume fixed $33 checkout', async () => {
  const { result, calls } = await request(quote, 'create-checkout');
  assert.equal(result.code, 200);
  const stripe = calls.find(c => c.url.includes('api.stripe.com'));
  assert.equal(stripe.init.body.get('line_items[0][price_data][unit_amount]'), '3300');
  assert.equal(stripe.init.body.get('metadata[quote_token]'), token);
});
test('paid, unaccepted, rejected and installed quotes cannot start checkout or receive fee reminders', async () => {
  for (const row of [
    { ...quote, booking_fee_paid_at: '2026-11-25T01:00:00Z', booking_fee_amount: 33 },
    { ...quote, accepted_at: null },
    { ...quote, status: 'rejected' },
    { ...quote, status: 'installed' },
    { ...quote, status: 'expired' },
  ]) for (const action of ['create-checkout', 'send-booking-reminder']) {
    const { result, calls } = await request(row, action);
    assert.equal(result.code, 409);
    assert.equal(calls.length, 1, 'only the quote lookup may run');
  }
});
test('booking email uses the stored recipient and token and records history without accepting again', async () => {
  const { result, calls } = await request(quote, 'send-booking-reminder', { customer_email: 'untrusted@example.com' });
  assert.equal(result.code, 200);
  const mail = JSON.parse(calls.find(c => c.url.includes('api.mail.hostinger.com')).init.body);
  assert.deepEqual(mail.to, ['customer@example.com']);
  assert.match(mail.html, /Pam &lt;Whitehouse&gt;/);
  assert.match(mail.html, /accept-quote.html\?token=/);
  assert.match(mail.text, /pay over the phone/);
  const patch = JSON.parse(calls.find(c => c.init.method === 'PATCH').init.body);
  assert.equal(patch.reminder_count, 1);
  assert.ok(patch.last_reminder_sent_at);
  assert.equal(patch.accepted_at, undefined);
});
test('recent reminders and missing quotes fail without sending', async () => {
  for (const [row, expected] of [[{ ...quote, last_reminder_sent_at: new Date().toISOString() }, 429], [null, 404]]) {
    const { result, calls } = await request(row, 'send-booking-reminder');
    assert.equal(result.code, expected);
    assert.equal(calls.length, 1);
  }
});
test('payment links contain no staff view parameter or temporary Stripe session URL', () => {
  const email = buildBookingFeeReminder(quote);
  assert.match(email.text, new RegExp(token));
  assert.ok(!email.html.includes('source=tracker'));
  assert.ok(!email.html.includes('checkout.stripe.com'));
});
test('shared SMS and tracker actions show payment only for eligible quotes', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../assets/smoke-booking-fee.js', import.meta.url), 'utf8'), sandbox);
  const fee = sandbox.window.GoldsureBookingFee;
  assert.equal(fee.eligible(quote), true);
  assert.equal(fee.eligible({ ...quote, accepted_at: null }), false);
  const paid = { ...quote, booking_fee_paid_at: '2026-11-25T01:00:00Z', booking_fee_amount: 33 };
  assert.equal(fee.received(paid), true);
  assert.equal(fee.eligible(paid), false);
  assert.equal(fee.received({ ...paid, booking_fee_amount: 0 }), false);
  assert.equal(fee.eligible({ ...quote, status: 'installed' }), false);
  assert.match(fee.sms(quote), /\$33 booking fee is pending/);
  assert.ok(fee.sms(quote).includes(fee.url(quote)));
});
test('customer returning without paid URL can pay, while confirmed payments show receipt', async () => {
  const source = readFileSync(new URL('../accept-quote.html', import.meta.url), 'utf8');
  const process = source.slice(source.indexOf('async function processAcceptance()'), source.indexOf('async function submitAcceptance('));
  const payment = source.slice(source.indexOf('function showAcceptedPayment('), source.indexOf('function showSuccessMessage('));
  for (const paid of [false, true]) {
    const states = [], messages = [];
    const row = { ...quote, ...(paid ? { booking_fee_paid_at: '2026-11-25T01:00:00Z', booking_fee_amount: 33 } : {}) };
    const sandbox = {
      URLSearchParams, Date, console,
      SUPABASE_URL: 'https://db.example', SUPABASE_KEY: 'anon',
      window: { location: { search: '?token=' + token } },
      fetch: async () => response([row]),
      showState: state => states.push(state),
      showSuccessMessage: kind => messages.push(kind),
      buildQuoteInfo() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(process + payment, sandbox);
    await vm.runInContext('processAcceptance()', sandbox);
    assert.equal(states.at(-1), paid ? 'stateSuccess' : 'stateAlready');
    if (paid) assert.equal(messages.at(-1), 'paid');
  }
});
test('all modified inline browser scripts parse', () => {
  for (const path of ['../accept-quote.html', '../sms/index.html', '../smoke-alarms/quote-tracker.html']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    for (const match of source.matchAll(/<script(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => new Function(match[1]), path);
    }
  }
});

test('SMS cards offer fee actions only while unpaid and show receipt after payment', () => {
  const sandbox = { window: {}, esc: value => String(value) };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../assets/smoke-booking-fee.js', import.meta.url), 'utf8'), sandbox);
  sandbox.GoldsureBookingFee = sandbox.window.GoldsureBookingFee;
  const source = readFileSync(new URL('../sms/index.html', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('  function bookingQuote('), source.indexOf('  async function changeQuoteStatus(')), sandbox);
  const card = { product: 'smoke', token, status: 'accepted', acceptedAt: quote.accepted_at, customerName: 'Pam', customerEmail: 'customer@example.com' };
  const unpaid = sandbox.renderBookingFeeActions(card, 0);
  assert.match(unpaid, /Draft payment SMS/);
  assert.match(unpaid, /Email fee reminder/);
  assert.match(unpaid, /Copy payment link/);
  const paid = sandbox.renderBookingFeeActions({ ...card, bookingFeePaidAt: '2026-11-25T01:00:00Z', bookingFeeAmount: 33 }, 0);
  assert.match(paid, /Booking fee \$33 paid/);
  assert.doesNotMatch(paid, /Email fee reminder|Draft payment SMS|Pay \$33/);
  assert.equal(sandbox.renderBookingFeeActions({ ...card, acceptedAt: null }, 0), '');
});
