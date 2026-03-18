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
<body style="margin:0;padding:0;background-color:#f5f6f8;font-family:Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background-color:#ffffff;padding:20px 32px;border-bottom:3px solid #b08d2e;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"
                         alt="Goldsure" height="34"
                         style="display:block;height:34px;" />
                  </td>
                  <td align="right" style="font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#6b7899;">
                    Solar Battery
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN CARD -->
          <tr>
            <td style="background-color:#ffffff;padding:32px 32px 0;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
              <p style="margin:0 0 6px;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">
                New Lead — Solar Battery
              </p>
              <h1 style="margin:0 0 10px;font-size:22px;font-weight:700;color:#141c2e;line-height:1.3;">
                Call back request from ${fullName.split(' ')[0]}
              </h1>
              <p style="margin:0 0 24px;font-size:13px;color:#6b7899;line-height:1.6;">
                Submitted via the Goldsure Solar Battery form. Please follow up as soon as possible.
              </p>
            </td>
          </tr>

          <!-- DETAILS TABLE -->
          <tr>
            <td style="background-color:#ffffff;padding:0 32px 8px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:8px;overflow:hidden;">

                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;width:36%;">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Full Name</p>
                  </td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;">${fullName}</p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Phone</p>
                  </td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;">
                    <p style="margin:0;font-size:14px;font-weight:700;color:#141c2e;">
                      <a href="tel:${phone}" style="color:#141c2e;text-decoration:none;">${phone}</a>
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#f5f6f8;">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Email</p>
                  </td>
                  <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;background-color:#ffffff;">
                    <p style="margin:0;font-size:14px;color:#141c2e;">
                      ${email
                        ? `<a href="mailto:${email}" style="color:#b08d2e;text-decoration:none;">${email}</a>`
                        : '<span style="color:#aaaaaa;">Not provided</span>'}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:14px 18px;background-color:#f5f6f8;">
                    <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Property Address</p>
                  </td>
                  <td style="padding:14px 18px;background-color:#ffffff;">
                    <p style="margin:0;font-size:14px;color:#141c2e;">
                      ${address || '<span style="color:#aaaaaa;">Not provided</span>'}
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- CTA BUTTON -->
          <tr>
            <td style="background-color:#ffffff;padding:24px 32px 32px;border-left:1px solid #e3e7ef;border-right:1px solid #e3e7ef;border-bottom:1px solid #e3e7ef;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#141c2e;border-radius:6px;">
                    <a href="tel:${phone}"
                       style="display:inline-block;padding:12px 24px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                      Call ${fullName.split(' ')[0]} Now
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TIMESTAMP -->
          <tr>
            <td style="padding:14px 32px;background-color:#f5f6f8;border:1px solid #e3e7ef;border-top:none;">
              <p style="margin:0;font-size:11px;color:#aaaaaa;">Submitted: ${submittedAt}</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#aaaaaa;">
                Goldsure Pty Ltd &nbsp;&middot;&nbsp; info@goldsure.com.au &nbsp;&middot;&nbsp; 03 7050 2846
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
        from: "Goldsure Battery <info@goldsure.com.au>",
        to: ["vignesh@goldsure.com.au"],
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
