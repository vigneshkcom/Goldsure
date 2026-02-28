// api/config.js
// Returns only the Meta token to the browser.
// The GHL API key is intentionally NOT returned here — it is used exclusively
// in /api/ghl (server-side), so it is never exposed to the client.
//
// Set these in Vercel Dashboard → Project Settings → Environment Variables:
//   GHL_API_KEY   = your GoHighLevel API key (pit-xxxx...)   ← server-side only
//   META_TOKEN    = your Meta Ads access token (EAAia7...)   ← returned to browser

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const metaToken = process.env.META_TOKEN || '';

  if (!metaToken) {
    return res.status(500).json({
      error: 'META_TOKEN not configured. Please set it in Vercel Environment Variables.',
    });
  }

  return res.status(200).json({ metaToken });
}
