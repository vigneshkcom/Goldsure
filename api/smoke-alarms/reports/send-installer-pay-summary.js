export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, worker, period, filename, pdfBase64 } = req.body || {};
  const toAddresses = Array.isArray(to) ? to : [to];

  if (!toAddresses.length || !toAddresses.every(email => typeof email === 'string' && email.includes('@'))) {
    return res.status(400).json({ error: 'Missing or invalid recipient email.' });
  }
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'Missing PDF attachment data.' });
  }

  const fromAddress = 'Goldsure Pty Ltd <info@goldsure.com.au>';
  const emailSubject = subject || `${worker || 'Electrician'} Installer Pay Summary`;
  const safeFilename = filename || 'installer-pay-summary.pdf';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#141c2e;line-height:1.6;">
      <p style="margin:0 0 14px;">Hi${worker ? ` ${worker}` : ''},</p>
      <p style="margin:0 0 14px;">Please find your installer pay summary attached as a PDF.</p>
      <p style="margin:0 0 14px;"><strong>Pay period:</strong> ${period || 'Selected period'}</p>
      <p style="margin:0;">Goldsure Pty Ltd</p>
    </div>
  `;

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
        attachments: [
          {
            filename: safeFilename,
            content: pdfBase64,
          }
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(async () => ({ error: await response.text() }));
      console.error('[Resend] Installer pay summary send failed:', error);
      return res.status(500).json({ error: 'Failed to send email.', detail: error });
    }

    const result = await response.json();
    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    console.error('[Resend] Installer pay summary server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
