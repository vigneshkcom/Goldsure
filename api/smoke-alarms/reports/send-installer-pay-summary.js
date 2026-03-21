function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function qty(value) {
  return Number(value || 0) === 0 ? '&mdash;' : esc(value);
}

function buildEmailHtml(summary) {
  const worker = esc(summary.worker || 'Electrician');
  const period = esc(summary.period || 'Selected period');
  const totals = summary.totals || {};
  const columns = Array.isArray(summary.columns) ? summary.columns : [];
  const jobs = Array.isArray(summary.jobs) ? summary.jobs : [];
  const footer = summary.footer || {};

  // ── Job rows ──
  const jobRowsHtml = jobs.map((job, index) => {
    const bg = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
    // Format date as DD/MM/YY
    const rawDate = job.installedDate || '';
    let formattedDate = rawDate;
    const dmatch = rawDate.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (dmatch) {
      const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
      const d = dmatch[1].padStart(2,'0');
      const m = months[dmatch[2]] || '00';
      const y = dmatch[3].slice(2);
      formattedDate = `${d}/${m}/${y}`;
    }
    const itemCells = (job.items || []).map(val => {
      const isEmpty = Number(val || 0) === 0;
      return `<td align="center" bgcolor="${bg}"
          style="padding:9px 6px;font-family:Arial,Helvetica,sans-serif;
                 font-size:13px;color:${isEmpty ? '#cccccc' : '#333333'};
                 text-align:center;background:${bg};">
        ${isEmpty ? '&mdash;' : esc(val)}
      </td>`;
    }).join('');

    return `<tr>
      <td bgcolor="${bg}"
          style="padding:9px 8px;font-family:Arial,Helvetica,sans-serif;
                 font-size:11px;color:#888888;white-space:nowrap;background:${bg};">
        ${esc(formattedDate)}</td>
      <td bgcolor="${bg}"
          style="padding:9px 8px;font-family:Arial,Helvetica,sans-serif;
                 font-size:13px;font-weight:bold;color:#000000;background:${bg};">
        ${esc(job.jobId)}</td>
      ${itemCells}
      <td align="center" bgcolor="${bg}"
          style="padding:9px 6px;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;font-weight:bold;color:#000000;
                 text-align:center;background:${bg};">
        ${esc(job.totalQty)}</td>
      <td align="right" bgcolor="${bg}"
          style="padding:9px 8px;font-family:Arial,Helvetica,sans-serif;
                 font-size:13px;font-weight:bold;color:#000000;
                 text-align:right;background:${bg};">
        ${money(job.payEx)}</td>
      <td align="right" bgcolor="${bg}"
          style="padding:9px 8px;font-family:Arial,Helvetica,sans-serif;
                 font-size:13px;font-weight:bold;color:#b08d2e;
                 text-align:right;background:${bg};">
        ${money(job.payInc)}</td>
    </tr>`;
  }).join('');

  // ── Column header cells ──
  const colHeaderCells = columns.map(col => `
    <td align="center" bgcolor="#000000"
        style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;
               font-size:8px;font-weight:bold;letter-spacing:1px;
               text-transform:uppercase;color:#ffffff;text-align:center;
               background:#000000;">
      ${esc(col)}</td>`).join('');

  // ── Footer totals cells ──
  const colTotalCells = (footer.colTotals || []).map(val => `
    <td align="center" bgcolor="#000000"
        style="padding:12px 6px;font-family:Arial,Helvetica,sans-serif;
               font-size:14px;font-weight:bold;color:#ffffff;
               text-align:center;background:#000000;">
      ${esc(val)}</td>`).join('');

  const deductionRow = Number(totals.deduction || 0) > 0 ? `
    <tr>
      <td colspan="${columns.length + 6}" bgcolor="#fff5f5"
          style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;
                 font-size:11px;color:#b42318;text-align:right;font-weight:bold;
                 background:#fff5f5;">
        Cash Collected Deduction: ${money(totals.deduction)}
      </td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Installer Pay Summary</title>
</head>
<body style="margin:0;padding:0;background:#e4e0d8;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#e4e0d8">
<tr><td align="center" style="padding:28px 0 36px;">

<!-- OUTER CARD: fixed 600px — Gmail scales this down proportionally on mobile -->
<table width="600" border="0" cellpadding="0" cellspacing="0"
       style="background:#ffffff;" bgcolor="#ffffff">

  <!-- HEADER: white background with logo -->
  <tr>
    <td bgcolor="#ffffff" align="center"
        style="padding:24px 32px 8px;background:#ffffff;">
      <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"
           alt="Goldsure" width="160" height="auto"
           style="display:block;width:160px;border:0;" />
    </td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" align="center"
        style="padding:2px 32px 16px;background:#ffffff;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:8px;
                font-weight:bold;letter-spacing:5px;text-transform:uppercase;
                color:#b08d2e;">Installer Pay Summary</p>
    </td>
  </tr>
  <!-- Gold rule -->
  <tr>
    <td bgcolor="#b08d2e" height="2"
        style="font-size:2px;line-height:2px;background:#b08d2e;">&nbsp;</td>
  </tr>

  <!-- TITLE ROW -->
  <tr>
    <td bgcolor="#ffffff" style="padding:20px 28px 4px;background:#ffffff;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="middle">
            <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;
                      font-size:18px;font-weight:bold;color:#000000;">
              ${worker}</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:12px;color:#999999;">
              Pay Period:&nbsp;<strong style="color:#333333;">${period}</strong></p>
          </td>
          <td valign="middle" align="right">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:11px;color:#aaaaaa;text-align:right;line-height:1.7;">
              Goldsure Pty Ltd<br>
              <a href="mailto:vignesh@goldsure.com.au"
                 style="color:#b08d2e;text-decoration:none;font-weight:bold;">
                vignesh@goldsure.com.au</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- STAT STRIP -->
  <tr>
    <td bgcolor="#ffffff" style="padding:14px 28px 18px;background:#ffffff;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0"
             style="border-collapse:collapse;border:1px solid #e0dcd2;">
        <tr>
          <td width="25%" valign="top" bgcolor="#ffffff"
              style="padding:14px 16px;border-right:1px solid #e0dcd2;
                     vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;
                      font-size:8px;letter-spacing:3px;text-transform:uppercase;
                      color:#aaaaaa;">Total Jobs</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:26px;font-weight:bold;color:#000000;line-height:1;">
              ${esc(totals.jobs)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#ffffff"
              style="padding:14px 16px;border-right:1px solid #e0dcd2;
                     vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;
                      font-size:8px;letter-spacing:3px;text-transform:uppercase;
                      color:#aaaaaa;">Units Installed</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:26px;font-weight:bold;color:#000000;line-height:1;">
              ${esc(totals.units)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#ffffff"
              style="padding:14px 16px;border-right:1px solid #e0dcd2;
                     vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;
                      font-size:8px;letter-spacing:3px;text-transform:uppercase;
                      color:#aaaaaa;">Pay Ex GST</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:26px;font-weight:bold;color:#000000;line-height:1;">
              ${money(totals.payEx)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#000000"
              style="padding:14px 16px;vertical-align:top;background:#000000;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;
                      font-size:8px;letter-spacing:3px;text-transform:uppercase;
                      color:#b08d2e;">Pay Inc GST</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                      font-size:26px;font-weight:bold;color:#b08d2e;line-height:1;">
              ${money(totals.payInc)}</p>
            <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;
                      font-size:10px;color:#666666;">
              ${Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST'}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- JOB TABLE -->
  <tr>
    <td bgcolor="#ffffff" style="padding:0 28px 26px;background:#ffffff;">
      <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;
                font-size:8px;letter-spacing:3px;text-transform:uppercase;
                color:#aaaaaa;">Job Breakdown</p>

      <table width="100%" border="0" cellpadding="0" cellspacing="0"
             style="border-collapse:collapse;border:1px solid #e0dcd2;border-top:none;">

        <!-- Column headers -->
        <tr bgcolor="#000000">
          <td bgcolor="#000000"
              style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:8px;font-weight:bold;letter-spacing:1px;
                     text-transform:uppercase;color:#ffffff;background:#000000;">
            Date</td>
          <td bgcolor="#000000"
              style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:8px;font-weight:bold;letter-spacing:1px;
                     text-transform:uppercase;color:#ffffff;background:#000000;">
            Job No.</td>
          ${colHeaderCells}
          <td align="center" bgcolor="#000000"
              style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;
                     font-size:8px;font-weight:bold;letter-spacing:1px;
                     text-transform:uppercase;color:#ffffff;text-align:center;
                     background:#000000;">
            Total Qty</td>
          <td align="right" bgcolor="#000000"
              style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:8px;font-weight:bold;letter-spacing:1px;
                     text-transform:uppercase;color:#ffffff;text-align:right;
                     background:#000000;">
            Pay Ex GST</td>
          <td align="right" bgcolor="#000000"
              style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:8px;font-weight:bold;letter-spacing:1px;
                     text-transform:uppercase;color:#b08d2e;text-align:right;
                     background:#000000;">
            Pay Inc GST</td>
        </tr>

        ${jobRowsHtml}

        <!-- Gold separator -->
        <tr bgcolor="#b08d2e">
          <td colspan="${columns.length + 5}" bgcolor="#b08d2e"
              style="font-size:2px;line-height:2px;background:#b08d2e;">&nbsp;</td>
        </tr>

        <!-- Grand Total -->
        <tr bgcolor="#000000">
          <td colspan="2" bgcolor="#000000"
              style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:10px;font-weight:bold;color:#ffffff;
                     text-transform:uppercase;letter-spacing:2px;background:#000000;">
            Gross Total</td>
          ${colTotalCells}
          <td align="center" bgcolor="#000000"
              style="padding:12px 6px;font-family:Arial,Helvetica,sans-serif;
                     font-size:16px;font-weight:bold;color:#ffffff;
                     text-align:center;background:#000000;">
            ${esc(footer.grandQty)}</td>
          <td align="right" bgcolor="#000000"
              style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:16px;font-weight:bold;color:#ffffff;
                     text-align:right;background:#000000;">
            ${money(totals.payEx)}</td>
          <td align="right" bgcolor="#000000"
              style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;
                     font-size:16px;font-weight:bold;color:#b08d2e;
                     text-align:right;background:#000000;">
            ${money(totals.payIncGross)}</td>
        </tr>

        ${deductionRow}

      </table>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td bgcolor="#000000" align="center"
        style="padding:14px 28px;background:#000000;">
      <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;
                font-size:9px;font-weight:bold;letter-spacing:3px;
                text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;
                font-size:10px;color:#555555;line-height:1.7;">
        ABN: 66 683 305 106 &nbsp;&middot;&nbsp; Queensland, Australia<br>
        <a href="mailto:vignesh@goldsure.com.au"
           style="color:#b08d2e;text-decoration:none;">vignesh@goldsure.com.au</a>
        &nbsp;&middot;&nbsp;
        <a href="https://www.goldsure.com.au"
           style="color:#555555;text-decoration:none;">www.goldsure.com.au</a>
      </p>
    </td>
  </tr>

</table><!-- /600 card -->
</td></tr>
</table><!-- /100% wrapper -->

</body>
</html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, summary } = req.body || {};
  const toAddresses = Array.isArray(to) ? to : [to];

  if (!toAddresses.length || !toAddresses.every(email => typeof email === 'string' && email.includes('@'))) {
    return res.status(400).json({ error: 'Missing or invalid recipient email.' });
  }
  if (!summary || !summary.worker || !Array.isArray(summary.jobs) || !summary.jobs.length) {
    return res.status(400).json({ error: 'Missing summary data.' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
        to: toAddresses,
        subject: subject || `${summary.worker} Installer Pay Summary`,
        html: buildEmailHtml(summary),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(async () => ({ error: await response.text() }));
      console.error('[Resend] Installer pay summary send failed:', error);
      return res.status(500).json({ error: 'Failed to send email.', detail: error });
    }

    const result = await response.json();
    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    console.error('[Resend] Installer pay summary server error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
