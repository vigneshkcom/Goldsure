-- Battery customer email campaign tracking. Applied to goldsure-calendar on 12 Oct 2026.
create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  tracking_token uuid not null unique default gen_random_uuid(),
  email text not null,
  first_name text,
  last_name text,
  phone text,
  job_id text,
  delivery_status text not null default 'pending',
  provider_message_id text,
  send_error text,
  sent_at timestamptz,
  opened_at timestamptz,
  open_count integer not null default 0,
  clicked_at timestamptz,
  click_count integer not null default 0,
  unsubscribed_at timestamptz,
  callback_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email)
);

create table if not exists public.email_campaign_events (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.email_campaign_recipients(id) on delete cascade,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);

create index if not exists email_campaign_recipients_campaign_idx on public.email_campaign_recipients (campaign_id, delivery_status);
create index if not exists email_campaign_recipients_tracking_idx on public.email_campaign_recipients (tracking_token);
create index if not exists email_campaign_events_recipient_idx on public.email_campaign_events (recipient_id, occurred_at desc);

alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;
alter table public.email_campaign_events enable row level security;

insert into public.email_campaigns (slug, name, description, status)
values ('vic-battery-existing-customers-2026', 'VIC Battery - Existing Customers', 'Battery campaign for prior HWS and air-conditioning customers.', 'draft')
on conflict (slug) do update set name = excluded.name, description = excluded.description, updated_at = now();
