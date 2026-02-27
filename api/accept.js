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
  <title>Quote Accepted – Goldsure</title>
</head>
<body style="margin:0;padding:0;background-color:#ebebeb;">
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ebebeb">
  <tr>
    <td align="center" style="padding:20px 16px;">
      <table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;overflow:hidden;">

        <!-- HEADER -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:20px 32px 5px;">
            <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
                 alt="Goldsure" width="180" style="display:block;width:180px;height:auto;margin:0 auto;" />
          </td>
        </tr>
        <tr>
          <td bgcolor="#000000" align="center" style="padding:0 32px 16px;">
            <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;font-weight:bold;letter-spacing:4px;text-transform:uppercase;color:#b08d2e;">Quote Accepted</p>
          </td>
        </tr>
        <tr><td bgcolor="#18a96e" style="height:3px;font-size:1px;line-height:1px;">&nbsp;</td></tr>

        <!-- BODY -->
        <tr>
          <td style="padding:28px 30px;background:#ffffff;">

            <!-- Alert banner -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#eaf7f2;border-left:4px solid #18a96e;border-radius:4px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:16px;color:#0d6e46;">&#10003; A customer has accepted their quote!</p>
                  <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#2d7a5a;">Accepted on ${accepted_at}</p>
                </td>
              </tr>
            </table>

            <!-- Customer details -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #e0e0e0;border-radius:4px;">
              <tr bgcolor="#000000">
                <td colspan="2" style="padding:8px 14px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Customer Details</td>
              </tr>
              <tr bgcolor="#ffffff">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;width:35%;border-bottom:1px solid #f0f0f0;">Name</td>
                <td style="padding:10px 14px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:13px;color:#000000;border-bottom:1px solid #f0f0f0;">${customer_name}</td>
              </tr>
              <tr bgcolor="#f9f9f9">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;border-bottom:1px solid #f0f0f0;">Email</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000000;border-bottom:1px solid #f0f0f0;"><a href="mailto:${customer_email}" style="color:#b08d2e;text-decoration:none;">${customer_email}</a></td>
              </tr>
              <tr bgcolor="#ffffff">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;border-bottom:1px solid #f0f0f0;">Phone</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000000;border-bottom:1px solid #f0f0f0;">${customer_phone || '—'}</td>
              </tr>
              <tr bgcolor="#f9f9f9">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;">Address</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#000000;">${customer_address || '—'}</td>
              </tr>
            </table>

            <!-- Quote summary -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #e0e0e0;">
              <tr bgcolor="#000000">
                <td style="padding:8px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Description</td>
                <td style="padding:8px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:center;">Qty</td>
                <td style="padding:8px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Total</td>
              </tr>
              <tr bgcolor="#ffffff">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">Raptor Smoke Alarms</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${alarm_qty}</td>
                <td style="padding:10px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${alarm_total}</td>
              </tr>
              ${parseInt(ctrl_qty) > 0 ? `
              <tr bgcolor="#f9f9f9">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">Smoke Alarm Controller</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${ctrl_qty}</td>
                <td style="padding:10px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${ctrl_total}</td>
              </tr>` : ''}
              <tr bgcolor="${parseInt(ctrl_qty) > 0 ? '#ffffff' : '#f9f9f9'}">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">${fee_label}</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">1</td>
                <td style="padding:10px 12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${fee_amount}</td>
              </tr>
              <tr bgcolor="#000000">
                <td colspan="2" style="padding:12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:10px;color:#ffffff;text-transform:uppercase;letter-spacing:2px;">Grand Total (Incl. GST)</td>
                <td style="padding:12px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:20px;color:#b08d2e;text-align:right;">${grand_total}</td>
              </tr>
            </table>

            <!-- Agent info -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background:#f5f6f8;border-radius:4px;border:1px solid #e3e7ef;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0 0 2px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Quote Originally Sent By</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#141c2e;font-weight:bold;">${agent_name} &nbsp;·&nbsp; <span style="font-weight:normal;color:#6b7899;">${service_type}</span></p>
                </td>
              </tr>
            </table>

            <p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;font-style:italic;">
              Please follow up with ${customer_name} to confirm the booking date and collect the $33.00 booking fee.
            </p>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:15px 20px;">
            <p style="margin:0 0 3px;font-family:'Arial Black','Arial Bold',Gadget,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">ABN: 66 683 305 106 · Queensland, Australia</p>
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
        subject: `✅ Quote Accepted – ${customer_name} – ${grand_total}`,
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
