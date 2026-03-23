function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  if (value === null || value === undefined || value === '') return '$0';
  const numeric = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(numeric)) return esc(value);
  return `$${numeric.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function qty(value) {
  const numeric = parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildReminderEmail(data) {
  const customerName = esc(data.customer_name || 'there');
  const reminderCount = qty(data.reminder_count) + 1;
  const sentDate = data.sent_at
    ? new Date(data.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const baseUrl = process.env.SITE_URL || 'https://portal.goldsure.com.au';
  const acceptUrl = `${baseUrl.replace(/\/$/, '')}/accept-quote.html?token=${encodeURIComponent(data.quote_token)}`;
  const alarmQty = qty(data.alarm_qty);
  const controllerQty = qty(data.ctrl_qty);
  const alarmAmount = money(data.alarm_total ?? alarmQty * 98);
  const controllerAmount = money(data.ctrl_total ?? controllerQty * 49);
  const feeLabel = esc(data.fee_label || 'Booking Fee');
  const feeAmount = money(data.fee_amount);
  const totalAmount = money(data.grand_total_numeric ?? data.grand_total);
  const footerEmail = 'info@goldsure.com.au';
  const serviceType = esc(data.service_type || 'Smoke Alarm Quote');
  const customerAddress = esc(data.customer_address || '-');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Smoke Alarm Quote Reminder</title>
</head>
<body style="margin:0;padding:0;background-color:#ebebeb;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ebebeb">
    <tr>
      <td align="center" style="padding:20px 16px;">
        <table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;overflow:hidden;">
          <tr>
            <td bgcolor="#000000" align="center" style="padding:20px 32px 5px;">
              <img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="180" style="display:block;width:180px;height:auto;margin:0 auto;">
            </td>
          </tr>
          <tr>
            <td bgcolor="#000000" align="center" style="padding:0 32px 16px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;letter-spacing:4px;text-transform:uppercase;color:#b08d2e;">Smoke Alarm Quote Reminder</p>
            </td>
          </tr>
          <tr><td bgcolor="#b08d2e" style="height:2px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
          <tr>
            <td style="padding:24px 30px;background:#ffffff;">
              <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;color:#000000;">Hi ${customerName},</p>
              <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#444444;line-height:1.7;">Your smoke alarm quote${sentDate ? ` sent on <strong>${esc(sentDate)}</strong>` : ''} is awaiting approval and the details are set out below.</p>
              <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#444444;line-height:1.7;">Please accept your quote to secure current pricing and avoid delays in arranging your installation. Once accepted, our team will contact you to schedule the next available booking.</p>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border:1px solid #e0e0e0;">
                <tr>
                  <td bgcolor="#000000" style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Description</td>
                  <td bgcolor="#000000" style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:center;">Qty</td>
                  <td bgcolor="#000000" style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Amount</td>
                </tr>
                <tr bgcolor="#ffffff">
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><strong>Raptor Smoke Alarms</strong><br><span style="font-size:11px;color:#888888;">Photoelectric | Interconnected | 10-Year Warranty</span></td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${alarmQty}</td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${alarmAmount}</td>
                </tr>
                <tr bgcolor="#f9f9f9">
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><strong>Smoke Alarm Controller</strong><br><span style="font-size:11px;color:#888888;">Remote control and status display</span></td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${controllerQty}</td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${controllerAmount}</td>
                </tr>
                <tr bgcolor="#ffffff">
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><strong>${feeLabel}</strong><br><span style="font-size:11px;color:#888888;">Payable upfront to secure your booking</span></td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">1</td>
                  <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${feeAmount}</td>
                </tr>
                <tr bgcolor="#000000">
                  <td colspan="2" style="padding:12px 12px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:2px;">Grand Total (Incl. GST)</td>
                  <td style="padding:12px 12px;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:#b08d2e;text-align:right;">${totalAmount}</td>
                </tr>
              </table>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;background:#faf6ec;border-left:3px solid #b08d2e;">
                <tr><td style="padding:10px 14px;">
                  <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Quote Details</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.6;">Service: ${serviceType}<br>Address: ${customerAddress}<br>Reminder No.: ${reminderCount}</p>
                </td></tr>
              </table>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;background:#111111;border-radius:10px;">
                <tr><td style="padding:20px 22px;text-align:center;">
                  <p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Ready To Move Forward?</p>
                  <p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#ffffff;">If you are ready, you can accept this quote now and our team will contact you to arrange the next step.</p>
                  <a href="${esc(acceptUrl)}" style="display:inline-block;padding:14px 24px;background:#b08d2e;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">Accept This Quote</a>
                </td></tr>
              </table>

              <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;padding-top:16px;border-top:1px solid #e0e0e0;">
                <tr>
                  <td width="136" valign="middle" style="padding-right:4px;">
                    <img src="https://portal.goldsure.com.au/assets/48%20PX.png" alt="Goldsure" width="72" style="display:block;width:72px;height:auto;">
                  </td>
                  <td valign="middle" style="border-left:2px solid #b08d2e;padding-left:12px;">
                    <p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;line-height:1.2;color:#111111;">Customer Service</p>
                    <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
                    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.6;">p: 07 2145 5155<br>e: <a href="mailto:${footerEmail}" style="color:#b08d2e;text-decoration:none;font-weight:bold;">${footerEmail}</a><br>w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">www.goldsure.com.au</a></p>
                  </td>
                </tr>
              </table>

              <p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#aaaaaa;font-style:italic;line-height:1.5;border-top:1px solid #eeeeee;padding-top:12px;">This quote is an estimate based on the property details provided. Final requirements may vary after on-site review by a licensed electrician.</p>
            </td>
          </tr>
          <tr><td bgcolor="#000000" align="center" style="padding:15px 20px;">
            <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
            <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">ABN: 66 683 305 106</p>
            <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">Queensland, Australia</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#555555;line-height:1.5;">CONFIDENTIAL: This email and any attachments are intended solely for the named recipient. Unauthorised use is prohibited.</p>
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    id,
    quote_token,
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    customer_type,
    agent_name,
    service_type,
    alarm_qty,
    alarm_total,
    ctrl_qty,
    ctrl_total,
    fee_label,
    fee_amount,
    grand_total,
    grand_total_numeric,
    reminder_count,
    sent_at,
  } = req.body || {};

  if (!id) return res.status(400).json({ error: 'Missing quote id.' });
  if (!quote_token) return res.status(400).json({ error: 'Missing quote token.' });
  if (!customer_email || !String(customer_email).includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid customer email.' });
  }

  const html = buildReminderEmail({
    quote_token,
    customer_name,
    customer_email,
    customer_phone,
    customer_address,
    customer_type,
    agent_name,
    service_type,
    alarm_qty,
    alarm_total,
    ctrl_qty,
    ctrl_total,
    fee_label,
    fee_amount,
    grand_total,
    grand_total_numeric,
    reminder_count,
    sent_at,
  });

  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
        to: [customer_email],
        subject: `Reminder: Your Goldsure quote is ready`,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const error = await resendResponse.json().catch(() => ({}));
      return res.status(500).json({ error: 'Failed to send reminder email.', detail: error });
    }

    const nowIso = new Date().toISOString();
    const nextReminderCount = qty(reminder_count) + 1;
    let warning = null;

    try {
      const supabaseResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/quote_emails?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          reminder_count: nextReminderCount,
          last_reminder_sent_at: nowIso,
        }),
      });

      if (!supabaseResponse.ok) {
        warning = await supabaseResponse.text();
        console.error('[Supabase] Reminder tracking update failed:', warning);
      }
    } catch (dbErr) {
      warning = dbErr?.message || 'Reminder tracking update failed.';
      console.error('[Supabase] Reminder tracking network error:', dbErr);
    }

    return res.status(200).json({
      success: true,
      reminder_count: nextReminderCount,
      last_reminder_sent_at: nowIso,
      warning,
    });
  } catch (err) {
    console.error('[Reminder] Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
