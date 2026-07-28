import { sendHostingerMail } from '../../lib/hostinger-mail.js';

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
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Accepted – Goldsure</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#141c2e;">

<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f2f5">
  <tr>
    <td align="center" style="padding:36px 16px 48px;">
      <table width="560" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- LOGO HEADER -->
        <tr>
          <td style="background:#000000;padding:20px 28px;border-radius:4px 4px 0 0;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td valign="middle">
                  <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
                       alt="Goldsure" width="130" style="display:block;width:130px;height:auto;" />
                </td>
                <td align="right" valign="middle">
                  <span style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Internal Notification</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- GOLD LINE -->
        <tr><td style="height:3px;background:#b08d2e;font-size:1px;line-height:1px;">&nbsp;</td></tr>

        <!-- MAIN BODY -->
        <tr>
          <td style="background:#ffffff;padding:28px 28px 32px;border-radius:0 0 4px 4px;border:1px solid #e3e7ef;border-top:none;">

            <!-- Status + Customer name + Date -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td>
                  <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Quote Accepted</p>
                  <p style="margin:0;font-size:22px;font-weight:700;color:#141c2e;line-height:1.2;">${customer_name}</p>
                </td>
                <td align="right" valign="top">
                  <p style="margin:0;font-size:11px;color:#6b7899;">${accepted_at}</p>
                  <p style="margin:4px 0 0;font-size:11px;color:#6b7899;">Agent: <strong style="color:#141c2e;">${agent_name}</strong></p>
                </td>
              </tr>
            </table>

            <!-- Divider -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr><td style="height:1px;background:#e3e7ef;font-size:1px;line-height:1px;">&nbsp;</td></tr>
            </table>

            <!-- Customer Details -->
            <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Customer Details</p>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e3e7ef;border-radius:4px;">
              <tr>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;width:30%;background:#f0f2f5;">
                  <p style="margin:0;font-size:11px;color:#6b7899;">Email</p>
                </td>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;color:#141c2e;"><a href="mailto:${customer_email}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${customer_email}</a></p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f0f2f5;">
                  <p style="margin:0;font-size:11px;color:#6b7899;">Phone</p>
                </td>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;font-weight:600;color:#141c2e;">${customer_phone || '—'}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;background:#f0f2f5;">
                  <p style="margin:0;font-size:11px;color:#6b7899;">Address</p>
                </td>
                <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;color:#141c2e;">${customer_address || '—'}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 14px;background:#f0f2f5;">
                  <p style="margin:0;font-size:11px;color:#6b7899;">Service</p>
                </td>
                <td style="padding:10px 14px;">
                  <p style="margin:0;font-size:13px;font-weight:600;color:#141c2e;">${service_type}</p>
                </td>
              </tr>
            </table>

            <!-- Quote Breakdown -->
            <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7899;">Quote Breakdown</p>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e3e7ef;border-radius:4px;">

              <!-- Column headers -->
              <tr style="background:#f0f2f5;">
                <td style="padding:8px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7899;">Description</p>
                </td>
                <td align="right" style="padding:8px 14px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">
                  <p style="margin:0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7899;">Amount</p>
                </td>
              </tr>

              <!-- Alarms -->
              <tr>
                <td style="padding:12px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;color:#141c2e;">Raptor Smoke Alarms</p>
                  <p style="margin:2px 0 0;font-size:11px;color:#6b7899;">${alarm_qty} × $98.00</p>
                </td>
                <td align="right" style="padding:12px 14px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">
                  <p style="margin:0;font-size:13px;font-weight:600;color:#141c2e;">${alarm_total}</p>
                </td>
              </tr>

              ${hasControllers ? `
              <!-- Controllers -->
              <tr>
                <td style="padding:12px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;color:#141c2e;">Smoke Alarm Controllers</p>
                  <p style="margin:2px 0 0;font-size:11px;color:#6b7899;">${ctrl_qty} × $49.00</p>
                </td>
                <td align="right" style="padding:12px 14px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">
                  <p style="margin:0;font-size:13px;font-weight:600;color:#141c2e;">${ctrl_total}</p>
                </td>
              </tr>` : ''}

              <!-- Fee -->
              <tr>
                <td style="padding:12px 14px;border-bottom:1px solid #e3e7ef;">
                  <p style="margin:0;font-size:13px;color:#141c2e;">${fee_label}</p>
                </td>
                <td align="right" style="padding:12px 14px;border-bottom:1px solid #e3e7ef;white-space:nowrap;">
                  <p style="margin:0;font-size:13px;font-weight:600;color:#141c2e;">${fee_amount}</p>
                </td>
              </tr>

              <!-- Grand Total -->
              <tr style="background:#000000;">
                <td style="padding:14px 14px;">
                  <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.5);">Grand Total</p>
                </td>
                <td align="right" style="padding:14px 14px;white-space:nowrap;">
                  <p style="margin:0;font-size:18px;font-weight:700;color:#b08d2e;">${grand_total}</p>
                </td>
              </tr>

            </table>

            <!-- Divider -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr><td style="height:1px;background:#e3e7ef;font-size:1px;line-height:1px;">&nbsp;</td></tr>
            </table>

            <!-- Next Step -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:12px 16px;background:#fef7e7;border-left:3px solid #b08d2e;border-radius:0 4px 4px 0;">
                  <p style="margin:0;font-size:13px;color:#7a6020;line-height:1.6;">
                    <strong style="color:#141c2e;">Next step:</strong> Follow up with ${customer_name} to confirm the booking date and collect the $33.00 booking fee.
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td align="center" style="padding:20px 0 0;">
            <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#6b7899;">Goldsure Pty Ltd</p>
            <p style="margin:0;font-size:11px;color:#9aa5b8;">ABN: 66 683 305 106 &nbsp;·&nbsp; Queensland, Australia</p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

  const subject = `Quote Accepted – ${customer_name} – ${grand_total}`;

  // Notify the team via Hostinger (from info@goldsure.com.au); fall back to
  // Resend so a provider hiccup never drops an accepted-quote notification.
  let sent = false;
  try {
    await sendHostingerMail({ to: ['info@goldsure.com.au'], displayName: 'Goldsure Quotes', subject, html });
    sent = true;
  } catch (hostErr) {
    console.error('[Smoke accept] Hostinger failed, falling back to Resend:', hostErr.message);
  }

  if (!sent) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Goldsure Quotes <info@goldsure.com.au>',
          to: ['info@goldsure.com.au'],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('Resend error:', error);
        return res.status(500).json({ error: 'Failed to send notification.', detail: error });
      }
    } catch (err) {
      console.error('Server error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  return res.status(200).json({ success: true });
}
