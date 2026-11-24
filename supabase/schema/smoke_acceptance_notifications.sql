create table if not exists public.smoke_acceptance_notifications (
  quote_token text primary key,
  due_at timestamptz not null,
  payload jsonb not null,
  delivery jsonb,
  sent_at timestamptz,
  locked_until timestamptz,
  lock_token uuid,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists smoke_acceptance_notifications_due_idx
  on public.smoke_acceptance_notifications (due_at) where sent_at is null;
alter table public.smoke_acceptance_notifications enable row level security;
revoke all on public.smoke_acceptance_notifications from public, anon, authenticated;
grant select, insert, update, delete on public.smoke_acceptance_notifications to service_role;
