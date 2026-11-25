import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { queueAcceptanceEmail, dispatchAcceptanceEmails, renderAcceptanceEmail, queuePaymentCorrection, ACCEPTANCE_EMAIL_DELAY_MS } from '../lib/smoke-acceptance-notifications.js';
import { bookingFeeNotice, hasReceivedBookingFee } from '../lib/smoke-booking-notice.js';
import cronHandler from '../api/smoke-alarms/acceptance-notifications.js';

const acceptedAt = '2026-11-24T05:00:00.000Z';
const token = '123e4567-e89b-12d3-a456-426614174000';
const html = '<h1>Example Customer</h1><!-- BOOKING_PAYMENT_STATUS -->pending<!-- /BOOKING_PAYMENT_STATUS --><p><!-- BOOKING_NEXT_STEP -->Wait for a second email<!-- /BOOKING_NEXT_STEP --></p>';
const payload = { html, customer_name: 'Example Customer', total: '$719.00' };
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

function fixture() {
  const rows = new Map(), sends = new Map();
  const quote = { accepted_at: acceptedAt, booking_fee_paid_at: null, booking_fee_amount: null };
  const state = { rows, sends, quote, stampFailures: 0 };
  state.fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url), p = parsed.searchParams;
    const body = init.body ? JSON.parse(init.body) : {};
    if (parsed.pathname.endsWith('/quote_emails')) return json([quote]);
    if (!parsed.pathname.endsWith('/smoke_acceptance_notifications')) throw Error(`Unexpected URL ${url}`);
    if (init.method === 'POST') {
      if (!rows.has(body.quote_token)) rows.set(body.quote_token, { sent_at: null, locked_until: null, delivery: null, ...body });
      return json([]);
    }
    function matches(row) {
      if (p.has('quote_token') && p.get('quote_token') !== `eq.${row.quote_token}`) return false;
      if (p.has('sent_at') && row.sent_at) return false;
      if (p.has('lock_token') && p.get('lock_token') !== `eq.${row.lock_token}`) return false;
      if (p.has('due_at') && Date.parse(row.due_at) > Date.parse(p.get('due_at').slice(4))) return false;
      if (p.has('or') && row.locked_until && Date.parse(row.locked_until) >= Date.parse(p.get('due_at').slice(4))) return false;
      return true;
    }
    if (init.method === 'PATCH') {
      if (body.sent_at && state.stampFailures-- > 0) return json({}, 503);
      const matchesRows = [...rows.values()].filter(matches);
      for (const row of matchesRows) Object.assign(row, body);
      return json(matchesRows);
    }
    return json([...rows.values()].filter(matches));
  };
  state.queue = () => queueAcceptanceEmail({ quoteToken: token, acceptedAt, html, customerName: payload.customer_name, total: payload.total, env, fetchImpl: state.fetchImpl });
  let n = 0;
  state.mail = async mail => { sends.set(`send-${++n}`, mail); return { status: 200 }; };
  state.run = seconds => dispatchAcceptanceEmails({ env, fetchImpl: state.fetchImpl, mail: state.mail, now: new Date(Date.parse(acceptedAt) + seconds * 1000) });
  return state;
}

test('acceptance is queued for five minutes and repeated acceptance does not create another email', async () => {
  const state = fixture();
  await state.queue(); await state.queue();
  assert.equal(ACCEPTANCE_EMAIL_DELAY_MS, 300000);
  assert.equal(state.rows.size, 1);
  assert.equal([...state.rows.values()][0].due_at, '2026-11-24T05:05:00.000Z');
  assert.equal((await state.run(299)).sent, 0);
  assert.equal(state.sends.size, 0);
});

