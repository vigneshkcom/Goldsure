-- Run once in the Supabase SQL editor for project yxgdixwneprhjxzdlaqw
-- (same project already used by aircon_quotes, quote_emails etc.)
-- Backs the board at /aircons/job-tracker.html
--
-- Safe to re-run, and safe to run over the earlier draft of this file — the
-- alter/drop-policy steps below bring an existing table up to the current
-- shape rather than assuming a clean slate.

create table if not exists aircon_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text,
  customer text not null,
  address text,
  booked_date date,
  amount_received numeric(12,2),
  bpoint_ref text,
  status text not null default 'to_book',   -- to_book | scheduled | installed
  notes text,
  cancelled boolean not null default false,
  -- Sort order inside a column. Doubles (not ints) so dropping a card between
  -- two others is a single UPDATE to the midpoint instead of renumbering the
  -- whole column.
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Upgrade path, only does anything if you ran the first draft ────────────
alter table aircon_jobs add column if not exists booked_date date;

-- The old draft had installation_date + ac_assessment_date. Installation date
-- becomes the booked date; the assessment date and the derived "days to
-- install" are gone. This copies the values across before the columns drop.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'aircon_jobs' and column_name = 'installation_date') then
    update aircon_jobs set booked_date = installation_date where booked_date is null;
  end if;
end $$;

alter table aircon_jobs drop column if exists installation_date;
alter table aircon_jobs drop column if exists ac_assessment_date;

-- Old five-stage statuses collapse onto the three board groups.
update aircon_jobs set status = 'installed' where status in ('completed','complete','done');
update aircon_jobs set status = 'scheduled' where status in ('assigned','overdue_assigned');
update aircon_jobs set status = 'to_book'   where status in ('date_pending','pending');

create index if not exists aircon_jobs_status_position_idx
  on aircon_jobs (status, position);

alter table aircon_jobs enable row level security;

-- The board talks to Supabase straight from the browser with the public
-- "publishable" key — the same pattern as aircon_quotes and the other trackers
-- in this portal. There is no backend in front of it, so the anon role needs
-- all four verbs: select to load the board, insert to add a job, update to
-- drag a card or edit it, delete to remove one.
--
-- Worth being clear-eyed about: this means anyone who can reach the page can
-- also read and write this table directly. That is already true of every other
-- tracker here, and this table holds the same class of data (customer names,
-- addresses, amounts) — but if you ever want it properly locked down, the fix
-- is to put these reads/writes behind an /api route using the service-role key
-- and drop these policies, not to rely on the page being unlisted.

drop policy if exists "anon can read aircon jobs"   on aircon_jobs;
drop policy if exists "anon can insert aircon jobs" on aircon_jobs;
drop policy if exists "anon can update aircon jobs" on aircon_jobs;
drop policy if exists "anon can delete aircon jobs" on aircon_jobs;

create policy "anon can read aircon jobs" on aircon_jobs
  for select to anon using (true);

create policy "anon can insert aircon jobs" on aircon_jobs
  for insert to anon with check (true);

create policy "anon can update aircon jobs" on aircon_jobs
  for update to anon using (true) with check (true);

create policy "anon can delete aircon jobs" on aircon_jobs
  for delete to anon using (true);
