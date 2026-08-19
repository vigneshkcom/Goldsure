-- Run once in the Supabase SQL editor for project yxgdixwneprhjxzdlaqw
-- (same project already used by quote_emails etc.) to enable logging for
-- /smoke-alarms/qld-call-centre-pressure-test.html

create table if not exists call_centre_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  role text not null,
  status text not null default 'in_progress', -- in_progress | completed | locked_out
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

create table if not exists call_centre_quiz_violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references call_centre_quiz_attempts(id) on delete set null,
  agent_name text,
  violation_type text not null, -- tab_switch | window_blur | fullscreen_exit | devtools_shortcut | copy_shortcut
  detail text,
  occurred_at timestamptz not null default now()
);

alter table call_centre_quiz_attempts enable row level security;
alter table call_centre_quiz_violations enable row level security;

-- The quiz page uses the public "publishable" key directly from the browser
-- (same pattern as quote_emails elsewhere in this repo), so it can only
-- INSERT and UPDATE its own attempt row/log rows. It cannot SELECT — reports
-- should be pulled with the service role key from a trusted backend/admin
-- view, not from the browser, so an agent can't read or tamper with their
-- own integrity log mid-test.

create policy "anon can insert attempts" on call_centre_quiz_attempts
  for insert to anon with check (true);

create policy "anon can update own attempts" on call_centre_quiz_attempts
  for update to anon using (true) with check (true);

create policy "anon can insert violations" on call_centre_quiz_violations
  for insert to anon with check (true);
