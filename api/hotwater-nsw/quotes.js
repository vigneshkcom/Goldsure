// api/hotwater-nsw/quotes.js
// Support endpoint for the NSW Hot Water builder + tracker.
//
// Quotes are created by api/hotwater-nsw/send.js at the moment they are sent —
// there are no drafts, so there is nothing to save here. The tracker reads the
// table straight from Supabase (as the VIC tracker does) and deletes through the
// shared password-gated delete-quotes action in api/battery/request-callback.js.
//
//   GET ?action=search-contacts&q=...  → GHL contact lookup for the name field

export default async function handler(req, res) {
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
