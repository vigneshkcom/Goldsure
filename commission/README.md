# Commission Job Log

A simple weekly job tracker for a commission-based team member. She logs each job
(job number, when it was booked, the booked installation date), the data is saved
to Supabase, and at the end of the week she downloads the **Monday → Sunday** report
(PDF + CSV) and emails it across herself.

- **UI:** `/commission/` — add a job, browse week by week, download the report
- **API:** `/api/smoke-alarms/reports` — `POST { commission: { action, ... } }`
  (folded into the existing reports handler to stay under Vercel's 12-function Hobby limit)
- **Storage:** Supabase table `commission_jobs`

## How it works

```
Add job:  /commission/ ──POST {commission:{action:'add'}}──▶ reports handler ──▶ Supabase
View:     /commission/ ──POST {commission:{action:'list'}}─▶ reports handler ──▶ Supabase
Report:   weekly jobs grouped Mon–Sun, downloaded as PDF (print → Save as PDF) + CSV
```

Weeks always run **Monday → Sunday** (Sunday is the week-ending day). A job belongs
to the week of its **Booked Date**. Use the ‹ › arrows to move between weeks or
**This week** to jump back to the current one. The default Booked Date is today.

## Supabase table (run once)

```sql
CREATE TABLE commission_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_number     text NOT NULL,
  booked_date    date NOT NULL,
  install_date   date,
  customer_name  text,
  customer_phone text,
  lead_type      text,
  notes          text,
  agent          text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX ON commission_jobs (booked_date);
ALTER TABLE commission_jobs DISABLE ROW LEVEL SECURITY;
```

**Already created the table without the newer columns?** Add them:

```sql
ALTER TABLE commission_jobs ADD COLUMN IF NOT EXISTS agent          text;
ALTER TABLE commission_jobs ADD COLUMN IF NOT EXISTS customer_name  text;
ALTER TABLE commission_jobs ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE commission_jobs ADD COLUMN IF NOT EXISTS lead_type      text;
```

The **Agent** name (top-right of the page, defaults to *Shanira*) is stamped onto
each job as it's added and shown on the report and CSV. It's remembered per browser
so it stays pre-filled. Until the columns exist, adding a job fails — run the
migration above first.

**Lead type** is a dropdown — *Digital*, *Letterbox*, or *Direct Phone Call* —
captured per job and shown on the report and CSV.

**Find customer** searches the **Smoke Alarm pipeline in GoHighLevel** by name or
phone and fills in the customer name + phone on selection. It reuses the existing
server-side GHL proxy (`/api/MetaAdPerformace/ghl`) and config endpoint that the
Meta Ad Performance dashboard already uses, so it needs `GHL_API_KEY` +
`GHL_LOCATION_ID` set in Vercel (already configured). If GHL is unreachable, the
agent can still type the customer in manually.

If you leave Row Level Security **on** instead, set `SUPABASE_SERVICE_ROLE_KEY` in
Vercel so **Delete** can still remove rows (an RLS-blocked anon delete returns 204
having deleted nothing — the UI surfaces a warning if that happens).

## Required configuration

Reuses the env vars already set for the SMS gateway — no new ones needed:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Read/insert jobs |
| `SUPABASE_SERVICE_ROLE_KEY` | *(optional)* Lets **Delete** bypass RLS |

## Handler actions (`POST /api/smoke-alarms/reports`)

| Body | Purpose |
|------|---------|
| `{ commission: { action:'list' } }` | All jobs (newest booked first); grouped into weeks client-side |
| `{ commission: { action:'add', job:{ job_number, booked_date, install_date, customer_name, customer_phone, lead_type, notes, agent } } }` | Insert a job; returns the saved row |
| `{ commission: { action:'delete', id } }` | Delete a job by id (service-role key, verified count) |

Customer search is done **client-side** against the existing `/api/MetaAdPerformace/ghl`
proxy (Smoke Alarm pipeline) — it does not go through this handler.

## Downloads

- **PDF** — opens a branded, print-ready report in a new tab and triggers the print
  dialog; choose **Save as PDF** (or print). Allow pop-ups for `portal.goldsure.com.au`.
- **CSV** — `Agent, Job Number, Customer, Phone, Lead Type, Booked Date, Installation Date, Notes` for the viewed week,
  ready for Excel/Sheets.

Both files are named `Goldsure_Commission_<weekStart>_to_<weekEnd>`.
