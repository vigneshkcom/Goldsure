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
import { calculateQuote, HEAT_PUMP_LABEL, EXISTING_SYSTEM_LABEL, DEPOSIT_AMOUNT } from './pricing.js';

const SITE = 'https://portal.goldsure.com.au';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Negatives render as "− $200.00" rather than "$-200.00" so discount lines read
// correctly on the quote.
const money = (n) => {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const s = Math.abs(v).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '− $' : '$') + s;
};

const DEFAULT_EMAIL_BODY = 'Thank you for the opportunity to quote your heat pump hot water upgrade. '
  + 'The price below includes the applicable NSW scheme discounts and covers the installation as '
  + 'quoted, based on the information provided. If anything unforeseen is identified on site that '
  + 'requires additional work, we\u2019ll explain it clearly and confirm any cost with you before proceeding.';

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

// The customer-facing quotation, sent inline in the email body so everything
// they need is in front of them without opening anything. Follows the VIC hot
// water quote layout and Goldsure's black/gold branding, with Ecogenica named
// as the accredited provider and installer.
function buildEmailHtml(q, calc, quoteUrl, acceptUrl, emailBody) {
  const modelLabel = HEAT_PUMP_LABEL[q.heat_pump_model] || q.heat_pump_model || '';
  const systemLabel = (EXISTING_SYSTEM_LABEL[q.existing_system] || '').toLowerCase();
  const bodyHtml = esc(String(emailBody || '').trim() || DEFAULT_EMAIL_BODY).replace(/\r?\n/g, '<br>');
  const exGst = (inc) => (Number(inc) || 0) / 1.1;

  const lines = [
    // systemLabel already ends in "hot water" (e.g. "gas hot water") — don't append it again.
    { name: modelLabel, sub: `Supply and installation — upgrade from ${systemLabel}`, amt: calc.base_price },
    calc.relocation_charge > 0 ? { name: 'Standard tank relocation', sub: `${calc.relocation_metres}m @ $155.00 per metre`, amt: calc.relocation_charge } : null,
    calc.back_to_back_charge > 0 ? { name: 'Back-to-back tank relocation', sub: 'Fixed charge', amt: calc.back_to_back_charge } : null,
    calc.cable_charge > 0 ? { name: 'Additional electrical cable', sub: `${calc.cable_chargeable_metres}m @ $20.00 per metre beyond the 15m included`, amt: calc.cable_charge } : null,
    ...(calc.other_extras || []).map(e => ({ name: e.label, sub: 'Additional charge', amt: Number(e.amount) || 0 })),
    calc.no_finance_discount > 0 ? { name: 'Upfront payment discount', sub: 'Applied for paying up front rather than financing', amt: -calc.no_finance_discount } : null,
  ].filter(Boolean);

  const itemRows = lines.map(l => `<tr bgcolor="#ffffff">
    <td valign="top" style="padding:11px 12px;font-family:${FONT};font-size:13px;color:#111111;">${esc(l.name)}<br><span style="font-size:11px;color:#8b93a3;">${esc(l.sub)}</span></td>
    <td valign="top" style="padding:11px 12px;font-family:${FONT};font-size:13px;color:#111111;text-align:center;">1</td>
    <td valign="top" style="padding:11px 12px;font-family:${FONT};font-size:13px;color:#111111;text-align:right;">${money(exGst(l.amt))}</td>
    <td valign="top" style="padding:11px 12px;font-family:${FONT};font-size:13px;font-weight:700;color:#000000;text-align:right;">${money(exGst(l.amt))}</td>
  </tr>`).join('');

  const subtotalEx = exGst(calc.final_price);
  const gst = calc.final_price - subtotalEx;

  const financeBlock = calc.finance_requested ? `
    <tr><td style="padding:18px 32px 0;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fdf8ec" style="background:#fdf8ec;border:1px solid #eaddb4;border-radius:12px;"><tr><td style="padding:16px 18px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;margin-bottom:13px;">NSW Home Energy Saver Loan by Brighte — 0% Interest</div>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
          <td width="33%" align="center" style="padding:0 4px;">
            <div style="font-size:20px;font-weight:700;color:#b08d2e;line-height:1.2;">${money(calc.fortnightly_repayment)}</div>
            <div style="font-size:9.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#9c8a5e;padding-top:3px;">per fortnight</div>
          </td>
          <td width="33%" align="center" style="padding:0 4px;">
            <div style="font-size:20px;font-weight:700;color:#b08d2e;line-height:1.2;">${money(calc.monthly_repayment)}</div>
            <div style="font-size:9.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#9c8a5e;padding-top:3px;">per month</div>
          </td>
          <td width="33%" align="center" style="padding:0 4px;">
            <div style="font-size:20px;font-weight:700;color:#b08d2e;line-height:1.2;">${calc.finance_term_years} yrs</div>
            <div style="font-size:9.5px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#9c8a5e;padding-top:3px;">term</div>
          </td>
        </tr></table>
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #eaddb4;">
          <tr><td style="padding:9px 0 0;font-size:12px;color:#8b7c56;">Total installed price</td><td style="padding:9px 0 0;font-size:12px;color:#141c2e;text-align:right;font-weight:600;">${money(calc.final_price)}</td></tr>
          <tr><td style="padding:3px 0;font-size:12px;color:#8b7c56;">Less deposit paid up front</td><td style="padding:3px 0;font-size:12px;color:#141c2e;text-align:right;font-weight:600;">− ${money(calc.deposit_amount)}</td></tr>
          <tr><td style="padding:3px 0;font-size:12.5px;color:#141c2e;font-weight:700;">Amount financed</td><td style="padding:3px 0;font-size:13.5px;color:#b08d2e;text-align:right;font-weight:700;">${money(calc.amount_financed)}</td></tr>
        </table>
        <div style="font-size:11px;color:#8b7c56;margin-top:12px;line-height:1.6;">Repayments are calculated on the amount financed after your ${money(calc.deposit_amount)} deposit. 0% interest with no establishment, account-keeping or introducer fees, and no early repayment fee. Estimate only — subject to Brighte credit approval and household taxable income of $210,000 or less per year.</div>
      </td></tr></table>
    </td></tr>` : '';

  const quoteNo = 'NSW-' + String(q.quote_token || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const quoteDate = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'long', year: 'numeric' });
  const preheader = `Your Goldsure heat pump hot water quote — ${money(calc.final_price)} installed.`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>Goldsure Hot Water Quotation</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#eef0f4;">${esc(preheader)}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:32px 14px 44px;">
  <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 6px 24px rgba(20,28,46,0.08);">

    <!-- Header -->
    <tr><td style="background:#000000;padding:22px 32px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="${SITE}/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="150" style="display:block;width:150px;height:auto;"></td>
        <td valign="middle" align="right">
          <div style="font-family:${FONT};font-size:18px;font-weight:700;letter-spacing:5px;color:#c9a13b;">QUOTATION</div>
          <div style="font-family:${FONT};font-size:11px;color:#8b93a3;margin-top:5px;">${quoteNo} &nbsp;·&nbsp; ${quoteDate}</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#b08d2e;font-size:0;line-height:0;">&nbsp;</td></tr>

    <!-- Parties -->
    <tr><td style="padding:26px 32px 8px;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="top" width="52%" style="font-family:${FONT};">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">Prepared For</div>
          <div style="font-size:16px;font-weight:700;color:#141c2e;line-height:1.35;">${esc(q.customer_name)}</div>
          ${q.property_address ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">${esc(q.property_address)}</div>` : ''}
          ${q.customer_phone ? `<div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(q.customer_phone)}</div>` : ''}
          <div style="font-size:12px;color:#5b6577;line-height:1.6;">${esc(q.customer_email)}</div>
        </td>
        <td valign="top" width="48%" align="right" style="font-family:${FONT};">
          <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#9aa2b1;margin-bottom:7px;">From</div>
          <div style="font-size:14px;font-weight:700;color:#141c2e;">Goldsure Pty Ltd</div>
          <div style="font-size:12px;color:#5b6577;line-height:1.6;margin-top:4px;">ABN 66 683 305 106<br>Suite 4, Level 1, 293 High Street<br>Preston VIC 3072<br>info@goldsure.com.au</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Intro -->
    <tr><td style="padding:14px 32px 4px;font-family:${FONT};">
      <p style="margin:0;font-size:14px;color:#3d4658;line-height:1.65;">${bodyHtml}</p>
    </td></tr>

    <!-- Line items -->
    <tr><td style="padding:20px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT};">
        <tr>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;">Item</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:center;">Qty</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Rate ex GST</td>
          <td style="padding:9px 12px;border-bottom:2px solid #141c2e;font-size:10px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#141c2e;text-align:right;">Total ex GST</td>
        </tr>
        ${itemRows}
        <tr><td colspan="3" style="padding:9px 12px;font-size:12px;color:#5b6577;text-align:right;border-bottom:1px solid #eef0f4;">Subtotal (ex GST)</td><td style="padding:9px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:600;border-bottom:1px solid #eef0f4;">${money(subtotalEx)}</td></tr>
        <tr><td colspan="3" style="padding:9px 12px;font-size:12px;color:#5b6577;text-align:right;border-bottom:1px solid #eef0f4;">GST (10%)</td><td style="padding:9px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:600;border-bottom:1px solid #eef0f4;">${money(gst)}</td></tr>
        <tr><td colspan="3" style="padding:11px 12px;font-size:12px;color:#141c2e;text-align:right;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #141c2e;">Total (inc GST)</td><td style="padding:11px 12px;font-size:14px;color:#141c2e;text-align:right;font-weight:700;border-bottom:2px solid #141c2e;">${money(calc.final_price)}</td></tr>
      </table>
    </td></tr>

    <!-- Total installed price -->
    <tr><td style="padding:16px 32px 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#000000;border-radius:6px;"><tr>
        <td style="padding:16px 20px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#c9a13b;">Your Total Installed Price</td>
        <td style="padding:16px 20px;font-family:${FONT};font-size:24px;font-weight:700;color:#ffffff;text-align:right;">${money(calc.final_price)}</td>
      </tr></table>
      <div style="font-family:${FONT};font-size:11px;color:#9aa2b1;line-height:1.55;margin-top:9px;">Applicable NSW Energy Savings Scheme, Peak Demand Reduction Scheme and Small-scale Technology Certificate discounts have already been applied to the price above.</div>
    </td></tr>

    <!-- Deposit -->
    <tr><td style="padding:14px 32px 0;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#fdf8ec" style="background:#fdf8ec;border:1px solid #eaddb4;border-radius:8px;"><tr>
        <td style="padding:13px 16px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;margin-bottom:5px;">Deposit to Proceed</div>
          <div style="font-size:12.5px;color:#3d4658;line-height:1.6;">A <strong style="color:#141c2e;">${money(DEPOSIT_AMOUNT)} deposit</strong> is required up front to book your installation. This is the minimum customer contribution required under the NSW scheme and forms part of your total installed price above &mdash; it is not an additional charge.</div>
        </td>
      </tr></table>
    </td></tr>
${financeBlock}
    <!-- Accredited provider & installer -->
    <tr><td style="padding:20px 32px 0;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:6px;"><tr>
        <td valign="middle" width="74" style="padding:14px 0 14px 16px;">
          <img src="${SITE}/assets/hotwater/ecogenica-logo.png" alt="Ecogenica" width="58" style="display:block;width:58px;height:auto;">
        </td>
        <td valign="middle" style="padding:14px 16px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;margin-bottom:5px;">Accredited Provider &amp; Installer</div>
          <div style="font-size:12.5px;color:#3d4658;line-height:1.6;">Your system is supplied and installed by <strong style="color:#141c2e;">Ecogenica</strong>, the accredited provider and installer for this upgrade.<br>NSW Contractor Licence: <strong style="color:#141c2e;">397621C</strong></div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Accept / view -->
    <tr><td align="center" style="padding:26px 32px 6px;font-family:${FONT};">
      <div style="font-size:13px;color:#3d4658;line-height:1.6;margin-bottom:15px;">Happy to go ahead? Accept your quote online and our team will call you shortly to take the $${DEPOSIT_AMOUNT} deposit and book your installation.</div>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${acceptUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="16%" stroke="f" fillcolor="#b08d2e"><w:anchorlock/><center style="color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;">Accept This Quote</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${acceptUrl}" style="display:inline-block;background:#b08d2e;color:#141c2e;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:8px;">Accept This Quote</a><!--<![endif]-->
      <div style="font-size:12px;margin-top:14px;"><a href="${quoteUrl}" style="color:#8b93a3;text-decoration:underline;">or view your quote online</a></div>
      <div style="font-size:11px;color:#9aa2b1;margin-top:11px;">This quote remains valid for 21 days from ${quoteDate}.</div>
    </td></tr>

    <!-- Fine print -->
    <tr><td style="padding:20px 32px 0;font-family:${FONT};">
      <p style="margin:0;font-size:10px;color:#aeb4c0;line-height:1.6;">This is not a tax invoice. This quotation is an estimate based on the information provided and is subject to on-site assessment. Scheme eligibility is subject to approval. A tax invoice is issued once products are installed and services rendered. All products carry a minimum 1-year warranty.</p>
    </td></tr>

    <!-- Signature -->
    <tr><td style="padding:18px 32px 24px;font-family:${FONT};">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f4;"><tr>
        <td valign="middle" style="padding:16px 16px 0 0;width:118px;"><img src="${SITE}/assets/goldsure-logo.jpg" alt="Goldsure" width="108" style="display:block;width:108px;height:auto;"></td>
        <td valign="middle" style="padding:16px 0 0 16px;border-left:2px solid #b08d2e;">
          <div style="font-size:15px;font-weight:700;color:#141c2e;">${esc(q.agent_name || 'The Goldsure Team')}</div>
          <div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#b08d2e;margin-top:2px;">Goldsure Pty Ltd</div>
          <div style="font-size:12px;color:#5b6577;line-height:1.85;margin-top:6px;">e: <a href="mailto:info@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">info@goldsure.com.au</a><br>p: <a href="tel:0370502846" style="color:#5b6577;text-decoration:none;font-weight:600;">03 7050 2846</a><br>w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:600;">www.goldsure.com.au</a></div>
        </td>
      </tr></table>
    </td></tr>

    <!-- Footer -->
    <tr><td align="center" style="background:#000000;padding:16px 20px;font-family:${FONT};">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#c9a13b;margin-bottom:3px;">Goldsure Pty Ltd</div>
      <div style="font-size:10px;color:#8b93a3;line-height:1.5;">ABN 66 683 305 106 &nbsp;·&nbsp; Suite 4, Level 1, 293 High Street, Preston VIC 3072</div>
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
  const acceptUrl = `${SITE}/hotwater-nsw/accept.html?token=${encodeURIComponent(token)}`;
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
    // Surface the real Postgres/PostgREST reason (e.g. a missing column after a
    // schema change) rather than a generic message — this is the only place an
    // agent sees the failure, and "Could not save the quote" alone sent people
    // hunting blind for something that a one-line error would have named.
    let hint = '';
    try { hint = JSON.parse(detail)?.message || ''; } catch { /* not JSON */ }
    return res.status(502).json({ error: hint ? `Could not save the quote: ${hint}` : 'Could not save the quote.' });
  }
  const inserted = (await insRes.json().catch(() => []))[0] || {};

  const removeRow = async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}`, {
      method: 'DELETE', headers: HEADERS,
    }).catch(() => {});
  };

  // ── Attach the model's brochure, as the VIC quote does. The PDFs live at
  //    /assets/hotwater/<PRODUCT CODE>.pdf, and heat_pump_model IS the product
  //    code, so no lookup table is needed. Best-effort throughout: a missing,
  //    unreachable or oversized brochure must never stop a quote going out.
  //    The size cap matters — some datasheets are 14MB, which would push the
  //    message past what mailboxes accept and bounce the whole quote.
  const attachments = [];
  const MAX_BROCHURE_BYTES = 7 * 1024 * 1024;
  if (body.heat_pump_model) {
    const brochureUrl = `${SITE}/assets/hotwater/${encodeURIComponent(body.heat_pump_model)}.pdf`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const bRes = await fetch(brochureUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (bRes.ok) {
        const buf = Buffer.from(await bRes.arrayBuffer());
        if (buf.length <= MAX_BROCHURE_BYTES) {
          attachments.push({
            filename: `${body.heat_pump_model} Brochure.pdf`,
            content: buf.toString('base64'),
            contentType: 'application/pdf',
          });
        } else {
          console.warn('[NSW HWS] brochure too large to attach:', brochureUrl, buf.length);
        }
      } else {
        console.warn('[NSW HWS] brochure not reachable:', brochureUrl, bRes.status);
      }
    } catch (e) {
      console.warn('[NSW HWS] brochure fetch failed:', e.message);
    }
  }

  // ── Email (required — a quote that could not be emailed was not sent) ──
  try {
    await sendHostingerMail({
      to: [customer_email],
      bcc: ['info@goldsure.com.au'],
      displayName: 'Goldsure Pty Ltd',
      subject: 'Your Heat Pump Hot Water Quotation – Goldsure',
      html: buildEmailHtml(body, calc, quoteUrl, acceptUrl, email_body),
      ...(attachments.length ? { attachments } : {}),
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
        + (calc.finance_requested ? `\nDeposit: ${money(calc.deposit_amount)}\nFinanced: ${money(calc.amount_financed)} — ${money(calc.fortnightly_repayment)}/fortnight over ${calc.finance_term_years}yrs` : '');
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
    brochure_attached: attachments.length > 0,
    quote_url: quoteUrl,
  });
}
