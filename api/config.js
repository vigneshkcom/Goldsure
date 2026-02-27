// api/config.js
// This Vercel serverless function securely serves API keys
// stored as Vercel Environment Variables to the frontend.
//
// Set these in Vercel Dashboard → Project Settings → Environment Variables:
//   GHL_API_KEY   = your GoHighLevel API key (pit-xxxx...)
//   META_TOKEN    = your Meta Ads access token (EAAia7...)

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ghlKey    = process.env.GHL_API_KEY   || '';
  const metaToken = process.env.META_TOKEN     || '';

  if (!ghlKey && !metaToken) {
    return res.status(500).json({
      error: 'No API keys configured. Please set GHL_API_KEY and META_TOKEN in Vercel Environment Variables.'
    });
  }

  // Return the keys — this endpoint is only accessible from your deployed domain
  return res.status(200).json({
    ghlKey,
    metaToken
  });
}
