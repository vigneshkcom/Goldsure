# Queensland certificate signer

Staff: `/compliance/`. Electrician: `/compliance/sign.html#<request-id>.<secret>`.
Uses the existing `/api/smoke-alarms/google-key` function with isolated
`qld-certificate-*` actions. Existing actions and GET Maps-key contract are unchanged.

## Workflow

1. Staff unlocks with the existing staff password, looks up a Dataforce job or enters
   details manually. No Dataforce records are created or changed.
2. Staff confirms the commissioning party separately from the homeowner/customer,
   describes the actual installation/equipment tested, and reviews the unsigned PDF.
3. Choose an email invitation or **Save & open SMS portal**. The latter creates the
   request without sending an invitation email or SMS. A same-tab, one-time session
   storage handoff opens `/sms/` with an editable mobile number and message. Review
   in the conversation and press its existing **Send** button. No send is automatic.
   The tracker can also prepare the same private SMS link for an unsigned, unexpired
   email request. SMS delivery/replies remain in the SMS portal; the certificate
   tracker does not misreport preparing an SMS as sending or delivering it.
4. A named electrician follows a private, 14-day email or SMS link, confirms the test date,
   contractor licence, inspection results, safety declaration, authority and consent,
   and draws a signature. Staff credentials alone cannot submit a signature.
5. The signed record is create-only. A PDF is saved, hashed and automatically emailed
   to the customer, commissioning party and `vignesh@goldsure.com.au`. Duplicate
   recipients are removed. The signer can download a copy through the private link.
6. Tracker shows request accepted/unknown/rejected, first signing-page load, signed
   date and completion-email status. Download retrieves stored PDF bytes, not a new PDF.

## Publication checklist (not performed by local tests)

- Review this UI and PDF before publishing. Do not send customer invitations as a test.
- Apply `/docs/qld-certificate-postgres.sql` and `/docs/qld-certificate-storage.sql`
  in goldsure-calendar. The first creates three private PostgreSQL tables with
  RLS and server-only INSERT/SELECT grants; it does not touch existing job/customer
  tables. The storage policies are
  deliberately restrictive, preserving unrelated buckets while denying this bucket
  to `anon` and `authenticated`, even if other broad permissive policies exist.
- Add `QLD_CERTIFICATE_SIGNING_SECRET`: a dedicated cryptographically random secret
  of at least 32 characters. Do not put it in a browser, Git, logs or documentation.
  Changing it invalidates outstanding links. Keep it separate from the staff password.
- Verify existing `DASHBOARD_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATAFORCE_CLIENT_ID`, `DATAFORCE_CLIENT_SECRET`, `HOSTINGER_MAILBOX_RESOURCE_ID`,
  and `HOSTINGER_MAIL_API_TOKEN`. Never fall back to an anonymous Supabase key.
- Publish to Vercel, open the staff page, and initialise private storage. This creates
  only the `qld-compliance-certificates` private PDF bucket, after verifying all
  three PostgreSQL tables exist. There is no fallback to storing JSON in a bucket.
- Verify anonymous/public/authenticated reads and writes are denied. Ensure Storage
  backups cover the new bucket; establish a five-year minimum retention policy.
- Verify a real job lookup read-only, PDF preview, and mobile rendering. Obtain
  approval for a controlled invitation before checking real mail delivery end to end.
- Have the issuing electrical contractor approve certificate wording and applicability.
  This tool does not verify a licence, perform electrical testing or provide legal advice.

## Persistence and recovery

Structured records are stored in PostgreSQL in the existing Supabase project:

- `qld_certificate_requests`: job/customer/site, commissioning party, electrician,
  prefilled fields, delivery channel, creation time and link expiry.
- `qld_certificate_signatures`: actual test date, contractor name/licence/phone,
  signer, inspection results, signature strokes, consent and audit evidence.
- `qld_certificate_events`: first view, email attempt/result, and PDF integrity hash.

JSONB preserves the exact source payload, while generated columns expose key fields
directly in Supabase Table Editor and SQL reports. Foreign keys tie all records to a
certificate, unique keys prevent duplicate signatures/send claims, and RLS plus grants
deny browser access. The service role can INSERT/SELECT but not UPDATE/DELETE these rows.
There are no public policies or signed-PDF URLs. Only PDF bytes remain in private Storage.
PDFs are created with `x-upsert:false`; conflicts reuse existing records. A single
request ID is used for all retries from the draft. Concurrent signing uses the first
persisted signed record, never overwrites it, and never changes final stored PDF bytes.

An immutable send claim is saved before calling Hostinger. A timeout or a crash after
that point is **unknown**, not assumed sent or safe to resend. A provider 4xx rejection
is displayed as rejected. Accepted means accepted by Hostinger, not delivered/read.
No ambiguous mail send is automatically retried. Staff checks the mailbox before
manual delivery. **Recover completion** resumes PDF generation / unattempted delivery
after an interruption; it cannot resend a claimed email. No background retry worker
is installed: the tracker exposes incomplete completion for staff recovery.

If the request was already emailed and its contents are wrong, do not sign it. Contact
the issuing team. This version has no automated revocation or amendment interface;
existing links expire after 14 days. Already signed records are never edited.

## Certificate scope

The supplied static one-page design is adapted to a readable multi-page certificate
and signing record. Old 2013 references are replaced with the current 2026 regulation.
There is no Goldsure logo, brand heading/footer or Goldsure PDF author metadata.
The issuing electrical contractor's confirmed name, licence, phone and signer identify
the issuer. Completed-PDF delivery has neutral wording and identifies that contractor;
it still uses the configured delivery mailbox, not an impersonated contractor address.
Goldsure may still appear as a factual commissioning party if that is accurate.
Branding removal is not a legal release or a determination of responsibility.
Actual test dates and safety declarations are never derived from Dataforce status.
Staff may optionally prefill test date, contractor/licence/phone, inspection findings,
replacement date and observations. Prefills are visible in the unsigned preview and
remain editable for the electrician. Signature, authority, safety confirmation and
electronic consent cannot be prefilled. Final PDF uses the electrician's confirmed
values, not fallback values from the draft. No editing of a signed record is allowed.
Smoke checklist items are explicit Yes/No/Not applicable findings, not pre-certified
printed assertions. A failed electrical safety declaration cannot be signed. Smoke
non-compliance needs observations and is highlighted in the resulting email/PDF.
Non-ASCII text is rendered using PDFKit's standard Latin fonts; review names/addresses
in the PDF preview and do not issue if unsupported characters render incorrectly.

Email/SMS-link access establishes possession of the link, not independent identity or
licence verification. A drawn electronic signature, signed content hash and recorded
timestamp/IP/user agent provide an audit record. This is not a PKI digital signature
or a claim of DocuSign-equivalent identity assurance. The PDF contains the signer and
content hash, not the raw IP/user-agent values.

Primary source: [WorkSafe Queensland certificate requirements](https://www.worksafe.qld.gov.au/laws-and-compliance/electrical-safety-laws/issuing-certificates-of-compliance).
The issuing contractor is responsible for correct declarations and five-year retention.

## Verification

Run `node --test tests/qld-certificates.test.mjs` for validation, auth, token expiry,
read-only lookup, create-only storage, concurrent signing, send deduplication,
unknown/rejected mail outcomes and interruption recovery. Tests use in-memory storage
and mocked email only. The local demo runner uses synthetic `.test` email addresses.
