# Time Tracker

Agent **clock in / clock out** with a weekly timesheet, for the Goldsure team.

- **UI:** `/time/` — big Clock In/Out button, live "on the clock" timer, weekly timesheet, CSV export
- **API:** `/api/smoke-alarms/reports` — `POST { time: { action, agent, ... } }` (shares the reports function to stay under Vercel's 12-function limit; it replaced the old commission route)
- **Storage:** Supabase table `time_entries` (an open shift = `clock_out IS NULL`)

## How it works

The clock state lives in **Supabase, not the browser** — so an agent can Clock In,
then close the tab / shut the laptop / switch to their phone, and the shift keeps
running. Reopening `/time/` reads the open shift back and shows a live timer
computed from the stored start time. **No tab needs to stay open.**

On open, a **"Who's clocking in?"** picker asks the agent to select their name
(**David** or **Shanira**); the choice is remembered per browser and the top-bar
chip switches agents. Hours = `clock_out − clock_in`; an open shift counts up to
"now". (To change the agent list, edit the `AGENTS` array in `time/index.html`.)

## Required Supabase table

Run once in **Supabase → SQL Editor**:

```sql
CREATE TABLE time_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent text NOT NULL,
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz,
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON time_entries (agent, clock_in);
ALTER TABLE time_entries DISABLE ROW LEVEL SECURITY;
```

> Editing/deleting a shift uses `SUPABASE_SERVICE_ROLE_KEY` if set (it bypasses
> Row Level Security); otherwise it falls back to the anon key, which only works
> while RLS is off.

## API actions (`POST { time: {...} }`)

| Request | Purpose |
|---------|---------|
| `{ action:'status', agent }` | The agent's current open shift, or `null` |
| `{ action:'clock-in', agent }` | Open a shift now (returns the existing open one if already clocked in) |
| `{ action:'clock-out', agent }` | Close the agent's open shift |
| `{ action:'list', agent }` | All shifts for the agent (the page groups them into Mon–Sun weeks) |
| `{ action:'update', id, clock_in?, clock_out?, note? }` | Fix a wrong or forgotten time |
| `{ action:'delete', id }` | Remove a shift entry |

## Forgotten clock-out

If someone forgets to clock out, the shift shows **"In progress"** and, after 18h,
a **"forgot to clock out?"** flag. Use **Stop** (clock out now) or **Edit** (set the
correct clock-out time) on that row — nothing is lost.
