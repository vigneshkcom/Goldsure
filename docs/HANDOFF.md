# Goldsure Portal Repo — Handoff

This file is a single-page orientation for any new contributor or assistant. It explains how the repo is structured, what is live, and where the critical flows are implemented.

## Quick Facts

- GitHub: `https://github.com/vigneshkcom/Goldsure.git`
- Canonical host: `https://portal.goldsure.com.au`
- Runtime model: static HTML pages + Vercel serverless functions under `/api`
- Routing is path‑sensitive. Do not rename live paths without updating links and Vercel config.

## Top‑Level Map (Where Things Live)

- `index.html`  
  Main portal homepage (internal navigation hub).

- `/smoke-alarms/`  
  Core smoke alarm sales, operations, support, and reporting pages.

- `/Ads reporting/`  
  Ad reporting dashboard (Meta + Google + CRM).

- `/api/`  
  All form handlers, email templates, reporting, CRM proxy routes.

- `/assets/`  
  Shared logos and imagery (follow branding map).

## Critical Flows

### 1) Quote Send (Smoke Alarms)

- Page: `/smoke-alarms/smoke-alarm.html`
- API: `/api/smoke-alarms/send.js`
- Creates quote + sends customer email

### 2) Quote Acceptance

- Page: `/accept-quote.html`
- API: `/api/smoke-alarms/accept.js`
- Sends internal acceptance notification

### 3) Quote Tracker + Reminders

- Page: `/smoke-alarms/quote-tracker.html`
- API: `/api/smoke-alarms/send-reminder.js`
- Tracks reminder count + last reminder timestamp in `quote_emails`
- Sales portal summary block (quote follow‑up) reads from the same data

### 4) Ad Performance Reporting

- Page: `/Ads reporting/Meta Ad Performance.html`
- APIs:
  - `/api/MetaAdPerformace/auth.js`
  - `/api/MetaAdPerformace/config.js`
  - `/api/MetaAdPerformace/ghl.js`
  - `/api/MetaAdPerformace/google-spend.js`
  - `/api/MetaAdPerformace/send-report.js` (cron email)

## Key Source‑Classification Rules (Reporting)

- Paid social (Facebook/Instagram) → `Meta`
- Direct traffic → `Google`
- Landing page / offers URLs → shown as a journey touchpoint, not a standalone source
- Journey table shows sub‑paths under `Meta` and `Google`

## High‑Risk Files (Don’t Rename)

- `/vercel.json`
- Anything under `/api/`
- `/smoke-alarms/calendar/`
- `/smoke-alarms/calculatorpdf.html`
- `/Ads reporting/`
- `/Battery/`
- `/Air-Cons/`

## Branding (Logos)

- Light background: `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- Dark background: `/assets/goldsure-inverted-logo.jpg`

More detail: `docs/BRANDING_MAP.md`

## Environment Variables (Common)

### Reporting / Meta + Google

- `META_TOKEN`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_MANAGER_ID`
- `GOOGLE_ADS_CUSTOMER_ID`

### Smoke Alarm Emails

- `RESEND_API_KEY`
- `SITE_URL` (should match `https://portal.goldsure.com.au`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## If Something Looks “Locked”

The portal sidebar uses a small client‑side toggle. If left nav feels stuck:
- check `index.html` for the `toggleGroup()` script at the bottom
- confirm the file ends with proper closing tags

## Related Docs

- `README.md`  
  Quick index of folders and URLs.
- `docs/ARCHITECTURE.md`  
  Full repo map and flows.
- `docs/route-dependencies.md`  
  Path‑sensitive warnings and dependencies.
