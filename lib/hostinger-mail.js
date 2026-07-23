const HOSTINGER_MAIL_API_BASE = 'https://api.mail.hostinger.com/api/v1/mailboxes';

export function hasHostingerMailConfig() {
  return Boolean(
    process.env.HOSTINGER_MAILBOX_RESOURCE_ID &&
    process.env.HOSTINGER_MAIL_API_TOKEN
  );
}

export async function sendHostingerMail({
  to,
  cc,
  bcc,
  displayName,
  subject,
  text,
  html,
  attachments,
  signal,
}) {
  const mailboxResourceId = process.env.HOSTINGER_MAILBOX_RESOURCE_ID;
  const apiToken = process.env.HOSTINGER_MAIL_API_TOKEN;

  if (!mailboxResourceId || !apiToken) {
    const error = new Error('Hostinger Mail API credentials are not configured.');
    error.code = 'HOSTINGER_MAIL_NOT_CONFIGURED';
    throw error;
  }

  const payload = {
    ...(Array.isArray(to) && to.length ? { to } : {}),
    ...(Array.isArray(cc) && cc.length ? { cc } : {}),
    ...(Array.isArray(bcc) && bcc.length ? { bcc } : {}),
    ...(displayName ? { displayName } : {}),
    ...(subject ? { subject } : {}),
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
    ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
  };

  if (!payload.to && !payload.cc && !payload.bcc) {
    throw new Error('Hostinger Mail requires at least one recipient.');
  }

  const response = await fetch(
    `${HOSTINGER_MAIL_API_BASE}/${encodeURIComponent(mailboxResourceId)}/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(
      `Hostinger Mail send failed (${response.status})${detail ? `: ${detail}` : ''}`
    );
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  return { status: response.status };
}
