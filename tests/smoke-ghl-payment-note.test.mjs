import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSmokeBookingPaymentNote } from '../lib/ghl-smoke-alarm-stage.js';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'fixture', GHL_API_KEY: 'fixture', GHL_LOCATION_ID: 'location' };
const token = '123e4567-e89b-12d3-a456-426614174000';
const quote = {
  customer_name: 'Example', customer_email: 'example@example.com', customer_address: '12 Example Street, Brisbane QLD 4000',
  accepted_at: new Date().toISOString(), booking_fee_paid_at: new Date().toISOString(), booking_fee_amount: 33,
  stripe_checkout_session_id: 'cs_paid', stripe_payment_intent_id: 'pi_paid',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

for (const fields of [
  { accepted_at: null }, { booking_fee_paid_at: null }, { booking_fee_amount: 32 }, { stripe_checkout_session_id: 'cs_other' },
]) {
  test(`no paid note without verified payment: ${Object.keys(fields)[0]}`, async () => {
    const calls = [];
    const result = await syncSmokeBookingPaymentNote({
      quoteToken: token, checkoutSessionId: 'cs_paid', env,
      fetchImpl: async url => { calls.push(url); return json([{ ...quote, ...fields }]); },
    });
    assert.equal(result.synced, false);
    assert.equal(result.reason, 'payment-not-verified');
    assert.equal(calls.length, 1, 'Do not call GHL for an unverified payment');
  });
}

test('keeps the original acceptance note and adds a separate payment note', async () => {
  const notes = [{ body: 'Smoke alarm quote accepted\nCustomer: Example\nProperty address: 12 Example Street, Brisbane QLD 4000\nDataforce job: 601 (Waiting list)' }];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/quote_emails')) return json([quote]);
    if (String(url).includes('/contacts/?')) return json({ contacts: [{ id: 'contact', email: quote.customer_email }] });
    if (String(url).endsWith('/contacts/contact/notes')) {
      if (init.method === 'POST') { notes.push(JSON.parse(init.body)); return json({ note: { id: 'new-note' } }); }
      return json({ notes });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const originalAcceptance = notes[0].body;
  const args = { quoteToken: token, checkoutSessionId: 'cs_paid', env, fetchImpl };
  assert.equal((await syncSmokeBookingPaymentNote(args)).synced, true);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].body, originalAcceptance);
  assert.match(notes[1].body, /^\$33 paid via Stripe\nBooking fee received: \$33.00 AUD/);
  assert.match(notes[1].body, /Manually record the \$33 payment in DataForce/);
  assert.equal((await syncSmokeBookingPaymentNote(args)).reason, 'already-noted');
  assert.equal(notes.length, 2);
});

test('does not post a note if the contact lookup cannot match the quote customer', async () => {
  const result = await syncSmokeBookingPaymentNote({
    quoteToken: token, checkoutSessionId: 'cs_paid', env,
    fetchImpl: async url => String(url).includes('/rest/v1/quote_emails') ? json([quote]) : json({ contacts: [{ id: 'wrong-contact', email: 'other@example.com' }] }),
  });
  assert.equal(result.reason, 'contact-not-found');
});
