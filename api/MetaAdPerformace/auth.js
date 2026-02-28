// api/auth.js
// Password verification endpoint. The password is stored in Vercel
// Environment Variables as DASHBOARD_PASSWORD — never in the HTML source.
//
// Set in Vercel Dashboard → Project Settings → Environment Variables:
//   DASHBOARD_PASSWORD = your chosen password

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const correctPassword = process.env.DASHBOARD_PASSWORD || '';
  if (!correctPassword) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD not configured in Vercel.' });
  }

  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ ok: false, error: 'No password provided.' });
  }

  const ok = password === correctPassword;
  return res.status(200).json({ ok });
}
