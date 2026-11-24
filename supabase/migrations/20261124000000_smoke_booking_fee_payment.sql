-- Records the $33 smoke alarm booking fee paid online through Stripe Checkout.
ALTER TABLE public.quote_emails
  ADD COLUMN IF NOT EXISTS booking_fee_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
