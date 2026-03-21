# Goldsure Portal Repo

This repo runs the live Goldsure portal on Vercel:

- Repository: `https://github.com/vigneshkcom/Goldsure.git`
- Canonical runtime: `https://portal.goldsure.com.au`

## Read This First

If you are trying to find something quickly, use this file as the plain-English guide.

The repo is not neatly grouped yet, so the same business area may be spread across a few folders.

## Where Things Are

### Smoke Alarms

If you are looking for the main smoke alarm pages, staff pages, quote tools, install summaries, or smoke alarm calendar, start in:

- `/smoke-alarms/`

Important files there include:

- `/smoke-alarms/smoke-alarm.html`
- `/smoke-alarms/quote-tracker.html`
- `/smoke-alarms/smoke-alarm-troubleshooting.html`
- `/smoke-alarms/raptor-enquiry-workflow.html`
- `/smoke-alarms/install-summary.html`
- `/smoke-alarms/Installer Pay Summary.html`
- `/smoke-alarms/compliance.html`
- `/smoke-alarms/calculatorpdf.html`
- `/smoke-alarms/qld-smoke-alarm-training-certificate.html`
- `/smoke-alarms/calendar/index.html`

### Battery

If you are looking for battery landing pages, callback forms, or the ROI calculator, start in:

- `/Battery/`

Important files:

- `/Battery/request-callback.html`
- `/Battery/thank-you.html`
- `/Battery/battery-roi.html`

### Air-Cons

If you are looking for the aircon pricing page or its export/report logic, start in:

- `/Air-Cons/`

Important file:

- `/Air-Cons/aux-mini-vrf-pricing.html`

### Reporting

If you are looking for the ad reporting dashboard or daily email reporting logic, start in:

- `/Ads reporting/`
- `/api/MetaAdPerformace/`

Important files:

- `/Ads reporting/Meta Ad Performance.html`
- `/api/MetaAdPerformace/auth.js`
- `/api/MetaAdPerformace/config.js`
- `/api/MetaAdPerformace/ghl.js`
- `/api/MetaAdPerformace/google-spend.js`
- `/api/MetaAdPerformace/send-report.js`

### API / Forms / Notifications

If something submits a form, sends an email, pulls CRM data, or generates a report, check:

- `/api/`

Main API areas:

- `/api/smoke-alarms/`
- `/api/battery/`
- `/api/MetaAdPerformace/`

### Shared Images, Logos, and Icons

If you need logos, icons, or shared images, check:

- `/assets/`

Important shared assets:

- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- `/assets/goldsure-inverted-logo.jpg`
- `/assets/goldsure-logo.jpg`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`
- `/assets/icon-192x192.png`
- `/assets/icon-512x512.png`
- `/assets/goldsure-technician.png`
- `/assets/Smoke Alarm Placement Guide.png`

### Staff Calendar

If you are looking for the leave planner, check:

- `/calendar/staff-leave-planner.html`

If you are looking for the electrician calendar app, check:

- `/smoke-alarms/calendar/`

### Main Portal Homepage

If you want the page that links to most internal tools, check:

- `/index.html`

### Quote Acceptance Page

If you want the public quote acceptance page, check:

- `/accept-quote.html`

## If You Need To Search By Purpose

Use this shortcut:

- Smoke alarms: `/smoke-alarms/`
- Battery: `/Battery/`
- Aircons: `/Air-Cons/`
- Reporting dashboard: `/Ads reporting/`
- APIs and emails: `/api/`
- Logos and images: `/assets/`
- Staff leave planner: `/calendar/`
- Internal portal homepage: `/index.html`

## Important Warning

This is a live repo.

Do not casually rename, move, or delete:

- `/vercel.json`
- anything in `/api/`
- anything in `/smoke-alarms/calendar/`
- `/smoke-alarms/calculatorpdf.html`
- `/Battery/`
- `/Air-Cons/`
- `/Ads reporting/`

## Better Detailed Docs

If you need more detail after this README, use:

- [ARCHITECTURE.md](./ARCHITECTURE.md): practical repo map and critical flows
- [UI_GUIDE.md](./UI_GUIDE.md): browser/UI conventions
- [BRANDING_MAP.md](./BRANDING_MAP.md): logo/icon usage rules
- [AGENTS.md](./AGENTS.md): contributor/agent guardrails
- [docs/cleanup-matrix.md](./docs/cleanup-matrix.md): cleanup planning matrix and risk map
- [docs/naming-plan.md](./docs/naming-plan.md): naming and organisation cleanup plan
- [docs/route-dependencies.md](./docs/route-dependencies.md): route/path dependency notes
