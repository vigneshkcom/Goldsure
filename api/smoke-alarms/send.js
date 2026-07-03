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
    payment_note,
  } = req.body;

  if (!customer_name || !to_email || !to_email.includes('@')) {
    return res.status(400).json({ error: 'Missing or invalid required fields.' });
  }

  // ── Controller state ──
  // The Smoke Alarm Controller is an optional add-on. It should only appear
  // as a line item on the quote when the agent actually selected it.
  // When no controller is selected on an installation quote, we instead
  // upsell it as a low-cost add-on the customer can request on the day.
  const hasController = (parseInt(ctrl_qty, 10) || 0) > 0;
  const isInstall     = service_type === 'Installation Quote';

  // ── Build Accept Quote URL using token ──
  const baseUrl   = process.env.SITE_URL || 'https://www.goldsure.com.au';
  const token     = quote_token || crypto.randomUUID();
  const acceptUrl = `${baseUrl}/accept-quote.html?token=${token}`;

  // ── Phone display in email ──
  const phoneDisplay = customer_phone
    ? `<br><span style="font-size:12px;color:#888888;font-family:Arial,Helvetica,sans-serif;">📞 ${customer_phone}</span>`
    : '';

  const html = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Goldsure Quote</title>
</head>
<body style="margin:0;padding:0;background-color:#ebebeb;">
<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#ebebeb">
  <tr><td align="center" style="padding:20px 16px;">
    <table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;overflow:hidden;">
      <tr><td bgcolor="#000000" align="center" style="padding:20px 32px 5px;">
        <img src="https://portal.goldsure.com.au/assets/goldsure-inverted-logo.jpg" alt="Goldsure" width="180" style="display:block;width:180px;height:auto;margin:0 auto;" />
      </td></tr>
      <tr><td bgcolor="#000000" align="center" style="padding:0 32px 16px;">
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;letter-spacing:4px;text-transform:uppercase;color:#b08d2e;">Smoke Alarm Quote</p>
      </td></tr>
      <tr><td bgcolor="#b08d2e" style="height:2px;font-size:1px;line-height:1px;">&nbsp;</td></tr>
      <tr><td style="padding:24px 30px;background:#ffffff;">
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:700;color:#000000;">Hi ${customer_name},</p>
        ${(customer_phone || customer_address) ? `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#888888;line-height:1.6;">${customer_phone ? customer_phone : ''}${customer_phone && customer_address ? '<br>' : ''}${customer_address ? customer_address : ''}</p>` : ''}
        <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#444444;line-height:1.6;">Thank you for choosing Goldsure. As discussed, please find your personalised smoke alarm quote below. Our licensed electrician will confirm the exact alarm placement on the day of installation to ensure full compliance with Queensland legislation.</p>
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border:1px solid #e0e0e0;">
          <tr bgcolor="#000000">
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Description</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:center;">Qty</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Unit</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;text-align:right;">Total</td>
          </tr>
          <tr bgcolor="#ffffff">
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><span style="font-family:Arial,Helvetica,sans-serif;">Raptor Smoke Alarms</span><br><span style="font-size:11px;color:#888888;">Photoelectric &middot; Interconnected &middot; 10-Yr Warranty</span></td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${alarm_qty}</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">$98.00</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${alarm_total}</td>
          </tr>
          ${hasController ? `<tr bgcolor="#f9f9f9">
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><span style="font-family:Arial,Helvetica,sans-serif;">Smoke Alarm Controller</span><br><span style="font-size:11px;color:#888888;">Remote control &amp; status display</span></td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">${ctrl_qty}</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">$49.00</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${ctrl_total}</td>
          </tr>` : ''}
          <tr bgcolor="#ffffff">
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;border-top:1px solid #f0f0f0;"><span style="font-family:Arial,Helvetica,sans-serif;">${fee_label}</span><br><span style="font-size:11px;color:#888888;">${fee_amount} payable upfront to secure your booking</span></td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:center;border-top:1px solid #f0f0f0;">1</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;text-align:right;border-top:1px solid #f0f0f0;">${fee_amount}</td>
            <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#000000;text-align:right;border-top:1px solid #f0f0f0;">${fee_amount}</td>
          </tr>
          <tr bgcolor="#000000">
            <td colspan="3" style="padding:12px 12px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#ffffff;text-transform:uppercase;letter-spacing:2px;">Grand Total (Incl. GST)</td>
            <td style="padding:12px 12px;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#b08d2e;text-align:right;">${grand_total}</td>
          </tr>
        </table>
        ${(isInstall && !hasController) ? `<table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;background:#faf6ec;border:1px dashed #b08d2e;">
          <tr><td style="padding:12px 14px;">
            <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Optional Add-On &mdash; Smoke Alarm Controller</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.5;">Want to silence a nuisance alarm or check your alarms at the touch of a button? Ask our electrician about adding a Smoke Alarm Controller when he is on site &mdash; just <strong style="color:#000000;">$49</strong> extra, no need to arrange it in advance.</p>
          </td></tr>
        </table>` : ''}
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;background:#faf6ec;border-left:3px solid #b08d2e;">
          <tr><td style="padding:10px 14px;">
            <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#b08d2e;">Payment Structure</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333;line-height:1.5;">${payment_note}</p>
          </td></tr>
        </table>
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#111111;border-radius:10px;">
          <tr><td style="padding:20px 22px;text-align:center;">
            <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">This quote is valid for 14 days</p>
            <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff;line-height:1.5;">Ready to proceed? Click below and we'll be in touch to confirm your booking.</p>
            <a href="${acceptUrl}" style="display:inline-block;background:#b08d2e;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 24px;border-radius:8px;">Accept This Quote</a>
          </td></tr>
        </table>
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
          <tr><td bgcolor="#000000" style="padding:8px 14px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:#b08d2e;">Queensland Legislation &mdash; Effective 01/01/2027</p></td></tr>
          <tr><td style="padding:10px 12px;border:1px solid #e0e0e0;border-top:none;">
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
          </td></tr>
        </table>
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:18px;border-top:2px solid #b08d2e;">
          <tr><td style="padding-top:14px;">
            <p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#b08d2e;">Raptor Alarms</p>
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:20px;color:#000000;line-height:1.2;">The Raptor Smoke Alarm</p>
            <p style="margin:0 0 15px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:1.5;">Purpose-built for Australian Standards and approved for Queensland's fire safety regulatory requirements.</p>
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:15px;">
              <tr>
                <td width="48%" align="center"><img src="https://portal.goldsure.com.au/assets/Raptor%20Smoke%20Alarm%201.png" alt="Raptor Front View" width="160" style="display:block;width:160px;height:auto;margin:0 auto;" /><p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#999999;margin:4px 0 0;font-style:italic;text-align:center;">Front View</p></td>
                <td width="4%"></td>
                <td width="48%" align="center"><img src="https://portal.goldsure.com.au/assets/Raptor%20Alarm%202.png" alt="Raptor Installed View" width="160" style="display:block;width:160px;height:auto;margin:0 auto;" /><p style="font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#999999;margin:4px 0 0;font-style:italic;text-align:center;">Installed View</p></td>
              </tr>
            </table>
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border:1px solid #e0e0e0;">
              <tr><td colspan="2" bgcolor="#000000" style="padding:8px 12px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Key Features</p></td></tr>
              <tr>
                <td width="50%" valign="top" bgcolor="#ffffff" style="padding:10px 12px;border-right:1px solid #eeeeee;border-bottom:1px solid #eeeeee;"><p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#b08d2e;">&#10003; Photoelectric Sensing</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Reduces nuisance alarms from cooking while ensuring reliable early detection.</p></td>
                <td width="50%" valign="top" bgcolor="#ffffff" style="padding:10px 12px;border-bottom:1px solid #eeeeee;"><p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#b08d2e;">&#10003; RF Wireless Interconnect</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">When one alarm sounds, all connected alarms sound. Up to 40 units per network.</p></td>
              </tr>
              <tr>
                <td width="50%" valign="top" bgcolor="#f9f9f9" style="padding:10px 12px;border-right:1px solid #eeeeee;"><p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#b08d2e;">&#10003; Alarm Memory</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Visual indication of prior activations and end-of-life warning for easy management.</p></td>
                <td width="50%" valign="top" bgcolor="#f9f9f9" style="padding:10px 12px;"><p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#b08d2e;">&#10003; 10-Year Warranty</p><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;line-height:1.4;">Backed by a full 10-year manufacturer warranty for complete peace of mind.</p></td>
              </tr>
              <tr><td colspan="2" bgcolor="#000000" align="center" style="padding:8px 12px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#ffffff;">Certified to <strong style="color:#b08d2e;">AS3786 2023</strong> &nbsp;|&nbsp; Approved for All Australian States</p></td></tr>
            </table>
            <p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;text-align:center;"><a href="https://workdrive.zohopublic.com.au/external/77cc4e8b9e29aef78d17e9bde90d3e9718972cbe212a0bc0446effb7292cf0e6" style="color:#b08d2e;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">View the Raptor Smoke Alarm Datasheet &rarr;</a></p>
          </td></tr>
        </table>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#aaaaaa;font-style:italic;line-height:1.5;border-top:1px solid #eeeeee;padding-top:12px;">* This quote is an estimate based on property details provided. On-site assessment by a licensed electrician is required for final compliance certification.</p>
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e0e0e0;">
          <tr>
            <td valign="middle" style="padding:14px 16px 14px 0;width:130px;">
              <img src="https://portal.goldsure.com.au/assets/goldsure-logo.jpg" alt="Goldsure" width="110" style="display:block;width:110px;height:auto;">
            </td>
            <td valign="middle" style="padding:14px 0 14px 16px;border-left:2px solid #b08d2e;">
              <p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#000000;">${agent_name}</p>
              <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#555555;line-height:1.6;">p: 07 2145 5155<br>e: <a href="mailto:info@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">info@goldsure.com.au</a><br>w: <a href="https://www.goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">www.goldsure.com.au</a></p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td bgcolor="#000000" align="center" style="padding:15px 20px;">
        <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">ABN: 66 683 305 106</p>
        <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#888888;line-height:1.5;">Queensland, Australia</p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;color:#555555;line-height:1.4;">CONFIDENTIAL: This email and any attachments are intended solely for the named recipient. Unauthorised use is prohibited.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // ════════════════════════════════════════════════════════════
  // SEND EMAIL via Resend
  // ════════════════════════════════════════════════════════════
  let emailSuccess = false;
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
      console.error('[Resend] Send failed:', error);
      return res.status(500).json({ error: 'Failed to send email.', detail: error });
    }

    emailSuccess = true;
  } catch (err) {
    console.error('[Resend] Server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }

  // ════════════════════════════════════════════════════════════
  // LOG TO SUPABASE — non-blocking, email already sent above
  //
  // FIX: previously the fetch response was never read or checked.
  // fetch() only throws on network failure — it does NOT throw on
  // HTTP 4xx/5xx. The silent failure was swallowed by the catch
  // because there was nothing to catch. Now we:
  //   1. Await and store the response
  //   2. Read the response body with .text() regardless of status
  //   3. Check response.ok and log the full error body if it failed
  //   4. Log a success confirmation when the row is inserted
  // This ensures every failure appears in Vercel function logs.
  // ════════════════════════════════════════════════════════════
  if (emailSuccess) {
    try {
      // Parse "$1,254.00" → 1254.00
      // Strip everything except digits and dots, then remove any
      // extra leading dots to avoid parseFloat returning NaN.
      const grandNumeric = parseFloat(
        (grand_total || '0')
          .replace(/[^0-9.]/g, '')          // keep only digits and dots
          .replace(/^\.+/, '')              // remove any leading dots
          .replace(/\.(?=.*\.)/g, '')       // keep only the last dot
      ) || 0;

      console.log('[Supabase] Attempting insert for quote_token:', token);
      console.log('[Supabase] Using URL:', process.env.SUPABASE_URL ? process.env.SUPABASE_URL.slice(0, 40) + '…' : 'MISSING');
      console.log('[Supabase] Anon key present:', !!process.env.SUPABASE_ANON_KEY);

      const supabaseRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/quote_emails`,
        {
          method: 'POST',
          headers: {
            'apikey':        process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type':  'application/json',
            // return=representation tells Supabase to return the inserted
            // row so we can confirm exactly what was written
            'Prefer':        'return=representation',
          },
          body: JSON.stringify({
            quote_token:         token,
            customer_name:       customer_name    || null,
            customer_email:      to_email         || null,
            customer_phone:      customer_phone   || null,
            customer_address:    customer_address || null,
            customer_type:       customer_type    || 'digital',
            agent_name:          agent_name       || null,
            service_type:        service_type     || null,
            alarm_qty:           parseInt(alarm_qty, 10) || 0,
            alarm_total:         parseFloat((alarm_total  || '0').replace(/[^0-9.]/g, '')) || null,
            alarm_unit_price:    98,
            ctrl_qty:            parseInt(ctrl_qty, 10) || 0,
            ctrl_total:          parseFloat((ctrl_total  || '0').replace(/[^0-9.]/g, '')) || null,
            fee_label:           fee_label        || null,
            fee_amount:          parseFloat((fee_amount  || '0').replace(/[^0-9.]/g, '')) || null,
            grand_total:         parseFloat((grand_total || '0').replace(/[^0-9.]/g, '')) || null,
            grand_total_numeric: grandNumeric,
            status:              'sent',
            accepted:            false,
            sent_at:             new Date().toISOString(),
          }),
        }
      );

      // ALWAYS read the response body — required to free the connection
      // and to get the actual error message from Supabase on failure
      const supaBody = await supabaseRes.text();

      if (!supabaseRes.ok) {
        // Log HTTP status + full Supabase error payload to Vercel logs
        console.error(
          `[Supabase] INSERT FAILED — HTTP ${supabaseRes.status} ${supabaseRes.statusText}`
        );
        console.error('[Supabase] Error body:', supaBody);
      } else {
        // Confirm the row was written — log the returned id for traceability
        let insertedId = '(unknown)';
        try {
          const parsed = JSON.parse(supaBody);
          if (Array.isArray(parsed) && parsed[0]) insertedId = parsed[0].id;
        } catch (_) { /* body may be empty on some Prefer modes */ }
        console.log(
          `[Supabase] INSERT OK — HTTP ${supabaseRes.status} — row id: ${insertedId} — token: ${token}`
        );
      }
    } catch (supaErr) {
      // Only reaches here on network-level failure (DNS, timeout, etc.)
      console.error('[Supabase] Network error during insert (non-fatal):', supaErr);
    }

    return res.status(200).json({ success: true });
  }
}
