export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fullName, phone, email, postcode, source } = req.body;

  const message = `
New Call Back Request

Name: ${fullName}
Phone: ${phone}
Email: ${email || "Not provided"}
Postcode: ${postcode || "Not provided"}
Source: ${source || "Unknown"}

Submitted: ${new Date().toISOString()}
`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: "Goldsure Leads <info@goldsure.com.au>",
      to: ["info@goldsure.com.au"],
      subject: "New Callback Request",
      text: message
    })
  });

  if (!response.ok) {
    return res.status(500).json({ error: "Email failed" });
  }

  return res.status(200).json({ success: true });
}
