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
  status text NOT NULL DEFAULT 'draft',
  -- Suggested values: draft, quote_ready, quote_sent, customer_reviewing,
  -- follow_up, accepted, declined, finance_pending, finance_approved, booked

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
  final_price numeric DEFAULT 0,

  -- Finance
  finance_requested boolean DEFAULT false,
  income_eligible text,          -- yes | no | needs_confirmation
  finance_eligibility text,      -- not_eligible | potentially_eligible | n_a
  finance_term_years integer DEFAULT 10,
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
