// api/hotwater-nsw/quotes.js
// CRUD for the NSW Hot Water Quote Builder. Reads/writes the nsw_hws_quotes
// Supabase table (see hotwater-nsw/nsw-hws-quotes-schema.sql). Pricing is
// always recalculated server-side from calculateQuote() — the client sends
// raw selections, never final $ figures, so a quote can't be saved with
// numbers that don't match the agreed pricing rules.
//
// Routes:
//   GET  ?token=...        → one quote by quote_token
//   GET  (no token)        → list quotes (tracker board), newest first
//   POST { action:'save', token?, ...fields }  → insert (no token) or update (token)
//   POST { action:'delete', token }            → remove a draft

import { calculateQuote } from './pricing.js';

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase is not configured.' });
  }
  const HEADERS = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    // Contact search for the builder's customer-name field. Deliberately its own
    // endpoint rather than reusing the SMS handler's ghl-contacts action: that one
    // drops contacts with no phone number and swallows every failure as an empty
    // list, which makes a misconfigured key look identical to "no matches".
    if (req.query.action === 'search-contacts') {
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

    const { token } = req.query;
    if (token) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
        { headers: HEADERS }
      );
      if (!r.ok) return res.status(502).json({ error: 'Lookup failed.' });
      const rows = await r.json();
      const row = Array.isArray(rows) && rows[0];
      if (!row) return res.status(404).json({ error: 'Quote not found.' });
      return res.status(200).json(row);
    }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/nsw_hws_quotes?select=*&order=updated_at.desc&limit=500`,
      { headers: HEADERS }
    );
    if (!r.ok) return res.status(502).json({ error: 'List failed.' });
    return res.status(200).json(await r.json());
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = req.body || {};

  if (body.action === 'delete') {
    if (!body.token) return res.status(400).json({ error: 'token is required.' });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(body.token)}`, {
      method: 'DELETE', headers: HEADERS,
    });
    if (!r.ok) return res.status(502).json({ error: 'Delete failed.' });
    return res.status(200).json({ success: true });
  }

  if (body.action !== 'save') {
    return res.status(400).json({ error: 'Unknown action.' });
  }

  if (!body.customer_name) {
    return res.status(400).json({ error: 'Customer name is required.' });
  }

  const calc = calculateQuote(body);
  const token = body.token || (globalThis.crypto?.randomUUID?.() || String(Date.now()));

  const record = {
    quote_token: token,
    agent_name: body.agent_name || null,
    status: body.status || 'draft',
    customer_name: body.customer_name || null,
    customer_phone: body.customer_phone || null,
    customer_email: body.customer_email || null,
    property_address: body.property_address || null,
    existing_system: body.existing_system || null,
    heat_pump_model: body.heat_pump_model || null,
    tank_staying: !!body.tank_staying,
    ...calc,
    updated_at: new Date().toISOString(),
  };

  if (body.token) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes?quote_token=eq.${encodeURIComponent(body.token)}`, {
      method: 'PATCH',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(record),
    });
    if (!r.ok) {
      console.error('[NSW HWS] update failed', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'Save failed.' });
    }
    const rows = await r.json();
    return res.status(200).json(rows[0] || record);
  }

  const r = await fetch(`${SUPABASE_URL}/rest/v1/nsw_hws_quotes`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ ...record, created_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    console.error('[NSW HWS] insert failed', r.status, (await r.text()).slice(0, 300));
    return res.status(502).json({ error: 'Save failed.' });
  }
  const rows = await r.json();
  return res.status(200).json(rows[0] || record);
}
