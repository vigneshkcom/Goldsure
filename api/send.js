export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    customer_name,
    to_email,
    agent_name,
    service_type,
    alarm_qty,
    alarm_total,
    ctrl_qty,
    ctrl_total,
    fee_label,
    fee_amount,
    grand_total,
    payment_note,
  } = req.body;

  if (!customer_name || !to_email || !to_email.includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid required fields.' });
  }

  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Goldsure Quote</title>
</head>
<body style="margin:0;padding:0;background-color:#ebebeb;">

<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ebebeb">
  <tr>
    <td align="center" style="padding:20px 16px;">

      <table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;overflow:hidden;">

        <!-- HEADER LOGO -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:20px 32px 5px;">
            <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
                 alt="Goldsure" width="180" style="display:block;width:180px;height:auto;margin:0 auto;" />
          </td>
        </tr>

        <!-- SMOKE ALARM QUOTE label -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:0 32px 16px;">
            <p style="margin:0;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;font-weight:bold;letter-spacing:4px;text-transform:uppercase;color:#b08d2e;">Smoke Alarm Quote</p>
          </td>
        </tr>

        <!-- GOLD STRIPE -->
        <tr><td bgcolor="#b08d2e" style="height:2px;font-size:1px;line-height:1px;">&nbsp;</td></tr>

        <!-- BODY -->
        <tr>
          <td style="padding:24px 30px;background:#ffffff;">

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:22px;font-weight:bold;color:#000000;">Hi ${customer_name},</p>
            <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#444444;line-height:1.6;">
              Thank you for choosing Goldsure. As discussed, please find your personalised smoke alarm quote below.
              Our licensed electrician will confirm the exact alarm placement on the day of installation to ensure
              full compliance with Queensland legislation.
            </p>

            <!-- QUOTE TABLE -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border:1px solid #e0e0e0;">

              <!-- Table header -->
              <tr bgcolor="#000000">
                <td style="padding:8px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Description</td>
                <td style="padding:8px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:center;">Qty</td>
                <td style="padding:8px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Unit</td>
                <td style="padding:8px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Total</td>
              </tr>

              <!-- Alarms row -->
              <tr bgcolor="#ffffff">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">
                  <span style="font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;">Raptor Smoke Alarms</span><br>
                  <span style="font-size:11px;color:#888888;">Photoelectric &middot; Interconnected &middot; 10-Yr Warranty</span>
                </td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${alarm_qty}</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">$98.00</td>
                <td style="padding:10px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${alarm_total}</td>
              </tr>

              <!-- Controller row -->
              <tr bgcolor="#f9f9f9">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">
                  <span style="font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;">Smoke Alarm Controller</span><br>
                  <span style="font-size:11px;color:#888888;">Remote control &amp; status display</span>
                </td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${ctrl_qty}</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">$49.00</td>
                <td style="padding:10px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${ctrl_total}</td>
              </tr>

              <!-- Fee row -->
              <tr bgcolor="#ffffff">
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;">
                  <span style="font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;">${fee_label}</span><br>
                  <span style="font-size:11px;color:#888888;">${fee_amount} payable upfront to secure your booking</span>
                </td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">1</td>
                <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">${fee_amount}</td>
                <td style="padding:10px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:13px;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${fee_amount}</td>
              </tr>

              <!-- Grand Total -->
              <tr bgcolor="#000000">
                <td colspan="3" style="padding:12px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:10px;color:#ffffff;text-transform:uppercase;letter-spacing:2px;">Grand Total (Incl. GST)</td>
                <td style="padding:12px 12px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:20px;color:#b08d2e;text-align:right;">${grand_total}</td>
              </tr>

            </table>

            <!-- Payment note -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;background:#faf6ec;border-left:3px solid #b08d2e;">
              <tr>
                <td style="padding:10px 14px;">
                  <p style="margin:0 0 3px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Payment Structure</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.5;">${payment_note}</p>
                </td>
              </tr>
            </table>

            <!-- LEGISLATION -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
              <tr>
                <td bgcolor="#000000" style="padding:8px 14px;">
                  <p style="margin:0;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:#b08d2e;">Queensland Legislation &mdash; Effective 01/01/2027</p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 12px;border:1px solid #e0e0e0;border-top:none;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="50%" valign="top" style="padding:3px 8px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; Photoelectric &amp; Interconnected</td>
                      <td width="50%" valign="top" style="padding:3px 0 3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; In each bedroom &amp; connecting hallway</td>
                    </tr>
                    <tr>
                      <td width="50%" valign="top" style="padding:3px 8px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; Installed on each level</td>
                      <td width="50%" valign="top" style="padding:3px 0 3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; 10-year sealed lithium backup battery</td>
                    </tr>
                    <tr>
                      <td width="50%" valign="top" style="padding:3px 8px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; Compliant AS 3786-2014 / AS 3786-2023</td>
                      <td width="50%" valign="top" style="padding:3px 0 3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; Hard-wired replaced with hard-wired</td>
                    </tr>
                    <tr>
                      <td width="50%" valign="top" style="padding:3px 8px 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; Less than 10 years old</td>
                      <td width="50%" valign="top" style="padding:3px 0 3px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#333333;">&#10003;&nbsp; 10-Year Warranty included</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- RAPTOR PRODUCT SHOWCASE -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border-top:2px solid #b08d2e;">
              <tr>
                <td style="padding-top:14px;">
                  <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b08d2e;">Raptor Alarms</p>
                  <p style="margin:0 0 5px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:20px;color:#000000;line-height:1.2;">The Raptor Smoke Alarm</p>
                  <p style="margin:0 0 15px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.5;">Purpose-built for Australian Standards and approved for Queensland's fire safety regulatory requirements.</p>

                  <!-- Product images -->
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:15px;">
                    <tr>
                      <td width="48%" align="center">
                        <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699aaa9d08245e3a7a8f790d.png"
                             alt="Raptor Front View" width="160"
                             style="display:block;width:160px;height:auto;margin:0 auto;" />
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#999999;margin:4px 0 0;font-style:italic;text-align:center;">Front View</p>
                      </td>
                      <td width="4%"></td>
                      <td width="48%" align="center">
                        <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699aaa9ddf9bdf6826e81b7c.png"
                             alt="Raptor Installed View" width="160"
                             style="display:block;width:160px;height:auto;margin:0 auto;" />
                        <p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#999999;margin:4px 0 0;font-style:italic;text-align:center;">Installed View</p>
                      </td>
                    </tr>
                  </table>

                  <!-- Features grid -->
                  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;">
                    <tr>
                      <td colspan="2" bgcolor="#000000" style="padding:8px 12px;">
                        <p style="margin:0;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Key Features</p>
                      </td>
                    </tr>
                    <tr>
                      <td width="50%" valign="top" bgcolor="#ffffff" style="padding:10px 12px;border-right:1px solid #eeeeee;border-bottom:1px solid #eeeeee;">
                        <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:12px;color:#b08d2e;">&#10003; Photoelectric Sensing</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Reduces nuisance alarms from cooking while ensuring reliable early detection.</p>
                      </td>
                      <td width="50%" valign="top" bgcolor="#ffffff" style="padding:10px 12px;border-bottom:1px solid #eeeeee;">
                        <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:12px;color:#b08d2e;">&#10003; RF Wireless Interconnect</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">When one alarm sounds, all connected alarms sound. Up to 40 units per network.</p>
                      </td>
                    </tr>
                    <tr>
                      <td width="50%" valign="top" bgcolor="#f9f9f9" style="padding:10px 12px;border-right:1px solid #eeeeee;">
                        <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:12px;color:#b08d2e;">&#10003; Alarm Memory</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Visual indication of prior activations and end-of-life warning for easy management.</p>
                      </td>
                      <td width="50%" valign="top" bgcolor="#f9f9f9" style="padding:10px 12px;">
                        <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:12px;color:#b08d2e;">&#10003; 10-Year Warranty</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Backed by a full 10-year manufacturer warranty for complete peace of mind.</p>
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2" bgcolor="#000000" align="center" style="padding:8px 12px;">
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#ffffff;">Certified to <strong style="color:#b08d2e;">AS3786 2023</strong> &nbsp;|&nbsp; Approved for All Australian States</p>
                      </td>
                    </tr>
                  </table>

                  <!-- Datasheet link -->
                  <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;text-align:center;">
                    <a href="https://workdrive.zohopublic.com.au/external/77cc4e8b9e29aef78d17e9bde90d3e9718972cbe212a0bc0446effb7292cf0e6"
                       style="color:#b08d2e;text-decoration:none;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;">View the Raptor Smoke Alarm Datasheet &rarr;</a>
                  </p>

                </td>
              </tr>
            </table>

            <!-- DISCLAIMER -->
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#aaaaaa;font-style:italic;line-height:1.5;border-top:1px solid #eeeeee;padding-top:12px;">
              * This quote is an estimate based on property details provided. On-site assessment by a licensed electrician is required for final compliance certification.
            </p>

            <!-- SIGNATURE -->
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:18px;padding-top:14px;border-top:1px solid #e0e0e0;">
              <tr>
                <td width="100" valign="middle" style="padding-right:14px;">
                  <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/6941477dca729831ab339932.jpg"
                       alt="Goldsure Team" width="90"
                       style="display:block;width:90px;height:auto;" />
                </td>
                <td valign="middle" style="padding-left:14px;border-left:2px solid #b08d2e;">
                  <p style="margin:0 0 2px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:16px;color:#000000;">${agent_name}</p>
                  <p style="margin:0 0 5px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:11px;color:#b08d2e;letter-spacing:1px;text-transform:uppercase;">Goldsure Pty Ltd</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.6;">
                    p: 07 2145 5155<br>
                    e: <a href="mailto:info@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">info@goldsure.com.au</a><br>
                    w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">www.goldsure.com.au</a>
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#000000" align="center" style="padding:15px 20px;">
            <p style="margin:0 0 3px;font-family:'Arial Black', 'Arial Bold', Gadget, sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
            <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">
              ABN: 66 683 305 106<br>
              Queensland, Australia
            </p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#555555;line-height:1.4;">
              CONFIDENTIAL: This email and any attachments are intended solely for the named recipient. Unauthorised use is prohibited.
            </p>
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
        from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
        to: [to_email],
        bcc: ['vignesh@goldsure.com.au'],
        subject: `Your Smoke Alarm Quote – Goldsure`,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Resend error:', error);
      return res.status(500).json({ error: 'Failed to send email.', detail: error });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
