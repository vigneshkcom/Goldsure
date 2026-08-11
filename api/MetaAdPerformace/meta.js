// api/MetaAdPerformace/meta.js
// Combined auth + config endpoint for the Meta Ad Performance dashboard
// (merged from separate auth.js/config.js files to stay within Vercel's
// per-deployment serverless function limit).
//
//  GET  /api/MetaAdPerformace/meta            → { metaToken, ghlLocationId }
//  POST /api/MetaAdPerformace/meta { password } → { ok: true|false }
//
// Set in Vercel Dashboard → Project Settings → Environment Variables:
//   DASHBOARD_PASSWORD = your chosen password
//   GHL_API_KEY         = your GoHighLevel API key (pit-xxxx...)   ← server-side only, used in /api/MetaAdPerformace/ghl
//   GHL_LOCATION_ID      = your GHL Location/Sub-account ID         ← returned to browser (not sensitive)
//   META_TOKEN           = your Meta Ads access token (EAAia7...)   ← returned to browser

export default function handler(req, res) {
  if (req.method === 'GET') {
    const metaToken     = process.env.META_TOKEN      || '';
    const ghlLocationId = process.env.GHL_LOCATION_ID || '';
    if (!metaToken) {
      return res.status(500).json({
        error: 'META_TOKEN not configured. Please set it in Vercel Environment Variables.',
      });
    }
    return res.status(200).json({ metaToken, ghlLocationId });
  }

  if (req.method === 'POST') {
    const correctPassword = process.env.DASHBOARD_PASSWORD || '';
    if (!correctPassword) {
      return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured in Vercel.' });
    }
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ ok: false, error: 'No password provided.' });
    }
    return res.status(200).json({ ok: password === correctPassword });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
