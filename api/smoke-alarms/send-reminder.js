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
  return `$${numeric.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function qty(value) {
  const numeric = parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildReminderEmail(data) {
  const customerName = esc(data.customer_name || 'there');
  const serviceType = esc(data.service_type || 'Smoke Alarm Quote');
  const reminderCount = qty(data.reminder_count) + 1;
  const sentDate = data.sent_at
    ? new Date(data.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const baseUrl = process.env.SITE_URL || 'https://portal.goldsure.com.au';
  const acceptUrl = `${baseUrl.replace(/\/$/, '')}/accept-quote.html?token=${encodeURIComponent(data.quote_token)}`;

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Goldsure Quote Reminder</title>
</head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#141c2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f6f8;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e3e7ef;border-radius:18px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px 16px;background:#ffffff;">
              <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg" alt="Goldsure" width="140" style="display:block;width:140px;height:auto;">
            </td>
          </tr>
          <tr><td style="height:3px;background:#b08d2e;font-size:1px;line-height:1px;">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#6b7899;">Quote Reminder</p>
              <p style="margin:0 0 12px;font-size:30px;line-height:1.15;font-weight:700;color:#141c2e;">Hi ${customerName},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#44506b;">We wanted to follow up on the smoke alarm quote we sent${sentDate ? ` on <strong>${esc(sentDate)}</strong>` : ''}. If you would like to go ahead, you can accept the quote below and our team will contact you to arrange the next step.</p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#fef7e7;border:1px solid #e8d28a;border-radius:14px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;">Reminder ${reminderCount}</p>
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#5b4a1d;">Your quote is still ready to go. If you have any questions about the alarms, compliance, or booking process, just reply to this email and we will help.</p>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">
                <tr style="background:#f0f2f5;">
                  <td style="padding:11px 14px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#6b7899;">Quote Summary</td>
                  <td style="padding:11px 14px;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#6b7899;text-align:right;">Amount</td>
                </tr>
                <tr>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;">Service</td>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;text-align:right;font-weight:600;">${serviceType}</td>
                </tr>
                <tr>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;">Smoke Alarms</td>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;text-align:right;font-weight:600;">${qty(data.alarm_qty)} units</td>
                </tr>
                <tr>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;">Controllers</td>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;text-align:right;font-weight:600;">${qty(data.ctrl_qty)} units</td>
                </tr>
                <tr>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:14px;color:#141c2e;">Total Quote</td>
                  <td style="padding:13px 14px;border-top:1px solid #e3e7ef;font-size:18px;color:#b08d2e;text-align:right;font-weight:700;">${money(data.grand_total_numeric ?? data.grand_total)}</td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
                <tr>
                  <td align="center">
                    <a href="${acceptUrl}" style="display:inline-block;background:#b08d2e;color:#141c2e;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;padding:16px 30px;border-radius:999px;">Accept This Quote</a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;background:#f8fafc;border:1px solid #e3e7ef;border-radius:14px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7899;">Need Help?</p>
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#44506b;">Reply to this email or contact Goldsure on <strong>07 2145 5155</strong>. We can answer questions, update the quote, or help you secure a booking.</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;line-height:1.6;color:#7d879b;">Goldsure Pty Ltd<br>Queensland, Australia<br><a href="mailto:info@goldsure.com.au" style="color:#2d6be4;text-decoration:none;">info@goldsure.com.au</a></p>
            </td>
          </tr>
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
