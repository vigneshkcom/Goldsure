# Naming Plan

This file is a naming-and-organisation plan only. It does not authorize runtime renames.

Use it to reduce confusion while preserving:

- current public URLs
- current Vercel behavior
- current API route names
- current report/email delivery behavior

## Scope

- Canonical runtime: `https://portal.goldsure.com.au`
- Current public folder names remain live until explicit migration work is approved
- Repo-relative paths remain the documentation standard
- Naming cleanup should favor consistency, not churn

## Proposed Naming Standard

### Folder Names

- Use lowercase kebab-case for future canonical folder names
- Avoid spaces in folder names
- Avoid mixed casing in folder names
- Avoid abbreviated or typoed names when a clear full name exists

Preferred future examples:

- `/ads-reporting/`
- `/air-cons/`
- `/battery/`
- `/smoke-alarms/`
- `/api/meta-ad-performance/`

### HTML File Names

- Use lowercase kebab-case
- Keep filenames descriptive but short
- Avoid spaces
- Avoid compressed names like `calculatorpdf`
- Prefer consistent suffix patterns for flow pages and tools

Preferred future examples:

- `meta-ad-performance.html`
- `installer-pay-summary.html`
- `calculator-pdf.html`
- `request-callback.html`
- `smoke-alarm-troubleshooting.html`

### Documentation Files

- Use uppercase stable root names only for shared repo docs already in use:
  - `/README.md`
  - `/docs/AGENTS.md`
  - `/docs/ARCHITECTURE.md`
  - `/docs/UI_GUIDE.md`
  - `/docs/BRANDING_MAP.md`
- Use lowercase kebab-case under `/docs/` for planning and operational notes

Preferred examples under `/docs/`:

- `/docs/route-dependencies.md`
- `/docs/cleanup-matrix.md`
- `/docs/naming-plan.md`

### Asset Names

- Keep existing live asset names for compatibility until migration is approved
- Prefer lowercase kebab-case for future canonical asset names
- Prefer purpose-driven names over export/spec-driven names
- Avoid spaces, parentheses, and embedded color comments in filenames

Preferred future examples:

- `logo-horizontal.jpg`
- `logo-inverted.jpg`
- `logo-square.png`
- `logo-square-light.png`
- `icon-192.png`
- `icon-512.png`
- `smoke-alarm-placement-guide.png`

## Naming Cleanup Matrix

| Current path | Reason it is confusing | Proposed future path/name | Public URL impact exists | Alias/wrapper needed | Risk level |
|---|---|---|---|---|---|
| `/Ads reporting/` | space in folder name; mixed naming style; inconsistent with repo sections | `/ads-reporting/` | yes | yes | high |
| `/Ads reporting/Meta Ad Performance.html` | spaces and title-case filename; hard to link consistently | `/ads-reporting/meta-ad-performance.html` | yes | yes | high |
| `/Air-Cons/` | mixed case; inconsistent casing standard | `/air-cons/` | yes | yes | high |
| `/Battery/` | root folder uses uppercase while peer sections vary | `/battery/` | yes | yes | high |
| `/api/MetaAdPerformace/` | live typo in route namespace; easily “fixed” by accident | `/api/meta-ad-performance/` | yes | yes | very high |
| `/smoke-alarms/Installer Pay Summary.html` | spaces and title case; internal tool looks ad hoc by filename | `/smoke-alarms/installer-pay-summary.html` | yes | yes | high |
| `/smoke-alarms/calculatorpdf.html` | compressed name hides purpose; unclear whether it is calculator, PDF, or both | `/smoke-alarms/calculator-pdf.html` | yes | yes | very high |
| `/assets/48 PX.png` | space-heavy export-style name; does not describe usage | `/assets/logo-square.png` | yes | likely compatibility copy or alias path | medium |
| `/assets/48 PX (#f5f6f8).png` | space-heavy name; embedded color note in filename; not self-explanatory | `/assets/logo-square-light.png` | yes | likely compatibility copy or alias path | medium |
| `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg` | export-spec filename is long and hard to reuse consistently | `/assets/logo-horizontal.jpg` | yes | likely compatibility copy or alias path | high |
| `/assets/goldsure-logo.jpg` | ambiguous against other logo files; unclear if primary or legacy | `/assets/logo-horizontal-legacy.jpg` or compatibility-only legacy file | possible | likely no rename until fully verified | medium |
| `/assets/icon-192x192.png` | acceptable but could be more consistent with future naming | `/assets/icon-192.png` | yes | likely compatibility copy | high |
| `/assets/icon-512x512.png` | acceptable but could be more consistent with future naming | `/assets/icon-512.png` | yes | likely compatibility copy | high |
| `/assets/Smoke Alarm Placement Guide.png` | spaces and title case | `/assets/smoke-alarm-placement-guide.png` | yes | likely compatibility copy | medium |

