// api/ghl.js
// Server-side proxy for GoHighLevel API — handles both API keys and Private Integration tokens.
// All requests go FROM Vercel server → GHL, so zero CORS issues in the browser.
//
// Set in Vercel Environment Variables:
//   GHL_API_KEY = your GHL API key or Private Integration token

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ghlKey = process.env.GHL_API_KEY || '';
  if (!ghlKey) {
    return res.status(500).json({ error: 'GHL_API_KEY not configured in Vercel Environment Variables.' });
  }

  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing required `path` query parameter.' });
  }

  const ghlBase = 'https://services.leadconnectorhq.com';
  const targetUrl = `${ghlBase}${path}`;

  // GHL Private Integration tokens use a different header: 'token-id' isn't needed,
  // but they must be passed as Bearer. The error "Invalid Private Integration token"
  // usually means the token needs to be used against the correct base URL.
  // Try both the standard and legacy base URLs.
  const tryFetch = async (baseUrl) => {
    return fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlKey}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
  };

  try {
    // Primary: services.leadconnectorhq.com
    let ghlResp = await tryFetch('https://services.leadconnectorhq.com');

    // If auth fails, try the legacy REST API base
    if (ghlResp.status === 401 || ghlResp.status === 403) {
      ghlResp = await tryFetch('https://rest.gohighlevel.com/v1');
    }

    const data = await ghlResp.json();

    if (!ghlResp.ok) {
      return res.status(ghlResp.status).json({
        error: data.message || data.msg || data.error || `GHL returned HTTP ${ghlResp.status}`,
        hint: 'Check that GHL_API_KEY in Vercel is a valid API key (not a Private Integration token). Go to GHL → Settings → API Keys to get the correct key.',
        raw: data,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: `Proxy fetch failed: ${err.message}` });
  }
}
