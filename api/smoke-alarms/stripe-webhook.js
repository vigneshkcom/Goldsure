import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { BOOKING_FEE_CENTS, isValidQuoteToken, verifyStripeSignature } from '../../lib/smoke-stripe.js';
import { bookingFeeNotice } from '../../lib/smoke-booking-notice.js';

// Stripe needs the exact raw body to verify the signature.
export const config = { api: { bodyParser: false } };

const STAFF = [
  'shanira@goldsure.com.au',
  'david@goldsure.com.au',
  'alda@goldsure.com.au',
  'vignesh@goldsure.com.au',
];

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) return res.status(503).json({ error: 'Stripe webhook is not configured.' });

  const raw = await readRawBody(req);
  if (!verifyStripeSignature(raw, req.headers['stripe-signature'], secret)) {
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'Invalid payload.' }); }

  // Only a completed, paid booking-fee checkout matters. Everything else is acknowledged.
  const session = event?.data?.object;
  const paidEvent = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type);
  if (!paidEvent || session?.payment_status !== 'paid' || session?.metadata?.purpose !== 'smoke-booking-fee') {
    return res.status(200).json({ received: true, ignored: true });
  }
  const token = session.metadata?.quote_token || session.client_reference_id;
  if (!isValidQuoteToken(token) || session.amount_total !== BOOKING_FEE_CENTS || String(session.currency).toLowerCase() !== 'aud') {
    console.error('[Smoke Stripe] Unexpected paid session', session?.id, session?.amount_total);
    return res.status(200).json({ received: true, ignored: true });
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const headers = base && key ? { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } : null;
  const rowUrl = headers ? `${base}/rest/v1/quote_emails?quote_token=eq.${encodeURIComponent(token)}` : '';

  let quote = null;
  let firstNotification = true;
  try {
    if (headers) {
      const lookup = await fetch(`${rowUrl}&select=*&limit=1`, { headers });
      if (lookup.ok) [quote] = await lookup.json();
      // Dedupe Stripe retries: only the first write that finds no paid stamp notifies staff.
      // Needs the columns from supabase/migrations/20261124000000_smoke_booking_fee_payment.sql.
      const mark = await fetch(`${rowUrl}&booking_fee_paid_at=is.null`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          booking_fee_paid_at: new Date().toISOString(),
          booking_fee_amount: session.amount_total / 100,
          stripe_checkout_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent || null,
        }),
      });
      if (mark.ok) firstNotification = (await mark.json()).length > 0;
      else console.error('[Smoke Stripe] Could not record payment on quote', mark.status);
    }
  } catch (error) {
    console.error('[Smoke Stripe] Quote update failed', error.message);
  }

  if (firstNotification) {
    const name = quote?.customer_name || session.metadata?.customer_name || session.customer_details?.name || 'Customer';
    const phone = quote?.customer_phone || session.customer_details?.phone || '—';
    const email = quote?.customer_email || session.customer_details?.email || '—';
    const subject = `Quote Accepted | $33 RECEIVED | ${name}`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#141c2e;max-width:560px">
  ${bookingFeeNotice({ received: true })}
  <h2 style="margin:0 0 12px">Quote accepted: ${escapeHtml(name)}</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.6">Smoke alarm booking fee received online via Stripe. <strong>Call the customer to agree installation dates.</strong></p>
  <table cellpadding="8" style="border:1px solid #e3e7ef;border-collapse:collapse;font-size:13px">
    <tr><td style="background:#f0f2f5">Customer</td><td>${escapeHtml(name)}</td></tr>
    <tr><td style="background:#f0f2f5">Phone</td><td>${escapeHtml(phone)}</td></tr>
    <tr><td style="background:#f0f2f5">Email</td><td>${escapeHtml(email)}</td></tr>
    <tr><td style="background:#f0f2f5">Address</td><td>${escapeHtml(quote?.customer_address || '—')}</td></tr>
    <tr><td style="background:#f0f2f5">Alarms</td><td>${escapeHtml(quote?.alarm_qty ?? '—')}</td></tr>
    <tr><td style="background:#f0f2f5">Quote total</td><td>${escapeHtml(quote?.grand_total_numeric ?? quote?.grand_total ?? '—')}</td></tr>
    <tr><td style="background:#f0f2f5">Amount paid</td><td><strong>$33.00 AUD</strong></td></tr>
    <tr><td style="background:#f0f2f5">Stripe payment</td><td>${escapeHtml(session.payment_intent || session.id)}</td></tr>
  </table></div>`;
    try {
      await sendHostingerMail({ to: STAFF, displayName: 'Goldsure Quotes', subject, html });
    } catch (hostErr) {
      console.error('[Smoke Stripe] Hostinger failed, falling back to Resend:', hostErr.message);
      const fallback = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Goldsure Quotes <info@goldsure.com.au>', to: STAFF, subject, html }),
      }).catch(() => null);
      if (!fallback?.ok) {
        // Clear the paid stamp so Stripe's retry (triggered by the 500) notifies staff.
        if (headers) {
          await fetch(rowUrl, { method: 'PATCH', headers, body: JSON.stringify({ booking_fee_paid_at: null }) }).catch(() => null);
        }
        return res.status(500).json({ error: 'Notification failed.' });
      }
    }
  }
  return res.status(200).json({ received: true });
}

