# Architecture

This document is the practical repo map for day-to-day work. Use it to answer:

- what each top-level area is for
- which files are live and risky
- where forms, reports, and shared assets connect
- which files are safer cleanup candidates later

## Deployment

- Primary host: `https://portal.goldsure.com.au`
- Platform: Vercel
- Runtime model: static HTML pages plus Vercel serverless functions under `/api`
- Canonical browser assumptions:
  - internal links should be root-relative
  - shared browser assets should use `/assets/...`
  - browser API calls should use `/api/...`

## How To Read This Repo

- Start with [/index.html](/index.html) if you want the main portal navigation.
- Start with [/smoke-alarms/](/smoke-alarms) if you are working on the busiest live workflow.
- Start with [/api/](/api) if you are tracing forms, notifications, or report delivery.
- Start with [/assets/](/assets) and [/docs/BRANDING_MAP.md](/docs/BRANDING_MAP.md) if you are changing shared branding.
- Treat [/vercel.json](/vercel.json) as deployment-critical configuration, not routine cleanup territory.

## Top-Level Practical File Map

### `/index.html`

- Type: `browser page`
- Purpose: internal portal homepage and main navigation hub for tools, pages, and external systems
- Live/active: yes
- Shared: yes, acts as the main entry point for internal navigation
- Likely legacy: no
- Risky to change: high
- Open this when: you need to understand how people navigate into the rest of the repo
- Notes: sidebar groups are client-side toggles; if the left nav feels locked, check the bottom script for `toggleGroup()`

### `/accept-quote.html`

- Type: `browser page`
- Purpose: public acceptance page for smoke alarm quote approvals
- Live/active: yes
- Shared: no
- Likely legacy: no
- Risky to change: high
- Open this when: you need to trace quote acceptance or public confirmation behavior

### `/vercel.json`

- Type: `config`
- Purpose: Vercel deployment behavior, including cron schedule and path-specific headers
- Live/active: yes
- Shared: yes
- Likely legacy: no
- Risky to change: very high
- Open this when: you need to inspect cron jobs, headers, or route-level deployment behavior

### `/Ads reporting/`

- Type: folder containing `browser page`
- Purpose: reporting dashboard UI
- Live/active: yes
- Shared: limited
- Likely legacy: no, but naming is legacy/inconsistent
- Risky to change: high because public path is live
- Open this when: you are working on reporting UI, ad reporting, or the Meta/Google dashboard

### `/Air-Cons/`

- Type: folder containing `browser page`
- Purpose: air-conditioning pricing and calculator tooling
- Live/active: yes
- Shared: limited
- Likely legacy: no, but naming is legacy/inconsistent
- Risky to change: high because public path is live
- Open this when: you are working on the AUX pricing calculator or its export output

### `/api/`

- Type: folder containing `API route` files and server-side template/report code
- Purpose: Vercel serverless functions for forms, CRM/reporting, notifications, and utilities
- Live/active: yes
- Shared: yes
- Likely legacy: mixed
- Risky to change: very high
- Open this when: you are tracing form submissions, CRM/report integrations, or generated emails
- **Vercel Hobby plan limit: 12 serverless functions maximum.** The repo is currently at exactly 12. Do not add a new file under `/api/` without first consolidating or removing an existing one.

### `/assets/`

- Type: folder containing `shared asset` files
- Purpose: logos, icons, shared imagery, and support graphics
- Live/active: yes
- Shared: yes
- Likely legacy: mixed
- Risky to change: medium to high depending on asset
- Open this when: you need logos, icons, or smoke-alarm marketing imagery

### `/Battery/`

- Type: folder containing `browser page` files
- Purpose: battery landing pages, callback flow, and ROI calculator
- Live/active: yes
- Shared: partially
- Likely legacy: no, but naming is legacy/inconsistent
- Risky to change: high because public path is live
- Open this when: you are working on battery landing pages, callback flow, or ROI tooling

