# Goldsure SMS Gateway

Two-way SMS customer messaging via [SMS Gate](https://sms-gate.app) (cloud mode),
an Android phone, Supabase storage, and a Vercel serverless handler.

- **UI:** `/sms/` — chat interface (conversation list, message bubbles, new conversation, Sync Inbox)
- **API:** `/api/battery/request-callback.js` — multi-action handler (shared with the
  battery callback form to stay under the Vercel Hobby 12-function limit)
- **Storage:** Supabase table `sms_messages`

## How it works

```
Send:    Portal UI ──POST action=send──▶ handler ──▶ SMS Gate cloud ──▶ Android phone ──▶ customer
Receive: customer ──SMS──▶ Android phone ──webhook──▶ handler ──▶ Supabase ──▶ Portal UI
```

The Android phone running the SMS Gate app is the actual sender/receiver. The cloud
server (`api.sms-gate.app`) only relays. Received SMS are pushed to our endpoint via webhook.

## Required configuration

### 1. Vercel environment variables
| Variable | Source |
|----------|--------|
| `SMSGATE_USERNAME` | SMS Gate app → Home → Cloud server → Username |
| `SMSGATE_PASSWORD` | SMS Gate app → Home → Cloud server → Password |
| `SMSGATE_DEVICE_ID` | SMS Gate app → Home → Cloud server → Device ID |
| `SUPABASE_SERVICE_ROLE_KEY` | *(recommended)* Supabase → Project Settings → API → `service_role` secret. Lets **Delete conversation** bypass Row Level Security and actually remove rows; without it, deletes fall back to the anon key and silently fail if RLS is on. Server-side only — never exposed to the browser. |
| `SMS_DELETE_PIN` | *(optional)* PIN guarding **Delete** and **Mark all read** (default `4321`). |
| `HOSTINGER_MAILBOX_RESOURCE_ID` | Hostinger mailbox resource ID used to send inbound-SMS and battery-callback notification emails. |
| `HOSTINGER_MAIL_API_TOKEN` | Hostinger Mail API bearer token authorised for the configured mailbox. If either Hostinger variable is unset, inbound-SMS notification emails are skipped. |

(Reuses existing `SUPABASE_URL` and `SUPABASE_ANON_KEY` for storage.)

### 2. Supabase table
```sql
CREATE TABLE sms_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number text NOT NULL,
  message text NOT NULL,
  direction text CHECK (direction IN ('outbound','inbound')),
  status text DEFAULT 'pending',
  sms_gate_id text,
  is_bulk boolean DEFAULT false,
  campaign text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON sms_messages (phone_number, created_at);
CREATE INDEX ON sms_messages (is_bulk) WHERE is_bulk;
-- The scheduler polls status='scheduled' constantly (portal + GitHub cron);
-- without this it is a sequential scan of the whole table on every poll.
CREATE INDEX ON sms_messages (sms_gate_id) WHERE status = 'scheduled';
-- The sidebar's contact list orders the whole table by created_at and filters
-- out bulk rows. `is_bulk = false` is NOT covered by the partial index above
-- (that one only indexes true), so this is the index that query actually uses.
CREATE INDEX ON sms_messages (created_at DESC) WHERE is_bulk IS NOT TRUE;
-- Delivery-receipt lookups (?action=delivery) match on the gateway's message id.
CREATE INDEX ON sms_messages (sms_gate_id);
ALTER TABLE sms_messages DISABLE ROW LEVEL SECURITY;

-- Shared read-state for the unread badge, so "read" is the same on every
-- browser/device instead of per-browser localStorage. The reserved row
-- phone_number='__ALL__' stores the global "Mark all read" timestamp.
CREATE TABLE sms_read_state (
  phone_number text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sms_read_state DISABLE ROW LEVEL SECURITY;
```

**Migration for existing installs** (required for the collapsed bulk-sends
sidebar group and per-campaign naming — until each is run, that feature
degrades gracefully and the bulk-send response carries a `warning`):
```sql
ALTER TABLE sms_messages ADD COLUMN is_bulk boolean DEFAULT false;
CREATE INDEX ON sms_messages (is_bulk) WHERE is_bulk;
-- per-campaign groups (each bulk send gets its own named sidebar group):
ALTER TABLE sms_messages ADD COLUMN campaign text;
-- shared unread state (the unread badge syncs across browsers; until this table
-- exists the badge silently falls back to per-browser localStorage and "Mark
-- all read" returns an error):
CREATE TABLE IF NOT EXISTS sms_read_state (
  phone_number text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sms_read_state DISABLE ROW LEVEL SECURITY;
```

**Performance migration (run this if the portal has got slow).** Once the table
passes a few tens of thousands of rows — which one bulk campaign can do — the
scheduler and sidebar queries become full table scans, every poll, from every
open tab. That starves the same connection pool that `action=send` uses, so
sending crawls even though nothing about sending changed. These indexes are
safe to add at any time and take seconds:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS sms_messages_sched_idx
  ON sms_messages (sms_gate_id) WHERE status = 'scheduled';
CREATE INDEX CONCURRENTLY IF NOT EXISTS sms_messages_inbox_idx
  ON sms_messages (created_at DESC) WHERE is_bulk IS NOT TRUE;
CREATE INDEX CONCURRENTLY IF NOT EXISTS sms_messages_gate_id_idx
  ON sms_messages (sms_gate_id);
```
Check what is queued while you are in there — a stalled campaign keeps every
open portal polling:
```sql
SELECT status, count(*), min(sms_gate_id), max(sms_gate_id)
FROM sms_messages GROUP BY status ORDER BY 2 DESC;
```
Rows stuck at `sending` are messages that were claimed but never completed (a
function timeout mid-send); they will not retry on their own:
```sql
UPDATE sms_messages SET status = 'scheduled'
WHERE status = 'sending' AND created_at < now() - interval '1 hour';
```
Optionally retro-tag past blasts so they collapse too (adjust the text to
match the message that was sent):
```sql
UPDATE sms_messages SET is_bulk = true
WHERE direction = 'outbound'
  AND message LIKE 'Hi, Goldsure here. You recently enquired%';
```

### 3. Webhooks (register via SMS Gate API — the app has no webhook UI)
Run in PowerShell, replacing the device ID if the phone changes:
```powershell
$creds = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("USERNAME:PASSWORD"))
$headers = @{ Authorization = "Basic $creds"; "Content-Type" = "application/json" }

