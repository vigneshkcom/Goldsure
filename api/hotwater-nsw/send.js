// api/hotwater-nsw/send.js
// Send a NSW Hot Water quote — the only way a quote comes into existence.
// Mirrors the VIC hot water flow (action=hws-quote in api/battery/request-callback.js):
// the builder holds the whole quote in the page until the agent hits Send, then this
// endpoint prices it, stores it, emails it, optionally texts it, and logs a GHL note.
// There are no drafts: if it is in the tracker, it was sent.
//
// POST { ...quote fields, email_body, send_sms }

import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { findOrCreateGhlContactByPhone } from '../../lib/ghl-contact.js';
import { calculateQuote, HEAT_PUMP_LABEL, EXISTING_SYSTEM_LABEL } from './pricing.js';

const SITE = 'https://portal.goldsure.com.au';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
  .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DEFAULT_EMAIL_BODY = 'Thank you for the opportunity to quote your heat pump hot water upgrade. '
  + 'The price shown below already includes the applicable NSW scheme discounts. Eligibility, final '
  + 'system requirements and installation scope will be confirmed on site by a licensed installer.';

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

function buildEmailHtml(q, calc, quoteUrl, emailBody) {
  const modelLabel = HEAT_PUMP_LABEL[q.heat_pump_model] || q.heat_pump_model || '';
  const systemLabel = (EXISTING_SYSTEM_LABEL[q.existing_system] || '').toLowerCase();
  const bodyHtml = esc(String(emailBody || '').trim() || DEFAULT_EMAIL_BODY).replace(/\r?\n/g, '<br>');
  const extras = [
    calc.relocation_charge > 0 ? ['Standard tank relocation', calc.relocation_charge] : null,
    calc.back_to_back_charge > 0 ? ['Back-to-back tank relocation', calc.back_to_back_charge] : null,
    calc.cable_charge > 0 ? ['Additional electrical cable', calc.cable_charge] : null,
    ...(calc.other_extras || []).map(e => [e.label, Number(e.amount) || 0]),
  ].filter(Boolean);

  const finance = calc.finance_requested ? `
    <tr><td style="padding:18px 32px 0;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#eef6e8;border:1px solid #cfe3c0;border-radius:6px;"><tr><td style="padding:16px 20px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#3d6b21;margin-bottom:8px;">NSW Home Energy Saver Loan by Brighte — 0% Interest</div>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Estimated fortnightly repayment</td><td style="padding:4px 0;font-size:13px;color:#1f2328;text-align:right;font-weight:700;">${money(calc.fortnightly_repayment)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Estimated monthly repayment</td><td style="padding:4px 0;font-size:13px;color:#1f2328;text-align:right;font-weight:700;">${money(calc.monthly_repayment)}</td></tr>
          <tr><td style="padding:4px 0;font-size:13px;color:#3d4658;">Term</td><td style="padding:4px 0;font-size:13px;color:#1f2328;text-align:right;">${calc.finance_term_years} years</td></tr>
        </table>
        <div style="font-size:11px;color:#5b6470;margin-top:10px;line-height:1.5;">Estimate only — subject to Brighte credit approval and household income eligibility ($210,000 or less per year).</div>
      </td></tr></table>
    </td></tr>` : '';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Your Heat Pump Hot Water Quotation</title></head>
<body style="margin:0;padding:0;background-color:#eceff1;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eceff1"><tr><td align="center" style="padding:32px 14px 44px;">
  <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,46,0.08);">

    <tr><td style="padding:24px 32px 16px;font-family:${FONT};">
      <img src="${SITE}/assets/hotwater/ecogenica-logo.png" alt="Ecogenica" height="56" style="height:56px;width:auto;display:block;">
    </td></tr>
    <tr><td style="height:4px;background:#5a9e31;font-size:0;line-height:0;">&nbsp;</td></tr>

    <tr><td style="padding:24px 32px 4px;font-family:${FONT};">
      <div style="font-size:16px;font-weight:700;color:#1f2328;">Hi ${esc(String(q.customer_name || '').split(/\s+/)[0] || 'there')},</div>
      <p style="margin:8px 0 0;font-size:14px;color:#3d4658;line-height:1.65;">${bodyHtml}</p>
    </td></tr>

    <tr><td style="padding:20px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT};">
        <tr>
          <td style="padding:9px 12px;background:#5a9e31;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;">Item</td>
          <td style="padding:9px 12px;background:#5a9e31;color:#ffffff;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;text-align:right;">Amount</td>
        </tr>
        <tr><td style="padding:11px 12px;font-size:13px;color:#111;border-bottom:1px solid #e2e6ea;">${esc(modelLabel)}<br><span style="font-size:11px;color:#98a0aa;">Upgrade from ${esc(systemLabel)} hot water</span></td><td style="padding:11px 12px;font-size:13px;color:#111;text-align:right;border-bottom:1px solid #e2e6ea;">${money(calc.base_price)}</td></tr>
        ${extras.map(([l, a]) => `<tr><td style="padding:9px 12px;font-size:13px;color:#3d4658;border-bottom:1px solid #e2e6ea;">${esc(l)}</td><td style="padding:9px 12px;font-size:13px;color:#111;text-align:right;border-bottom:1px solid #e2e6ea;">${money(a)}</td></tr>`).join('')}
        <tr><td style="padding:12px;font-size:14px;color:#1f2328;font-weight:700;border-top:2px solid #5a9e31;">Grand TOTAL (inc GST)</td><td style="padding:12px;font-size:16px;color:#3d6b21;text-align:right;font-weight:700;border-top:2px solid #5a9e31;">${money(calc.final_price)}</td></tr>
      </table>
    </td></tr>
