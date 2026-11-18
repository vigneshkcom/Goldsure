# Goldsure Rescheduling Control Centre

A deployable HTML dashboard and secure Vercel API for call-centre staff to coordinate Gold Coast smoke alarm appointments. Uses the existing **Goldsure** Vercel project and existing **goldsure-calendar** Supabase database (`yxgdixwneprhjxzdlaqw`).

## Installation into `vigneshkcom/Goldsure`

Copy the directories **`rescheduling/`** and **`api/rescheduling/`** into the root of the existing Goldsure repository, preserving their directory names. Do **not** replace any other existing files, especially `vercel.json` or `index.html`.

The resulting Vercel-hosted page should be available at:

`https://portal.goldsure.com.au/rescheduling/`

The dashboard requires Vercel's existing environment variables `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, plus `GOLDSURE_REBOOKING_SESSION_SECRET` (created for Production and Preview on 18 Nov 2026). It uses the **existing** Dataforce OAuth variables `DATAFORCE_CLIENT_ID` and `DATAFORCE_CLIENT_SECRET` for appointment reads and rescheduling. Never expose any service-role or Dataforce credentials in frontend code or GitHub.

The calendar database tables and **28 booking rows** (26 proposed moves and 2 protected existing Mason bookings) were already created and populated on 18 Nov 2026. The optional `supabase/01_schema.sql` is for reference/re-creation in a fresh database. **Do not rerun the CSV import/seed against the production data**; the dashboard records are live and editable. The private customer CSV and private SQL seeds are deliberately NOT included in this public-repository deployment package.

## How agents use it

1. Open `/rescheduling/`. Pick your name from the "Who is using the rescheduling portal?" prompt (same list as the SMS portal; the choice is shared with it for the browser tab). There is no password on this page any more. The existing portal homepage currently uses a client-side shared PIN and does not transmit an individual username or securely share an authenticated session, so this page cannot infer who is signed in without a portal authentication upgrade.
2. Review Alex's 26 Nov jobs or Mason's 14, 15 or 16 Dec jobs, with AM/PM capacities visible. Alex's current 26 Nov appointments **must be moved elsewhere by the manager separately** before confirming the ten proposed Alex jobs. His proposed route runs **Currumbin → Miami → Mermaid Beach → Broadbeach → Surfers Paradise → Southport → Oxenford**, finishing closer to his home in D'Aguilar.
3. Select **Manage** to edit proposed date, AM/PM slot, call outcome, SMS/email sent, follow-up, alarm type (hardwired, battery, mixed), hardwired/battery quantities and notes. Enter your agent name. Click **Save changes**; Supabase records the update and who made it.
4. Use **Copy SMS** or **Copy email** only after saving the intended date. The personalised messages identify the customer, property, job ID, proposed appointment date **and AM/PM window**, and available alternative windows subject to remaining capacity. Copying does not send a message.
5. **Move job directly in Dataforce** asks agents to paste the customer's exact written agreement, confirm that it matches the date/slot, verify stock and choose an exact internal start time. Verify your Goldsure work email to move the appointment. **Save for manual move** saves the same approval evidence and shows the Dataforce job link.

### Dataforce writes

Configure production email delivery and include the one-time code (`{{ .Token }}`) in the Goldsure calendar Supabase sign-in template. Provision authorised schedulers in Supabase Auth and set the administrator-controlled `app_metadata.goldsure_rebooking_staff` field to their staff picker name. Then set `GOLDSURE_DATAFORCE_EMAIL_LOGIN_ENABLED=true` in the Goldsure Vercel project. The server verifies the email session and role for every direct move. The existing Dataforce OAuth client needs appointment write access.

The direct action uses Dataforce's [appointment reschedule endpoint](https://asap-api.dataforce.com.au/apps/swagger-ui/#/appointment/appointment.reschedule) on the existing appointment ID. It keeps the current duration, sends the selected clock time using Dataforce’s program offset and the chosen fieldworker, and verifies all three booking details (date, start time and worker) by reading the appointment back. The action leaves booking emails to the scheduler.

## Limits, data accuracy and safety

- Alex: up to 10 jobs on Thursday 26 Nov (5 AM, 5 PM), only **after** the original two bookings are moved elsewhere.
- Mason: 8 jobs on Mon 14 Dec (5 AM/3 PM); 6 on Tue 15 Dec (3 AM/3 PM); 4 on Wed 16 Dec (3 AM/1 PM), including two protected existing bookings.
- PostgreSQL counts confirmed, synced and protected bookings against capacity. Proposals leave capacity available. A worker/day lock prevents two agents from taking the last tracker spot at the same time. The dashboard also includes appointments from the live Dataforce schedule.
- The SMS/email phrases use **AM (morning)** and **PM (afternoon)**; precise arrival times are not promised. Only choose an exact start time internally when a customer has agreed to the window and the route is confirmed.
- The CSV cannot establish existing hardwired or battery alarm quantities. Staff must verify these manually before committing an appointment.
- Source data warning: Jobs **37256** and **37257** have identical mobile and email contact details in the CSV. Both are flagged for review; verify which contact is correct before using the email template.
- Existing job IDs 37310 and 37187 on 16 Dec are protected in the database. The tracker does not change Dataforce or existing calendar events on its own.
- Customer PII is stored only in Supabase, not in the public HTML or GitHub. The browser accesses it only through server-side Vercel functions that check a signed HTTP-only session. Public Supabase `anon` access is revoked for the tracker tables; RLS is enabled.
- The user name field records attribution but cannot independently prove which individual operated a shared login. Use real individual portal authentication for verifiable accountability in future.

## Source files

- `rescheduling/index.html`: responsive, single-file HTML dashboard with CSS and JS (no npm build needed)
- `api/rescheduling/session.js`: shared dashboard passphrase validation and signed session cookie
- `api/rescheduling/jobs.js`: list/update jobs and retrieve per-job audit history
- `api/rescheduling/dataforce.js`: saves customer approval and verifies direct Dataforce moves
- `api/rescheduling/_shared.js`: server-only Supabase and session functions
- `supabase/01_schema.sql`: schema reference
- `plan_summary.json`: booking IDs and planned dates (no personal details)

No changes to the existing Goldsure portal files or Dataforce appointments are included in this package.

## Live Dataforce read

`/api/rescheduling/live` (read-only, session required, cached 20 s) reads Dataforce with the existing `DATAFORCE_CLIENT_ID` / `DATAFORCE_CLIENT_SECRET`:

- each tracker job's active appointment (`/jobs/{id}/appointments`, cancelled ones ignored) gives the real date, time and status;
- each worker/day (Alex 1009 on 26 Nov, Mason 1012 on 14-16 Dec) is read with `/appointments/search`, so the day boxes show real bookings including jobs outside the tracker.

The portal compares the live Dataforce appointment with the original booking. A change to the date, time or fieldworker appears as **Moved**, and the job is listed under its live date. Saved proposals do not change. The live read does not write to Dataforce or Supabase.
