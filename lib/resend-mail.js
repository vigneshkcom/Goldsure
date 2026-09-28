export function hasResendConfig() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendResendMail({ from, to, cc, bcc, replyTo, subject, html, text, attachments }) {
  if (!process.env.RESEND_API_KEY) {
    const error = new Error('Resend API key is not configured.');
    error.code = 'RESEND_NOT_CONFIGURED';
    throw error;
  }
  const payload = {
    from,
    to,
    ...(Array.isArray(cc) && cc.length ? { cc } : {}),
    ...(Array.isArray(bcc) && bcc.length ? { bcc } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {}),
    ...(Array.isArray(attachments) && attachments.length
      ? { attachments: attachments.map(({ filename, content }) => ({ filename, content })) }
      : {}),
  };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Resend send failed (${response.status})${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response.json().catch(() => ({}));
}
