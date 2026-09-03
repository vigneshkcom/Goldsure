# Eco Alliance Xero Recharge - PAUSED

**Status:** Paused by Vignesh on 3 September 2026.

The Goldsure portal feature is built, tested, deployed, and available at:

`https://portal.goldsure.com.au/xero-recharge/`

It is intentionally **not connected to Xero yet**. Do not create a live invoice until the Custom Connection subscription has been purchased, the Xero organisation has been authorised, and the production credentials have been added to Vercel.

## Current setup state

- The Xero developer app `EcoAlliance Meta Ads Recharge` has been created as a **Custom Connection**.
- The intended authorised organisation is **Goldsure Pty Ltd**.
- The minimum required scopes were selected:
  - `accounting.invoices`
  - `accounting.contacts.read`
  - `accounting.settings.read`
  - `accounting.attachments`
- Xero currently shows **Subscription required to connect**.
- The Custom Connection subscription has not been purchased.
- Organisation authorisation is not complete.
- Xero OAuth credentials are not available/configured in production.
- No invoice has been created by this integration.
- The portal remains in **Xero setup required** mode until the credentials are configured.

## What the feature does

The page lets an authorised Goldsure user upload Meta invoice PDFs and create one draft sales invoice in Xero for Eco Alliance's 50% share of the NSW advertising spend.

The designed workflow is:

1. Open `/xero-recharge/` and enter the existing secure Goldsure portal password.
2. Upload one or more Meta invoice PDFs.
3. The server reads each PDF and extracts the Meta invoice number, payment date, transaction ID, total paid amount, and every `Heatpumps Sydney` campaign amount.
4. Only the Sydney campaign amounts are included. Melbourne and other campaign spend is ignored.
5. The page totals the selected NSW spend and calculates exactly 50%, rounded to cents after the selected receipts are combined.
6. The user reviews the amount, tax treatment, payment term, and selected receipts.
7. The user clicks **Create draft in Xero** and confirms the browser prompt.
8. The server finds the existing `Eco Alliance` contact and validates account `421` before creating anything.
9. One `DRAFT` accounts-receivable invoice is created and the selected PDFs are attached to it.
10. The draft is reviewed and sent manually from Xero. The portal never sends or approves the invoice automatically.

## Invoice design

Every invoice is intentionally constrained to these rules:

| Field | Value |
|---|---|
| Invoice type | Sales invoice (`ACCREC`) |
| Contact | Existing active Xero contact named exactly `Eco Alliance` |
| Status | `DRAFT` |
| Currency | AUD |
| Quantity | 1 |
| Unit amount | 50% of the combined selected NSW campaign spend |
| Account | `421 - Advertising Recharge Income` |
| Default tax treatment | Inclusive, so the invoice total stays at exactly 50% |
| Optional tax treatment | Exclusive, which lets Xero add the account's GST on top |
| Default due date | 14 days from the Sydney invoice-creation date |
| Other due-date choices | 7 or 30 days |
| Attachments | The original selected Meta PDF receipts |

The description includes the receipt date range, confirms that only Sydney campaign spend was used, and lists the source Meta invoice numbers.

## Duplicate protection

The integration is designed so a retry should not create a second invoice for the same receipt batch.

- Receipt invoice numbers are sorted and hashed to produce a stable batch identity.
- The Xero reference has the format `EA-META-YYYYMMDD-YYYYMMDD-HASH`.
- Before creating a draft, the server searches Xero for that exact reference.
- If it already exists, the existing invoice is returned instead of creating another one.
- Xero idempotency keys are also supplied for invoice and attachment creation.
- Each attachment is tied to the SHA-256 hash of the PDF that was originally parsed.

## Security design

- The browser never receives the Xero client secret.
- Xero credentials live only in encrypted Vercel production environment variables.
- Portal access uses `XERO_PORTAL_PASSWORD` when set, otherwise the existing `DASHBOARD_PASSWORD`.
- PDF parsing happens on the server.
- Parsed receipt details are signed by the server with an HMAC proof.
- Edited totals or changed PDFs are rejected before any Xero action.
- Only same-origin POST requests are accepted by the API.
- Responses disable caching and do not expose internal credentials.
- A maximum of 10 PDFs is allowed per draft because that is the Xero attachment limit.
- Each PDF must be under 2.5 MB and must contain readable PDF text.
- The integration rejects missing Sydney campaign data, duplicate Meta invoice numbers, invalid receipt dates, and mismatched contact/account details.

