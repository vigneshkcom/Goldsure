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

  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote Accepted – Goldsure</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f0f0;">
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#f0f0f0">
  <tr>
    <td align="center" style="padding:28px 16px;">
      <table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:22px 32px 8px;">
            <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
                 alt="Goldsure" width="160" style="display:block;width:160px;height:auto;margin:0 auto;" />
          </td>
        </tr>
        <tr>
          <td bgcolor="#000000" align="center" style="padding:0 32px 18px;">
            <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:8px;font-weight:bold;letter-spacing:5px;text-transform:uppercase;color:#b08d2e;">Internal Notification</p>
          </td>
        </tr>
        <!-- GOLD STRIPE -->
        <tr><td bgcolor="#b08d2e" style="height:3px;font-size:1px;line-height:1px;">&nbsp;</td></tr>

        <!-- BODY -->
        <tr>
          <td style="padding:32px 32px 28px;background:#ffffff;">

            <!-- Status heading -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr>
                <td>
                  <p style="margin:0 0 2px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:22px;color:#141c2e;line-height:1.2;">Quote Accepted</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7899;">Accepted on ${accepted_at} &nbsp;·&nbsp; Sent by ${agent_name}</p>
                </td>
                <td align="right" valign="top">
                  <div style="display:inline-block;background:#000000;border-radius:4px;padding:10px 18px;">
                    <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#b08d2e;">Total Value</p>
                    <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:20px;color:#b08d2e;">${grand_total}</p>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Two column layout: Customer + Quote -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>

                <!-- LEFT: Customer Details -->
                <td width="48%" valign="top" style="padding-right:12px;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:4px;overflow:hidden;">
                    <tr>
                      <td bgcolor="#000000" style="padding:9px 14px;">
                        <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Customer</p>
                      </td>
                    </tr>
                    <tr bgcolor="#ffffff">
                      <td style="padding:11px 14px;border-bottom:1px solid #f0f2f5;">
                        <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#9aa5b8;">Name</p>
                        <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:13px;color:#141c2e;">${customer_name}</p>
                      </td>
                    </tr>
                    <tr bgcolor="#f9fafb">
                      <td style="padding:11px 14px;border-bottom:1px solid #f0f2f5;">
                        <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#9aa5b8;">Email</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#141c2e;"><a href="mailto:${customer_email}" style="color:#b08d2e;text-decoration:none;font-weight:600;">${customer_email}</a></p>
                      </td>
                    </tr>
                    <tr bgcolor="#ffffff">
                      <td style="padding:11px 14px;border-bottom:1px solid #f0f2f5;">
                        <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#9aa5b8;">Phone</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#141c2e;font-weight:600;">${customer_phone || '—'}</p>
                      </td>
                    </tr>
                    <tr bgcolor="#f9fafb">
                      <td style="padding:11px 14px;">
                        <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#9aa5b8;">Address</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#141c2e;">${customer_address || '—'}</p>
                      </td>
                    </tr>
                  </table>
                </td>

                <!-- RIGHT: Quote Breakdown -->
                <td width="4%"></td>
                <td width="48%" valign="top" style="padding-left:0;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:4px;overflow:hidden;">
                    <tr>
                      <td bgcolor="#000000" style="padding:9px 14px;">
                        <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Quote Breakdown</p>
                      </td>
                    </tr>
                    <tr bgcolor="#ffffff">
                      <td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7899;">Raptor Alarms (${alarm_qty})</td>
                            <td align="right" style="font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:12px;color:#141c2e;">${alarm_total}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    ${parseInt(ctrl_qty) > 0 ? `
                    <tr bgcolor="#f9fafb">
                      <td style="padding:10px 14px;border-bottom:1px solid #f0f2f5;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7899;">Controllers (${ctrl_qty})</td>
                            <td align="right" style="font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:12px;color:#141c2e;">${ctrl_total}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>` : ''}
                    <tr bgcolor="${parseInt(ctrl_qty) > 0 ? '#ffffff' : '#f9fafb'}">
                      <td style="padding:10px 14px;border-bottom:1px solid #e3e7ef;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7899;">${fee_label}</td>
                            <td align="right" style="font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:12px;color:#141c2e;">${fee_amount}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr bgcolor="#000000">
                      <td style="padding:12px 14px;">
                        <table width="100%" border="0" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.5);">Grand Total</td>
                            <td align="right" style="font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:18px;color:#b08d2e;">${grand_total}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <!-- Service type tag -->
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                    <tr>
                      <td style="padding:9px 14px;background:#f5f6f8;border:1px solid #e3e7ef;border-radius:4px;">
                        <p style="margin:0 0 1px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:0.5px;color:#9aa5b8;">Service Type</p>
                        <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:12px;color:#141c2e;">${service_type}</p>
                      </td>
                    </tr>
                  </table>
                </td>

              </tr>
            </table>

            <!-- Action reminder -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:14px 18px;background:#fef7e7;border-left:3px solid #b08d2e;border-radius:0 4px 4px 0;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#7a6020;line-height:1.6;">
                    <strong style="color:#141c2e;">Next step:</strong> Follow up with ${customer_name} to confirm the booking date and collect the $33.00 booking fee.
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:14px 20px;">
            <p style="margin:0 0 3px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#555555;line-height:1.5;">ABN: 66 683 305 106 &nbsp;·&nbsp; Queensland, Australia</p>
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
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Quotes <info@goldsure.com.au>',
        to: ['info@goldsure.com.au'],
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
