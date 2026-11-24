import crypto from 'node:crypto';
import { bookingFeeNotice, hasReceivedBookingFee } from './smoke-booking-notice.js';

const STAFF = ['shanira@goldsure.com.au', 'david@goldsure.com.au', 'alda@goldsure.com.au', 'vignesh@goldsure.com.au'];
export const ACCEPTANCE_EMAIL_DELAY_MS = 3 * 60 * 1000;
const QUEUE = 'smoke_acceptance_notifications';

function database(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Acceptance email database is not configured');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return {
    base: `${env.SUPABASE_URL}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  };
}

export async function queueAcceptanceEmail({ quoteToken, acceptedAt, html, customerName, total, fetchImpl = fetch, env = process.env }) {
  const { base, headers } = database(env);
  if (!quoteToken || !Number.isFinite(Date.parse(acceptedAt))) throw new Error('Missing verified quote acceptance');
  const response = await fetchImpl(`${base}/${QUEUE}?on_conflict=quote_token`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      quote_token: quoteToken, due_at: new Date(Date.parse(acceptedAt) + ACCEPTANCE_EMAIL_DELAY_MS).toISOString(),
      payload: { html, customer_name: customerName, total },
    }),
  });
  if (!response.ok) throw new Error(`Could not queue acceptance email (${response.status})`);
}

export function renderAcceptanceEmail(payload, quote) {
  const received = hasReceivedBookingFee(quote);
  const nextStep = received
    ? '$33.00 booking fee received via Stripe. Call the customer to arrange installation. Manually record the payment in DataForce. Do not collect the booking fee again.'
    : 'No booking fee has been confirmed as received at the time of this email. Call the customer and collect the $33.00 booking fee before confirming the booking. Check GoHighLevel for any payment made after this email.';
  const html = payload.html
    .replace(/<!-- BOOKING_PAYMENT_STATUS -->[\s\S]*?<!-- \/BOOKING_PAYMENT_STATUS -->/, bookingFeeNotice({ received }))
    .replace(/<!-- BOOKING_NEXT_STEP -->[\s\S]*?<!-- \/BOOKING_NEXT_STEP -->/, `<strong>${nextStep}</strong>`);
  return {
    from: 'Goldsure Quotes <info@goldsure.com.au>', to: STAFF,
    subject: `Quote Accepted | ${received ? '$33 RECEIVED' : '$33 NOT RECEIVED'} | ${payload.customer_name} | ${payload.total}`,
    html,
  };
}

export async function dispatchAcceptanceEmails({ fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const { base, headers } = database(env);
  if (!env.RESEND_API_KEY) throw new Error('Acceptance email provider is not configured');
  const nowIso = now.toISOString();
  const dueFilter = `sent_at=is.null&due_at=lte.${nowIso}&or=(locked_until.is.null,locked_until.lt.${nowIso})`;
  const dueResponse = await fetchImpl(`${base}/${QUEUE}?select=*&${dueFilter}&order=due_at.asc&limit=20`, { headers });
  if (!dueResponse.ok) throw new Error(`Could not load due notifications (${dueResponse.status})`);
  const due = await dueResponse.json();
  const result = { sent: 0, skipped: 0, failed: 0 };
  for (const item of due) {
    const lockToken = crypto.randomUUID();
    const rowFilter = `quote_token=eq.${encodeURIComponent(item.quote_token)}`;
    const rowUrl = `${base}/${QUEUE}?${rowFilter}`;
    const claim = await fetchImpl(`${rowUrl}&${dueFilter}`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ lock_token: lockToken, locked_until: new Date(now.getTime() + 5 * 60000).toISOString() }),
    });
    if (!claim.ok) { result.failed++; continue; }
    const [claimed] = await claim.json();
    if (!claimed) { result.skipped++; continue; }
    const lockedUrl = `${rowUrl}&lock_token=eq.${lockToken}&sent_at=is.null`;
    try {
      let delivery = claimed.delivery;
      if (!delivery) {
        const quoteResponse = await fetchImpl(`${base}/quote_emails?quote_token=eq.${encodeURIComponent(item.quote_token)}&select=*&limit=1`, { headers });
        if (!quoteResponse.ok) throw new Error(`Payment status lookup failed (${quoteResponse.status})`);
        const [quote] = await quoteResponse.json();
        if (!quote?.accepted_at) throw new Error('Quote acceptance could not be verified');
        delivery = renderAcceptanceEmail(claimed.payload, quote);
        // Freeze the exact message before sending, so retries use the same
        // provider idempotency key and payload even if payment arrives later.
        const frozen = await fetchImpl(lockedUrl, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ delivery }),
        });
        if (!frozen.ok || !(await frozen.json()).length) throw new Error('Could not store email delivery');
      }
      const sent = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `smoke-acceptance-${item.quote_token}` },
        body: JSON.stringify(delivery),
      });
      if (!sent.ok) throw new Error(`Email provider failed (${sent.status})`);
      const stamped = await fetchImpl(lockedUrl, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ sent_at: nowIso, locked_until: null, lock_token: null, last_error: null }),
      });
      if (!stamped.ok || !(await stamped.json()).length) throw new Error('Could not record email delivery');
      result.sent++;
    } catch (error) {
      result.failed++;
      console.error('[Smoke acceptance email]', error.message);
      await fetchImpl(lockedUrl, {
        method: 'PATCH', headers,
        body: JSON.stringify({ locked_until: null, lock_token: null, last_error: error.message }),
      }).catch(() => {});
    }
  }
  return result;
}
