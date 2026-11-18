# Goldsure Rescheduling Control Centre

A deployable HTML dashboard and secure Vercel API for call-centre staff to coordinate Gold Coast smoke alarm appointments. Uses the existing **Goldsure** Vercel project and existing **goldsure-calendar** Supabase database (`yxgdixwneprhjxzdlaqw`).

## Installation into `vigneshkcom/Goldsure`

Copy the directories **`rescheduling/`** and **`api/rescheduling/`** into the root of the existing Goldsure repository, preserving their directory names. Do **not** replace any other existing files, especially `vercel.json` or `index.html`.

The resulting Vercel-hosted page should be available at:

`https://portal.goldsure.com.au/rescheduling/`

The dashboard requires Vercel's existing environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `DASHBOARD_PASSWORD`, plus `GOLDSURE_REBOOKING_SESSION_SECRET` (created for Production and Preview on 18 Nov 2026). It uses the **existing** Dataforce OAuth variables `DATAFORCE_CLIENT_ID` and `DATAFORCE_CLIENT_SECRET` when the Dataforce rescheduling contract is verified. Never expose any service-role or Dataforce credentials in frontend code or GitHub.

The calendar database tables and **28 booking rows** (26 proposed moves and 2 protected existing Mason bookings) were already created and populated on 18 Nov 2026. The optional `supabase/01_schema.sql` is for reference/re-creation in a fresh database. **Do not rerun the CSV import/seed against the production data**; the dashboard records are live and editable. The private customer CSV and private SQL seeds are deliberately NOT included in this public-repository deployment package.

## How agents use it

1. Open `/rescheduling/`. Enter the existing Goldsure dashboard passphrase once per browser session, then type your first and last name in the top-right name field. This is **not** a new individual account or password. The existing portal homepage currently uses a client-side shared PIN and does not transmit an individual username or securely share an authenticated session, so this page cannot infer who is signed in without a portal authentication upgrade.
2. Review Alex's 26 Nov jobs or Mason's 14, 15 or 16 Dec jobs, with AM/PM capacities visible. Alex's current 26 Nov appointments **must be moved elsewhere by the manager separately** before confirming the ten proposed Alex jobs. His proposed route runs **Currumbin → Miami → Mermaid Beach → Broadbeach → Surfers Paradise → Southport → Oxenford**, finishing closer to his home in D'Aguilar.
3. Select **Manage** to edit proposed date, AM/PM slot, call outcome, SMS/email sent, follow-up, alarm type (hardwired, battery, mixed), hardwired/battery quantities and notes. Enter your agent name. Click **Save changes**; Supabase records the update and who made it.
4. Use **Copy SMS** or **Copy email** only after saving the intended date. The personalised messages identify the customer, property, job ID, proposed appointment date **and AM/PM window**, and available alternative windows subject to remaining capacity. Copying does not send a message.
5. **Move job directly in Dataforce** asks agents to paste the customer's exact written agreement, confirm that it matches the date/slot, verify stock and choose an exact internal start time. This saves the evidence in Supabase.

### Critical: Dataforce movement is not yet enabled

The repository and Goldsure Vercel already have Dataforce OAuth credentials and working read/create operations. Dataforce announced a new appointment-rescheduling endpoint in ASAP 2026.2. **However, its exact HTTP method, path and request schema could not be verified through the public Swagger UI in this environment.** The guarded endpoint `/api/rescheduling/dataforce` deliberately responds **501** with a direct Dataforce job link after saving the customer agreement, and does **not** claim to have moved a live booking. Please verify the official Swagger contract against the account, then add the authenticated mutation and read-back verification before enabling the one-click action. Do not guess a request payload for real customer bookings. The confirmed approval text remains available in the dashboard database.

## Limits, data accuracy and safety

- Alex: up to 10 jobs on Thursday 26 Nov (5 AM, 5 PM), only **after** the original two bookings are moved elsewhere.
- Mason: 8 jobs on Mon 14 Dec (5 AM/3 PM); 6 on Tue 15 Dec (3 AM/3 PM); 4 on Wed 16 Dec (3 AM/1 PM), including two protected existing bookings.
- The server and PostgreSQL validate capacity, including a ceiling of five jobs per AM/PM period. Concurrent agents cannot silently overbook the same date and worker.
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
- `api/rescheduling/dataforce.js`: strict customer-agreement gate; **live move disabled pending API contract**
- `api/rescheduling/_shared.js`: server-only Supabase and session functions
- `supabase/01_schema.sql`: schema reference
- `plan_summary.json`: booking IDs and planned dates (no personal details)

No changes to the existing Goldsure portal files or Dataforce appointments are included in this package.