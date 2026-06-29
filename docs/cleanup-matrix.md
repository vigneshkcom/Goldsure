# Cleanup Matrix

This file is a planning aid only. It does not authorize runtime changes.

Use it to reduce confusion without breaking public URLs, Vercel behavior, API route names, or report/email flows.

## Scope

- Canonical runtime: `https://portal.goldsure.com.au`
- Preserve all current public URLs by default
- Do not rename public folders or API routes without explicit verification
- Treat this matrix as a prioritization map, not an execution plan

## Status Groups

### Clearly Active

- `/index.html`
- `/accept-quote.html`
- `/vercel.json`
- `/Ads reporting/`
- `/Ads reporting/Meta Ad Performance.html`
- `/Air-Cons/`
- `/api/`
- `/api/battery/request-callback.js`
- `/api/MetaAdPerformace/auth.js`
- `/api/MetaAdPerformace/config.js`
- `/api/MetaAdPerformace/ghl.js`
- `/api/MetaAdPerformace/google-spend.js`
- `/api/MetaAdPerformace/send-report.js`
- `/api/smoke-alarms/send.js`
- `/api/smoke-alarms/accept.js`
- `/api/smoke-alarms/google-key.js`
- `/api/smoke-alarms/reports/send-install-summary.js`
- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- `/assets/goldsure-inverted-logo.jpg`
- `/assets/icon-192x192.png`
- `/assets/icon-512x512.png`
- `/Battery/request-callback.html`
- `/Battery/thank-you.html`
- `/Battery/battery-roi.html`
- `/calendar/staff-leave-planner.html`
- `/smoke-alarms/smoke-alarm.html`
- `/smoke-alarms/smoke-alarm-troubleshooting.html`
- `/smoke-alarms/raptor-enquiry-workflow.html`
- `/smoke-alarms/quote-tracker.html`
- `/smoke-alarms/Installer Pay Summary.html`
- `/smoke-alarms/install-summary.html`
- `/smoke-alarms/calendar/index.html`
- `/smoke-alarms/calendar/manifest.json`
- `/smoke-alarms/calendar/sw.js`

### Probably Active

- `/smoke-alarms/compliance.html`
- `/smoke-alarms/calculatorpdf.html`
- `/assets/goldsure-technician.png`
- `/assets/Smoke Alarm Placement Guide.png`

### Internal-Only

- `/index.html` as an internal portal homepage
- `/calendar/staff-leave-planner.html`
- `/smoke-alarms/qld-smoke-alarm-training-certificate.html`
- `/smoke-alarms/Installer Pay Summary.html`
- `/Ads reporting/Meta Ad Performance.html`

### Shared Infrastructure

- `/vercel.json`
- `/api/`
- `/assets/`
- `/docs/route-dependencies.md`
- `/README.md`
- `/docs/AGENTS.md`
- `/docs/ARCHITECTURE.md`
- `/docs/UI_GUIDE.md`
- `/docs/BRANDING_MAP.md`

### Likely Legacy

- `/assets/goldsure-logo.jpg`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`

### Duplicated Or Overlapping

- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- `/assets/goldsure-logo.jpg`
- `/assets/goldsure-inverted-logo.jpg`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`
- `/assets/icon-192x192.png`
- `/assets/icon-512x512.png`

### Confusing By Name Only

- `/Ads reporting/`
- `/Ads reporting/Meta Ad Performance.html`
- `/Air-Cons/`
- `/Battery/`
- `/api/MetaAdPerformace/`
- `/smoke-alarms/Installer Pay Summary.html`
- `/smoke-alarms/calculatorpdf.html`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`
- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`

## Cleanup Matrix

