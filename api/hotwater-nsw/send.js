// api/hotwater-nsw/send.js
// Email Quote + SMS Quote actions for the NSW Hot Water Quote Builder.
// Loads the quote fresh from Supabase by token (never trusts client-supplied
// pricing), sends via Hostinger Mail / SMS Gate (same providers as the rest
// of the portal), logs a GHL contact note, and creates the GHL contact if one
// doesn't already exist by phone.
//
// POST { action:'email', token }
// POST { action:'sms', token }

import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { findOrCreateGhlContactByPhone } from '../../lib/ghl-contact.js';
import { BASE_PRICE, HEAT_PUMP_LABEL, EXISTING_SYSTEM_LABEL } from './pricing.js';

const SITE = 'https://portal.goldsure.com.au';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
  .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Normalise AU mobile formats to E.164 (same rule as api/battery/request-callback.js
// so a reply lands in the same SMS thread regardless of which flow sent first).
function normalizeAuPhone(raw) {
  let s = String(raw || '').replace(/[\s\-().]/g, '');
  if (!s) return s;
  if (s[0] === '+') return s;
  if (s.startsWith('0061')) s = s.slice(2);
  if (/^61\d{9}$/.test(s)) return '+' + s;
  if (/^0\d{9}$/.test(s)) return '+61' + s.slice(1);
  if (/^4\d{8}$/.test(s)) return '+61' + s;
  return s;
}

async function isOptedOut(phone, SUPABASE_URL, SUPABASE_KEY) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&status=in.(optout,optin)&order=created_at.desc&limit=1&select=status`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] && rows[0].status === 'optout';
  } catch { return false; }
}

function buildQuoteEmailHtml(q, quoteUrl) {
  const modelLabel = HEAT_PUMP_LABEL[q.heat_pump_model] || q.heat_pump_model || '';
  const systemLabel = EXISTING_SYSTEM_LABEL[q.existing_system] || q.existing_system || '';
  const extraRows = [
    q.relocation_charge > 0 ? ['Standard relocation', q.relocation_charge] : null,
    q.back_to_back_charge > 0 ? ['Back-to-back relocation', q.back_to_back_charge] : null,
    q.cable_charge > 0 ? ['Additional electrical cable', q.cable_charge] : null,
    ...(Array.isArray(q.other_extras) ? q.other_extras.map(e => [e.label, Number(e.amount) || 0]) : []),
  ].filter(Boolean);

  const financeBlock = q.finance_requested ? `
    <tr><td style="padding:18px 32px 0;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#f5f7fa;border-radius:6px;"><tr><td style="padding:16px 20px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#0073ea;margin-bottom:8px;">NSW Home Energy Saver Loan by Brighte — 0% Interest</div>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Estimated fortnightly repayment</td><td style="padding:4px 0;font-size:13px;color:#141c2e;text-align:right;font-weight:700;">${money(q.fortnightly_repayment)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Estimated monthly repayment</td><td style="padding:4px 0;font-size:13px;color:#141c2e;text-align:right;font-weight:700;">${money(q.monthly_repayment)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Term</td><td style="padding:4px 0;font-size:13px;color:#141c2e;text-align:right;">${q.finance_term_years} years</td></tr>
        </table>
        <div style="font-size:11px;color:#8b93a3;margin-top:10px;line-height:1.5;">Estimate only — subject to Brighte credit approval and household income eligibility ($210,000 or less per year). Final approval and terms are confirmed directly by Brighte.</div>
      </td></tr></table>
    </td></tr>` : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Goldsure Heat Pump Hot Water Quote</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:32px 14px 44px;">
  <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,46,0.08);">
    <tr><td style="background:#000000;padding:22px 32px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="${SITE}/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="150" style="display:block;width:150px;height:auto;"></td>
        <td valign="middle" align="right"><div style="font-family:${FONT};font-size:16px;font-weight:700;letter-spacing:4px;color:#0073ea;">NSW QUOTE</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#0073ea;font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td style="padding:11px 32px;background:#fafbfc;border-bottom:1px solid #e3e6ea;font-family:${FONT};">
      <img src="${SITE}/assets/hotwater/ecogenica-logo.png" alt="Ecogenica" height="36" style="vertical-align:middle;height:36px;width:auto;">
      <span style="font-size:11px;color:#676879;font-weight:600;margin-left:10px;vertical-align:middle;">Authorised Dealer</span>
    </td></tr>

    <tr><td style="padding:26px 32px 4px;font-family:${FONT};">
      <div style="font-size:16px;font-weight:700;color:#141c2e;">Hi ${esc(String(q.customer_name || '').split(/\s+/)[0] || 'there')},</div>
      <p style="margin:8px 0 0;font-size:14px;color:#3d4658;line-height:1.65;">Your Goldsure heat pump hot water quote is ready. Here's a summary — the full quote is always available at the link below.</p>
    </td></tr>

    <tr><td style="padding:20px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT};">
        <tr><td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;">Item</td><td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Amount</td></tr>
        <tr><td style="padding:11px 12px;font-size:13px;color:#111111;">${esc(modelLabel)}<br><span style="font-size:11px;color:#8b93a3;">Upgrade from ${esc(systemLabel).toLowerCase()}</span></td><td style="padding:11px 12px;font-size:13px;color:#111111;text-align:right;">${money(q.base_price)}</td></tr>
        ${extraRows.map(([label, amt]) => `<tr><td style="padding:9px 12px;font-size:13px;color:#3d4658;">${esc(label)}</td><td style="padding:9px 12px;font-size:13px;color:#111111;text-align:right;">${money(amt)}</td></tr>`).join('')}
        <tr><td style="padding:12px;font-size:14px;color:#141c2e;font-weight:700;border-top:2px solid #141c2e;">Total installed price (inc GST)</td><td style="padding:12px;font-size:16px;color:#141c2e;text-align:right;font-weight:700;border-top:2px solid #141c2e;">${money(q.final_price)}</td></tr>
      </table>
    </td></tr>
${financeBlock}
    <tr><td align="center" style="padding:26px 32px 30px;font-family:${FONT};">
      <a href="${quoteUrl}" style="display:inline-block;background:#0073ea;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:8px;">View Your Full Quote</a>
    </td></tr>

    <tr><td style="padding:0 32px 22px;font-family:${FONT};">
      <p style="margin:0;font-size:10px;color:#aeb4c0;line-height:1.6;">This is an estimate based on the information provided and is subject to on-site assessment. Finance eligibility is subject to Brighte approval. Questions? Call 03 7050 2846 or email info@goldsure.com.au.</p>
    </td></tr>

    <tr><td align="center" style="background:#000000;padding:16px 20px;font-family:${FONT};">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#0073ea;margin-bottom:3px;">Goldsure Pty Ltd</div>
      <div style="font-size:10px;color:#8b93a3;">ABN 66 683 305 106 · Suite 4, Level 1, 293 High Street, Preston VIC 3072</div>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase is not configured.' });
  const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  const { action, token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required.' });
  if (action !== 'email' && action !== 'sms') return res.status(400).json({ error: 'Unknown action.' });

  const qRes = await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}&select=*&limit=1`, { headers: HEADERS });
  const rows = qRes.ok ? await qRes.json() : [];
  const q = rows[0];
  if (!q) return res.status(404).json({ error: 'Quote not found.' });

  const quoteUrl = `${SITE}/hotwater-nsw/quote.html?token=${encodeURIComponent(token)}`;
  const modelLabel = HEAT_PUMP_LABEL[q.heat_pump_model] || q.heat_pump_model || 'heat pump hot water system';

  // ── GHL: find-or-create contact + note (best-effort, non-fatal) ──
  const logGhlNote = async () => {
    try {
      const found = await findOrCreateGhlContactByPhone(q.customer_phone, {
        firstName: String(q.customer_name || '').trim().split(/\s+/)[0],
        lastName: String(q.customer_name || '').trim().split(/\s+/).slice(1).join(' '),
        email: q.customer_email,
        address: q.property_address,
      });
      if (found?.contactId) {
        const apiKey = process.env.GHL_API_KEY;
        const noteBody = `NSW Hot Water quote ${action === 'email' ? 'emailed' : 'texted'} by ${q.agent_name || 'Goldsure'}\nModel: ${modelLabel}\nExisting system: ${EXISTING_SYSTEM_LABEL[q.existing_system] || q.existing_system || '—'}\nFinal price: ${money(q.final_price)}${q.finance_requested ? `\nFinance: ${money(q.fortnightly_repayment)}/fortnight over ${q.finance_term_years}yrs` : ''}`;
        await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(found.contactId)}/notes`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: noteBody }),
        });
      }
    } catch (e) { console.warn('[NSW HWS] GHL note failed (non-fatal):', e.message); }
  };

  if (action === 'email') {
    if (!q.customer_email || !String(q.customer_email).includes('@')) {
      return res.status(400).json({ error: 'Quote has no valid customer email.' });
    }
    const html = buildQuoteEmailHtml(q, quoteUrl);
    try {
      await sendHostingerMail({
        to: [q.customer_email],
        bcc: ['info@goldsure.com.au'],
        displayName: 'Goldsure Pty Ltd',
        subject: 'Your NSW Heat Pump Hot Water Quote – Goldsure',
        html,
      });
    } catch (e) {
      console.error('[NSW HWS] email send failed:', e.message);
      return res.status(500).json({ error: 'Failed to send email.' });
    }
    await logGhlNote();
    await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ status: q.status === 'draft' ? 'quote_sent' : q.status, sent_at: new Date().toISOString() }),
    }).catch(() => {});
    return res.status(200).json({ success: true });
  }

  // action === 'sms'
  if (!q.customer_phone) return res.status(400).json({ error: 'Quote has no customer phone number.' });
  const smsPhone = normalizeAuPhone(q.customer_phone);
  const smsUser = process.env.SMSGATE_USERNAME, smsPass = process.env.SMSGATE_PASSWORD;
  if (!smsUser || !smsPass) return res.status(503).json({ error: 'SMS Gate is not configured.' });
  if (await isOptedOut(smsPhone, SUPABASE_URL, SUPABASE_KEY)) {
    return res.status(403).json({ error: 'This number has opted out of SMS.' });
  }

  const custFirst = String(q.customer_name || 'there').trim().split(/\s+/)[0] || 'there';
  const smsText = `Hi ${custFirst}, your Goldsure heat pump quote is ready. Your total installed price for the ${modelLabel} is ${money(q.final_price)}${q.finance_requested ? ', with 0% finance options available' : ''}. View your quote here: ${quoteUrl}`;

  try {
    const creds = Buffer.from(`${smsUser}:${smsPass}`).toString('base64');
    const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumbers: [smsPhone], textMessage: { text: smsText }, ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}) }),
    });
    if (!smsRes.ok) {
      const detail = await smsRes.text().catch(() => '');
      console.error('[NSW HWS] SMS send failed:', smsRes.status, detail);
      return res.status(502).json({ error: 'Failed to send SMS.' });
    }
    const smsData = await smsRes.json().catch(() => ({}));
    await fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
      method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ phone_number: smsPhone, message: smsText, direction: 'outbound', status: 'sent', sms_gate_id: smsData.id || null }),
    }).catch(() => {});
  } catch (e) {
    console.error('[NSW HWS] SMS error:', e.message);
    return res.status(500).json({ error: 'Internal error sending SMS.' });
  }

  await logGhlNote();
  await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH', headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: q.status === 'draft' ? 'quote_sent' : q.status, sent_at: q.sent_at || new Date().toISOString() }),
  }).catch(() => {});
  return res.status(200).json({ success: true });
}
