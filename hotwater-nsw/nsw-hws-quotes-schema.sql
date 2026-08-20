-- NSW Hot Water Quote Builder — Supabase schema
-- Run this once in the Supabase SQL editor for the Goldsure portal project.
-- Mirrors the existing hotwater_quotes / aircon_jobs tables in shape and
-- conventions (quote_token as the public lookup key, status as free text,
-- RLS disabled — the API key already scopes access via the serverless functions).

CREATE TABLE nsw_hws_quotes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_token text UNIQUE NOT NULL,

  -- Ownership / lifecycle
  agent_name text,
  status text NOT NULL DEFAULT 'sent',
  -- sent | accepted | rejected | installed — same lifecycle as hotwater_quotes.
  -- Rows only exist once a quote has actually been sent; there are no drafts.

  -- Customer
  customer_name text,
  customer_phone text,
  customer_email text,
  property_address text,

  -- Existing system
  existing_system text,          -- electric | gas | solar_boosted
  activity_code text,            -- D17 (electric), D19 (gas); blank/NULL for solar (no HEER code)

  -- Selected heat pump
  heat_pump_model text,          -- 290-all-in-one | 290-split | 330-split

  -- Installation / relocation
  tank_staying boolean,          -- true = staying in existing location
  relocation_type text,          -- back_to_back | standard | null
  relocation_metres numeric DEFAULT 0,
  relocation_charge numeric DEFAULT 0,
  back_to_back_charge numeric DEFAULT 0,

  -- Gas-to-electric cabling
  cable_metres numeric DEFAULT 0,
  cable_chargeable_metres numeric DEFAULT 0,
  cable_charge numeric DEFAULT 0,

  -- Other manually-added extras (plumbing/electrical items not yet coded), e.g.
  -- [{"label":"Switchboard upgrade","amount":250}]
  other_extras jsonb DEFAULT '[]'::jsonb,

  -- Pricing
  base_price numeric DEFAULT 0,
  total_extras numeric DEFAULT 0,
  -- $200 waived when the customer pays up front instead of financing
  no_finance_discount numeric DEFAULT 0,
  final_price numeric DEFAULT 0,

  -- Finance
  finance_requested boolean DEFAULT false,
  income_eligible text,          -- yes | no | needs_confirmation
  finance_eligibility text,      -- not_eligible | potentially_eligible | n_a
  finance_term_years integer DEFAULT 10,
  -- $220 NSW scheme co-payment, taken up front; Brighte finances the balance
  deposit_amount numeric DEFAULT 0,
  amount_financed numeric DEFAULT 0,
  fortnightly_repayment numeric DEFAULT 0,
  monthly_repayment numeric DEFAULT 0,

  -- Send tracking
  sent_at timestamptz,
  reminder_count integer DEFAULT 0,
  last_reminder_sent_at timestamptz,
  accepted boolean DEFAULT false,
  accepted_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX ON nsw_hws_quotes (quote_token);
CREATE INDEX ON nsw_hws_quotes (status);
CREATE INDEX ON nsw_hws_quotes (created_at);
ALTER TABLE nsw_hws_quotes DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration for an install created before the draft workflow was removed.
-- Quotes are now only written when they are sent, matching the VIC hot water
-- flow, so the status vocabulary is sent/accepted/rejected/installed and any
-- leftover drafts should go.
-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE FROM nsw_hws_quotes WHERE status = 'draft';
-- ALTER TABLE nsw_hws_quotes ALTER COLUMN status SET DEFAULT 'sent';

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: the no-finance discount column. REQUIRED on an existing install —
-- the send endpoint writes this field, and Supabase rejects the whole insert if
-- the column is missing, so quotes will fail to send until this is run.
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE nsw_hws_quotes ADD COLUMN IF NOT EXISTS no_finance_discount numeric DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: deposit + financed amount. REQUIRED on an existing install — the
-- send endpoint writes both fields, and Supabase rejects the whole insert if a
-- column is missing, so quotes will fail to send until this is run.
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE nsw_hws_quotes ADD COLUMN IF NOT EXISTS deposit_amount  numeric DEFAULT 0;
-- ALTER TABLE nsw_hws_quotes ADD COLUMN IF NOT EXISTS amount_financed numeric DEFAULT 0;