## Naming Cleanups Safe In Docs Only

These are safe now because they only affect documentation language, planning, and future conventions.

- Standardize docs to refer to future canonical names without changing runtime paths.
- Keep calling out `/api/MetaAdPerformace/` as typoed-but-live.
- Treat `/Ads reporting/`, `/Air-Cons/`, and `/Battery/` as legacy naming styles in docs.
- Document canonical future asset names in planning docs before any file work happens.
- Prefer lowercase kebab-case for any new docs created under `/docs/`.

## Naming Cleanups Safe Later With Path Updates

These are plausible future renames, but only after path updates and compatibility handling are ready.

- `/Ads reporting/` -> `/ads-reporting/`
- `/Ads reporting/Meta Ad Performance.html` -> `/ads-reporting/meta-ad-performance.html`
- `/Air-Cons/` -> `/air-cons/`
- `/Battery/` -> `/battery/`
- `/smoke-alarms/Installer Pay Summary.html` -> `/smoke-alarms/installer-pay-summary.html`
- `/assets/48 PX.png` -> future canonical square-logo name
- `/assets/48 PX (#f5f6f8).png` -> future canonical light-square-logo name
- `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg` -> future canonical horizontal-logo name
- `/assets/Smoke Alarm Placement Guide.png` -> `/assets/smoke-alarm-placement-guide.png`

These all need a compatibility strategy first:

- alias route
- wrapper page
- duplicate retained file
- staged reference migration

## Naming Cleanups Too Risky For Now

These should not be attempted until explicit approval, compatibility planning, and verification exist.

- `/api/MetaAdPerformace/` route rename
  - reason: live frontend/API dependency plus cron coupling
- `/smoke-alarms/calculatorpdf.html` rename
  - reason: explicitly targeted in `/vercel.json`
  - reason: PWA `scope`, `start_url`, and service-worker sensitivity
- `/assets/icon-192x192.png` and `/assets/icon-512x512.png` rename
  - reason: PWA/app-icon contexts are easy to break silently

## Lowest-Risk Future Naming Cleanups

These are the least controversial naming problems to fix later, assuming compatibility wrappers or retained legacy files are used.

1. `/smoke-alarms/Installer Pay Summary.html` -> clearer kebab-case page name
2. `/Ads reporting/Meta Ad Performance.html` -> clearer kebab-case page name
3. `/assets/Smoke Alarm Placement Guide.png` -> clearer asset name
4. `/assets/48 PX.png` -> clearer square-logo name
5. `/assets/48 PX (#f5f6f8).png` -> clearer light-square-logo name

These are lower-risk than folder or API namespace renames because they can often be handled with compatibility copies or wrapper pages.

## Most Confusing Names That Should Eventually Be Fixed

1. `/api/MetaAdPerformace/`
2. `/Ads reporting/`
3. `/Ads reporting/Meta Ad Performance.html`
4. `/smoke-alarms/Installer Pay Summary.html`
5. `/smoke-alarms/calculatorpdf.html`
6. `/assets/48 PX (#f5f6f8).png`
7. `/assets/48 PX.png`
8. `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
9. `/Air-Cons/`
10. `/Battery/`

## Should Not Be Attempted Yet

- Renaming `/api/MetaAdPerformace/`
- Renaming `/smoke-alarms/calculatorpdf.html`
- Renaming `/Battery/`, `/Air-Cons/`, or `/Ads reporting/` without wrappers or aliases
- Renaming PWA icon files without verifying manifest and browser install behavior

## Notes

- Canonical naming can be documented before it is implemented.
- Runtime migration should happen only after:
  - path inventory
  - compatibility strategy
  - alias/wrapper plan
  - verification against Vercel, forms, reports, and scheduled jobs
