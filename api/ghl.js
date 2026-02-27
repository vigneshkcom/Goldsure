// api/ghl.js
// Server-side proxy for GoHighLevel API.
// All GHL requests are made FROM Vercel (server) → GHL, so there are zero CORS issues.
//
// Usage: GET /api/ghl?path=/opportunities/search?location_id=xxx&limit=5
//        The `path` query param is forwarded to the GHL API.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ghlKey = process.env.GHL_API_KEY || '';
  if (!ghlKey) {
    return res.status(500).json({ error: 'GHL_API_KEY not configured in Vercel Environment Variables.' });
  }

  // The `path` param contains everything after the GHL base URL
  // e.g. /opportunities/search?location_id=xxx&limit=100
  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing required `path` query parameter.' });
  }

  const ghlBase = 'https://services.leadconnectorhq.com';
  const targetUrl = `${ghlBase}${path}`;

  try {
    const ghlResp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlKey}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
      },
    });

    const data = await ghlResp.json();

    if (!ghlResp.ok) {
      return res.status(ghlResp.status).json({
        error: data.message || data.error || `GHL returned ${ghlResp.status}`,
        raw: data,
      });
    }

    // Pass GHL response straight through
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: `Proxy fetch failed: ${err.message}` });
  }
}
