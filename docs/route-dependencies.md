# Route Dependencies

This repo is live and has route-sensitive paths that should not be renamed casually.

## Preserve as-is for now

- Public folders with mixed naming that are already live:
  - `/Battery/`
  - `/Air-Cons/`
  - `/Ads reporting/`
- Public page paths under `/smoke-alarms/`
- Existing API route names under `/api/`

## Vercel-coupled paths

- [vercel.json](../vercel.json) schedules the cron job at `/api/MetaAdPerformace/send-report`.
- [vercel.json](../vercel.json) also applies custom headers to `/smoke-alarms/calculatorpdf.html`.
- Do not rename either path without updating deployment config and preserving compatibility.

## API route dependencies

- The `MetaAdPerformace` directory name contains a typo, but it is a live dependency.
- Frontend code currently calls:
  - `/api/MetaAdPerformace/meta` (GET = config, POST = auth — merged from separate auth.js/config.js to stay within Vercel's function-count limit)
  - `/api/MetaAdPerformace/ghl`
  - `/api/MetaAdPerformace/google-spend`
- Keep those route names working until aliases or wrappers are added.

## Quote tracker dependencies

- `/smoke-alarms/quote-tracker.html` calls `/api/smoke-alarms/send-reminder`.
- Reminder tracking persists in `quote_emails` via `reminder_count` and `last_reminder_sent_at`.
- `/smoke-alarms/smoke-alarm.html` reads quote tracker data to show the follow-up summary bar.

## Report email dependencies

- `/smoke-alarms/install-summary.html` calls `/api/smoke-alarms/reports` (POST `{ html, to, subject, from }`).
- `/smoke-alarms/Installer Pay Summary.html` calls `/api/smoke-alarms/reports` (POST `{ summary, to, subject }`).
- Both routes are handled by the single `api/smoke-alarms/reports/index.js` function.
- Do not split this back into separate files without freeing a Vercel function slot first.

## PWA path dependencies

- `/smoke-alarms/calendar/` is path-sensitive.
- Its manifest uses `/smoke-alarms/calendar/` for both `start_url` and `scope`.
- Treat that folder as fixed unless the manifest, service worker behavior, and inbound links are updated together.

## Safe cleanup pattern

- Root-relative links like `/smoke-alarms/...`, `/calendar/...`, `/assets/...`, and `/api/...` are safe when they point to existing paths in this repo.
- Cross-domain references to GitHub Pages or pinned raw GitHub assets should be reviewed separately before changing them.
