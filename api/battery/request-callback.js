// Multi-purpose handler: SMS Gateway (send/receive/history) + legacy battery callback email
// Stays within the Vercel Hobby 12-function limit by reusing this file.
//
// Routes:
//   GET  ?phone=+61...                  → conversation history for that number
//   GET  (no phone)                     → contacts list (last message per number)
//   POST { action:'send', phone, message }  → send SMS via SMS Gate cloud API
//   POST { action:'webhook', ... }      → receive inbound SMS (webhook from SMS Gate)
//   POST { fullName, phone, ... }       → legacy battery callback email (unchanged)

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  // Title-case names that come back all-lower or all-upper from GHL ("karen parsons"
  // → "Karen Parsons"), but leave deliberately mixed-case names ("McDonald") alone.
  const tidyName = (name) => {
    if (!name) return name;
    if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
    return name.toLowerCase().replace(/(^|[\s'’\-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  };

  // ── GET: history or contacts ────────────────────────────────────────────────
  if (req.method === 'GET') {
    // GHL contact search (used by new-conversation picker in the SMS UI)
    if (req.query.action === 'ghl-contacts') {
      const q = (req.query.q || '').trim();
      if (!q) return res.status(200).json([]);
      const apiKey    = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) return res.status(200).json([]);
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
        { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' } }
      );
      if (!ghlRes.ok) return res.status(200).json([]);
      const ghlData = await ghlRes.json();
      const contacts = (ghlData.contacts || [])
        .filter(c => c.phone)
        .map(c => ({
          id:    c.id,
          name:  tidyName([c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '') || c.phone,
          phone: c.phone,
          email: c.email || '',
        }));
      return res.status(200).json(contacts);
    }

    // GHL reverse lookup: phone numbers → customer names (resolves sidebar names)
    if (req.query.action === 'ghl-lookup') {
      const phones = String(req.query.phones || '')
        .split(',').map(p => p.trim()).filter(Boolean).slice(0, 50);
      if (!phones.length) return res.status(200).json({});
      const apiKey     = process.env.GHL_API_KEY;
      const locationId = process.env.GHL_LOCATION_ID;
      if (!apiKey || !locationId) {
        return res.status(200).json(req.query.debug ? { error: 'GHL env not set', hasKey: !!apiKey, hasLocation: !!locationId } : {});
      }

      const debug   = !!req.query.debug;
      const last9   = s => String(s || '').replace(/\D/g, '').slice(-9);
      const headers = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
      const out = {};
      const diag = [];

      await Promise.all(phones.map(async (phone) => {
        const target = last9(phone);
        if (target.length < 6) return;
        // Query GHL with the full number as stored (E.164), then national, then bare —
        // first format that returns a contact whose last-9 digits match wins.
        const variants = [phone, phone.replace(/^\+/, ''), '0' + target, target];
        for (const q of [...new Set(variants)]) {
          try {
            const r = await fetch(
              `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
              { headers }
            );
            const d = r.ok ? await r.json() : {};
            const candidates = d.contacts || [];
            if (debug) diag.push({ phone, query: q, status: r.status, returned: candidates.length,
              candidates: candidates.slice(0, 5).map(c => ({ name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name, phone: c.phone, last9: last9(c.phone) })) });
            const match = candidates.find(c => last9(c.phone) === target);
            if (match) {
              const name = [match.firstName, match.lastName].filter(Boolean).join(' ') || match.name || '';
              if (name) { out[phone] = tidyName(name); return; }
            }
          } catch (e) { if (debug) diag.push({ phone, query: q, error: String(e) }); }
        }
      }));

      return res.status(200).json(debug ? { results: out, diag } : out);
    }

    const { phone } = req.query;

    if (phone) {
      // Conversation thread for one number
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&order=created_at.asc&limit=300`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await supaRes.json();
      const messages = Array.isArray(rows) ? rows : [];

      // Fire any past-due scheduled messages (best-effort, async)
      const pastDue = messages.filter(m =>
        m.status === 'scheduled' &&
        typeof m.sms_gate_id === 'string' && m.sms_gate_id.startsWith('sched:') &&
        new Date(m.sms_gate_id.replace('sched:', '')) <= new Date()
      );
      if (pastDue.length) {
        const user = process.env.SMSGATE_USERNAME;
        const pass = process.env.SMSGATE_PASSWORD;
        if (user && pass) {
          const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
          for (const m of pastDue) {
            try {
              const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
                method: 'POST',
                headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  phoneNumbers: [m.phone_number],
                  textMessage: { text: m.message },
                  ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}),
                }),
              });
              const newStatus = smsRes.ok ? 'sent' : 'failed';
              const smsData = smsRes.ok ? await smsRes.json().catch(() => ({})) : {};
              await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(m.id)}`, {
                method: 'PATCH',
                headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ status: newStatus, sms_gate_id: smsData.id || m.sms_gate_id }),
              });
              m.status = newStatus;
            } catch (e) { console.error('[Schedule fire]', e.message); }
          }
        }
      }

      return res.status(200).json(messages);
    }

    // Contacts: deduplicate to latest message per phone number
    const supaRes = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?select=phone_number,message,direction,created_at&order=created_at.desc&limit=500`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await supaRes.json();
    const seen = new Set();
    const contacts = (Array.isArray(rows) ? rows : []).filter(r => {
      if (seen.has(r.phone_number)) return false;
      seen.add(r.phone_number);
      return true;
    });
    return res.status(200).json(contacts);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // ── POST action=sync: trigger SMS Gate inbox export ─────────────────────────
  // SMS Gate has no pull endpoint for received messages — the documented method
  // is POST /messages/inbox/export, which makes the device re-fire sms:received
  // webhooks for the given window. Those land back on this same endpoint (below)
  // and get written to Supabase. So: trigger export → wait a few seconds in the
  // UI → reload.
  if (body.action === 'sync') {
    const user = process.env.SMSGATE_USERNAME;
    const pass = process.env.SMSGATE_PASSWORD;
    if (!user || !pass) {
      return res.status(503).json({ error: 'SMS Gateway credentials not configured.' });
    }

    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');
    const days  = Math.min(parseInt(body.days, 10) || 3, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const until = new Date().toISOString();

    const exportBody = { since, until };
    if (process.env.SMSGATE_DEVICE_ID) exportBody.deviceId = process.env.SMSGATE_DEVICE_ID;

    const exportRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages/inbox/export', {
      method: 'POST',
      headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(exportBody),
    });

    const detail = await exportRes.text();
    console.log('[Sync] inbox/export status', exportRes.status, detail);

    if (!exportRes.ok) {
      return res.status(502).json({ error: 'Inbox export failed', status: exportRes.status, detail });
    }

    return res.status(200).json({
      success: true,
      triggered: true,
      since,
      note: 'Export requested. Received messages arrive via webhook within a few seconds.',
    });
  }

  // ── POST action=note: save internal note + post to GHL ─────────────────────
  if (body.action === 'note') {
    const { phone, message } = body;
    if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });

    // Save to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number: phone, message, direction: 'outbound', status: 'note' }),
    });

    // Post to GHL contact notes (best-effort)
    const apiKey = process.env.GHL_API_KEY;
    const locationId = process.env.GHL_LOCATION_ID;
    if (apiKey && locationId) {
      try {
        const last9 = s => String(s || '').replace(/\D/g, '').slice(-9);
        const target = last9(phone);
        const variants = [...new Set([phone, phone.replace(/^\+/, ''), '0' + target, target])];
        let contactId = null;
        const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };
        for (const q of variants) {
          const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`, { headers: hdrs });
          if (!r.ok) continue;
          const d = await r.json();
          const match = (d.contacts || []).find(c => last9(c.phone) === target);
          if (match) { contactId = match.id; break; }
        }
        if (contactId) {
          await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
            method: 'POST',
            headers: { ...hdrs, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: `[SMS Portal Note]\n${message}` }),
          });
        }
      } catch (e) { console.error('[GHL note]', e.message); }
    }

    return res.status(200).json({ success: true });
  }

  // ── POST action=schedule: save a scheduled outbound SMS ─────────────────────
  if (body.action === 'schedule') {
    const { phone, message, sendAt } = body;
    if (!phone || !message || !sendAt) return res.status(400).json({ error: 'phone, message and sendAt required' });
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number: phone, message, direction: 'outbound', status: 'scheduled', sms_gate_id: `sched:${sendAt}` }),
    });
    return res.status(200).json({ success: true });
  }

  // ── POST action=cancel-schedule: mark a scheduled message as cancelled ───────
  if (body.action === 'cancel-schedule') {
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    return res.status(200).json({ success: true });
  }

  // ── POST action=send: outbound SMS ──────────────────────────────────────────
  if (body.action === 'send') {
    const { phone, message } = body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }

    const user = process.env.SMSGATE_USERNAME;
    const pass = process.env.SMSGATE_PASSWORD;
    if (!user || !pass) {
      return res.status(503).json({
        error: 'SMS Gateway credentials not configured.',
        help: 'Add SMSGATE_USERNAME and SMSGATE_PASSWORD to Vercel environment variables.',
      });
    }

    const credentials = Buffer.from(`${user}:${pass}`).toString('base64');

    const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumbers: [phone],
        textMessage: { text: message },
        ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}),
      }),
    });

    if (!smsRes.ok) {
      const detail = await smsRes.text();
      console.error('[SMSGate] send failed', smsRes.status, detail);
      return res.status(502).json({ error: 'SMS Gateway rejected the request', detail });
    }

    const smsData = await smsRes.json().catch(() => ({}));
    const smsGateId = smsData.id || null;

    // Log to Supabase (non-fatal)
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          phone_number: phone,
          message,
          direction: 'outbound',
          status: 'sent',
          sms_gate_id: smsGateId,
        }),
      });
    } catch (err) {
      console.error('[Supabase] outbound log failed (non-fatal):', err.message);
    }

    return res.status(200).json({ success: true, messageId: smsGateId });
  }

  // ── POST action=webhook: inbound SMS from SMS Gate ──────────────────────────
  // Webhook URL (no query params needed):
  //   https://portal.goldsure.com.au/api/battery/request-callback
  //
  // Real SMS Gate webhooks are NESTED under `payload`:
  //   { "event": "sms:received",
  //     "payload": { "messageId", "message", "phoneNumber", "receivedAt" } }
  // We read from body.payload first, then fall back to the flat body so manual
  // tests and older formats still work.
  const p = body.payload && typeof body.payload === 'object' ? body.payload : body;

  const isSmsGateWebhook =
    body.action === 'webhook' ||
    req.query.action === 'webhook' ||
    (typeof body.event === 'string' && body.event.toLowerCase().includes('received')) ||
    (!body.action && !body.fullName && (p.phoneNumber || p.from || p.sender) && (p.message || p.text || p.content));

  if (isSmsGateWebhook) {
    console.log('[Webhook] inbound payload:', JSON.stringify(body));

    // SMS Gate may use different field names across versions — handle all variants
    const phoneNumber = p.phoneNumber || p.from || p.sender || p.source || p.phone;
    const message     = p.message     || p.text || p.content || p.body;
    const messageId   = p.messageId   || p.id   || p.msgId   || null;
    const receivedAt  = p.receivedAt  || p.timestamp || p.date || new Date().toISOString();

    if (!phoneNumber || !message) {
      console.error('[Webhook] missing fields. Body was:', JSON.stringify(body));
      return res.status(400).json({ error: 'phoneNumber and message are required', received: body });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        message,
        direction: 'inbound',
        status: 'received',
        sms_gate_id: messageId,
        created_at: receivedAt,
      }),
    });

    return res.status(200).json({ success: true });
  }

  // ── POST legacy: battery callback form ─────────────────────────────────────
  // Detected by fullName field – same contract as before, no changes to the form.
  if (body.fullName !== undefined) {
    const { fullName, phone, email, address } = body;
    if (!fullName || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const submittedAt = new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const htmlMessage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Call Back Request</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f6f8;padding:40px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
        <tr><td style="background-color:#ffffff;padding:20px 32px;border-bottom:3px solid #b08d2e;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg" alt="Goldsure" height="34" style="display:block;height:34px;" /></td>
            <td align="right" style="font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#6b7899;">Solar Battery</td>
          </tr></table>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:32px 32px 0;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
          <p style="margin:0 0 6px;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">New Lead - Solar Battery</p>
          <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#141c2e;line-height:1.3;">Call back request from ${fullName.split(' ')[0]}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#6b7899;line-height:1.6;">Submitted via the Goldsure Solar Battery form. Please follow up as soon as possible.</p>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:0 32px 8px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;width:36%;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Full Name</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;">${fullName}</p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Phone</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;"><a href="tel:${phone}" style="color:#141c2e;text-decoration:none;">${phone}</a></p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Email</p></td>
              <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;"><p style="margin:0;font-size:14px;color:#141c2e;">${email ? `<a href="mailto:${email}" style="color:#b08d2e;text-decoration:none;">${email}</a>` : '<span style="color:#aaaaaa;">Not provided</span>'}</p></td>
            </tr>
            <tr>
              <td style="padding:14px 18px;background-color:#f5f6f8;"><p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Property Address</p></td>
              <td style="padding:14px 18px;background-color:#ffffff;"><p style="margin:0;font-size:14px;color:#141c2e;">${address || '<span style="color:#aaaaaa;">Not provided</span>'}</p></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="background-color:#ffffff;padding:24px 32px 32px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;border-bottom:1px solid #e3e7ef;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background-color:#141c2e;border-radius:8px;">
              <a href="tel:${phone}" style="display:inline-block;padding:14px 32px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;">&#128222;&nbsp;Call ${fullName.split(' ')[0]} Now</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:14px 32px;background-color:#f5f6f8;border:1px solid #e3e7ef;border-top:none;"><p style="margin:0;font-size:11px;color:#aaaaaa;">Submitted: ${submittedAt}</p></td></tr>
        <tr><td style="padding:20px 32px;text-align:center;"><p style="margin:0;font-size:11px;color:#aaaaaa;">Goldsure Pty Ltd &nbsp;&middot;&nbsp; info@goldsure.com.au &nbsp;&middot;&nbsp; 03 7050 2846</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Leads <vignesh@goldsure.com.au>',
        to: ['info@goldsure.com.au'],
        subject: `New Call Back Request - ${fullName}`,
        html: htmlMessage,
        text: `New Callback: ${fullName} | ${phone} | ${email || 'no email'} | ${address || 'no address'} | ${submittedAt}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Resend] callback email failed:', errorText);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({
    error: 'Unknown request.',
    help: 'Use action=send, action=webhook, or POST {fullName,phone} for battery callback.',
  });
}
