# Branding Map

This file defines the canonical brand asset usage for the live Goldsure portal repo.

## Canonical Environment

- Canonical browser environment: `https://portal.goldsure.com.au` on Vercel
- Preferred browser asset references: root-relative `/assets/...`
- Email-safe assets may still require absolute `https://portal.goldsure.com.au/assets/...` URLs

## Light Background Logo

- File path: `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- Intended usage:
  - all standard browser logo placements on light backgrounds
  - headers and footers on white or pale surfaces
  - email-safe horizontal logo usage when referenced with an absolute portal URL
- Should not be used:
  - on dark backgrounds
  - as a favicon or PWA icon
  - where a square aspect ratio is technically required

## Inverted / Dark-Background Logo

- File path: `/assets/goldsure-inverted-logo.jpg`
- Intended usage:
  - dark-background layouts
  - generated browser-side exports on dark or branded report surfaces
  - contexts where the normal logo does not have enough contrast
- Current known usage:
  - none currently — the AUX Mini VRF pricing tool that used it was removed
- Should not be used:
  - as the default portal header logo
  - as a favicon or PWA icon
  - in email/report templates without separately confirming the delivery context

## Legacy Primary Portal Logo

- File path: `/assets/goldsure-logo.jpg`
- Intended usage:
  - legacy browser branding where already present
  - only when a specific page has not yet been migrated to the horizontal logo rule
- Should not be used:
  - for new light-background browser branding
  - on dark backgrounds
  - as a favicon or PWA icon

## Square Mark / Icon

- File path: `/assets/48 PX.png`
- Intended usage:
  - square-only technical contexts where a square aspect ratio is required
  - fallback compact placements only when the horizontal logo will not fit
- Should not be used:
  - as a default browser header logo on light backgrounds
  - when the horizontal light-background logo fits cleanly
  - as a favicon or PWA icon

## Square Mark / Light-Surface Variant

- File path: `/assets/48 PX (#f5f6f8).png`
- Intended usage:
  - square-only technical contexts on the repo's light grey surface color
  - fallback compact placements only when the horizontal logo will not fit and the surface matches `#f5f6f8`
- Should not be used:
  - as a default browser header logo on light backgrounds
  - when the horizontal light-background logo fits cleanly
  - as a favicon or PWA icon
  - in email HTML unless explicitly tested there

## Favicon / PWA Icons

- File path: `/assets/icon-192x192.png`
- Intended usage:
  - PWA icon
  - Apple touch icon
  - installable app/icon surfaces
- Current known usage:
  - [smoke-alarms/calendar/index.html](../smoke-alarms/calendar/index.html)
  - [smoke-alarms/calendar/manifest.json](../smoke-alarms/calendar/manifest.json)
- Should not be used:
  - as a normal page header logo
  - in email HTML
  - as a substitute for the square mark on content pages

- File path: `/assets/icon-512x512.png`
- Intended usage:
  - high-resolution PWA icon
  - install prompts and launcher surfaces
- Current known usage:
  - [smoke-alarms/calendar/manifest.json](../smoke-alarms/calendar/manifest.json)
- Should not be used:
  - as a normal page header logo
  - in email HTML
  - as a substitute for the square mark on content pages

## Email-Safe Absolute Logo

- File path: `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- Canonical email-safe URL:
  - `https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`
- Intended usage:
  - generated email HTML
  - transactional email templates
  - any delivery context where relative asset paths may not resolve reliably
- Current known usage:
  - [api/battery/request-callback.js](../api/battery/request-callback.js)
- Should not be used:
  - as the default browser logo when a root-relative browser asset is available
  - as a favicon or PWA icon
  - as the compact square mark in tool headers

## Non-Logo Brand Assets

- File path: `/assets/goldsure-technician.png`
- Intended usage:
  - marketing/support imagery
  - content sections such as compliance pages
- Should not be used:
  - as a logo substitute
  - as an icon, favicon, or header mark

- File path: `/assets/Smoke Alarm Placement Guide.png`
- Intended usage:
  - informational content image
  - modal/help/support placement guide usage
- Should not be used:
  - as a logo substitute
  - as a favicon, icon, or header mark

## Practical Selection Rules

- On light backgrounds, use `/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg`.
- On dark backgrounds, use `/assets/goldsure-inverted-logo.jpg`.
- Keep `/assets/48 PX.png` and `/assets/48 PX (#f5f6f8).png` only for square-only technical contexts.
- Use `/assets/icon-192x192.png` and `/assets/icon-512x512.png` only for PWA/app-icon contexts.
- Use the absolute `https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg` URL for email HTML unless the delivery context is proven to support relative assets.
