export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {

    const { fullName, phone, email, postcode, source } = req.body;

    if (!fullName || !phone) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const message = `
New Callback Request

Name: ${fullName}
Phone: ${phone}
Email: ${email || "Not provided"}
Postcode: ${postcode || "Not provided"}
Source: ${source || "Unknown"}

Submitted: ${new Date().toLocaleString()}
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
        subject: "New Call Back Request",
        text: message
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
