-- Run once in the Supabase SQL editor for project yxgdixwneprhjxzdlaqw
-- (same project already used by quote_emails etc.) to enable logging + the
-- admin log view for /smoke-alarms/staff-assessment.html

create table if not exists staff_assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  role text not null default 'Staff',
  status text not null default 'in_progress', -- in_progress | completed | timed_out | locked_out
  correct int,
  total int,
  score_pct int,
  passed boolean,
  violation_count int not null default 0,
  user_agent text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists staff_assessment_violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references staff_assessment_attempts(id) on delete set null,
  agent_name text,
  violation_type text not null, -- tab_switch | window_blur | fullscreen_exit | devtools_shortcut | copy_shortcut
  detail text,
  occurred_at timestamptz not null default now()
);

alter table staff_assessment_attempts enable row level security;
alter table staff_assessment_violations enable row level security;

-- The quiz page talks to Supabase directly from the browser with the public
-- "publishable" key (same pattern as quote_emails elsewhere in this repo).
-- INSERT/UPDATE let it log attempts and violations as they happen. SELECT is
-- also granted here because the built-in Admin Log view (PIN-gated in the
-- page itself) reads straight from the browser too — there is no backend
-- for it. That PIN is a UI gate only, not real security: anyone who reads
-- the page's JS can call this endpoint directly with the same key. Treat
-- this table as no more protected than the PIN itself; it holds staff names,
-- scores, and violation timestamps — nothing more sensitive than that.

create policy "anon can insert attempts" on staff_assessment_attempts
  for insert to anon with check (true);

create policy "anon can update own attempts" on staff_assessment_attempts
  for update to anon using (true) with check (true);

create policy "anon can read attempts" on staff_assessment_attempts
  for select to anon using (true);

create policy "anon can insert violations" on staff_assessment_violations
  for insert to anon with check (true);

create policy "anon can read violations" on staff_assessment_violations
  for select to anon using (true);

-- Superseded tables from the earlier "Call Centre Pressure Test" page (now
-- merged into this one). Drop them only if you're sure nothing else needs
-- that history — this is NOT run automatically:
-- drop table if exists call_centre_quiz_violations;
-- drop table if exists call_centre_quiz_attempts;
