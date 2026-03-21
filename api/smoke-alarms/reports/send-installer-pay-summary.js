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

  const thStyle = 'padding:8px 6px;border-bottom:1px solid #e3e7ef;font-size:9px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase;color:#6b7899;';
  const tdBase = 'padding:8px 6px;border-bottom:1px solid #eef2f7;font-size:11px;';
  const tfStyle = 'padding:8px 6px;background:#f8f9fc;border-top:2px solid #e3e7ef;font-size:11px;font-weight:700;';

  // ── Desktop table ──
  const headerCells = columns.map(col =>
    `<th style="${thStyle}text-align:right;">${esc(col)}</th>`
  ).join('');

  const jobRowsDesktop = jobs.map((job, index) => {
    const itemCells = (job.items || []).map(val =>
      `<td style="${tdBase}color:${Number(val || 0) === 0 ? '#c8d0dd' : '#141c2e'};text-align:right;">${qty(val)}</td>`
    ).join('');
    return `
      <tr style="background:${index % 2 === 0 ? '#ffffff' : '#fbfcfe'};">
        <td style="${tdBase}color:#6b7899;text-align:left;white-space:nowrap;">${esc(job.installedDate)}</td>
        <td style="${tdBase}color:#2d6be4;font-weight:700;text-align:left;white-space:nowrap;">${esc(job.jobId)}</td>
        ${itemCells}
        <td style="${tdBase}color:#141c2e;text-align:right;font-weight:700;">${esc(job.totalQty)}</td>
        <td style="${tdBase}color:${job.balance ? '#d98c1e' : '#c8d0dd'};text-align:right;">${job.balance ? money(job.balance) : '&mdash;'}</td>
        <td style="${tdBase}color:#141c2e;text-align:left;">${job.paymentMethod ? esc(job.paymentMethod) : '&mdash;'}</td>
        <td style="${tdBase}color:#18a96e;text-align:right;font-weight:700;">${money(job.payEx)}</td>
        <td style="${tdBase}color:#d98c1e;text-align:right;font-weight:700;">${money(job.payInc)}</td>
      </tr>`;
  }).join('');

  const footerCells = (footer.colTotals || []).map(val =>
    `<td style="${tfStyle}color:#141c2e;text-align:right;">${esc(val)}</td>`
  ).join('');

  const deductionRow = Number(totals.deduction || 0) > 0 ? `
    <tr>
      <td colspan="${columns.length + 6}" style="padding:10px 8px;background:#fff5f5;border-top:1px solid #f3d1d1;font-size:12px;color:#b42318;text-align:right;font-weight:700;">
        Cash Collected Deduction: ${money(totals.deduction)}
      </td>
    </tr>` : '';

  // ── Mobile: one card per job ──
  const mobileJobCards = jobs.map((job) => {
    const productLines = columns.map((col, i) => {
      const val = (job.items || [])[i];
      if (Number(val || 0) === 0) return '';
      return `<tr>
        <td style="padding:4px 0;font-size:12px;color:#6b7899;">${esc(col)}</td>
        <td style="padding:4px 0;font-size:12px;color:#141c2e;text-align:right;font-weight:700;">${esc(val)}</td>
      </tr>`;
    }).filter(Boolean).join('');

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:10px;margin-bottom:10px;border-collapse:collapse;overflow:hidden;">
      <tr style="background:#f8f9fc;">
        <td style="padding:10px 12px;border-bottom:1px solid #e3e7ef;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;font-weight:700;color:#2d6be4;">${esc(job.jobId)}</td>
              <td style="font-size:11px;color:#6b7899;text-align:right;">${esc(job.installedDate)}</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="padding:10px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${productLines}
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#6b7899;">Total Qty</td>
            <td style="padding:4px 0;font-size:12px;color:#141c2e;text-align:right;font-weight:700;">${esc(job.totalQty)}</td>
          </tr>
          ${job.balance ? `<tr>
            <td style="padding:4px 0;font-size:12px;color:#6b7899;">Balance</td>
            <td style="padding:4px 0;font-size:12px;color:#d98c1e;text-align:right;font-weight:700;">${money(job.balance)}</td>
          </tr>` : ''}
          ${job.paymentMethod ? `<tr>
            <td style="padding:4px 0;font-size:12px;color:#6b7899;">Payment</td>
            <td style="padding:4px 0;font-size:12px;color:#141c2e;text-align:right;">${esc(job.paymentMethod)}</td>
          </tr>` : ''}
        </table>
      </td></tr>
      <tr style="background:#f8f9fc;"><td style="padding:10px 12px;border-top:1px solid #e3e7ef;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:12px;color:#6b7899;">Pay Ex GST</td>
            <td style="font-size:14px;font-weight:700;color:#18a96e;text-align:right;">${money(job.payEx)}</td>
          </tr>
          <tr>
            <td style="font-size:12px;color:#6b7899;">Pay Inc GST</td>
            <td style="font-size:14px;font-weight:700;color:#d98c1e;text-align:right;">${money(job.payInc)}</td>
          </tr>
        </table>
      </td></tr>
    </table>`;
  }).join('');

  // ── Stat cards: 2-column table ──
  const statData = [
    { label: 'Fieldworker',     value: worker,               color: '#141c2e', sub: '' },
    { label: 'Pay Period',      value: period,               color: '#2d6be4', sub: '' },
    { label: 'Total Jobs',      value: esc(totals.jobs),     color: '#2d6be4', sub: '' },
    { label: 'Units Installed', value: esc(totals.units),    color: '#d98c1e', sub: '' },
    { label: 'Pay Ex GST',      value: money(totals.payEx),  color: '#18a96e', sub: '' },
    { label: 'Pay Inc GST',     value: money(totals.payInc), color: '#d98c1e',
      sub: Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST' },
  ];
  const statRows = [];
  for (let i = 0; i < statData.length; i += 2) {
    const left = statData[i], right = statData[i + 1];
    const isLastRow = i + 2 >= statData.length;
    const bb = isLastRow ? '' : 'border-bottom:1px solid #e3e7ef;';
    const cell = `padding:12px 14px;${bb}vertical-align:top;width:50%;`;
    const card = (c) => `
      <div style="font-size:9px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">${c.label}</div>
      <div style="font-size:15px;font-weight:700;color:${c.color};margin-top:4px;">${c.value}</div>
      ${c.sub ? `<div style="font-size:10px;color:#6b7899;margin-top:2px;">${c.sub}</div>` : ''}`;
    statRows.push(`<tr>
      <td style="${cell}border-right:1px solid #e3e7ef;">${card(left)}</td>
      <td style="${cell}">${right ? card(right) : ''}</td>
    </tr>`);
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Installer Pay Summary</title>
  <style>
    /* u+.body targets Gmail Android specifically */
    u+.body .mob-hide { display:none !important; max-height:0 !important; overflow:hidden !important; mso-hide:all; }
    u+.body .mob-show { display:block !important; max-height:none !important; }
    u+.body .mob-show-row { display:table-row !important; max-height:none !important; }
    /* Standard media query for Apple Mail, Samsung, etc. */
    @media only screen and (max-width:600px) {
      .mob-hide { display:none !important; max-height:0 !important; overflow:hidden !important; }
      .mob-show { display:block !important; max-height:none !important; }
      .mob-show-row { display:table-row !important; max-height:none !important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:12px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#141c2e;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #e3e7ef;border-radius:16px;overflow:hidden;">

    <!-- Header -->
    <tr>
      <td style="padding:14px 18px;border-bottom:1px solid #e3e7ef;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:10px;vertical-align:middle;">
              <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg" alt="Goldsure" style="height:32px;width:auto;display:block;">
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:14px;font-weight:700;color:#141c2e;">Goldsure | Installer Pay</div>
              <div style="font-size:12px;color:#6b7899;">${period}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Stat cards (always visible, 2-col table) -->
    <tr>
      <td style="padding:12px 16px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:12px;overflow:hidden;border-collapse:collapse;">
          ${statRows.join('')}
        </table>
      </td>
    </tr>

    <!-- DESKTOP: full table row — hidden on mobile -->
    <tr class="mob-hide">
      <td style="padding:14px 16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:11px 14px;border-bottom:1px solid #e3e7ef;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">
                    Installed Products by Job
                    <span style="font-size:13px;text-transform:none;letter-spacing:0;color:#141c2e;margin-left:6px;">${worker}</span>
                  </td>
                  <td align="right" style="padding-left:8px;white-space:nowrap;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#edf2fd;border:1px solid #c5d3f5;color:#2d6be4;font-size:11px;font-weight:700;">${period}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <thead>
                  <tr style="background:#f8f9fc;">
                    <th style="${thStyle}text-align:left;">Installed Date</th>
                    <th style="${thStyle}text-align:left;">Job No.</th>
                    ${headerCells}
                    <th style="${thStyle}text-align:right;">Total Qty</th>
                    <th style="${thStyle}text-align:right;">Balance</th>
                    <th style="${thStyle}text-align:left;">Payment Method</th>
                    <th style="${thStyle}text-align:right;">Pay Ex GST</th>
                    <th style="${thStyle}text-align:right;">Pay Inc GST</th>
                  </tr>
                </thead>
                <tbody>${jobRowsDesktop}</tbody>
                <tfoot>
                  <tr>
                    <td colspan="2" style="${tfStyle}color:#141c2e;text-align:left;">Gross Total</td>
                    ${footerCells}
                    <td style="${tfStyle}color:#141c2e;text-align:right;">${esc(footer.grandQty)}</td>
                    <td style="${tfStyle}"></td>
                    <td style="${tfStyle}"></td>
                    <td style="${tfStyle}color:#18a96e;text-align:right;">${money(totals.payEx)}</td>
                    <td style="${tfStyle}color:#d98c1e;text-align:right;">${money(totals.payIncGross)}</td>
                  </tr>
                  ${deductionRow}
                </tfoot>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- MOBILE: job cards row — hidden on desktop, shown on mobile -->
    <tr class="mob-show-row" style="display:none;">
      <td style="padding:12px 14px 16px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;margin-bottom:10px;">Jobs &mdash; ${worker}</div>
        ${mobileJobCards}
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:10px;border-collapse:collapse;overflow:hidden;margin-top:4px;">
          <tr style="background:#f8f9fc;">
            <td colspan="2" style="padding:12px 14px;border-bottom:1px solid #e3e7ef;font-size:11px;font-weight:700;color:#141c2e;">
              Gross Total &mdash; ${esc(totals.jobs)} jobs, ${esc(totals.units)} units
            </td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-size:13px;color:#6b7899;">Pay Ex GST</td>
            <td style="padding:10px 14px;font-size:16px;font-weight:700;color:#18a96e;text-align:right;">${money(totals.payEx)}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-size:13px;color:#6b7899;">Pay Inc GST</td>
            <td style="padding:10px 14px;font-size:16px;font-weight:700;color:#d98c1e;text-align:right;">${money(totals.payIncGross)}</td>
          </tr>
          ${Number(totals.deduction || 0) > 0 ? `<tr style="background:#fff5f5;">
            <td colspan="2" style="padding:10px 14px;font-size:12px;color:#b42318;">Cash Collected Deduction: ${money(totals.deduction)}</td>
          </tr>` : ''}
        </table>
      </td>
    </tr>

  </table>
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
