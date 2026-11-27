create table if not exists public.electrician_schedule_cache (
 id text primary key, payload jsonb not null default '{}'::jsonb,
 lease_token text, locked_until timestamptz, next_attempt_at timestamptz,
 failures integer not null default 0, last_error text, updated_at timestamptz
);
alter table public.electrician_schedule_cache enable row level security;
revoke all on public.electrician_schedule_cache from public, anon, authenticated;
grant select,insert,update on public.electrician_schedule_cache to service_role;
insert into public.electrician_schedule_cache(id) values ('dataforce') on conflict do nothing;
create or replace function public.claim_electrician_schedule_sync(p_token text)
returns setof public.electrician_schedule_cache language sql set search_path = public as $$
 update public.electrician_schedule_cache set lease_token=p_token, locked_until=now()+interval '120 seconds'
 where id='dataforce' and (locked_until is null or locked_until<now())
 and (next_attempt_at is null or next_attempt_at<=now()) returning *;
$$;
revoke all on function public.claim_electrician_schedule_sync(text) from public,anon,authenticated;
grant execute on function public.claim_electrician_schedule_sync(text) to service_role;
