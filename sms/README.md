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
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON sms_messages (phone_number, created_at);
ALTER TABLE sms_messages DISABLE ROW LEVEL SECURITY;
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
| `POST {fullName, phone, ...}` | Legacy battery callback email (unchanged) |

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
