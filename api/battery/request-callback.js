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

  // ── GET: history or contacts ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { phone } = req.query;

    if (phone) {
      // Conversation thread for one number
      const supaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&order=created_at.asc&limit=300`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      const rows = await supaRes.json();
      return res.status(200).json(Array.isArray(rows) ? rows : []);
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
  // Auto-detected: payload has phoneNumber/from/sender but no action or fullName
  const isSmsGateWebhook =
    body.action === 'webhook' ||
    req.query.action === 'webhook' ||
    (!body.action && !body.fullName && (body.phoneNumber || body.from || body.sender) && (body.message || body.text || body.content));

  if (isSmsGateWebhook) {
    console.log('[Webhook] inbound payload:', JSON.stringify(body));

    // SMS Gate may use different field names across versions — handle all variants
    const phoneNumber = body.phoneNumber || body.from || body.sender || body.source || body.phone;
    const message     = body.message    || body.text   || body.content || body.body;
    const messageId   = body.messageId  || body.id     || body.msgId   || null;
    const receivedAt  = body.receivedAt || body.timestamp || body.date || new Date().toISOString();

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
