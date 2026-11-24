import crypto from 'node:crypto';

// Smoke alarm $33 booking fee, paid online through Stripe Checkout.
export const BOOKING_FEE_CENTS = 3300;
export const BOOKING_FEE_LABEL = '$33.00';
const STRIPE_API = 'https://api.stripe.com/v1';
const SITE_ORIGIN = 'https://www.goldsure.com.au';
const TOKEN_RE = /^[A-Za-z0-9-]{8,80}$/;

export function isValidQuoteToken(token) {
  return TOKEN_RE.test(String(token || ''));
}

function siteOrigin(env) {
  return String(env.PUBLIC_SITE_URL || SITE_ORIGIN).replace(/\/+$/, '');
}

// Creates a Stripe Checkout Session for the booking fee. Uses the REST API
// directly so the project needs no extra dependency.
export async function createBookingFeeCheckout({ quote, quoteToken, fetchImpl = fetch, env = process.env } = {}) {
  const secret = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!secret) throw new Error('stripe-not-configured');
  if (!isValidQuoteToken(quoteToken)) throw new Error('invalid-token');

  const origin = siteOrigin(env);
  const tokenParam = encodeURIComponent(quoteToken);
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${origin}/accept-quote.html?token=${tokenParam}&paid=1`);
  params.set('cancel_url', `${origin}/accept-quote.html?token=${tokenParam}&paid=0`);
  params.set('client_reference_id', quoteToken);
  if (quote?.customer_email) params.set('customer_email', String(quote.customer_email).trim());
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'aud');
  params.set('line_items[0][price_data][unit_amount]', String(BOOKING_FEE_CENTS));
  params.set('line_items[0][price_data][product_data][name]', 'Goldsure smoke alarm booking fee');
  params.set('line_items[0][price_data][product_data][description]', 'Secures your electrician. Deducted from your final quote total.');
  params.set('metadata[quote_token]', quoteToken);
  params.set('metadata[customer_name]', String(quote?.customer_name || '').slice(0, 200));
  params.set('metadata[purpose]', 'smoke-booking-fee');
  params.set('payment_intent_data[metadata][quote_token]', quoteToken);
  params.set('payment_intent_data[description]', `Goldsure smoke alarm booking fee – ${String(quote?.customer_name || '').slice(0, 100)}`);

  const response = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // One Checkout Session per quote per hour, so double-clicks reuse it.
      'Idempotency-Key': `smoke-fee-${quoteToken}-${Math.floor(Date.now() / 3600000)}`,
    },
    body: params,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) {
    const error = new Error('stripe-checkout-failed');
    error.stripeDetails = body?.error?.message || `status ${response.status}`;
    throw error;
  }
  return { url: body.url, sessionId: body.id };
}

// Verifies a Stripe-Signature header against the raw request body.
export function verifyStripeSignature(rawBody, header, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (!rawBody || !header || !secret) return false;
  const parts = String(header).split(',').map(p => p.trim().split('='));
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuf = Buffer.from(expected);
  return signatures.some(sig => {
    const buf = Buffer.from(sig);
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });
}
