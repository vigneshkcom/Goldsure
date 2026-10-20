import acceptHandler from './accept.js';
import { adjustSmokeQuote } from '../../lib/smoke-quote-adjustment.js';
import { parseAcceptedPropertyAddress } from '../../lib/dataforce-smoke-quote.js';

// Customer-facing quote support actions.
// POST { action: 'record-view', token } atomically records a genuine online open.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { action, token } = req.body || {};
  if (action === 'accept-customer') return acceptCustomer(req, res);
  if (action !== 'record-view') return res.status(400).json({ error: 'Unknown action.' });
  if (!token) return res.status(400).json({ error: 'token is required.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Supabase is not configured.' });

  try {
    const viewRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_smoke_quote_view`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });

    if (!viewRes.ok) {
      const detail = await viewRes.text().catch(() => '');
      console.error('[Smoke quote view] update failed', viewRes.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not record quote view.' });
    }

    const rows = await viewRes.json().catch(() => []);
    return res.status(200).json({ success: true, ...(rows[0] || {}) });
  } catch (error) {
    console.error('[Smoke quote view] update error', error.message);
    return res.status(502).json({ error: 'Could not record quote view.' });
  }
}

// Persist quantities, price and customer acceptance together before integrations.
async function acceptCustomer(req, res) {
  const { token, alarm_qty, customer_address } = req.body || {};
  const address = parseAcceptedPropertyAddress(customer_address);
  if (!token || !address) return res.status(400).json({ error: 'Enter the full Queensland installation address.' });
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Quote service is unavailable.' });
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const url = `${base}/rest/v1/quote_emails?quote_token=eq.${encodeURIComponent(token)}`;
  try {
    const lookup = await fetch(`${url}&select=*&limit=1`, { headers });
    if (!lookup.ok) throw new Error('Quote lookup failed');
    const [original] = await lookup.json();
    if (!original) return res.status(404).json({ error: 'Quote not found.' });
    if (original.accepted_at) return res.status(200).json({ success: true, already_accepted: true, quote: original });
    const issued = Date.parse(original.sent_at || original.created_at);
    if (['expired', 'rejected'].includes(String(original.status).toLowerCase()) || !Number.isFinite(issued) || Date.now() >= issued + 21 * 86400000) {
      return res.status(409).json({ error: 'This quote is no longer available. Please contact Goldsure for an updated quote.' });
    }
    let prices;
    try { prices = adjustSmokeQuote(original, alarm_qty ?? original.alarm_qty); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const acceptedAt = new Date().toISOString();
    // Compare the fetched snapshot to prevent two tabs from changing accepted prices.
    const guard = `&accepted_at=is.null&alarm_qty=eq.${encodeURIComponent(original.alarm_qty)}&grand_total=eq.${encodeURIComponent(original.grand_total)}&status=eq.${encodeURIComponent(original.status)}`;
    const saved = await fetch(url + guard, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ ...prices, customer_address: address.formatted, accepted: true, status: 'accepted', accepted_at: acceptedAt }),
    });
    if (!saved.ok) throw new Error(`Acceptance save failed (${saved.status})`);
    const [quote] = await saved.json();
    if (!quote) return res.status(409).json({ error: 'This quote changed in another tab. Refresh to see the latest quote.' });
    let integration = {};
    // This is one server request; navigation no longer drops the follow-up call.
    try {
      const notifyRes = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { integration = body; return this; } };
      await acceptHandler({ method: 'POST', body: {
        ...quote, to_email: quote.customer_email,
        alarm_total: `$${Number(quote.alarm_total||0).toFixed(2)}`,
        ctrl_total: `$${Number(quote.ctrl_total||0).toFixed(2)}`,
        fee_amount: `$${Number(quote.fee_amount||0).toFixed(2)}`,
        grand_total: `$${Number(quote.grand_total_numeric??quote.grand_total).toFixed(2)}`,
        customer_address: address.formatted,
        property_street: address.street, property_suburb: address.suburb,
        property_state: address.state, property_postcode: address.postcode,
        original_alarm_qty: original.alarm_qty,
        original_grand_total: original.grand_total_numeric ?? original.grand_total,
      } }, notifyRes);
      if (notifyRes.statusCode >= 400) console.error('[Smoke acceptance] Follow-up failed', notifyRes.statusCode);
    } catch (error) {
      console.error('[Smoke acceptance] Follow-up failed', error.message);
    }
    return res.status(200).json({ success: true, quote, dataforce_synced: integration.dataforce_synced === true });
  } catch (error) {
    console.error('[Smoke acceptance] Save failed', error.message);
    return res.status(502).json({ error: 'We could not confirm your quote. Please try again or contact Goldsure.' });
  }
}