# List existing
Invoke-RestMethod -Method GET -Uri "https://api.sms-gate.app/3rdparty/v1/webhooks" -Headers $headers

# Register (URL must be HTTPS, no query params, deviceId required)
Invoke-RestMethod -Method POST -Uri "https://api.sms-gate.app/3rdparty/v1/webhooks" -Headers $headers `
  -Body '{"url":"https://portal.goldsure.com.au/api/battery/request-callback","event":"sms:received","deviceId":"DEVICE_ID"}'
```
Webhook URL: `https://portal.goldsure.com.au/api/battery/request-callback`

### 4. Turn OFF RCS on the gateway phone  ⚠️ critical
**Google Messages → Settings → RCS chats → Turn off RCS chats**

RCS messages travel over Google's chat channel and do **not** trigger the
`sms:received` webhook. With RCS off on the gateway phone, senders automatically
fall back to plain SMS, which IS captured. Without this, customer replies vanish.

Also keep the gateway phone: default SMS app = SMS Gateway, battery = Unrestricted,
SMS permissions granted, app set to start on boot.

## Handler actions (`/api/battery/request-callback`)
| Request | Purpose |
|---------|---------|
| `GET` | Contacts list (latest message per number) |
| `GET ?phone=+61...` | Conversation history for one number |
| `POST {action:'send', phone, message}` | Send an SMS |
| `POST {action:'sync', days}` | Trigger `inbox/export` so the phone re-fires received-SMS webhooks |
| `POST` webhook (nested `{event, payload:{...}}`) | Inbound SMS → Supabase (deduped by `sms_gate_id`, insert verified — failures return 500 so SMS Gate retries). New messages also email the team via Hostinger (best-effort) |
| `GET ?action=recent` | Debug: last 25 saved rows — check if a missing reply reached the DB |
| `GET ?action=ghl-opps&phones=...` | GHL pipeline stage, opportunity value + contact link per phone |
| `GET ?action=delivery&ids=...` | Poll SMS Gate delivery state; persists delivered/failed to Supabase |
| `GET ?action=stats&tzo=...` | Dashboard aggregates: today/30d volumes, 14-day chart, scheduled, failed, opt-outs |
| `GET ?action=bulk-threads` | Bulk-only conversations (no reply yet) grouped by campaign: `{campaigns:[{name,count,latest,contacts}],count,latest}` |
| `GET ?action=fire-scheduled` | Send all past-due scheduled/bulk messages (drains in batches within a time budget). Returns `{fired, failed, cancelled, remaining}` |
| `GET ?action=bulk-status&ids=...` | Real status of specific scheduled rows so the bulk progress screen reflects sent/failed/cancelled accurately |
| `GET ?action=read-state` | Shared unread state `{allReadAt, seen:{phone:ISO}}` driving the unread badge across all browsers/devices |
| `POST {action:'mark-read', phone}` | Mark one thread read for everyone (fired when a conversation is opened) |
| `POST {action:'mark-all-read', pin}` | PIN-gated: mark every conversation read on all devices (same PIN as delete) |
| `POST {fullName, phone, ...}` | Legacy battery callback email (unchanged) |

## Scheduled & bulk sending (how messages actually go out)
Bulk/scheduled messages are saved with `status='scheduled'` and a fire time in
`sms_gate_id` (`sched:<ISO>`). Something must call `?action=fire-scheduled` for
them to send. Three things do:

1. **GitHub Actions cron — the reliable one.** `.github/workflows/fire-scheduled-sms.yml`
   pings the endpoint every 5 minutes, so messages send even with no portal
   open. Runs from the **default branch** only; enable it under the repo's
   **Actions** tab if Actions are off. It hits the public production URL and
   needs no secrets. (Vercel Hobby crons can't run more than daily, hence
   GitHub Actions. For tighter timing, Vercel Pro's 1-min cron or an external
   cron service pointed at the same URL also work.)
2. **Bulk progress screen** polls every 5s while open (fast feedback).
3. **Opening a conversation** fires that contact's past-due messages.

Each message is claimed (`scheduled→sending`) before sending, so concurrent
triggers can never double-send. The progress screen reads back the true
per-message status — it no longer marks a row "sent" just because its send
time passed.

> ⚠️ The gateway phone must be online for sends to actually leave. Android may
> also prompt to allow bulk SMS the first time; approve it on the device.

## Bulk sends, campaigns & the sidebar
Bulk SMS rows are tagged `is_bulk = true` and with the `campaign` name entered
on the compose screen. The contacts list excludes bulk rows entirely, so a
100-customer blast neither floods the sidebar nor pushes real conversations out
of its 500-row window. Customers whose only activity is bulk sends sit
collapsed behind one **"📢 &lt;campaign name&gt;"** group per campaign (click to
expand); a contact is grouped under their most recent campaign. As soon as one
replies — or is messaged manually — they move into the main list like any
normal conversation. Bulk messages stay in each customer's thread (marked
"📢 &lt;campaign&gt;") for history and SPAM Act records. Legacy bulk rows with no
campaign fall under a "Bulk sends" group.

## Opt-out (SPAM Act)
A reply of STOP / UNSUBSCRIBE / OPT OUT marks the number opted out (the inbound row
gets `status='optout'`). Sending and scheduling to that number are blocked (403) and
pending scheduled messages are cancelled at fire time. A reply of START / UNSTOP
re-subscribes. The UI shows a red banner and disables the composer; internal notes
still work.

## Email notifications for inbound SMS
Every **new** inbound SMS also emails a copy to the team so replies aren't missed
even with no portal open. Recipients are hardcoded to **vignesh@goldsure.com.au**
and **david@goldsure.com.au** (sent from the configured Hostinger mailbox). It
fires only for genuinely new messages — duplicates from **Sync Inbox** don't
re-email — and is best-effort: if Hostinger fails, the message is still saved and the
webhook still returns 200 (so SMS Gate doesn't retry). STOP/START replies email too,
flagged as opt-out/opt-in. Requires `HOSTINGER_MAILBOX_RESOURCE_ID` and
`HOSTINGER_MAIL_API_TOKEN`; without them the email is silently skipped. To change
recipients, edit the `to:` array in the webhook block of
`api/battery/request-callback.js`.

## Unread badge & read-state
The sidebar's **Inbox Chat** count and the per-row unread dots are driven by a
shared server table (`sms_read_state`), so "read" is the same on every browser
and device — opening a thread on one clears its unread everywhere within one poll
(~5s). A conversation counts as unread when its latest message is inbound **and**
newer than both that thread's last-seen time and the global "mark all read" marker.

The **✓ Mark all read** button (sidebar, beside Sync) clears the whole badge for
everyone at once. It's PIN-gated with the same PIN as delete (`SMS_DELETE_PIN`,
default `4321`), verified server-side so the PIN never ships in the page. Until the
`sms_read_state` table exists, the badge silently falls back to the old per-browser
behaviour (each browser tracks its own reads in `localStorage`, so a fresh browser
shows everything unread) and "Mark all read" returns an error asking you to create
the table.

## Troubleshooting
- **Replies not appearing:** confirm RCS is OFF on the gateway phone (most common cause).
- **Some replies missing:** open `/api/battery/request-callback?action=recent` — if the
  message is there but not in the chat, it's a display issue; if it's absent, the webhook
  never fired (check phone online, battery Unrestricted, RCS off for that sender) or the
  insert failed (Vercel logs, search `insert FAILED`). Use **Sync Inbox** to backfill —
  it is now safe to run repeatedly (duplicates are skipped).
- **Pull recent messages manually:** click **Sync Inbox** in the chat — triggers `inbox/export`.
- **Nothing sends:** check `SMSGATE_*` env vars are set and the phone shows "ONLINE".
- **Delete doesn't remove the row (it stays in Supabase):** the delete uses the
  `service_role` key and now verifies the deleted count. If it reports "Nothing was
  deleted", Row Level Security is blocking it — either set `SUPABASE_SERVICE_ROLE_KEY`
  in Vercel, or run `ALTER TABLE sms_messages DISABLE ROW LEVEL SECURITY;` in Supabase.
- **Inspect inbound payloads:** Vercel → Functions → Logs, search `[Webhook]`.
- **Webhook payloads are nested** under `payload` — the handler reads `body.payload`
  first, then falls back to flat fields.