| Current path | Type | Purpose | Current status | Proposed action | Risk level |
|---|---|---|---|---|---|
| `/index.html` | browser page | internal portal homepage and navigation hub | clearly active | keep | high |
| `/accept-quote.html` | browser page | public quote acceptance flow | clearly active | keep | high |
| `/vercel.json` | config | Vercel cron and path-specific headers | clearly active / shared infrastructure | keep | very high |
| `/Ads reporting/` | folder | live reporting section with inconsistent public naming | clearly active / confusing by name only | rename later | high |
| `/Ads reporting/Meta Ad Performance.html` | browser page | reporting dashboard UI | clearly active / confusing by name only | document better | high |
| `/Air-Cons/` | folder | live aircon tool section with inconsistent public naming | clearly active / confusing by name only | rename later | high |
| `/api/` | folder | live serverless routes and template/report generation | clearly active / shared infrastructure | keep | very high |
| `/api/battery/request-callback.js` | API route | battery callback submission and email HTML | clearly active / shared infrastructure | keep | very high |
| `/api/MetaAdPerformace/` | folder | live reporting route namespace with typo in path | clearly active / confusing by name only | rename later | very high |
| `/api/MetaAdPerformace/auth.js` | API route | reporting auth helper | clearly active / shared infrastructure | keep | very high |
| `/api/MetaAdPerformace/config.js` | API route | reporting config bootstrap | clearly active / shared infrastructure | keep | very high |
| `/api/MetaAdPerformace/ghl.js` | API route | GHL reporting proxy | clearly active / shared infrastructure | keep | very high |
| `/api/MetaAdPerformace/google-spend.js` | API route | Google Ads spend endpoint | clearly active / shared infrastructure | keep | very high |
| `/api/MetaAdPerformace/send-report.js` | API route + email/report template | cron-driven report sender | clearly active / shared infrastructure | keep | very high |
| `/api/smoke-alarms/send.js` | API route + email/report template | smoke alarm submission flow | clearly active / shared infrastructure | keep | very high |
| `/api/smoke-alarms/accept.js` | API route + email/report template | quote acceptance flow | clearly active / shared infrastructure | keep | very high |
| `/api/smoke-alarms/google-key.js` | API route | Google Maps key bootstrap | clearly active / shared infrastructure | keep | high |
| `/api/smoke-alarms/reports/send-install-summary.js` | API route | install summary reporting route | clearly active / shared infrastructure | keep | very high |
| `/assets/` | folder | shared logos, icons, and imagery | shared infrastructure | consolidate later | medium-high |
| `/assets/.keep` | shared asset placeholder | placeholder file for empty-folder retention | shared infrastructure | document better | low |
| `/assets/48 PX.png` | shared asset | square legacy brand mark | likely legacy / duplicated / confusing by name only | consolidate later | medium |
| `/assets/48 PX (#f5f6f8).png` | shared asset | square legacy mark for light grey surfaces | likely legacy / duplicated / confusing by name only | consolidate later | medium |
| `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg` | shared asset | canonical light-background logo | clearly active / shared infrastructure | keep | high |
| `/assets/goldsure-inverted-logo.jpg` | shared asset | canonical dark-background logo | clearly active / shared infrastructure | keep | high |
| `/assets/goldsure-logo.jpg` | shared asset | legacy horizontal logo still present for compatibility | likely legacy / duplicated | review | medium |
| `/assets/goldsure-technician.png` | shared asset | compliance/marketing imagery | probably active / shared infrastructure | keep | medium |
| `/assets/icon-192x192.png` | shared asset | PWA/app icon | clearly active / shared infrastructure | keep | high |
| `/assets/icon-512x512.png` | shared asset | PWA/app icon | clearly active / shared infrastructure | keep | high |
| `/assets/Smoke Alarm Placement Guide.png` | shared asset | support/compliance image | probably active / shared infrastructure | keep | medium |
| `/Battery/` | folder | live battery section with inconsistent public naming | clearly active / confusing by name only | rename later | high |
| `/Battery/battery-roi.html` | browser page | battery ROI calculator | clearly active | keep | medium-high |
| `/Battery/request-callback.html` | browser page | battery callback landing page | clearly active | keep | high |
| `/Battery/thank-you.html` | browser page | battery callback thank-you page | clearly active | keep | medium-high |
| `/calendar/` | folder | standalone staff leave planner section | clearly active | document better | medium-high |
| `/calendar/staff-leave-planner.html` | browser page | staff leave planner | clearly active / internal-only | keep | medium-high |
| `/docs/` | folder | contributor-facing maintenance docs | shared infrastructure | keep | low |
| `/docs/route-dependencies.md` | documentation | route-sensitive dependency notes | shared infrastructure | keep | low |
| `/smoke-alarms/` | folder | main sales, support, install, and ops area | clearly active | keep | very high |
| `/smoke-alarms/.gitkeep` | placeholder | placeholder for folder retention | shared infrastructure | document better | low |
| `/smoke-alarms/smoke-alarm.html` | browser page | main smoke alarm portal app | clearly active | keep | very high |
| `/smoke-alarms/smoke-alarm-troubleshooting.html` | browser page | troubleshooting/support flow | clearly active | keep | medium-high |
| `/smoke-alarms/raptor-enquiry-workflow.html` | browser page | purchase enquiry workflow | clearly active | keep | medium-high |
| `/smoke-alarms/quote-tracker.html` | browser page | quote tracking tool | clearly active | keep | high |
| `/smoke-alarms/qld-smoke-alarm-training-certificate.html` | browser page | staff training assessment and printable certificate | internal-only | document better | medium |
| `/smoke-alarms/Installer Pay Summary.html` | browser page | installer pay dashboard and printable report | clearly active / internal-only / confusing by name only | document better | high |
| `/smoke-alarms/install-summary.html` | browser page | install summary submission/reporting page | clearly active | keep | high |
| `/smoke-alarms/compliance.html` | browser page | public-facing compliance landing page with embedded forms | probably active | review | medium-high |
| `/smoke-alarms/calculatorpdf.html` | browser page | quote calculator with webhook and PDF generation | probably active / confusing by name only | document better | very high |
| `/smoke-alarms/calendar/` | folder | electrician calendar PWA path | clearly active / shared infrastructure | keep | very high |
| `/smoke-alarms/calendar/index.html` | browser page | electrician calendar PWA UI | clearly active | keep | very high |
| `/smoke-alarms/calendar/manifest.json` | config | PWA manifest for calendar | clearly active / shared infrastructure | keep | very high |
| `/smoke-alarms/calendar/sw.js` | config | service worker for calendar PWA | clearly active / shared infrastructure | keep | very high |
| `/README.md` | documentation | repo entry point | shared infrastructure | keep | low |
| `/docs/AGENTS.md` | documentation | agent/contributor guardrails | shared infrastructure | keep | low |
| `/docs/ARCHITECTURE.md` | documentation | structural map and flow map | shared infrastructure | keep | low |
| `/docs/UI_GUIDE.md` | documentation | UI/runtime rules | shared infrastructure | keep | low |
| `/docs/BRANDING_MAP.md` | documentation | branding source of truth | shared infrastructure | keep | low-medium |

