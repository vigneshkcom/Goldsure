# UI Guide

## Runtime Assumption

All browser UI in this repo should be treated as running primarily on `https://portal.goldsure.com.au`.
Before selecting a logo or icon, check [BRANDING_MAP.md](./BRANDING_MAP.md).

## URL Conventions

- Internal page links: use root-relative paths
  - example: `/smoke-alarms/smoke-alarm.html`
- Shared browser assets: use `/assets/...`
  - example: `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- API calls: use `/api/...`
  - example: `/api/smoke-alarms/send`

## Branding Assets

Current shared assets in active use include:

- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- `/assets/goldsure-inverted-logo.jpg`
- `/assets/goldsure-logo.jpg`
- `/assets/48 PX.png`
- `/assets/48 PX (#f5f6f8).png`
- `/assets/icon-192x192.png`
- `/assets/icon-512x512.png`

Use [BRANDING_MAP.md](./BRANDING_MAP.md) as the source of truth for which one belongs in each context.
Default rule:
- light backgrounds use `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- dark backgrounds use `/assets/goldsure-inverted-logo.jpg`
- square variants are only for square-only technical contexts
- `icon-192x192` and `icon-512x512` are only for favicon/PWA/app-icon usage

## Change Discipline

- Keep visual changes minimal unless specifically requested.
- Prefer link/asset normalization over structural refactors.
- Do not rename public routes as part of UI cleanup.
- Review any email/report template asset changes separately from browser UI changes.
