export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const { fullName, phone, email, address } = req.body;

    if (!fullName || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const submittedAt = new Date().toLocaleString("en-AU", {
      timeZone: "Australia/Melbourne",
      dateStyle: "full",
      timeStyle: "short"
    });

    const htmlMessage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Call Back Request</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e0e0e0;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#0a0a0a;padding:24px 32px;border-bottom:3px solid #d3ad40;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"
                         alt="Goldsure" height="36"
                         style="display:block;height:36px;" />
                  </td>
                  <td align="right" style="font-size:9px;font-weight:bold;letter-spacing:2.5px;text-transform:uppercase;color:#d3ad40;">
                    Solar Battery
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- GOLD BAND -->
          <tr>
            <td style="background-color:#d3ad40;padding:12px 32px;">
              <p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;">
                New Call Back Request
              </p>
            </td>
          </tr>

          <!-- INTRO -->
          <tr>
            <td style="padding:32px 32px 24px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#d3ad40;">
                Lead Notification
              </p>
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:bold;color:#0a0a0a;font-family:Georgia,serif;">
                A customer has requested a call back
              </h1>
              <p style="margin:0;font-size:14px;color:#555555;line-height:1.6;">
                The following details were submitted via the Goldsure Solar Battery callback form.
                Please contact this lead as soon as possible.
              </p>
            </td>
          </tr>

          <!-- DIVIDER -->
          <tr>
            <td style="padding:0 32px;">
              <div style="height:2px;background-color:#d3ad40;width:48px;"></div>
            </td>
          </tr>

          <!-- LEAD DETAILS CARD -->
          <tr>
            <td style="padding:24px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background-color:#f9f9f9;border:1px solid #e8e8e8;border-top:3px solid #d3ad40;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #e8e8e8;">
                    <p style="margin:0 0 4px;font-size:9px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad40;">Full Name</p>
                    <p style="margin:0;font-size:16px;color:#0a0a0a;font-weight:bold;">${fullName}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #e8e8e8;">
                    <p style="margin:0 0 4px;font-size:9px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad40;">Phone Number</p>
                    <p style="margin:0;font-size:16px;color:#0a0a0a;font-weight:bold;">
                      <a href="tel:${phone}" style="color:#0a0a0a;text-decoration:none;">${phone}</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #e8e8e8;">
                    <p style="margin:0 0 4px;font-size:9px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad40;">Email Address</p>
                    <p style="margin:0;font-size:15px;color:#0a0a0a;">
                      ${email
                        ? `<a href="mailto:${email}" style="color:#d3ad40;text-decoration:none;">${email}</a>`
                        : '<span style="color:#999999;">Not provided</span>'}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="margin:0 0 4px;font-size:9px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#d3ad40;">Property Address</p>
                    <p style="margin:0;font-size:15px;color:#0a0a0a;">
                      ${address || '<span style="color:#999999;">Not provided</span>'}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA BUTTON -->
          <tr>
            <td style="padding:0 32px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#d3ad40;">
                    <a href="tel:${phone}"
                       style="display:inline-block;padding:14px 28px;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;text-decoration:none;">
                      Call ${fullName.split(' ')[0]} Now
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TIMESTAMP -->
          <tr>
            <td style="padding:16px 32px;background-color:#f9f9f9;border-top:1px solid #e8e8e8;">
              <p style="margin:0;font-size:11px;color:#999999;">
                Submitted: ${submittedAt}
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color:#0a0a0a;padding:20px 32px;text-align:center;">
              <p style="margin:0 0 4px;font-size:10px;color:#d3ad40;letter-spacing:1px;text-transform:uppercase;font-weight:bold;">
                Goldsure Pty Ltd
              </p>
              <p style="margin:0;font-size:10px;color:#555555;letter-spacing:0.5px;">
                info@goldsure.com.au &nbsp;|&nbsp; 03 7050 2846
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>
`;

    const plainFallback = `
New Callback Request

Name: ${fullName}
Phone: ${phone}
Email: ${email || "Not provided"}
Address: ${address || "Not provided"}

Submitted: ${submittedAt}
`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Goldsure Leads <info@goldsure.com.au>",
        to: ["info@goldsure.com.au"],
        subject: `New Call Back Request — ${fullName}`,
        html: htmlMessage,
        text: plainFallback
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Resend error:", errorText);
      return res.status(500).json({ error: "Failed to send email" });
    }

    return res.status(200).json({ success: true });

  } catch (error) {

    console.error("Server error:", error);
    return res.status(500).json({ error: "Server error" });

  }

}