### `/calendar/`

- Type: folder containing `browser page`
- Purpose: staff leave planner
- Live/active: yes
- Shared: no
- Likely legacy: no
- Risky to change: medium to high
- Open this when: you are working on the standalone staff leave planner

### `/docs/`

- Type: folder containing `documentation`
- Purpose: supporting internal documentation and dependency notes
- Live/active: active for maintainers, not runtime-facing
- Shared: yes for contributors
- Likely legacy: no
- Risky to change: low
- Open this when: you need supporting notes about route or cleanup dependencies

### `/smoke-alarms/`

- Type: folder containing `browser page` files and a PWA subfolder
- Purpose: smoke alarm sales, ops, support, compliance, summary, and calendar tooling
- Live/active: yes
- Shared: yes
- Likely legacy: mixed
- Risky to change: very high because it contains the most route-sensitive live pages
- Open this when: you are working on the main smoke alarm sales, support, and install workflows

### `/README.md`

- Type: `documentation`
- Purpose: concise repo entry point and navigation to deeper docs
- Live/active: active for maintainers
- Shared: yes
- Likely legacy: no
- Risky to change: low
- Open this when: you need the quickest orientation to the repo docs

### `/docs/AGENTS.md`

- Type: `documentation`
- Purpose: instructions and guardrails for future coding/automation agents
- Live/active: active for maintainers
- Shared: yes
- Likely legacy: no
- Risky to change: low
- Open this when: you want guardrails for safe agent or contributor changes

### `/docs/BRANDING_MAP.md`

- Type: `documentation`
- Purpose: logo/icon usage source of truth
- Live/active: active for maintainers
- Shared: yes
- Likely legacy: no
- Risky to change: low to medium because it guides future branding decisions
- Open this when: you need to choose a logo or icon variant safely

### `/docs/UI_GUIDE.md`

- Type: `documentation`
- Purpose: UI/runtime conventions and design guardrails
- Live/active: active for maintainers
- Shared: yes
- Likely legacy: no
- Risky to change: low
- Open this when: you need UI conventions for browser-facing pages

### `/docs/ARCHITECTURE.md`

- Type: `documentation`
- Purpose: practical structural map of the repo and critical flows
- Live/active: active for maintainers
- Shared: yes
- Likely legacy: no
- Risky to change: low
- Open this when: you want the repo map, flow map, and sensitive-file checklist

## Major Folders

These sections list the files that are most important when working in each folder. They are not exhaustive inventories of every possible line of behavior, but they cover the files most likely to matter during maintenance.

### `/Ads reporting/`

- [Meta Ad Performance.html](/Ads reporting/Meta Ad Performance.html)
  - Type: `browser page`
  - Purpose: Meta/Google/GHL reporting dashboard UI
  - Live/active: yes
  - Shared: no
  - Likely legacy: no, but naming is inconsistent
  - Risky to change: high
- Notes: calls `/api/MetaAdPerformace/*`; contains report/export presentation logic
- Notes (2026-03): source/journey-path logic now normalizes to `Meta` vs `Google` and shows landing pages as a journey path detail

### `/Air-Cons/`

- [aux-mini-vrf-pricing.html](/Air-Cons/aux-mini-vrf-pricing.html)
  - Type: `browser page`
  - Purpose: AUX Mini VRF pricing tool and browser-side export flow
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high
  - Notes: includes browser-generated export/report behavior

### `/api/`

#### `/api/battery/`

- [request-callback.js](/api/battery/request-callback.js)
  - Type: `API route`
  - Purpose: handles battery callback submissions and generates email HTML
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high
  - Notes: also functions as an `email/report template` source

#### `/api/MetaAdPerformace/`

- [auth.js](/api/MetaAdPerformace/auth.js)
  - Type: `API route`
  - Purpose: reporting auth helper endpoint
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no, but path naming is legacy
  - Risky to change: very high