${finance}
    <tr><td align="center" style="padding:26px 32px 30px;font-family:${FONT};">
      <a href="${quoteUrl}" style="display:inline-block;background:#5a9e31;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:8px;">View &amp; Download Your Quotation</a>
      <div style="font-size:11px;color:#98a0aa;margin-top:13px;">This quote remains valid for 21 days from the date on the quote.</div>
    </td></tr>

    <tr><td style="padding:0 32px 20px;font-family:${FONT};">
      <p style="margin:0;font-size:10px;color:#98a0aa;line-height:1.65;"><strong style="color:#b23a3a;">THIS IS NOT AN INVOICE.</strong> This quote is an estimate based on the information known or provided at the time. An invoice will be issued after the assessment, products installed and services rendered.</p>
    </td></tr>

    <tr><td align="center" style="background:#1f2328;padding:16px 20px;font-family:${FONT};">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#8fbf6a;margin-bottom:3px;">Goldsure Pty Ltd · Authorised Ecogenica Dealer</div>
      <div style="font-size:10px;color:#8b93a3;">ABN 66 683 305 106 · 03 7050 2846 · info@goldsure.com.au</div>
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

  const body = req.body || {};
  const { customer_name, customer_email, customer_phone, email_body = '', send_sms = true } = body;

  if (!customer_name) return res.status(400).json({ error: 'Customer name is required.' });
  if (!customer_email || !String(customer_email).includes('@')) {
    return res.status(400).json({ error: 'A valid customer email is required.' });
  }
  if (!body.existing_system) return res.status(400).json({ error: 'Select the existing hot water system.' });
  if (!body.heat_pump_model) return res.status(400).json({ error: 'Select the heat pump being quoted.' });

  const calc = calculateQuote(body);
  const token = globalThis.crypto?.randomUUID?.() || String(Date.now());
  const quoteUrl = `${SITE}/hotwater-nsw/quote.html?token=${encodeURIComponent(token)}`;
  const sentAt = new Date().toISOString();

  // Insert first so the link in the email/SMS resolves the moment it lands.
  // If the email then fails, the row is removed again — the tracker only ever
  // holds quotes that actually went out.
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({
      quote_token: token,
      agent_name: body.agent_name || null,
      status: 'sent',
      customer_name,
      customer_phone: customer_phone || null,
      customer_email,
      property_address: body.property_address || null,
      existing_system: body.existing_system,
      heat_pump_model: body.heat_pump_model,
      tank_staying: body.tank_staying === true,
      ...calc,
      sent_at: sentAt,
      created_at: sentAt,
      updated_at: sentAt,
    }),
  });
  if (!insRes.ok) {
    const detail = await insRes.text().catch(() => '');
    console.error('[NSW HWS] insert failed', insRes.status, detail.slice(0, 300));
    return res.status(502).json({ error: 'Could not save the quote.' });
  }
  const inserted = (await insRes.json().catch(() => []))[0] || {};

  const removeRow = async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}`, {
      method: 'DELETE', headers: HEADERS,
    }).catch(() => {});
  };

  // ── Email (required — a quote that could not be emailed was not sent) ──
  try {
    await sendHostingerMail({
      to: [customer_email],
      bcc: ['info@goldsure.com.au'],
      displayName: 'Goldsure Pty Ltd',
      subject: 'Your Heat Pump Hot Water Quotation – Goldsure',
      html: buildEmailHtml(body, calc, quoteUrl, email_body),
    });
  } catch (e) {
    console.error('[NSW HWS] email send failed:', e.message);
    await removeRow();
    return res.status(502).json({ error: 'Could not send the email — the quote was not sent.' });
  }

  // ── SMS (best-effort, never fails the send) ──
  let smsSent = false;
  if (send_sms !== false && customer_phone) {
    try {
      const smsPhone = normalizeAuPhone(customer_phone);
      const smsUser = process.env.SMSGATE_USERNAME, smsPass = process.env.SMSGATE_PASSWORD;
      if (smsUser && smsPass && !(await isOptedOut(smsPhone, SUPABASE_URL, SUPABASE_KEY))) {
        const first = String(customer_name).trim().split(/\s+/)[0] || 'there';
        const modelLabel = HEAT_PUMP_LABEL[body.heat_pump_model] || 'heat pump hot water system';
        const smsText = `Hi ${first}, your Goldsure heat pump quote is ready. Your total installed price for the ${modelLabel} is ${money(calc.final_price)}${calc.finance_requested ? ', with 0% finance options available' : ''}. View your quote here: ${quoteUrl}`;
        const creds = Buffer.from(`${smsUser}:${smsPass}`).toString('base64');
        const smsRes = await fetch('https://api.sms-gate.app/3rdparty/v1/messages', {
          method: 'POST',
          headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumbers: [smsPhone], textMessage: { text: smsText }, ...(process.env.SMSGATE_DEVICE_ID ? { deviceId: process.env.SMSGATE_DEVICE_ID } : {}) }),
        });
        if (smsRes.ok) {
          smsSent = true;
          const smsData = await smsRes.json().catch(() => ({}));
          fetch(`${SUPABASE_URL}/rest/v1/sms_messages`, {
            method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' },
            body: JSON.stringify({ phone_number: smsPhone, message: smsText, direction: 'outbound', status: 'sent', sms_gate_id: smsData.id || null }),
          }).catch(() => {});
        }
      }
    } catch (e) { console.warn('[NSW HWS] SMS failed (non-fatal):', e.message); }
  }

  // ── GHL note, creating the contact if we don't already have one (best-effort) ──
  try {
    const found = await findOrCreateGhlContactByPhone(customer_phone, {
      firstName: String(customer_name).trim().split(/\s+/)[0],
      lastName: String(customer_name).trim().split(/\s+/).slice(1).join(' '),
      email: customer_email,
      address: body.property_address,
    });
    if (found?.contactId) {
      const noteBody = `NSW Hot Water quote sent by ${body.agent_name || 'Goldsure'}\n`
        + `Model: ${HEAT_PUMP_LABEL[body.heat_pump_model] || body.heat_pump_model}\n`
        + `Existing system: ${EXISTING_SYSTEM_LABEL[body.existing_system] || body.existing_system}\n`
        + `Grand TOTAL: ${money(calc.final_price)}`
        + (calc.finance_requested ? `\nFinance: ${money(calc.fortnightly_repayment)}/fortnight over ${calc.finance_term_years}yrs` : '');
      await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(found.contactId)}/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteBody }),
      });
    }
  } catch (e) { console.warn('[NSW HWS] GHL note failed (non-fatal):', e.message); }

  return res.status(200).json({
    success: true,
    quote_token: token,
    id: inserted.id || null,
    sms_sent: smsSent,
    quote_url: quoteUrl,
  });
}
