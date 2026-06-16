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
ALTER TABLE sms_messages DISABLE ROW LEVEL SECURITY;
```

**Migration for existing installs** (required for the collapsed bulk-sends
sidebar group and per-campaign naming — until each is run, that feature
degrades gracefully and the bulk-send response carries a `warning`):
```sql
ALTER TABLE sms_messages ADD COLUMN is_bulk boolean DEFAULT false;
CREATE INDEX ON sms_messages (is_bulk) WHERE is_bulk;
-- per-campaign groups (each bulk send gets its own named sidebar group):
ALTER TABLE sms_messages ADD COLUMN campaign text;
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
| `POST` webhook (nested `{event, payload:{...}}`) | Inbound SMS → Supabase (deduped by `sms_gate_id`, insert verified — failures return 500 so SMS Gate retries) |
| `GET ?action=recent` | Debug: last 25 saved rows — check if a missing reply reached the DB |
| `GET ?action=ghl-opps&phones=...` | GHL pipeline stage, opportunity value + contact link per phone |
| `GET ?action=delivery&ids=...` | Poll SMS Gate delivery state; persists delivered/failed to Supabase |
| `GET ?action=stats&tzo=...` | Dashboard aggregates: today/30d volumes, 14-day chart, scheduled, failed, opt-outs |
| `GET ?action=bulk-threads` | Bulk-only conversations (no reply yet) grouped by campaign: `{campaigns:[{name,count,latest,contacts}],count,latest}` |
| `GET ?action=fire-scheduled` | Send all past-due scheduled/bulk messages (drains in batches within a time budget). Returns `{fired, failed, cancelled, remaining}` |
| `GET ?action=bulk-status&ids=...` | Real status of specific scheduled rows so the bulk progress screen reflects sent/failed/cancelled accurately |
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

## Troubleshooting
- **Replies not appearing:** confirm RCS is OFF on the gateway phone (most common cause).
- **Some replies missing:** open `/api/battery/request-callback?action=recent` — if the
  message is there but not in the chat, it's a display issue; if it's absent, the webhook
  never fired (check phone online, battery Unrestricted, RCS off for that sender) or the
  insert failed (Vercel logs, search `insert FAILED`). Use **Sync Inbox** to backfill —
  it is now safe to run repeatedly (duplicates are skipped).
- **Pull recent messages manually:** click **Sync Inbox** in the chat — triggers `inbox/export`.
- **Nothing sends:** check `SMSGATE_*` env vars are set and the phone shows "ONLINE".
- **Inspect inbound payloads:** Vercel → Functions → Logs, search `[Webhook]`.
- **Webhook payloads are nested** under `payload` — the handler reads `body.payload`
  first, then falls back to flat fields.
