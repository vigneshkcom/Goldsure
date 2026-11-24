import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createBookingFeeCheckout, verifyStripeSignature, BOOKING_FEE_CENTS } from '../lib/smoke-stripe.js';

const TOKEN = '123e4567-e89b-12d3-a456-426614174000';

test('checkout session charges a fixed $33 AUD fee and carries the quote token', async () => {
  let sent;
  const result = await createBookingFeeCheckout({
    quote: { customer_email: 'a@b.com', customer_name: 'Jo' }, quoteToken: TOKEN,
    env: { STRIPE_SECRET_KEY: 'sk_test_x' },
    fetchImpl: async (url, init) => { sent = { url, init }; return { ok: true, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }) }; },
  });
  assert.equal(result.url, 'https://checkout.stripe.com/x');
  const body = sent.init.body;
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), String(BOOKING_FEE_CENTS));
  assert.equal(BOOKING_FEE_CENTS, 3300);
  assert.equal(body.get('line_items[0][price_data][currency]'), 'aud');
  assert.equal(body.get('metadata[quote_token]'), TOKEN);
  assert.match(body.get('success_url'), /paid=1/);
});

test('checkout fails closed without Stripe key or with a bad token', async () => {
  await assert.rejects(createBookingFeeCheckout({ quoteToken: TOKEN, env: {} }), /stripe-not-configured/);
  await assert.rejects(createBookingFeeCheckout({ quoteToken: 'x y', env: { STRIPE_SECRET_KEY: 'k' } }), /invalid-token/);
});

test('webhook signature verification accepts valid and rejects tampered/stale payloads', () => {
  const secret = 'whsec_test', raw = '{"a":1}', t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifyStripeSignature('{"a":2}', `t=${t},v1=${sig}`, secret), false);
  assert.equal(verifyStripeSignature(raw, `t=${t - 3600},v1=${sig}`, secret), false);
  assert.equal(verifyStripeSignature(raw, `t=${t},v1=${sig}`, 'other'), false);
});

test('accept page offers pay-online and request-a-call and its script parses', async () => {
  const src = await readFile(new URL('../accept-quote.html', import.meta.url), 'utf8');
  assert.match(src, /value="pay-online"/);
  assert.match(src, /value="request-call"/);
  assert.match(src, /action: 'create-checkout'/);
  assert.doesNotMatch(src, /bank transfer/i);
  const scripts = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
});
