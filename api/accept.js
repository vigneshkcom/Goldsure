export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    agent_name,
    service_type,
    alarm_qty,
    alarm_total,
    ctrl_qty,
    ctrl_total,
    fee_label,
    fee_amount,
    grand_total,
    accepted_at,
  } = req.body;

  if (!customer_name || !customer_email) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const hasControllers = parseInt(ctrl_qty) > 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quote Accepted – Goldsure</title>
</head>

<body style="margin:0;padding:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141c2e;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f5f6f8;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:6px;border:1px solid #e3e7ef;overflow:hidden;">

<tr>
<td style="background:#000000;padding:24px 28px;">
  <table width="100%">
    <tr>
      <td>
        <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
             width="130" style="display:block;">
      </td>
      <td align="right" style="color:#b08d2e;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">
        Internal Notification
      </td>
    </tr>
  </table>
</td>
</tr>

<tr>
<td style="background:#e9f7ef;padding:14px 28px;border-bottom:1px solid #d4efe0;">
  <span style="font-size:13px;font-weight:700;color:#1f7a45;">
    ✔ Quote Accepted
  </span>
  <span style="float:right;font-size:12px;color:#6b7899;">
    ${accepted_at}
  </span>
</td>
</tr>

<tr>
<td style="padding:28px;">

<p style="margin:0 0 6px;font-size:22px;font-weight:700;">
  ${customer_name}
</p>
<p style="margin:0 0 20px;font-size:13px;color:#6b7899;">
  Agent: <strong style="color:#141c2e;">${agent_name || '—'}</strong>
</p>

<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-top:1px solid #e3e7ef;">
<tr>
<td style="padding:10px 0;font-size:12px;color:#6b7899;width:140px;">Email</td>
<td style="padding:10px 0;font-size:13px;font-weight:600;">
  ${customer_email}
</td>
</tr>

<tr>
<td style="padding:10px 0;font-size:12px;color:#6b7899;">Phone</td>
<td style="padding:10px 0;font-size:13px;font-weight:600;">
  ${customer_phone || '—'}
</td>
</tr>

<tr>
<td style="padding:10px 0;font-size:12px;color:#6b7899;">Address</td>
<td style="padding:10px 0;font-size:13px;">
  ${customer_address || '—'}
</td>
</tr>

<tr>
<td style="padding:10px 0;font-size:12px;color:#6b7899;">Service</td>
<td style="padding:10px 0;font-size:13px;font-weight:600;">
  ${service_type || '—'}
</td>
</tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:4px;overflow:hidden;margin-bottom:24px;">

<tr style="background:#f0f2f5;">
<td style="padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7899;">
Description
</td>
<td align="right" style="padding:10px 14px;font-size:11px;font-weight:700;text-transform:uppercase;color:#6b7899;">
Amount
</td>
</tr>

<tr>
<td style="padding:12px 14px;font-size:13px;">
Raptor Smoke Alarms<br>
<span style="font-size:11px;color:#6b7899;">${alarm_qty} × $98.00</span>
</td>
<td align="right" style="padding:12px 14px;font-size:13px;font-weight:600;">
${alarm_total}
</td>
</tr>

${hasControllers ? `
<tr style="border-top:1px solid #e3e7ef;">
<td style="padding:12px 14px;font-size:13px;">
Smoke Alarm Controllers<br>
<span style="font-size:11px;color:#6b7899;">${ctrl_qty} × $49.00</span>
</td>
<td align="right" style="padding:12px 14px;font-size:13px;font-weight:600;">
${ctrl_total}
</td>
</tr>` : ''}

<tr style="border-top:1px solid #e3e7ef;">
<td style="padding:12px 14px;font-size:13px;">
${fee_label}
</td>
<td align="right" style="padding:12px 14px;font-size:13px;font-weight:600;">
${fee_amount}
</td>
</tr>

<tr style="background:#000000;">
<td style="padding:16px 14px;font-size:12px;font-weight:700;color:rgba(255,255,255,0.6);text-transform:uppercase;">
Grand Total
</td>
<td align="right" style="padding:16px 14px;font-size:18px;font-weight:700;color:#b08d2e;">
${grand_total}
</td>
</tr>

</table>

<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="background:#fff7e6;padding:16px;border-left:4px solid #b08d2e;border-radius:4px;">
<p style="margin:0;font-size:14px;font-weight:600;">
Next Action Required
</p>
<p style="margin:6px 0 0;font-size:13px;color:#7a6020;">
Contact ${customer_name} to confirm booking date and collect booking fee.
</p>
</td>
</tr>
</table>

</td>
</tr>

<tr>
<td align="center" style="padding:24px 0 30px;font-size:11px;color:#9aa5b8;">
Goldsure Pty Ltd · ABN 66 683 305 106 · Queensland, Australia
</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
        to: ['vignesh@goldsure.com.au'],
        subject: `Quote Accepted – ${customer_name} – ${grand_total}`,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Failed to send notification.', detail: error });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
