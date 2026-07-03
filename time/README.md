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

## Access control (private per agent)

Each agent's data is **private** — enforced on the server, so one agent can't load
another's hours even by calling the API directly. Set these in **Vercel → Environment
Variables**:

| Variable | Example | Purpose |
|----------|---------|---------|
| `TIME_AGENT_PINS` | `{"David":"1111","Shanira":"2222"}` | Per-agent PINs (JSON). An agent's PIN only ever returns their own entries. |
| `TIME_MANAGER_PIN` | `9999` | Manager PIN — unlocks the **all-agents** view (everyone's timesheets, totals and CSV). |

The `/time` page asks for the PIN on login and remembers it per browser. **Default PINs
are baked into the handler** (`api/smoke-alarms/reports`), so privacy is on out of the
box; set `TIME_MANAGER_PIN` / `TIME_AGENT_PINS` in Vercel to override or rotate them
without a code change. PINs are validated server-side and are never sent to the browser.

## API actions (`POST { time: {...} }`)

Every request also carries a `pin` (the agent's or the manager's).

| Request | Purpose |
|---------|---------|
| `{ action:'verify', agent, pin }` | Check a PIN on login → `{ ok, role }` or 403 |
| `{ action:'status', agent }` | The agent's current open shift, or `null` |
| `{ action:'clock-in', agent }` | Open a shift now (returns the existing open one if already clocked in) |
| `{ action:'clock-out', agent }` | Close the agent's open shift |
| `{ action:'list', agent }` | The agent's own shifts (page groups them into Mon–Sun weeks) |
| `{ action:'list-all' }` | **Manager PIN only** — every agent's shifts, for the overview |
| `{ action:'update', id, clock_in?, clock_out?, note? }` | Fix a wrong or forgotten time |
| `{ action:'delete', id }` | Remove a shift entry |

## Pay rates & manager emails

Rates are **$13.54/hr** (David) and **$25/hr** (Shanira), baked into the handler;
override with a `TIME_RATES` env var (JSON, e.g. `{"David":10.42,"Shanira":25}`).
Earnings = hours × rate. **Pay is manager-only** — agents never see any dollar figures.
Rates are sent from the server to the manager view only (never in the per-agent page or
its CSV), so an agent can't read their rate/earnings even from the page source. Earnings
appear only in the manager view, the manager CSV, and the clock-out email.

On every **clock-in** and **clock-out**, a note emails **vignesh@goldsure.com.au** and
**amit@goldsure.com.au** via Resend — the clock-out one is a branded report with the
shift times and hours only — **no pay figures** (earnings stay in the manager portal view).
Best-effort and bounded, so an email hiccup never blocks a clock action. Change the recipients with
`TIME_MANAGER_EMAIL` (comma-separated for several); requires `RESEND_API_KEY` (already set).

## Forgotten clock-out

If someone forgets to clock out, the shift shows **"In progress"** and, after 18h,
a **"forgot to clock out?"** flag. Use **Stop** (clock out now) or **Edit** (set the
correct clock-out time) on that row — nothing is lost.
