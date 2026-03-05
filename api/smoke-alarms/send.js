export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    quote_token,
    customer_name,
    customer_phone,
    customer_type,
    to_email,
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
    payment_note
  } = req.body;

  if (!customer_name || !to_email || !to_email.includes('@')) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const baseUrl = process.env.SITE_URL || 'https://www.goldsure.com.au';
  const token = quote_token || crypto.randomUUID();

  const acceptUrl =
    `${baseUrl}/smoke-alarms/accept-quote.html?token=${token}`;

  const phoneLine =
    customer_phone
      ? `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;">${customer_phone}</p>`
      : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#ebebeb;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center">

<table width="600" style="background:#ffffff;font-family:Arial,Helvetica,sans-serif">

<tr>
<td style="background:#000;padding:25px;text-align:center">
<img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg" width="180">
</td>
</tr>

<tr>
<td style="padding:30px">

<h2 style="margin:0 0 5px;">Hi ${customer_name},</h2>

${phoneLine}

<p style="margin:0 0 20px;color:#444;">
Thank you for choosing Goldsure. As discussed, please find your personalised smoke alarm quote below.
</p>

<table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #ddd">

<tr style="background:#000;color:#b08d2e;font-size:12px">
<td>Description</td>
<td align="center">Qty</td>
<td align="right">Unit</td>
<td align="right">Total</td>
</tr>

<tr>
<td>Raptor Smoke Alarms</td>
<td align="center">${alarm_qty}</td>
<td align="right">$98.00</td>
<td align="right">${alarm_total}</td>
</tr>

<tr style="background:#f6f6f6">
<td>Smoke Alarm Controller</td>
<td align="center">${ctrl_qty}</td>
<td align="right">$49.00</td>
<td align="right">${ctrl_total}</td>
</tr>

<tr>
<td>${fee_label}</td>
<td align="center">1</td>
<td align="right">${fee_amount}</td>
<td align="right">${fee_amount}</td>
</tr>

<tr style="background:#000;color:#fff">
<td colspan="3"><b>Grand Total</b></td>
<td align="right" style="color:#b08d2e"><b>${grand_total}</b></td>
</tr>

</table>

<p style="margin-top:20px">${payment_note}</p>

<p style="text-align:center;margin-top:30px">

<a href="${acceptUrl}"
style="
background:#b08d2e;
color:#000;
padding:14px 40px;
text-decoration:none;
border-radius:30px;
font-weight:bold;
display:inline-block;
">

Accept This Quote

</a>

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

  /* ---------------- SEND EMAIL ---------------- */

  let emailSuccess = false;

  try {

    const response = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
          to: [to_email],
          bcc: ['vignesh@goldsure.com.au'],
          subject: 'Your Smoke Alarm Quote – Goldsure',
          html
        })
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('[Resend] Send failed:', error);
      return res.status(500).json({ error: 'Email failed' });
    }

    emailSuccess = true;

  } catch (err) {

    console.error('[Resend] Server error:', err);
    return res.status(500).json({ error: 'Internal error' });

  }

  /* ---------------- LOG TO SUPABASE ---------------- */

  if (emailSuccess) {

    try {

      const toNum = v =>
        parseFloat((v || '0').replace(/[^0-9.]/g, '')) || 0;

      const grandNumeric = toNum(grand_total);

      const supabaseRes = await fetch(

        `${process.env.SUPABASE_URL}/rest/v1/quote_emails`,

        {
          method: 'POST',
          headers: {
            apikey: process.env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },

          body: JSON.stringify({

            quote_token: token,

            customer_name,
            customer_email: to_email,
            customer_phone,

            customer_address,
            customer_type: customer_type || 'digital',

            agent_name,
            service_type,

            alarm_qty: parseInt(alarm_qty) || 0,
            alarm_total: toNum(alarm_total),

            alarm_unit_price: 98,

            ctrl_qty: parseInt(ctrl_qty) || 0,
            ctrl_total: toNum(ctrl_total),

            fee_label,
            fee_amount: toNum(fee_amount),

            grand_total: toNum(grand_total),
            grand_total_numeric: grandNumeric,

            status: 'sent',
            accepted: false,

            sent_at: new Date().toISOString()

          })

        }

      );

      const body = await supabaseRes.text();

      if (!supabaseRes.ok) {

        console.error('[Supabase] INSERT FAILED');
        console.error(body);

      } else {

        console.log('[Supabase] INSERT OK');

      }

    } catch (err) {

      console.error('[Supabase] Network error:', err);

    }

    return res.status(200).json({ success: true });

  }

}
