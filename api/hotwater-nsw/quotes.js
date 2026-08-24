// api/hotwater-nsw/quotes.js
// Support endpoint for the NSW Hot Water builder + tracker.
//
// Quotes are created by api/hotwater-nsw/send.js at the moment they are sent —
// there are no drafts, so there is nothing to save here. The tracker reads the
// table straight from Supabase (as the VIC tracker does) and deletes through the
// shared password-gated delete-quotes action in api/battery/request-callback.js.
//
//   GET  ?action=search-contacts&q=...   → GHL contact lookup for the name field
//   POST { action:'record-view', token }   → increment the online quote view count
//   POST { action:'accept-notify', token } → internal "quote accepted" email

import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { HEAT_PUMP_LABEL, EXISTING_SYSTEM_LABEL } from './pricing.js';

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => '$' + (Math.round((Number(n) + Number.EPSILON) * 100) / 100)
  .toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Internal notification when a customer accepts, mirroring the VIC hot water
// "quote accepted" email so the team follows the same routine for both states.
function buildAcceptEmail(q, acceptedAt) {
  const when = new Date(acceptedAt || Date.now())
    .toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
  const first = String(q.customer_name || '').trim().split(/\s+/)[0] || 'the customer';
  const row = (label, value) => `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:34%;background:#f7f8fa;font-size:11px;color:#6b7899;">${label}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;">${value}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>NSW Hot Water Quote Accepted</title></head>
<body style="margin:0;padding:0;background-color:#eef0f4;font-family:${FONT};color:#141c2e;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#eef0f4"><tr><td align="center" style="padding:36px 16px 48px;">
  <table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#000000;padding:20px 28px;border-radius:6px 6px 0 0;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle"><img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="130" style="display:block;width:130px;height:auto;"></td>
        <td align="right" valign="middle"><span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c9a13b;">Internal · NSW Hot Water</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:3px;background:#18a96e;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 6px 6px;border:1px solid #e3e7ef;border-top:none;">

      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;"><tr>
        <td><p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#18a96e;">Quote Accepted</p>
            <p style="margin:0;font-size:22px;font-weight:700;line-height:1.2;">${esc(q.customer_name)}</p></td>
        <td align="right" valign="top"><p style="margin:0;font-size:11px;color:#6b7899;">${esc(when)}</p>
            <p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${esc(q.agent_name || '—')}</strong></p></td>
      </tr></table>

      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        ${row('Email', `<a href="mailto:${esc(q.customer_email)}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${esc(q.customer_email)}</a>`)}
        ${row('Phone', `<strong>${esc(q.customer_phone || '—')}</strong>`)}
        ${row('Address', esc(q.property_address || '—'))}
        ${row('Existing system', esc(EXISTING_SYSTEM_LABEL[q.existing_system] || q.existing_system || '—'))}
        ${row('Heat pump', `<strong>${esc(HEAT_PUMP_LABEL[q.heat_pump_model] || q.heat_pump_model || '—')}</strong>`)}
      </table>

      <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Quote Summary</p>
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:22px;border:1px solid #e3e7ef;border-radius:4px;">
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Base price</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(q.base_price)}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Deposit to collect</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:700;color:#b08d2e;">${money(q.deposit_amount || 220)}</td></tr>
        <tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Installation extras</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(q.total_extras)}</td></tr>
        ${Number(q.no_finance_discount) > 0 ? `<tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Upfront payment discount</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;color:#18a96e;">− ${money(q.no_finance_discount)}</td></tr>` : ''}
        ${q.finance_requested ? `<tr><td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;color:#3d4658;">Home Energy Saver loan by Brighte</td><td align="right" style="padding:10px 14px;border-bottom:1px solid #e3e7ef;font-size:13px;font-weight:600;">${money(q.amount_financed)} financed &middot; ${money(q.fortnightly_repayment)}/ftn over ${esc(String(q.finance_term_years))} yrs</td></tr>` : ''}
        <tr style="background:#000000;"><td style="padding:14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:rgba(255,255,255,0.6);">Total Installed Price</td><td align="right" style="padding:14px;font-size:18px;font-weight:700;color:#c9a13b;">${money(q.final_price)}</td></tr>
      </table>

      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 16px;background:#eaf7f2;border-left:3px solid #18a96e;border-radius:0 4px 4px 0;">
        <p style="margin:0;font-size:13px;color:#0d7a4f;line-height:1.6;"><strong style="color:#141c2e;">Next step:</strong> Call ${esc(first)} to confirm the installation date and complete the booking.</p>
      </td></tr></table>

    </td></tr>
    <tr><td align="center" style="padding:20px 0 0;">
      <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p>
      <p style="margin:0;font-size:10px;color:#9aa2b1;">ABN 66 683 305 106 · portal.goldsure.com.au</p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  // ── Customer accepted their quote → notify the team (best-effort email) ──
  if (req.method === 'POST') {
    const { action, token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token is required.' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: 'Supabase is not configured.' });

    if (action === 'record-view') {
      try {
        const viewRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_nsw_hws_quote_view`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_token: token }),
        });
        if (!viewRes.ok) {
          const detail = await viewRes.text().catch(() => '');
          console.error('[NSW HWS view] update failed', viewRes.status, detail.slice(0, 300));
          return res.status(502).json({ error: 'Could not record quote view.' });
        }
        const rows = await viewRes.json().catch(() => []);
        return res.status(200).json({ success: true, ...(rows[0] || {}) });
      } catch (e) {
        console.error('[NSW HWS view] update error', e.message);
        return res.status(502).json({ error: 'Could not record quote view.' });
      }
    }

    if (action !== 'accept-notify') return res.status(400).json({ error: 'Unknown action.' });

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = r.ok ? await r.json() : [];
    const q = rows[0];
    if (!q) return res.status(404).json({ error: 'Quote not found.' });

    try {
      await sendHostingerMail({
        to: ['info@goldsure.com.au'],
        displayName: 'Goldsure Quotes',
        subject: `Quote Accepted — ${q.customer_name} (NSW Hot Water)`,
        html: buildAcceptEmail(q, q.accepted_at),
      });
    } catch (e) {
      console.error('[NSW HWS accept] notification failed:', e.message);
      return res.status(502).json({ error: 'Could not send the notification.' });
    }
    return res.status(200).json({ success: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  if (req.query.action !== 'search-contacts') {
    return res.status(400).json({ error: 'Unknown action.' });
  }

  // Deliberately its own endpoint rather than reusing the SMS handler's
  // ghl-contacts action: that one drops contacts with no phone number and
  // swallows every failure as an empty list, which makes a misconfigured key
  // look identical to "no matches".
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(200).json({ contacts: [] });

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    return res.status(200).json({ contacts: [], error: 'GHL is not configured (GHL_API_KEY / GHL_LOCATION_ID missing).' });
  }

  try {
    const r = await fetch(
      `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(q)}&limit=20`,
      { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' } }
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('[NSW HWS] GHL search failed', r.status, detail.slice(0, 300));
      return res.status(200).json({ contacts: [], error: `GHL search failed (${r.status}).` });
    }
    const data = await r.json();
    const tidy = (n) => (!n || (n !== n.toLowerCase() && n !== n.toUpperCase())) ? n
      : n.toLowerCase().replace(/(^|[\s'’\-])([a-z])/g, (_, s, c) => s + c.toUpperCase());
    const contacts = (data.contacts || []).map(c => ({
      id: c.id,
      name: tidy([c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '') || c.email || c.phone || '(no name)',
      phone: c.phone || '',
      email: c.email || '',
      address: [c.address1, c.city, c.state, c.postalCode].filter(Boolean).join(', '),
    }));
    return res.status(200).json({ contacts });
  } catch (e) {
    console.error('[NSW HWS] GHL search error', e.message);
    return res.status(200).json({ contacts: [], error: 'Could not reach GHL.' });
  }
}
