-- Goldsure team task board.
-- Safe to re-run: creates the table on a fresh project and migrates an
-- existing one (open/completed -> todo/followup/done, adds due_time).

create extension if not exists pgcrypto;

create table if not exists public.portal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 180),
  description text not null default '',
  assignee text not null check (assignee in ('Vignesh','David','Shanira','Alda','Amit')),
  due_date date not null,
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  status text not null default 'todo',
  created_by text not null check (created_by in ('Vignesh','David','Shanira','Alda','Amit')),
  completed_by text check (completed_by is null or completed_by in ('Vignesh','David','Shanira','Alda','Amit')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- ── Columns added after the first release ──────────────────────────────────
-- due_time is the optional wall-clock time in Australia/Sydney. A task with a
-- due_time gets its own reminder email at that time; one without is covered by
-- the daily digest only.
alter table public.portal_tasks add column if not exists due_time time;
-- Stamped once the timed reminder for the current due date/time has been sent,
-- so the 15-minute cron cannot email the same task twice.
alter table public.portal_tasks add column if not exists reminder_sent_at timestamptz;

-- ── Linked GHL customer (optional) ─────────────────────────────────────────
-- Picked from the GHL contact search when the task is created. The URL is
-- built server-side so the board never needs the GHL location id.
alter table public.portal_tasks add column if not exists ghl_contact_id text;
alter table public.portal_tasks add column if not exists ghl_contact_url text;
alter table public.portal_tasks add column if not exists customer_name text;
alter table public.portal_tasks add column if not exists customer_phone text;
alter table public.portal_tasks add column if not exists customer_email text;

-- ── Status model: open/completed -> todo/followup/done ─────────────────────
-- Drop the constraint before rewriting values, then re-add it.
alter table public.portal_tasks drop constraint if exists portal_tasks_status_check;
update public.portal_tasks set status = 'todo' where status = 'open';
update public.portal_tasks set status = 'done' where status = 'completed';
alter table public.portal_tasks alter column status set default 'todo';
alter table public.portal_tasks
  add constraint portal_tasks_status_check check (status in ('todo','followup','done'));

-- ── Indexes ────────────────────────────────────────────────────────────────
drop index if exists public.portal_tasks_open_due_idx;
create index if not exists portal_tasks_status_due_idx
  on public.portal_tasks (status, due_date) where archived_at is null;
create index if not exists portal_tasks_assignee_idx
  on public.portal_tasks (assignee, status) where archived_at is null;
-- Supports the 15-minute reminder sweep.
create index if not exists portal_tasks_reminder_idx
  on public.portal_tasks (due_date, due_time)
  where archived_at is null and reminder_sent_at is null and due_time is not null;

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

-- ── Row level security ─────────────────────────────────────────────────────
-- NOTE: these policies are permissive because the board authenticates by a
-- name picker, not a Supabase session. The manager/employee split in the UI is
-- a view filter, not a security boundary. Anyone holding the publishable key
-- can read and write every row. Tighten this with Supabase Auth if the board
-- ever holds anything sensitive.
alter table public.portal_tasks enable row level security;
drop policy if exists "portal staff can read tasks" on public.portal_tasks;
drop policy if exists "portal staff can create tasks" on public.portal_tasks;
drop policy if exists "portal staff can update tasks" on public.portal_tasks;
create policy "portal staff can read tasks" on public.portal_tasks for select using (true);
create policy "portal staff can create tasks" on public.portal_tasks for insert with check (true);
create policy "portal staff can update tasks" on public.portal_tasks for update using (true) with check (true);
grant select, insert, update on public.portal_tasks to anon, authenticated;

-- ── Notes left on a task ───────────────────────────────────────────────────
-- A running thread per task, newest shown last. Deleting a task removes its
-- notes with it.
create table if not exists public.portal_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.portal_tasks(id) on delete cascade,
  author text not null check (author in ('Vignesh','David','Shanira','Alda','Amit')),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.portal_task_notes
  add column if not exists updated_at timestamptz not null default now();

create index if not exists portal_task_notes_task_idx
  on public.portal_task_notes (task_id, created_at);

create or replace function public.set_portal_task_note_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists portal_task_notes_updated_at on public.portal_task_notes;
create trigger portal_task_notes_updated_at
before update on public.portal_task_notes
for each row execute function public.set_portal_task_note_updated_at();

alter table public.portal_task_notes enable row level security;
drop policy if exists "portal staff can read notes" on public.portal_task_notes;
drop policy if exists "portal staff can create notes" on public.portal_task_notes;
drop policy if exists "portal staff can update notes" on public.portal_task_notes;
drop policy if exists "portal staff can delete notes" on public.portal_task_notes;
create policy "portal staff can read notes" on public.portal_task_notes for select using (true);
create policy "portal staff can create notes" on public.portal_task_notes for insert with check (true);
create policy "portal staff can update notes" on public.portal_task_notes for update using (true) with check (true);
create policy "portal staff can delete notes" on public.portal_task_notes for delete using (true);
grant select, insert, update, delete on public.portal_task_notes to anon, authenticated;

-- ── Daily digest run log (service role only) ───────────────────────────────
create table if not exists public.portal_task_digest_runs (
  digest_date date primary key,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  task_count integer not null default 0
);

alter table public.portal_task_digest_runs enable row level security;
revoke all on public.portal_task_digest_runs from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
