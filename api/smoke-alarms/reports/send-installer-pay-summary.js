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

  const headerCells = columns.map(col => `
    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;white-space:nowrap;">
      ${esc(col)}
    </th>
  `).join('');

  const jobRows = jobs.map((job, index) => {
    const itemCells = (job.items || []).map(val => `
      <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:${Number(val || 0) === 0 ? '#c8d0dd' : '#141c2e'};text-align:right;white-space:nowrap;">
        ${qty(val)}
      </td>
    `).join('');
    return `
      <tr style="background:${index % 2 === 0 ? '#ffffff' : '#fbfcfe'};">
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#6b7899;text-align:left;white-space:nowrap;">${esc(job.installedDate)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#2d6be4;text-align:left;font-weight:700;white-space:nowrap;">${esc(job.jobId)}</td>
        ${itemCells}
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#141c2e;text-align:right;font-weight:700;white-space:nowrap;">${esc(job.totalQty)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:${job.balance ? '#d98c1e' : '#c8d0dd'};text-align:right;white-space:nowrap;">${job.balance ? money(job.balance) : '&mdash;'}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#141c2e;text-align:left;white-space:nowrap;">${job.paymentMethod ? esc(job.paymentMethod) : '&mdash;'}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#18a96e;text-align:right;font-weight:700;white-space:nowrap;">${money(job.payEx)}</td>
        <td style="padding:9px 8px;border-bottom:1px solid #eef2f7;font-size:12px;color:#d98c1e;text-align:right;font-weight:700;white-space:nowrap;">${money(job.payInc)}</td>
      </tr>
    `;
  }).join('');

  const footerCells = (footer.colTotals || []).map(val => `
    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:right;white-space:nowrap;">${esc(val)}</td>
  `).join('');

  const deductionRow = Number(totals.deduction || 0) > 0 ? `
    <tr>
      <td colspan="${columns.length + 6}" style="padding:11px 8px;background:#fff5f5;border-top:1px solid #f3d1d1;font-size:12px;color:#b42318;text-align:right;font-weight:700;">
        Cash Collected Deduction: ${money(totals.deduction)}
      </td>
    </tr>
  ` : '';

  // Summary stat cards — 2-column grid on mobile, 6-column on desktop via inline-block
  const statCards = [
    { label: 'Fieldworker',    value: worker,              color: '#141c2e', sub: '' },
    { label: 'Pay Period',     value: period,              color: '#2d6be4', sub: '' },
    { label: 'Total Jobs',     value: esc(totals.jobs),    color: '#2d6be4', sub: '' },
    { label: 'Units Installed',value: esc(totals.units),   color: '#d98c1e', sub: '' },
    { label: 'Pay Ex GST',     value: money(totals.payEx), color: '#18a96e', sub: '' },
    { label: 'Pay Inc GST',    value: money(totals.payInc),color: '#d98c1e',
      sub: Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST' },
  ].map((card, i, arr) => {
    const isLast = i === arr.length - 1;
    return `
      <div class="stat-card" style="display:inline-block;vertical-align:top;width:16.6%;box-sizing:border-box;padding:12px 14px;border-right:${isLast ? 'none' : '1px solid #e3e7ef'};">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">${card.label}</div>
        <div style="font-size:15px;font-weight:700;color:${card.color};margin-top:3px;">${card.value}</div>
        ${card.sub ? `<div style="font-size:11px;color:#6b7899;margin-top:2px;">${card.sub}</div>` : ''}
      </div>
    `;
  }).join('');

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>Installer Pay Summary</title>
    <style>
      @media only screen and (max-width: 600px) {
        .outer-wrap { padding: 12px 8px !important; }
        .main-card { border-radius: 12px !important; }
        .header-cell { padding: 14px 14px !important; }

        /* Stat cards: 2 per row on mobile */
        .stat-grid { display: block !important; }
        .stat-card {
          display: inline-block !important;
          width: 50% !important;
          border-right: 1px solid #e3e7ef !important;
          border-bottom: 1px solid #e3e7ef !important;
          box-sizing: border-box !important;
        }
        .stat-card:nth-child(2n) { border-right: none !important; }
        .stat-card:nth-last-child(-n+2) { border-bottom: none !important; }

        /* Table section: scroll horizontally */
        .table-section { padding: 10px 10px 12px !important; }
        .table-header-row td { padding: 10px 10px !important; }
        .table-scroll-wrap {
          overflow-x: auto !important;
          -webkit-overflow-scrolling: touch !important;
        }
      }
    </style>
  </head>
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#141c2e;" class="outer-wrap">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:18px;overflow:hidden;" class="main-card">

      <!-- Header -->
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid #e3e7ef;" class="header-cell">
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

      <!-- Summary stat cards -->
      <tr>
        <td style="padding:12px 18px 0;">
          <div style="border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">
            <div class="stat-grid" style="font-size:0;">
              ${statCards}
            </div>
          </div>
        </td>
      </tr>

      <!-- Jobs table section -->
      <tr>
        <td style="padding:14px 18px 18px;" class="table-section">
          <div style="border:1px solid #e3e7ef;border-radius:14px;overflow:hidden;">

            <!-- Section header -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="table-header-row">
              <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #e3e7ef;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">
                        Installed Products by Job <span style="font-size:14px;text-transform:none;letter-spacing:0;color:#141c2e;margin-left:6px;">${worker}</span>
                      </td>
                      <td align="right" style="white-space:nowrap;padding-left:8px;">
                        <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:#edf2fd;border:1px solid #c5d3f5;color:#2d6be4;font-size:11px;font-weight:700;">${period}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Scrollable table wrapper -->
            <div class="table-scroll-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:700px;">
                <thead>
                  <tr style="background:#f8f9fc;">
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;white-space:nowrap;">Installed Date</th>
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;white-space:nowrap;">Job No.</th>
                    ${headerCells}
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;white-space:nowrap;">Total Qty</th>
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;white-space:nowrap;">Balance</th>
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:left;white-space:nowrap;">Payment Method</th>
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;white-space:nowrap;">Pay Ex GST</th>
                    <th style="padding:10px 8px;border-bottom:1px solid #e3e7ef;font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;text-align:right;white-space:nowrap;">Pay Inc GST</th>
                  </tr>
                </thead>
                <tbody>${jobRows}</tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:left;white-space:nowrap;">Gross Total</td>
                    ${footerCells}
                    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#141c2e;text-align:right;white-space:nowrap;">${esc(footer.grandQty)}</td>
                    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;"></td>
                    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;"></td>
                    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#18a96e;text-align:right;white-space:nowrap;">${money(totals.payEx)}</td>
                    <td style="padding:10px 8px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:12px;font-weight:700;color:#d98c1e;text-align:right;white-space:nowrap;">${money(totals.payIncGross)}</td>
                  </tr>
                  ${deductionRow}
                </tfoot>
              </table>
            </div>

          </div>
        </td>
      </tr>

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