test('payment during the waiting period produces one green received email', async () => {
  const state = fixture(); await state.queue();
  state.quote.booking_fee_paid_at = '2026-11-24T05:02:00.000Z'; state.quote.booking_fee_amount = 33;
  assert.equal((await state.run(301)).sent, 1);
  const mail = [...state.sends.values()][0];
  assert.match(mail.subject, /Quote Accepted \| \$33 RECEIVED/);
  assert.match(mail.html, /background:#dcfce7/);
  assert.doesNotMatch(mail.html, /Wait for a second email/);
  assert.match(mail.html, /Manually record the payment in DataForce/);
  await state.run(360); assert.equal(state.sends.size, 1);
});

test('one unpaid email is sent after the window; a later payment does not trigger another email', async () => {
  const state = fixture(); await state.queue();
  await state.run(300);
  const mail = [...state.sends.values()][0];
  assert.match(mail.subject, /\$33 NOT RECEIVED/);
  assert.match(mail.html, /BOOKING FEE NOT RECEIVED/);
  assert.match(mail.html, /at the time of this email/);
  state.quote.booking_fee_paid_at = '2026-11-24T05:05:00.000Z'; state.quote.booking_fee_amount = 33;
  await state.run(360); assert.equal(state.sends.size, 1);
});

test('an overlapping worker respects the database lease', async () => {
  const state = fixture(); await state.queue();
  const row = state.rows.get(token); row.locked_until = '2026-11-24T05:07:00.000Z';
  assert.equal((await state.run(300)).sent, 0);
  assert.equal(state.sends.size, 0);
});

test('late verified payment sends one correction across repeated webhook events and workers', async () => {
  const state = fixture(); await state.queue(); await state.run(300);
  state.quote.booking_fee_paid_at = '2026-11-24T05:06:00.000Z'; state.quote.booking_fee_amount = 33;
  const correction = () => queuePaymentCorrection({ quoteToken: token, env, fetchImpl: state.fetchImpl });
  await correction(); await correction();
  assert.equal((await state.run(361)).sent, 1);
  await correction(); await state.run(420);
  assert.equal(state.sends.size, 2);
  const mail = [...state.sends.values()][1];
  assert.match(mail.subject, /Payment Update \| \$33 RECEIVED/);
  assert.match(mail.html, /replaces the earlier unpaid status/);
  assert.doesNotMatch(mail.html, /Call requested|BOOKING FEE NOT RECEIVED/);
});

test('payment before the original notification suppresses the redundant correction', async () => {
  const state = fixture(); await state.queue();
  state.quote.booking_fee_paid_at = '2026-11-24T05:02:00.000Z'; state.quote.booking_fee_amount = 33;
  await queuePaymentCorrection({ quoteToken: token, env, fetchImpl: state.fetchImpl });
  await state.run(300); await state.run(360);
  assert.equal(state.sends.size, 1);
  assert.match([...state.sends.values()][0].subject, /\$33 RECEIVED/);
});

test('online payment pending never claims a call was requested, including older queued templates', () => {
  for (const extra of [{ paying_online: true }, { html: html + 'Customer chose to PAY ONLINE' }]) {
    const mail = renderAcceptanceEmail({ ...payload, ...extra }, {});
    assert.match(mail.subject, /PAYMENT PENDING/);
    assert.match(mail.html, /may still complete payment/);
    assert.doesNotMatch(mail.html, /Call requested|BOOKING FEE NOT RECEIVED/);
  }
});

test('mail accepted followed by a database failure retries with the exact frozen payload', async () => {
  const state = fixture(); await state.queue(); state.stampFailures = 1;
  assert.equal((await state.run(300)).failed, 1);
  assert.equal(state.sends.size, 1);
  state.quote.booking_fee_paid_at = '2026-11-24T05:04:00.000Z'; state.quote.booking_fee_amount = 33;
  assert.equal((await state.run(600)).sent, 1);
  // Hostinger has no idempotency key, so a rare stamp failure resends, but never with changed content.
  const [first, second] = [...state.sends.values()];
  assert.deepEqual(second, first);
  assert.match(second.subject, /NOT RECEIVED/);
});

test('cron endpoint rejects unauthenticated requests', async () => {
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await cronHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.code, 401);
});

test('acceptance handler queues its full email and does not send it immediately', async () => {
  const source = await readFile(new URL('../api/smoke-alarms/accept.js', import.meta.url), 'utf8');
  let queued;
  const body = { quote_token: token, customer_name: 'Example Customer', customer_email: 'example@example.com', customer_address: '12 Example Street, Brisbane QLD 4000', accepted_at: acceptedAt, alarm_qty: 5, grand_total: '$719.00', booking_option: 'pay-online' };
  const context = vm.createContext({ console, bookingFeeNotice, hasReceivedBookingFee,
    queueAcceptanceEmail: async value => { queued = value; },
    verifyCustomerAcceptedQuote: async () => ({ verified: true, quote: { accepted_at: acceptedAt } }),
    getQuoteCustomerSource: async () => 'Fixture',
    syncAcceptedSmokeQuoteToDataforce: async () => ({ synced: true, jobId: 123 }),
    syncAcceptedSmokeAlarmStage: async () => ({ moved: true, noteAdded: true }),
    request: { method: 'POST', body },
    response: { status(code) { this.code = code; return this; }, json(body) { this.body = body; } },
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace('export default async function handler', 'async function handler'), context);
  await vm.runInContext('handler(request, response)', context);
  assert.equal(queued.quoteToken, token);
  assert.equal(queued.acceptedAt, acceptedAt);
  const paid = renderAcceptanceEmail({ html: queued.html, customer_name: body.customer_name, total: body.grand_total }, { booking_fee_paid_at: acceptedAt, booking_fee_amount: 33 });
  assert.match(paid.html, /\$33 RECEIVED/);
  assert.doesNotMatch(paid.html, /separate "PAID" email|Wait for the \$33 RECEIVED|take the \$33.00 booking fee over the phone/);
});

test('older accepted quotes without an acceptance queue still deliver one staff payment receipt', async () => {
  const state = fixture();
  Object.assign(state.quote, { customer_name: 'Pamela Whitehouse', grand_total: 572, booking_fee_paid_at: '2026-11-25T00:00:00Z', booking_fee_amount: 33 });
  const queue = () => queuePaymentCorrection({ quoteToken: token, env, fetchImpl: state.fetchImpl });
  await queue(); await queue();
  assert.equal(state.rows.size, 1);
  assert.equal(state.rows.get(token + ':paid').payload.kind, 'payment-receipt');
  const run = () => dispatchAcceptanceEmails({ env, fetchImpl: state.fetchImpl, mail: state.mail, now: new Date(Date.now() + 60000) });
  assert.equal((await run()).sent, 1);
  assert.equal((await run()).sent, 0);
  const mail = [...state.sends.values()][0];
  assert.match(mail.subject, /Payment Received \| \$33 RECEIVED \| Pamela Whitehouse/);
  assert.match(mail.html, /customer has paid their \$33 booking fee via Stripe/);
  assert.ok(mail.to.includes('vignesh@goldsure.com.au'));
  assert.equal(state.sends.size, 1);
});

test('old quotes cannot queue a receipt without verified stored payment', async () => {
  const state = fixture();
  await assert.rejects(queuePaymentCorrection({ quoteToken: token, env, fetchImpl: state.fetchImpl }), /requires verified payment/);
  assert.equal(state.rows.size, 0);
  assert.equal(state.sends.size, 0);
});
