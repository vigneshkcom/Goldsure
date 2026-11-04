-- A new time or assessor gets a new reminder; concurrent cron runs share a claim.
create table public.battery_iha_reminder_runs (
  booking_id uuid not null references public.battery_iha_bookings(id) on delete cascade,
  starts_at timestamptz not null,
  assessor_id uuid not null references public.battery_iha_assessors(id) on delete cascade,
  status text not null default 'sending' check (status in ('sending', 'sent', 'uncertain')),
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (booking_id, starts_at, assessor_id)
);
alter table public.battery_iha_reminder_runs enable row level security;
revoke all on public.battery_iha_reminder_runs from public, anon, authenticated;
grant select, insert, update, delete on public.battery_iha_reminder_runs to service_role;
