# Battery proposal redesign and customer acceptance

Development branch: `feature/battery-proposals-acceptance`. Production has not been changed. No live database migration or customer messages were triggered.

## Final customer flow

The latest user direction supersedes PDF attachment requirements in the original brief. The email is a brief thank-you with a **View your quote** button. It has zero attachments. The SMS also points to the interactive quote. Brochures are linked inside the proposal. There is no customer quotation PDF download. Staff can still download a PDF for their records.

The interactive proposal shows the immutable selected system, exact STC breakdown, customer notes, original send and expiry dates, product documents and online acceptance. No payment collection, invented savings, warranty claims or installation diagrams are added.

## Changed components

- Customer page: `Battery/quote.html`, `Battery/quotes/customer.js`, `customer.css`.
- Staff builder/tracker: `Battery/quotes/index.html`, `app.js`, `app.css`.
- Shared validity/energy validation: `Battery/quotes/lifecycle.js`.
- Existing server modules: `lib/battery-quote-api.js`, `battery-quote-model.js`, `battery-quote-store.js`, `battery-quote-render.js`, `battery-quote-sms.js`.
- Additive migration: `supabase/battery-quotation-enhancements.sql`.
- Tests: `tests/battery-quotations.test.mjs`, `tests/battery-acceptance-sql.test.mjs`; PGlite is a development-only dependency for local PostgreSQL tests.
- Isolated preview: `scripts/battery-quote-preview.mjs`.

## Local review

Run `npm install`, then `node scripts/battery-quote-preview.mjs`. Open `http://127.0.0.1:8767/Battery/quotes/index.html`. The terminal lists demonstration awaiting, accepted and expired proposal URLs. Data persists only in `.vercel/battery-enhancement-preview/data.json`. The server binds loopback only. No live database credentials are loaded. Email, SMS and GHL mutations are simulated. The Google public-key endpoint is read-only; Google restrictions may require manual address entry on localhost. Production account access is not needed.

Select a system, fill the customer details, leave electricity details empty and press Send quote. This simulates delivery. In the tracker, Open exposes the email preview and customer quote link. Accepting that link changes only demonstration data. Test a fresh quote to repeat the awaiting-to-accepted flow.

## Behaviour and safeguards

- First provider-confirmed send writes `first_sent_at`, `sent_at` and `expires_at`. Resends preserve these timestamps; send history/count records later sends.
- Validity is 21 calendar days in Australia/Sydney, preserving local wall time across daylight-saving changes. At the exact expiry instant, acceptance is rejected.
- Email deliberately states the 21-day rule and directs customers online for the actual expiry, which is assigned after email provider confirmation. The staff PDF and customer page display the saved expiry date. A draft staff PDF says Draft, with no invented deadline.
- A unique acceptance record per quote and a row-locking database function enforce one acceptance atomically. The acceptance and quote event are committed together. Repeat requests return the original receipt. The database clock enforces expiry and sent status.
- Acceptance records signer, quote ID/reference, timestamp, consent version and exact text. Quote ID refers to the immutable quote snapshot. No IP address or user-agent is collected.
- Staff see Accepted / Awaiting acceptance / Expired separately from delivery/GHL status. Accepted time and signer appear on review. Expired quotes remain readable and cannot be resent to extend validity.
- Acceptance is surfaced through tracker and event history. There is no configured battery staff-notification recipient; no new recipient or external notification provider is invented. GHL lead mapping/stage behaviour is unchanged.
- Energy inputs are independently optional and immutable after save. Bill amount alone does not create savings. No financial model is claimed or displayed.
- Public responses omit internal notes, energy inputs, document storage paths, hashes and GHL IDs. Quote lists omit bearer tokens and internal notes. Customer PDF route remains unavailable. Existing password-free staff workflow is preserved; no authentication redesign is included.
- Preview requires an explicitly isolated store; default preview mail/GHL implementations do not call external services. The local preview script injects only demonstration adapters.

## Migration review before any deployment

Do not deploy this branch until the additive migration is reviewed and applied by an authorized operator. This branch is not compatible with the old schema: it intentionally reports an unavailable/migration-needed error rather than discarding acceptance data. Keep the production branch unchanged until review is complete.

1. Back up the existing battery tables and send-event history. Do not rerun/replace the original `battery-quotations.sql` file as a migration strategy.
2. Review the report below. The original sender overwrote `sent_at` on resends. For a quote with one successful send, existing `sent_at` remains the source. For resends with complete event history, the earliest recorded successful send event supplies the original timestamp. Older events used the immediately-after-send event timestamp, so verify it against provider records when the exact original timestamp matters. The migration refuses to proceed for ambiguous/incomplete resend histories. Correct those timestamps using reviewed provider evidence before continuing; never reset an expired quote to today.
3. If resend history is present and has been reviewed, explicitly run `set goldsure.battery_history_reviewed='yes';` in the same database session before applying the migration. The flag is a review gate, not an instruction to bypass missing evidence. It does not authorize dropping or altering existing customer snapshots.
4. Apply `supabase/battery-quotation-enhancements.sql` once reviewed. It is transactional and rerunnable. It adds nullable fields, backfills from reviewed original history, records a backfill audit event, adds a private acceptance table and a service-role-only function, and extends immutable guards. It adds no anon/public table policies and drops no data.
5. Check REST schema cache has discovered the new acceptance relationship/function. If needed, request PostgREST schema reload through the normal Supabase process.
6. Run tests and staging smoke checks, then request final production approval. Deploy code and verify before allowing staff to send new proposals.

Historical review query:

```sql
select q.id,q.reference,q.sent_at,q.send_count,
 count(e.id) filter(where e.event_type='sent') as recorded_successes,
 min(e.created_at) filter(where e.event_type='sent') as first_recorded_success
from public.battery_quotes q
left join public.battery_quote_events e on e.quote_id=q.id
where q.sent_at is not null
group by q.id,q.reference,q.sent_at,q.send_count
order by q.created_at;
```

Existing unresolved Sending/Delivery uncertain records must be checked with the email provider. Recovery now requires a verified original provider timestamp, rather than inventing a new expiry. Delivery status recovery stays an administrator action.

Rollback: retain all added fields, acceptance rows and audit events. Revert code only after operational review; do not drop acceptance history or remove the immutable validity guard to make old resend code run. Any recovery of historical timestamps needs an explicit reviewed migration.

## Verification

Run:

`node --test tests/battery-quotations.test.mjs tests/battery-acceptance-sql.test.mjs`

The local PostgreSQL tests execute the original schema and the additive migration, test reruns/backfill gates, concurrent submissions, single acceptance/event, expiry/sent-state rejections, immutable energy/expiry and role privileges. API tests cover snapshots, short email/no attachments, SMS, GHL, partial energy, exact expiry boundary and daylight saving, public privacy, resends, delivery failure and preview isolation.

Browser review covers desktop/mobile quote, optional electricity blank, direct simulated send, short email CTA, interactive acceptance, reopen receipt, expired page, accepted tracker filter and print layout. Staff PDF is rendered for visual inspection; it is not attached or sent to customers.

Verified result: all 65 `tests/battery*.test.mjs` tests pass. Desktop/mobile browser acceptance walkthrough and staff PDF render were inspected locally. No production deployment, schema migration, email, SMS or GHL mutation was performed.
