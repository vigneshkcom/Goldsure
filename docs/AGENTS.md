# AGENTS

## Working Assumptions

- The canonical environment is `https://portal.goldsure.com.au` on Vercel.
- Root-relative internal links, asset paths, and `/api/...` calls are preferred.
- Never document files using local machine paths; always use repo-relative paths such as `/index.html` or `/api/battery/request-callback.js`.
- GitHub Pages compatibility is not required unless a file is explicitly being kept as legacy or backup.
- Before choosing a logo or icon, check [BRANDING_MAP.md](./BRANDING_MAP.md).
- Logo rule:
  - light backgrounds use `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
  - dark backgrounds use `/assets/goldsure-inverted-logo.jpg`
  - square variants are only for square-only technical contexts
  - `icon-192x192` and `icon-512x512` are only for favicon/PWA/app-icon contexts

## Guardrails

- Preserve all existing public URLs by default.
- Preserve all current API route names by default.
- Do not rename:
  - `/Battery`
  - `/Air-Cons`
  - `/Ads reporting`
  - `/api/MetaAdPerformace`
- Do not change [vercel.json](../vercel.json) without checking cron paths, headers, and any route-sensitive behavior first.
- **Vercel Hobby plan: 12 serverless functions maximum.** The repo is currently at 11 (one slot free). Do not add more than one new file under `/api/` without consolidating existing ones. Each `.js` file directly inside `/api/` or any subfolder counts as one function.

## Email Signature Logos

- Quote email (`api/smoke-alarms/send.js`) and reminder email (`api/smoke-alarms/send-reminder.js`) both use `/assets/goldsure-logo.jpg` (white background) in the agent/contact signature block.
- The header logo in those same emails uses `/assets/goldsure-inverted-logo.jpg` (black background).

## Safe Cleanup Scope

- Safe:
  - normalize same-origin links to root-relative paths
  - normalize same-origin assets to `/assets/...`
  - normalize same-origin API calls to `/api/...`
  - add docs and dependency notes
- Risky:
  - renaming live folders or files
  - changing API route names
  - removing pages that seem unused

## Special Cases

- Email HTML should continue using absolute URLs where clients may not resolve relative assets reliably.
- Generated report/email templates should be reviewed separately before changing asset origins.
- Do not assume the most-used logo file is the correct one; follow [BRANDING_MAP.md](./BRANDING_MAP.md).
