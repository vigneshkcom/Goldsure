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
  const columns = (Array.isArray(summary.columns) ? summary.columns : []).map(col => {
    const lower = String(col || '').toLowerCase();
    if (lower.includes('hard wired')) return '240V';
    if (lower.includes('battery')) return 'Battery';
    if (lower.includes('controller')) return 'Controller';
    if (lower.includes('booking fee')) return 'Booking';
    return String(col || '').replace(/raptor/ig, '').trim();
  });
  const jobs = Array.isArray(summary.jobs) ? summary.jobs : [];
  const footer = summary.footer || {};

  const headerCells = columns.map(col => `
    <th style="padding:12px 6px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:center;line-height:1.25;">
      ${esc(col)}
    </th>
  `).join('');

  const jobRows = jobs.map((job, index) => {
    const itemCells = (job.items || []).map(val => `
      <td style="padding:10px 6px;border-bottom:1px solid #eef2f7;font-size:12px;color:${Number(val || 0) === 0 ? '#c8d0dd' : '#141c2e'};text-align:center;">
        ${qty(val)}
      </td>
    `).join('');
    return `
      <tr style="background:${index % 2 === 0 ? '#ffffff' : '#fbfcfe'};">
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#6b7899;text-align:left;white-space:nowrap;">${esc(job.installedDate)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#2d6be4;text-align:left;font-weight:700;white-space:nowrap;">${esc(job.jobId)}</td>
        ${itemCells}
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#141c2e;text-align:right;font-weight:700;">${esc(job.totalQty)}</td>
        <td style="padding:10px 6px;border-bottom:1px solid #eef2f7;font-size:12px;color:${job.balance ? '#d98c1e' : '#c8d0dd'};text-align:center;">${job.balance ? money(job.balance) : '&mdash;'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#141c2e;text-align:left;">${job.paymentMethod ? esc(job.paymentMethod) : '&mdash;'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#18a96e;text-align:right;font-weight:700;">${money(job.payEx)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#d98c1e;text-align:right;font-weight:700;">${money(job.payInc)}</td>
      </tr>
    `;
  }).join('');

  const footerCells = (footer.colTotals || []).map(val => `
    <td style="padding:12px 6px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:center;">${esc(val)}</td>
  `).join('');

  const paymentRows = jobs
    .filter(job => job.balance || job.paymentMethod)
    .map((job, index) => `
      <tr style="background:${index % 2 === 0 ? '#ffffff' : '#fbfcfe'};">
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#2d6be4;text-align:left;font-weight:700;white-space:nowrap;">${esc(job.jobId)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:${job.balance ? '#d98c1e' : '#c8d0dd'};text-align:right;">${job.balance ? money(job.balance) : '&mdash;'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#141c2e;text-align:left;">${job.paymentMethod ? esc(job.paymentMethod) : '&mdash;'}</td>
      </tr>
    `).join('');

  const deductionRow = Number(totals.deduction || 0) > 0 ? `
    <tr>
      <td colspan="${columns.length + 4}" style="padding:11px 8px;background:#fff5f5;border-top:1px solid #f3d1d1;font-size:12px;color:#b42318;text-align:right;font-weight:700;">
        Cash Collected Deduction: ${money(totals.deduction)}
      </td>
    </tr>
  ` : '';

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Installer Pay Summary</title>
  </head>
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#141c2e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:18px;overflow:hidden;">
      <tr>
        <td style="padding:18px 22px;border-bottom:1px solid #e3e7ef;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:10px;vertical-align:middle;">
                      <img src="https://portal.goldsure.com.au/assets/48%20PX.png" alt="Goldsure" style="height:28px;width:auto;display:block;">
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:14px;font-weight:700;color:#141c2e;">Goldsure | Installer Pay</div>
                      <div style="font-size:12px;color:#6b7899;">${period}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 18px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:12px 14px;border-right:1px solid #e3e7ef;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Fieldworker</div>
                <div style="font-size:15px;font-weight:700;color:#141c2e;">${worker}</div>
              </td>
              <td style="padding:12px 14px;border-right:1px solid #e3e7ef;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Pay Period</div>
                <div style="font-size:15px;font-weight:700;color:#2d6be4;">${period}</div>
              </td>
              <td style="padding:12px 14px;border-right:1px solid #e3e7ef;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Total Jobs</div>
                <div style="font-size:15px;font-weight:700;color:#2d6be4;">${esc(totals.jobs)}</div>
              </td>
              <td style="padding:12px 14px;border-right:1px solid #e3e7ef;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Units Installed</div>
                <div style="font-size:15px;font-weight:700;color:#d98c1e;">${esc(totals.units)}</div>
              </td>
              <td style="padding:12px 14px;border-right:1px solid #e3e7ef;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Pay Ex GST</div>
                <div style="font-size:15px;font-weight:700;color:#18a96e;">${money(totals.payEx)}</div>
              </td>
              <td style="padding:12px 14px;">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Pay Inc GST</div>
                <div style="font-size:15px;font-weight:700;color:#d98c1e;">${money(totals.payInc)}</div>
                <div style="font-size:11px;color:#6b7899;">${Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST'}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 18px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:14px 16px;border-bottom:1px solid #e3e7ef;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">
                      Installed Products by Job <span style="font-size:14px;text-transform:none;letter-spacing:0;color:#141c2e;margin-left:6px;">${worker}</span>
                    </td>
                    <td align="right">
                      <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#edf2fd;border:1px solid #c5d3f5;color:#2d6be4;font-size:12px;font-weight:700;">${period}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;">
                  <colgroup>
                    <col style="width:11%;">
                    <col style="width:10%;">
                    ${columns.map(() => '<col style="width:9.5%;">').join('')}
                    <col style="width:9%;">
                    <col style="width:11%;">
                    <col style="width:11%;">
                  </colgroup>
                  <thead>
                    <tr style="background:#f8f9fc;">
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;line-height:1.25;">Date</th>
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;line-height:1.25;">Job</th>
                      ${headerCells}
                      <th style="padding:12px 6px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:center;line-height:1.25;">Qty</th>
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;">Pay Ex GST</th>
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;">Pay Inc GST</th>
                    </tr>
                  </thead>
                  <tbody>${jobRows}</tbody>
                  <tfoot>
                    <tr>
                      <td colspan="2" style="padding:12px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:left;">Gross Total</td>
                      ${footerCells}
                      <td style="padding:12px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:right;">${esc(footer.grandQty)}</td>
                      <td style="padding:12px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#18a96e;text-align:right;">${money(totals.payEx)}</td>
                      <td style="padding:12px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#d98c1e;text-align:right;">${money(totals.payIncGross)}</td>
                    </tr>
                    ${deductionRow}
                  </tfoot>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${paymentRows ? `
      <tr>
        <td style="padding:0 18px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:14px 16px;border-bottom:1px solid #e3e7ef;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">
                Payment Details
              </td>
            </tr>
            <tr>
              <td style="padding:0;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <thead>
                    <tr style="background:#f8f9fc;">
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;">Job</th>
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;">Balance</th>
                      <th style="padding:12px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;">Payment</th>
                    </tr>
                  </thead>
                  <tbody>${paymentRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ` : ''}
    </table>
  </body>
  </html>
  `;
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
