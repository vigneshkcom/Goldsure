create table if not exists public.smoke_calculator_bookings (
  quote_token text primary key references public.quote_emails(quote_token),
  lead_token text not null unique,
  lead_id uuid not null,
  dataforce_job_id bigint,
  dataforce_appointment_id bigint,
  ghl_accepted_at timestamptz,
  landing_synced_at timestamptz,
  sync_error text,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  email_status text not null default 'pending',
  sms_status text not null default 'pending',
  request_error text,
  lock_token uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.smoke_calculator_bookings enable row level security;
revoke all on public.smoke_calculator_bookings from public, anon, authenticated;
grant select,insert,update,delete on public.smoke_calculator_bookings to service_role;
