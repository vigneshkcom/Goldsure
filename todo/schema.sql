create extension if not exists pgcrypto;

create table if not exists public.portal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '',
  assignee text not null check (assignee in ('Vignesh','David','Shanira','Alda','Amit')),
  due_date date not null,
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status text not null default 'open' check (status in ('open','completed')),
  created_by text not null check (created_by in ('Vignesh','David','Shanira','Alda','Amit')),
  completed_by text check (completed_by is null or completed_by in ('Vignesh','David','Shanira','Alda','Amit')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists portal_tasks_open_due_idx
  on public.portal_tasks (status, due_date) where archived_at is null;
create index if not exists portal_tasks_assignee_idx
  on public.portal_tasks (assignee, status) where archived_at is null;

create or replace function public.set_portal_task_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portal_tasks_updated_at on public.portal_tasks;
create trigger portal_tasks_updated_at
before update on public.portal_tasks
for each row execute function public.set_portal_task_updated_at();

alter table public.portal_tasks enable row level security;
drop policy if exists "portal staff can read tasks" on public.portal_tasks;
drop policy if exists "portal staff can create tasks" on public.portal_tasks;
drop policy if exists "portal staff can update tasks" on public.portal_tasks;
create policy "portal staff can read tasks" on public.portal_tasks for select using (true);
create policy "portal staff can create tasks" on public.portal_tasks for insert with check (true);
create policy "portal staff can update tasks" on public.portal_tasks for update using (true) with check (true);
grant select, insert, update on public.portal_tasks to anon, authenticated;

create table if not exists public.portal_task_digest_runs (
  digest_date date primary key,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  task_count integer not null default 0
);

alter table public.portal_task_digest_runs enable row level security;
revoke all on public.portal_task_digest_runs from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
