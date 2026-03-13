// api/send-install-summary.js
// Vercel serverless function — receives pre-built HTML from the
// Install Summary frontend and delivers it via Resend.
//
// Required env vars (set in Vercel dashboard):
//   RESEND_API_KEY  — your Resend API key

export default async function handler(req, res) {
  // ── CORS (allows portal.goldsure.com.au to call this) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { from, to, subject, html } = req.body;

  // ── Basic validation ──
  // to can be a single address string or an array of addresses
  const toAddresses = Array.isArray(to) ? to : [to];

  if (!toAddresses.length || !toAddresses.every(e => e.includes('@'))) {
    return res.status(400).json({ error: 'Missing or invalid recipient email(s).' });
  }
  if (!html) {
    return res.status(400).json({ error: 'No HTML body provided.' });
  }

  const fromAddress = from || 'Goldsure Pty Ltd <info@goldsure.com.au>';
  const emailSubject = subject || 'Install Summary Report — Goldsure';

  // ════════════════════════════════════════════════════════════
  // SEND EMAIL via Resend
  // ════════════════════════════════════════════════════════════
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: toAddresses,
        bcc: ['vignesh@goldsure.com.au'],
        subject: emailSubject,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('[Resend] Send failed:', error);
      return res.status(500).json({ error: 'Failed to send email.', detail: error });
    }

    const result = await response.json();
    console.log('[Resend] Email sent OK — id:', result.id);
    return res.status(200).json({ success: true, id: result.id });

  } catch (err) {
    console.error('[Resend] Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