## Top 20 Most Confusing Files/Folders

1. `/Ads reporting/`
2. `/Ads reporting/Meta Ad Performance.html`
3. `/Air-Cons/`
4. `/Battery/`
5. `/api/MetaAdPerformace/`
6. `/api/MetaAdPerformace/send-report.js`
7. `/smoke-alarms/Installer Pay Summary.html`
8. `/smoke-alarms/calculatorpdf.html`
9. `/smoke-alarms/qld-smoke-alarm-training-certificate.html`
10. `/assets/48 PX.png`
11. `/assets/48 PX (#f5f6f8).png`
12. `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
13. `/assets/goldsure-logo.jpg`
14. `/smoke-alarms/compliance.html`
15. `/calendar/`
16. `/smoke-alarms/calendar/`
17. `/smoke-alarms/install-summary.html`
18. `/smoke-alarms/quote-tracker.html`
19. `/docs/route-dependencies.md`
20. `/assets/.keep`

## Top 10 Lowest-Risk Cleanup Opportunities

1. Add clearer documentation for placeholder files `/assets/.keep` and `/smoke-alarms/.gitkeep`.
2. Keep documenting legacy branding files so new work does not reintroduce them by accident.
3. Add `/docs/cleanup-matrix.md` to the main documentation index.
4. Continue standardizing documentation language around `clearly active`, `probably active`, `internal-only`, and `likely legacy`.
5. Add a future move matrix for naming-only cleanup without changing runtime paths yet.
6. Document which files are internal tools versus customer-facing pages more explicitly.
7. Consolidate planning around duplicated logo assets before touching any file names.
8. Add a short note that `/api/MetaAdPerformace/` is typoed but live, so future contributors do not “fix” it casually.
9. Document that `/smoke-alarms/calculatorpdf.html` is deployment-sensitive because of [vercel.json](/vercel.json).
10. Document homepage-linked internal tools more clearly so they are not mistaken for legacy pages.

## Never Delete Or Rename Without Explicit Verification

- `/vercel.json`
- `/api/`
- `/api/MetaAdPerformace/`
- `/api/MetaAdPerformace/send-report.js`
- `/api/smoke-alarms/send.js`
- `/api/smoke-alarms/accept.js`
- `/api/smoke-alarms/reports/send-install-summary.js`
- `/api/battery/request-callback.js`
- `/smoke-alarms/`
- `/smoke-alarms/smoke-alarm.html`
- `/smoke-alarms/install-summary.html`
- `/smoke-alarms/calculatorpdf.html`
- `/smoke-alarms/calendar/`
- `/smoke-alarms/calendar/index.html`
- `/smoke-alarms/calendar/manifest.json`
- `/smoke-alarms/calendar/sw.js`
- `/Battery/`
- `/Air-Cons/`
- `/Ads reporting/`
- `/accept-quote.html`
- `/index.html`
- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- `/assets/goldsure-inverted-logo.jpg`
- `/assets/icon-192x192.png`
- `/assets/icon-512x512.png`

## Possible Archive Candidates

None are safe archive candidates from repo evidence alone.

The closest items to "review before keeping forever" are:

- `/assets/goldsure-logo.jpg`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`

Even those should not be deleted yet because they may still be referenced externally or in report/export contexts.

## Still Unclear

- Whether `/smoke-alarms/compliance.html` is a high-traffic acquisition page or a lower-traffic reference page.
- Whether `/assets/goldsure-logo.jpg` is still used outside the repo in older email templates, exported reports, or cached pages.
- Whether the square legacy mark files are still required in any browser/report contexts not obvious from the current repo scan.