- [config.js](/api/MetaAdPerformace/config.js)
  - Type: `API route`
  - Purpose: secure config bootstrap for reporting UI
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no, but path naming is legacy
  - Risky to change: very high

- [ghl.js](/api/MetaAdPerformace/ghl.js)
  - Type: `API route`
  - Purpose: CRM/GoHighLevel proxy for reporting
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no, but path naming is legacy
  - Risky to change: very high

- [google-spend.js](/api/MetaAdPerformace/google-spend.js)
  - Type: `API route`
  - Purpose: Google Ads spend data endpoint for reporting
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no, but path naming is legacy
  - Risky to change: very high

- [send-report.js](/api/MetaAdPerformace/send-report.js)
  - Type: `API route`
  - Purpose: scheduled daily report sender
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no, but path naming is legacy
  - Risky to change: very high
  - Notes: also functions as an `email/report template` source and is coupled to Vercel cron
  - Notes (2026-03): journey path output now mirrors dashboard (landing page shown as path detail under Meta/Google)

#### `/api/smoke-alarms/`

- [send.js](/api/smoke-alarms/send.js)
  - Type: `API route`
  - Purpose: smoke alarm form submission and quote email flow
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high
  - Notes: also functions as an `email/report template` source

- [accept.js](/api/smoke-alarms/accept.js)
  - Type: `API route`
  - Purpose: quote acceptance notification flow
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high
  - Notes: also functions as an `email/report template` source

- [google-key.js](/api/smoke-alarms/google-key.js)
  - Type: `API route`
  - Purpose: browser-safe bootstrap for Google Maps Places key

- [send-reminder.js](/api/smoke-alarms/send-reminder.js)
  - Type: `API route`
  - Purpose: quote reminder email flow for the quote tracker
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high
  - Notes: updates `reminder_count` + `last_reminder_sent_at` in `quote_emails`
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high

#### `/api/smoke-alarms/reports/`

- [index.js](/api/smoke-alarms/reports/index.js)
  - Type: `API route`
  - Purpose: combined report email endpoint — handles both install summary relay and installer pay summary builder in a single function; routes on request body shape (`html` field → install summary, `summary` field → pay summary)
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high
  - Notes: consolidated from two separate files to stay within Vercel Hobby plan 12-function limit; frontend callers use `/api/smoke-alarms/reports` (no sub-path)

### `/assets/`

- [48 PX.png](/assets/48 PX.png)
  - Type: `shared asset`
  - Purpose: square logo asset, now intended only for square-only technical contexts
  - Live/active: yes
  - Shared: yes
  - Likely legacy: partly
  - Risky to change: medium

