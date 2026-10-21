# Battery quotations: implementation and launch checklist

## Staff pages

- `/Battery/quotes/index.html`: New Quote and Quote Tracker. The staff pricing-management and upload screens have been removed at the user’s request.
- `/Battery/quote-tracker.html`: direct tracker entry.
- `/Battery/quote.html?token=...`: customer-facing quotation, available after a confirmed send.
- API actions are dispatched through `/api/battery/request-callback?module=quotes`; no new serverless function is added.

## Review before launch

1. Review the local preview and generated PDF.
2. Apply `/supabase/battery-quotations.sql` only after approval. It adds five private tables, a reference sequence, immutable quote snapshots, and a private PDF bucket. It does not modify existing product tables.
3. Set `BATTERY_QUOTES_ADMIN_PASSWORD` to a distinct administrator password. Staff use `BATTERY_QUOTES_STAFF_PASSWORD` or the existing `DASHBOARD_PASSWORD`. Administrator access is reserved for delivery verification and server-side maintenance; staff do not upload documents or manage package pricing in the UI.
4. Optionally set `BATTERY_QUOTES_SESSION_SECRET`; otherwise the server-only service-role key signs eight-hour sessions. Changing either invalidates sessions. Do not put passwords in static files, URLs or local storage.
5. Existing server-side Supabase service-role, Hostinger Mail and GHL credentials are used. The application reports missing provider/storage configuration instead of pretending to send.
6. Supply the actual product PDFs. Commit approved brochures under `/assets/battery-quote-documents/` and register their immutable IDs, names, kinds, sizes, hashes and matching package IDs in `/Battery/quotes/documents.json`. Packages acquire those attachments automatically; no staff upload step is needed. Keep prior file versions for historical quote resends. Previously uploaded private documents remain supported by the backend. Maximum 3 MB per document and 8 MB combined attachment payload, plus quote PDF.
7. Confirm the tax-display setting; initial setting is unspecified. The user confirmed $39.50 per STC for both gross-up and deduction. System price before STC discount = saved OOP + STCs × $39.50. Federal STC discount = negative STCs × $39.50. Final OOP remains the supplied package price. Save the rate, gross and deduction in each quote snapshot; do not label the rate as government-guaranteed.
8. Confirm a controlled test recipient and approve one test send before customer use. Verify the quote PDF, actual product attachments, provider confirmation, saved tracker record, and GHL contact/opportunity.

## Verified GHL destination (read-only, 21 October 2026)

- Pipeline: `Battery Customers` (`vNOSzOo0pXEnGS38xuNw`).
- Stage: `New Lead` (`5ecf91e1-3067-4a4e-be2a-641cd0027923`).
- Source: `Direct Call`.
- Each new saved quote has one opportunity; resending or retrying CRM uses the existing reference and opportunity. It does not move an opportunity backwards after sales staff progress it.
- The GHL contact note includes the customer quotation link, quotation PDF link, system details, OOP and matching attachment links. GHL sync is triggered after the provider confirms sending. Failure remains visible in the tracker and can be retried without another customer email.

## Quote history and delivery

- The five starting packages are database records seeded once. Staff pricing screens have been removed; new configuration is maintained in the repository/database setup. `/Battery/quotes/seed.json` supplies the same data to the local preview only; the production UI always loads saved database records.
- A saved quote snapshots customer, package/version, OOP, STCs, phase, tax display and exact document versions. It cannot silently change when a package is edited. To revise a saved quotation, create a new draft. This also applies when documents are linked after a draft was saved.
- Delivery states: Draft, Sending, Sent, Send failed, Delivery uncertain. Sent means provider acceptance, not verified inbox delivery. Customer view counts are separate and can be influenced by forwarded links or scanners.
- Atomic send claims prevent two simultaneous sends. Resend requires explicit review/confirmation. A provider/network timeout blocks automatic retries until an administrator checks the provider and records evidence.
- The provider-confirmed tracker update is retried without recontacting the mail provider. If tracking cannot be updated, the Sending state remains blocked until investigated.
- Staff-only internal notes never appear on the customer page, email or PDF. Customer links use opaque UUID bearer tokens and provide no access to package management.
- The tracker currently loads the most recent 1,000 quotes. This bound should be replaced by cursor pagination before the dataset reaches that size.

## Validation

`node --test tests/battery-quotations.test.mjs`

Tests cover exact package seeds, validation, immutable snapshots, authorization, attachment hashes, duplicate-send protection, provider rejection/uncertainty, resend history, GHL destination, public data isolation and PDF content/page count. Existing battery campaign, callback and SMS quote regressions also pass.

The local preview is isolated and persists its own demonstration data. It never calls real mail or GHL services. Production schema, credentials, attachments and real delivery are not confirmed by the local preview.
