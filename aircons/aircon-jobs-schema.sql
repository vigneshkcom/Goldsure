-- Creates the aircon_jobs table backing /aircons/job-tracker.html
-- Run once in the Supabase SQL editor for project yxgdixwneprhjxzdlaqw
-- (same project already used by aircon_quotes, quote_emails etc.)
--
-- Clean create for a fresh/empty database — this does not need to migrate
-- anything, so it's just the table, an index, and RLS policies.

create table aircon_jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text,
  customer text not null,
  address text,
  booked_date date,
  out_of_pocket numeric(12,2),              -- total the customer owes
  deposit numeric(12,2),                    -- what they have paid so far
  -- Pending balance is deliberately NOT stored here — the board always
  -- shows out_of_pocket − deposit, so the three figures can never disagree.
  comments text,
  status text not null default 'to_book',   -- to_book | scheduled | installed
  cancelled boolean not null default false,
  -- Sort order inside a group. A double (not an int) so dropping a row
  -- between two others is one UPDATE to the midpoint, never a renumber of
  -- the whole group.
  position double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index aircon_jobs_status_position_idx on aircon_jobs (status, position);

alter table aircon_jobs enable row level security;

-- The board talks to Supabase straight from the browser with the public
-- "publishable" key — the same pattern as aircon_quotes and the other
-- trackers in this portal. There is no backend in front of it, so the anon
-- role needs all four verbs: select to load the board, insert to add a job,
-- update to drag a card or edit it, delete to remove one.
--
-- Worth being clear-eyed about: this means anyone who can reach the page can
-- also read and write this table directly, and — since this page is shared
-- externally — anyone who reads its JavaScript has this same key. If that
-- needs locking down, the fix is an /api route using the service-role key
-- with these policies removed, not relying on the page being unlisted.

create policy "anon can read aircon jobs" on aircon_jobs
  for select to anon using (true);

create policy "anon can insert aircon jobs" on aircon_jobs
  for insert to anon with check (true);

create policy "anon can update aircon jobs" on aircon_jobs
  for update to anon using (true) with check (true);

create policy "anon can delete aircon jobs" on aircon_jobs
  for delete to anon using (true);

-- ── Eco Comments ─────────────────────────────────────────────────────────
-- A second, unlocked comment column alongside `comments` (now labelled
-- "Goldsure Comments" in the UI and gated behind a password there — the gate
-- is UI-only, since the anon key above can already write either column
-- directly). Anyone with the tracker link can add an Eco Comment; doing so
-- also emails vignesh@goldsure.com.au via the existing Hostinger integration.
-- Run this once against an existing database — it's a no-op if already applied.
alter table aircon_jobs add column if not exists eco_comments text;