- [48 PX (#f5f6f8).png](/assets/48 PX (#f5f6f8).png)
  - Type: `shared asset`
  - Purpose: light-surface square logo variant, now intended only for square-only technical contexts
  - Live/active: yes
  - Shared: yes
  - Likely legacy: partly
  - Risky to change: medium

- [Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg](/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg)
  - Type: `shared asset`
  - Purpose: canonical light-background horizontal logo and email-safe base asset
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high

- [goldsure-inverted-logo.jpg](/assets/goldsure-inverted-logo.jpg)
  - Type: `shared asset`
  - Purpose: canonical dark-background logo
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high

- [goldsure-logo.jpg](/assets/goldsure-logo.jpg)
  - Type: `shared asset`
  - Purpose: horizontal logo on a white/light background — used in email signatures (quote + reminder emails)
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: medium

- [goldsure-technician.png](/assets/goldsure-technician.png)
  - Type: `shared asset`
  - Purpose: smoke alarm marketing/support imagery
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: medium

- [icon-192x192.png](/assets/icon-192x192.png)
  - Type: `shared asset`
  - Purpose: PWA/touch icon
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high

- [icon-512x512.png](/assets/icon-512x512.png)
  - Type: `shared asset`
  - Purpose: high-resolution PWA icon
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: high

- [Smoke Alarm Placement Guide.png](/assets/Smoke Alarm Placement Guide.png)
  - Type: `shared asset`
  - Purpose: informational/support image for smoke alarm compliance content
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: medium

### `/Battery/`

- [battery-roi.html](/Battery/battery-roi.html)
  - Type: `browser page`
  - Purpose: battery and solar ROI calculator
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high

- [request-callback.html](/Battery/request-callback.html)
  - Type: `browser page`
  - Purpose: battery callback form landing page
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: high

- [thank-you.html](/Battery/thank-you.html)
  - Type: `browser page`
  - Purpose: battery callback confirmation page
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high

### `/calendar/`

- [staff-leave-planner.html](/calendar/staff-leave-planner.html)
  - Type: `browser page`
  - Purpose: staff leave planner UI
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high

### `/docs/`

- [route-dependencies.md](/docs/route-dependencies.md)
  - Type: `documentation`
  - Purpose: route/path dependency note for safe cleanup and restructuring work
  - Live/active: yes for maintainers
  - Shared: yes
  - Likely legacy: no
  - Risky to change: low

### `/smoke-alarms/`

- [smoke-alarm.html](/smoke-alarms/smoke-alarm.html)
  - Type: `browser page`
  - Purpose: main smoke alarm sales portal/tool
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: very high

- [smoke-alarm-troubleshooting.html](/smoke-alarms/smoke-alarm-troubleshooting.html)
  - Type: `browser page`
  - Purpose: troubleshooting/support flow
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high

- [raptor-enquiry-workflow.html](/smoke-alarms/raptor-enquiry-workflow.html)
  - Type: `browser page`
  - Purpose: purchase enquiry workflow/support page
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: medium to high

- [quote-tracker.html](/smoke-alarms/quote-tracker.html)
  - Type: `browser page`
  - Purpose: quote tracking UI
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: high
  - Notes: supports reminder counts and follow-up actions; feeds the sales-portal summary block

- [qld-smoke-alarm-training-certificate.html](/smoke-alarms/qld-smoke-alarm-training-certificate.html)
  - Type: `browser page`
  - Purpose: staff training assessment and printable certification page for smoke alarm competency
  - Live/active: internal-only
  - Shared: no
  - Likely legacy: no clear evidence of legacy, but not linked from repo navigation
  - Risky to change: medium

- [Installer Pay Summary.html](/smoke-alarms/Installer Pay Summary.html)
  - Type: `browser page`
  - Purpose: installer pay summary dashboard and printable payment report page
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: high

- [install-summary.html](/smoke-alarms/install-summary.html)
  - Type: `browser page`
  - Purpose: install summary submission/reporting page
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: high

- [compliance.html](/smoke-alarms/compliance.html)
  - Type: `browser page`
  - Purpose: compliance-focused landing page with embedded lead-capture forms and reference content
  - Live/active: probably
  - Shared: no
  - Likely legacy: no clear evidence of legacy
  - Risky to change: medium to high

- [calculatorpdf.html](/smoke-alarms/calculatorpdf.html)
  - Type: `browser page`
  - Purpose: smoke alarm quote calculator with PDF generation and webhook submission
  - Live/active: probably
  - Shared: no
  - Likely legacy: no clear evidence of legacy
  - Risky to change: very high because `vercel.json` targets this exact path

#### `/smoke-alarms/calendar/`

- [index.html](/smoke-alarms/calendar/index.html)
  - Type: `browser page`
  - Purpose: electrician calendar PWA UI — shows scheduled jobs by electrician, supports availability toggling, CSV upload, and team management
  - Live/active: yes
  - Shared: no
  - Likely legacy: no
  - Risky to change: very high
  - Notes: worker view is accessed via `?electrician=SLUG` query param; admin view has no query param; no ICS/calendar-feed endpoint (was removed — Google Calendar sync was unreliable due to 24h refresh delay)

- [manifest.json](/smoke-alarms/calendar/manifest.json)
  - Type: `config`
  - Purpose: PWA manifest for electrician calendar
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high

- [sw.js](/smoke-alarms/calendar/sw.js)
  - Type: `config`
  - Purpose: service worker for electrician calendar
  - Live/active: yes
  - Shared: yes
  - Likely legacy: no
  - Risky to change: very high

## Critical Flows

### Homepage / Index

- Entry point: [index.html](/index.html)
- Purpose: internal navigation hub
- What the user sees: a menu into the main operational tools and landing pages
- Dependencies:
  - shared assets in `/assets/`
  - direct links into `/smoke-alarms/`, `/Battery/`, `/Air-Cons/`, `/Ads reporting/`, and `/calendar/`
- Risk profile:
  - breaking links here disrupts internal navigation across the repo

### Accept-Quote Flow

- Entry point: [accept-quote.html](/accept-quote.html)
- Main API dependency: [api/smoke-alarms/accept.js](/api/smoke-alarms/accept.js)
- Purpose: customer quote acceptance confirmation and follow-up trigger
- What the user sees: a public-facing confirmation page tied to an existing quote
- Risk profile:
  - public-facing flow
  - touches quote records and notifications

### Battery Callback Flow

- Landing page: [Battery/request-callback.html](/Battery/request-callback.html)
- Confirmation page: [Battery/thank-you.html](/Battery/thank-you.html)
- Form API: [api/battery/request-callback.js](/api/battery/request-callback.js)
- Supporting page/tool: [Battery/battery-roi.html](/Battery/battery-roi.html)
- What the user sees: a battery callback request form, then a thank-you page
- Risk profile:
  - form-sensitive
  - API-sensitive
  - email-template-sensitive

### Smoke Alarm Flow

- Main app: [smoke-alarms/smoke-alarm.html](/smoke-alarms/smoke-alarm.html)
- Supporting pages:
  - [smoke-alarms/quote-tracker.html](/smoke-alarms/quote-tracker.html)
  - [smoke-alarms/smoke-alarm-troubleshooting.html](/smoke-alarms/smoke-alarm-troubleshooting.html)
  - [smoke-alarms/raptor-enquiry-workflow.html](/smoke-alarms/raptor-enquiry-workflow.html)
  - [smoke-alarms/install-summary.html](/smoke-alarms/install-summary.html)
  - [smoke-alarms/calendar/index.html](/smoke-alarms/calendar/index.html)
- Main APIs:
  - [api/smoke-alarms/send.js](/api/smoke-alarms/send.js)
  - [api/smoke-alarms/accept.js](/api/smoke-alarms/accept.js)
  - [api/smoke-alarms/send-reminder.js](/api/smoke-alarms/send-reminder.js)
  - [api/smoke-alarms/google-key.js](/api/smoke-alarms/google-key.js)
  - [api/smoke-alarms/reports/index.js](/api/smoke-alarms/reports/index.js)
- What the user sees: the core sales and operations workflow for smoke alarm quotes, support, installs, and calendar access
- Risk profile:
  - most interconnected area in the repo
  - mixes browser UI, forms, calendars, support tooling, and report-style pages

### Reporting Flow

- Dashboard UI: [Ads reporting/Meta Ad Performance.html](/Ads reporting/Meta Ad Performance.html)
- APIs:
  - [api/MetaAdPerformace/auth.js](/api/MetaAdPerformace/auth.js)
  - [api/MetaAdPerformace/config.js](/api/MetaAdPerformace/config.js)
  - [api/MetaAdPerformace/ghl.js](/api/MetaAdPerformace/ghl.js)
  - [api/MetaAdPerformace/google-spend.js](/api/MetaAdPerformace/google-spend.js)
  - [api/MetaAdPerformace/send-report.js](/api/MetaAdPerformace/send-report.js)
- What the user sees: an internal reporting dashboard with exports and scheduled report behavior behind it
- Risk profile:
  - cron-sensitive
  - API-sensitive
  - CRM/report-template-sensitive

## Safe Cleanup Candidates

Documentation only. These are good candidates for future cleanup planning, not automatic change.

- Continue reducing inconsistent naming in documentation first, since runtime paths are still live and mixed-case.
- Consolidate remaining legacy references to `goldsure-logo.jpg` and square logos where layout permits, guided by [BRANDING_MAP.md](./BRANDING_MAP.md).
- Standardize documentation language around "live", "legacy", and "shared" so future audits stay comparable.
- Review mixed branding/report pages individually:
  - [Ads reporting/Meta Ad Performance.html](/Ads reporting/Meta Ad Performance.html)
  - [smoke-alarms/Installer Pay Summary.html](/smoke-alarms/Installer Pay Summary.html)
- Consider documenting public-vs-internal status of unclear smoke-alarm pages before any restructure:
  - [smoke-alarms/compliance.html](/smoke-alarms/compliance.html)
  - confirm whether it is linked externally from ads, emails, or landing-page campaigns
  - verify whether it is tracked as a public acquisition page or mainly a reference page

## Do Not Touch Casually

### Vercel-sensitive

- [vercel.json](/vercel.json)
- [api/MetaAdPerformace/send-report.js](/api/MetaAdPerformace/send-report.js)
- [smoke-alarms/calculatorpdf.html](/smoke-alarms/calculatorpdf.html)

### API-sensitive

- Anything under [api](/api)
- Especially:
  - [api/MetaAdPerformace/auth.js](/api/MetaAdPerformace/auth.js)
  - [api/MetaAdPerformace/config.js](/api/MetaAdPerformace/config.js)
  - [api/MetaAdPerformace/ghl.js](/api/MetaAdPerformace/ghl.js)
  - [api/MetaAdPerformace/google-spend.js](/api/MetaAdPerformace/google-spend.js)
  - [api/smoke-alarms/send.js](/api/smoke-alarms/send.js)
  - [api/smoke-alarms/accept.js](/api/smoke-alarms/accept.js)
  - [api/smoke-alarms/google-key.js](/api/smoke-alarms/google-key.js)
  - [api/smoke-alarms/reports/index.js](/api/smoke-alarms/reports/index.js)
  - [api/battery/request-callback.js](/api/battery/request-callback.js)

### Form-sensitive

- [accept-quote.html](/accept-quote.html)
- [Battery/request-callback.html](/Battery/request-callback.html)
- [smoke-alarms/smoke-alarm.html](/smoke-alarms/smoke-alarm.html)
- [smoke-alarms/install-summary.html](/smoke-alarms/install-summary.html)

### Report-sensitive

- [Ads reporting/Meta Ad Performance.html](/Ads reporting/Meta Ad Performance.html)
- [api/MetaAdPerformace/send-report.js](/api/MetaAdPerformace/send-report.js)
- [api/battery/request-callback.js](/api/battery/request-callback.js)
- [api/smoke-alarms/send.js](/api/smoke-alarms/send.js)
- [api/smoke-alarms/accept.js](/api/smoke-alarms/accept.js)
- [smoke-alarms/Installer Pay Summary.html](/smoke-alarms/Installer Pay Summary.html)
- [smoke-alarms/install-summary.html](/smoke-alarms/install-summary.html)

### PWA/calendar-sensitive

- [smoke-alarms/calendar/index.html](/smoke-alarms/calendar/index.html)
- [smoke-alarms/calendar/manifest.json](/smoke-alarms/calendar/manifest.json)
- [smoke-alarms/calendar/sw.js](/smoke-alarms/calendar/sw.js)

## Still Unclear

- Whether [/smoke-alarms/compliance.html](/smoke-alarms/compliance.html) is a high-traffic live landing page or a lower-traffic reference page.
