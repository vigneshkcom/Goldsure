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
  const summaryCards = [
    { label: 'Fieldworker', value: worker, color: '#141c2e', sub: '' },
    { label: 'Pay Period', value: period, color: '#2d6be4', sub: '' },
    { label: 'Total Jobs', value: esc(totals.jobs), color: '#2d6be4', sub: '' },
    { label: 'Units Installed', value: esc(totals.units), color: '#d98c1e', sub: '' },
    { label: 'Pay Ex GST', value: money(totals.payEx), color: '#18a96e', sub: '' },
    { label: 'Pay Inc GST', value: money(totals.payInc), color: '#d98c1e', sub: Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST' }
  ].map(card => `
    <td width="50%" style="padding:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:14px;">
        <tr>
          <td style="padding:12px 14px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">${card.label}</div>
            <div style="font-size:15px;line-height:1.3;font-weight:700;color:${card.color};">${card.value}</div>
            ${card.sub ? `<div style="font-size:11px;color:#6b7899;margin-top:3px;">${card.sub}</div>` : ''}
          </td>
        </tr>
      </table>
    </td>
  `);

  const summaryRows = [];
  for (let i = 0; i < summaryCards.length; i += 2) {
    summaryRows.push(`
      <tr>
        ${summaryCards[i]}
        ${summaryCards[i + 1] || '<td width="50%" style="padding:6px;"></td>'}
      </tr>
    `);
  }

  const jobCards = jobs.map((job, index) => {
    const itemRows = columns.map((col, idx) => `
      <tr>
        <td style="padding:7px 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">${esc(col)}</td>
        <td align="right" style="padding:7px 0;font-size:14px;font-weight:700;color:${Number(job.items?.[idx] || 0) === 0 ? '#c8d0dd' : '#141c2e'};">${qty(job.items?.[idx] || 0)}</td>
      </tr>
    `).join('');

    const paymentBlock = (job.balance || job.paymentMethod) ? `
      <tr>
        <td colspan="2" style="padding-top:10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px dashed #d8dfeb;">
            ${job.balance ? `
              <tr>
                <td style="padding:8px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Balance</td>
                <td align="right" style="padding:8px 0 0;font-size:13px;font-weight:700;color:#d98c1e;">${money(job.balance)}</td>
              </tr>
            ` : ''}
            ${job.paymentMethod ? `
              <tr>
                <td style="padding:7px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Payment</td>
                <td align="right" style="padding:7px 0 0;font-size:13px;font-weight:700;color:#141c2e;">${esc(job.paymentMethod)}</td>
              </tr>
            ` : ''}
          </table>
        </td>
      </tr>
    ` : '';

    return `
      <tr>
        <td style="padding:${index === 0 ? '0' : '12px 0 0'};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:16px;overflow:hidden;background:${index % 2 === 0 ? '#ffffff' : '#fbfcfe'};">
            <tr>
              <td style="padding:14px 14px 12px;border-bottom:1px solid #eef2f7;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <div style="font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Job</div>
                      <div style="font-size:15px;font-weight:700;color:#2d6be4;">${esc(job.jobId)}</div>
                    </td>
                    <td align="right">
                      <div style="font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Date</div>
                      <div style="font-size:13px;font-weight:700;color:#141c2e;">${esc(job.installedDate)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${itemRows}
                  <tr>
                    <td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Total Qty</td>
                    <td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(job.totalQty)}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Pay Ex GST</td>
                    <td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#18a96e;">${money(job.payEx)}</td>
                  </tr>
                  <tr>
                    <td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Pay Inc GST</td>
                    <td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#d98c1e;">${money(job.payInc)}</td>
                  </tr>
                  ${paymentBlock}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    `;
  }).join('');

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
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${summaryRows.join('')}
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
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:14px;">
                  ${jobCards}
                  <tr>
                    <td style="padding:12px 0 0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:16px;background:#f8f9fc;">
                        <tr>
                          <td style="padding:14px 14px 10px;border-bottom:1px solid #e3e7ef;">
                            <div style="font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#6b7899;">Gross Total</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:12px 14px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr><td style="padding:7px 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Booking</td><td align="right" style="padding:7px 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(summary.footer?.colTotals?.[0] || 0)}</td></tr>
                              <tr><td style="padding:7px 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">240V</td><td align="right" style="padding:7px 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(summary.footer?.colTotals?.[1] || 0)}</td></tr>
                              <tr><td style="padding:7px 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Battery</td><td align="right" style="padding:7px 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(summary.footer?.colTotals?.[2] || 0)}</td></tr>
                              <tr><td style="padding:7px 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Controller</td><td align="right" style="padding:7px 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(summary.footer?.colTotals?.[3] || 0)}</td></tr>
                              <tr><td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Total Qty</td><td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#141c2e;">${esc(summary.footer?.grandQty || 0)}</td></tr>
                              <tr><td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Pay Ex GST</td><td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#18a96e;">${money(totals.payEx)}</td></tr>
                              <tr><td style="padding:9px 0 0;font-size:11px;color:#6b7899;text-transform:uppercase;letter-spacing:0.3px;">Pay Inc GST</td><td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#d98c1e;">${money(totals.payIncGross)}</td></tr>
                              ${Number(totals.deduction || 0) > 0 ? `<tr><td style="padding:9px 0 0;font-size:11px;color:#b42318;text-transform:uppercase;letter-spacing:0.3px;">Cash Deduction</td><td align="right" style="padding:9px 0 0;font-size:14px;font-weight:700;color:#b42318;">${money(totals.deduction)}</td></tr>` : ''}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
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
