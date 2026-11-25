
import { BOOKING_FEE_CENTS, isValidQuoteToken, verifyStripeSignature } from '../../lib/smoke-stripe.js';

import { syncSmokeBookingPaymentNote, syncAcceptedQuoteStage } from '../../lib/ghl-smoke-alarm-stage.js';
import { queuePaymentCorrection } from '../../lib/smoke-acceptance-notifications.js';

// Stripe needs the exact raw body to verify the signature.
export const config = { api: { bodyParser: false } };

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

  if (!headers) return res.status(503).json({ error: 'Payment database is not configured.' });
  try {
    if (headers) {
      // Preserve the first confirmed payment stamp across Stripe retries.
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
      if (!mark.ok) throw new Error(`Could not record payment (${mark.status})`);
    }
  } catch (error) {
    console.error('[Smoke Stripe] Quote update failed', error.message);
    return res.status(500).json({ error: 'Could not record payment; retry required.' });
  }

  // The durable worker sends a correction only if the original email was unpaid.
  try {
    await queuePaymentCorrection({ quoteToken: token });
  } catch (error) {
    console.error('[Smoke Stripe] Payment correction queue failed', error.message);
    return res.status(500).json({ error: 'Payment recorded; notification queue needs retry.' });
  }

  // Retry the GHL payment note even when an earlier delivery recorded payment.
  let paymentNote;
  try {
    paymentNote = await syncSmokeBookingPaymentNote({ quoteToken: token, checkoutSessionId: session.id });
  } catch (error) {
    console.error('[Smoke Stripe] GHL payment note failed', error.message);
    paymentNote = { synced: false, reason: 'ghl-note-failed-network' };
  }

  if (!paymentNote.synced) {
    console.error('[Smoke Stripe] GHL payment note needs retry', paymentNote.reason);
    return res.status(500).json({ error: 'Payment recorded; GHL payment note needs retry.' });
  }
  // Recheck the opportunity after payment, including customers who paid later
  // through a reminder link. Reuse the stage-only sync to avoid duplicate notes.
  let paymentStage;
  try {
    paymentStage = await syncAcceptedQuoteStage({
      quoteToken: token, quoteTable: 'quote_emails', pipelineNames: ['Smoke Alarms'],
      pipelineId: process.env.SMOKE_ALARMS_PIPELINE_ID,
      stageId: process.env.SMOKE_ALARMS_QUOTE_ACCEPTED_STAGE_ID,
    });
  } catch (error) {
    console.error('[Smoke Stripe] GHL paid stage failed', error.message);
    paymentStage = { moved: false, reason: 'ghl-stage-failed-network' };
  }
  if (!paymentStage.moved && paymentStage.reason !== 'already-in-quote-accepted') {
    console.error('[Smoke Stripe] GHL paid stage needs retry', paymentStage.reason);
    return res.status(500).json({ error: 'Payment recorded; GHL Quote Accepted stage needs retry.' });
  }
  return res.status(200).json({ received: true, ghl_payment_note_synced: true, ghl_quote_accepted_synced: true });
}