## Technical layout

```text
/xero-recharge/index.html
        |
        v
/xero-recharge/app.js
        |
        | same-origin authenticated POST requests
        v
/api/xero-recharge.js
        |
        +--> PDF parsing and signed receipt proof
        +--> Custom Connection access token
        +--> Contact/account validation
        +--> Draft invoice creation
        +--> PDF attachment upload
        |
        v
/lib/xero-recharge.js
        |
        v
Xero Accounting API
```

The implementation uses the official `xero-node` SDK for accounting operations. The client-credentials token request is sent directly to Xero with the singular `scope` form field required by granular Custom Connection scopes.

## API actions

`/api/xero-recharge` is one authenticated serverless endpoint with four actions:

| Action | Purpose |
|---|---|
| `status` | Confirms credentials work and validates the Eco Alliance contact and account 421 |
| `parse` | Reads one uploaded Meta PDF and returns signed receipt data |
| `create` | Creates or recovers the matching draft Xero invoice |
| `attach` | Verifies and attaches one original PDF to the draft |

## Repository files

- `/xero-recharge/index.html` - page structure and user workflow
- `/xero-recharge/styles.css` - desktop and mobile styling
- `/xero-recharge/app.js` - upload, review, calculation, progress, and confirmation UI
- `/api/xero-recharge.js` - authenticated Vercel API handler
- `/lib/xero-recharge.js` - parsing, validation, calculations, Xero client, and duplicate protection
- `/tests/xero-recharge.test.mjs` - automated coverage for parsing, calculations, invoice construction, scopes, signed proofs, and retries
- `/package.json` - `xero-node` and PDF parser dependencies plus the test command

The feature was published to `main` in commits `75fc19c` and `8c8daa9`.

## Vercel configuration required when resuming

Add these encrypted **Production** environment variables without placing their values in source control, chat, screenshots, or this document:

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`

Optional overrides already supported by the code:

- `XERO_PORTAL_PASSWORD` - separate password for this page; otherwise `DASHBOARD_PASSWORD` is used.
- `XERO_RECEIPT_SIGNING_SECRET` - separate HMAC signing secret; otherwise the Xero client secret or portal password is used.

A new production deployment must be created after adding or changing Vercel environment variables.

## Exact resume checklist

1. Decide whether to keep the existing `EcoAlliance Meta Ads Recharge` Xero app or replace it with a newly created Custom Connection app.
2. Purchase one Xero Custom Connection subscription for **Goldsure Pty Ltd**.
3. Open the chosen app's configuration and confirm the four scopes listed above.
4. Choose the correct authorised Xero user.
5. Complete Xero's organisation authorisation for **Goldsure Pty Ltd**.
6. Generate/retrieve the app's client ID and client secret.
7. Add them to Vercel as `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` for Production.
8. Redeploy the Goldsure portal so the new environment variables are loaded.
9. Log into `/xero-recharge/` and confirm the badge says **Xero connected**.
10. Confirm the status check reports:
    - Contact: `Eco Alliance`
    - Account: `421`
    - Account name: `Advertising Recharge Income`
11. Run `npm run test:xero-recharge` before changing the implementation.
12. For the first live run, upload the receipts, verify the displayed 50% total, create a draft, and review it in Xero before sending.

## If a different Xero app is created

Only one app should ultimately be used by production. A replacement app must use the same four granular scopes and must be authorised against Goldsure Pty Ltd. Update both Vercel credential variables together, redeploy, and verify the portal status before creating a draft. Do not delete the existing app until the replacement connection has been proven to work.

## Pause boundary

Work stops here. The code and public portal page remain deployed, but Xero subscription purchase, organisation authorisation, credential generation, Vercel secret configuration, and live invoice creation are deliberately deferred.
