// api/smoke-alarms/reports/index.js
// Combined handler for install-summary and installer-pay-summary emails.
// Routes on body shape: { html } → install summary relay; { summary } → pay summary builder.

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

function buildPaySummaryHtml(summary) {
  const worker = esc(summary.worker || 'Electrician');
  const period = esc(summary.period || 'Selected period');
  const totals = summary.totals || {};
  const columns = Array.isArray(summary.columns) ? summary.columns : [];
  const jobs = Array.isArray(summary.jobs) ? summary.jobs : [];
  const footer = summary.footer || {};

  const jobRowsHtml = jobs.map((job, index) => {
    const bg = index % 2 === 0 ? '#ffffff' : '#f9f9f9';
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

  const colHeaderCells = columns.map(col => `
    <td align="center" bgcolor="#000000"
        style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;
               font-size:8px;font-weight:bold;letter-spacing:1px;
               text-transform:uppercase;color:#ffffff;text-align:center;
               background:#000000;">
      ${esc(col)}</td>`).join('');

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
<table width="600" border="0" cellpadding="0" cellspacing="0" style="background:#ffffff;" bgcolor="#ffffff">
  <tr>
    <td bgcolor="#ffffff" align="center" style="padding:24px 32px 8px;background:#ffffff;">
      <img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"
           alt="Goldsure" width="160" height="auto" style="display:block;width:160px;border:0;" />
    </td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" align="center" style="padding:2px 32px 16px;background:#ffffff;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:8px;
                font-weight:bold;letter-spacing:5px;text-transform:uppercase;
                color:#b08d2e;">Installer Pay Summary</p>
    </td>
  </tr>
  <tr>
    <td bgcolor="#b08d2e" height="2" style="font-size:2px;line-height:2px;background:#b08d2e;">&nbsp;</td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" style="padding:20px 28px 4px;background:#ffffff;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0">
        <tr>
          <td valign="middle">
            <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#000000;">
              ${worker}</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#999999;">
              Pay Period:&nbsp;<strong style="color:#333333;">${period}</strong></p>
          </td>
          <td valign="middle" align="right">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#aaaaaa;text-align:right;line-height:1.7;">
              Goldsure Pty Ltd<br>
              <a href="mailto:vignesh@goldsure.com.au" style="color:#b08d2e;text-decoration:none;font-weight:bold;">
                vignesh@goldsure.com.au</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" style="padding:14px 28px 18px;background:#ffffff;">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e0dcd2;">
        <tr>
          <td width="25%" valign="top" bgcolor="#ffffff" style="padding:14px 16px;border-right:1px solid #e0dcd2;vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#aaaaaa;">Total Jobs</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:#000000;line-height:1;">${esc(totals.jobs)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#ffffff" style="padding:14px 16px;border-right:1px solid #e0dcd2;vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#aaaaaa;">Units Installed</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:#000000;line-height:1;">${esc(totals.units)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#ffffff" style="padding:14px 16px;border-right:1px solid #e0dcd2;vertical-align:top;background:#ffffff;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#aaaaaa;">Pay Ex GST</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:#000000;line-height:1;">${money(totals.payEx)}</p>
          </td>
          <td width="25%" valign="top" bgcolor="#000000" style="padding:14px 16px;vertical-align:top;background:#000000;">
            <p style="margin:0 0 5px;font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#b08d2e;">Pay Inc GST</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:#b08d2e;line-height:1;">${money(totals.payInc)}</p>
            <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#666666;">
              ${Number(totals.deduction || 0) > 0 ? 'net after cash deduction' : 'includes 10% GST'}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" style="padding:0 28px 26px;background:#ffffff;">
      <p style="margin:0 0 7px;font-family:Arial,Helvetica,sans-serif;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#aaaaaa;">Job Breakdown</p>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e0dcd2;border-top:none;">
        <tr bgcolor="#000000">
          <td bgcolor="#000000" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff;background:#000000;">Date</td>
          <td bgcolor="#000000" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff;background:#000000;">Job No.</td>
          ${colHeaderCells}
          <td align="center" bgcolor="#000000" style="padding:10px 6px;font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff;text-align:center;background:#000000;">Total Qty</td>
          <td align="right" bgcolor="#000000" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#ffffff;text-align:right;background:#000000;">Pay Ex GST</td>
          <td align="right" bgcolor="#000000" style="padding:10px 8px;font-family:Arial,Helvetica,sans-serif;font-size:8px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#b08d2e;text-align:right;background:#000000;">Pay Inc GST</td>
        </tr>
        ${jobRowsHtml}
        <tr bgcolor="#b08d2e">
          <td colspan="${columns.length + 5}" bgcolor="#b08d2e" style="font-size:2px;line-height:2px;background:#b08d2e;">&nbsp;</td>
        </tr>
        <tr bgcolor="#000000">
          <td colspan="2" bgcolor="#000000" style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#ffffff;text-transform:uppercase;letter-spacing:2px;background:#000000;">Gross Total</td>
          ${colTotalCells}
          <td align="center" bgcolor="#000000" style="padding:12px 6px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-align:center;background:#000000;">${esc(footer.grandQty)}</td>
          <td align="right" bgcolor="#000000" style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-align:right;background:#000000;">${money(totals.payEx)}</td>
          <td align="right" bgcolor="#000000" style="padding:12px 8px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#b08d2e;text-align:right;background:#000000;">${money(totals.payIncGross)}</td>
        </tr>
        ${deductionRow}
      </table>
    </td>
  </tr>
  <tr>
    <td bgcolor="#000000" align="center" style="padding:14px 28px;background:#000000;">
      <p style="margin:0 0 3px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;letter-spacing:3px;text-transform:uppercase;color:#b08d2e;">Goldsure Pty Ltd</p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#555555;line-height:1.7;">
        ABN: 66 683 305 106 &nbsp;&middot;&nbsp; Queensland, Australia<br>
        <a href="mailto:vignesh@goldsure.com.au" style="color:#b08d2e;text-decoration:none;">vignesh@goldsure.com.au</a>
        &nbsp;&middot;&nbsp;
        <a href="https://www.goldsure.com.au" style="color:#555555;text-decoration:none;">www.goldsure.com.au</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
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

  const body = req.body || {};

  // ── Route: time tracker (clock in / out, Supabase CRUD + PIN access control) ──
  // Powers /time/ — the agent clock in/out timesheet. Routed on body.time, shaped
  // { action:'verify'|'status'|'clock-in'|'clock-out'|'list'|'list-all'|'update'|'delete', agent, pin, ... }.
  // Stored in the `time_entries` table (an OPEN shift = clock_out IS NULL, so the
  // clock keeps running server-side even with no tab open). Kept here (not a new
  // file) to stay under Vercel's 12-function limit.
  if (body.time !== undefined) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
    // Service-role key bypasses Row Level Security so updates/deletes actually take
    // (an RLS-blocked anon write returns 204 having changed nothing). Falls back to anon.
    const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Supabase is not configured on the server.' });
    }
    const TABLE = `${SUPABASE_URL}/rest/v1/time_entries`;
    const anonH = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };
    const adminH = { apikey: SUPABASE_ADMIN_KEY, Authorization: `Bearer ${SUPABASE_ADMIN_KEY}` };
    const COLS = 'id,agent,clock_in,clock_out,note';
    const t = body.time || {};
    const agent = String(t.agent || '').trim();

    // ── Access control: the manager PIN sees everyone; each agent's PIN sees only
    // their own. Defaults are baked in here so privacy works without any Vercel
    // setup; set TIME_MANAGER_PIN / TIME_AGENT_PINS in Vercel to override or rotate
    // them without a code change. Validated server-side; never sent to the browser.
    const managerPin = String(process.env.TIME_MANAGER_PIN || '4895');
    let agentPins = { David: '1018', Shanira: '5220' };
    try { if (process.env.TIME_AGENT_PINS) agentPins = JSON.parse(process.env.TIME_AGENT_PINS); } catch { /* keep the built-in defaults */ }
    const pinsOn = managerPin !== '' || Object.keys(agentPins).length > 0;
    const pin = String(t.pin || '');
    const isManager = pinsOn && managerPin !== '' && pin === managerPin;
    const agentOk = (a) => !pinsOn || isManager || (!!a && agentPins[a] != null && pin !== '' && String(agentPins[a]) === pin);

    // Pay rates ($/hr) — defaults baked in; override with TIME_RATES env (JSON).
    let rates = { David: 13.54, Shanira: 25 };
    try { if (process.env.TIME_RATES) rates = JSON.parse(process.env.TIME_RATES); } catch { /* keep defaults */ }
    const rateFor = (a) => Number(rates[a]) || 0;

    // Per-agent billing details for the manager invoice PDF. Sent ONLY to the
    // manager (in list-all), never to an agent's page. Override with TIME_AGENT_DETAILS.
    let agentDetails = {
      David:   { name: 'David', lines: ['2 Kaba Place, Field 40 New Subdivision', 'Lautoka, Fiji'], phone: '+679 507 5588', email: 'admin@optimumoutsourcing.org', abn: '', payName: 'Marijo Mcgoon', bsb: '736125', acct: '791581', payPhone: '' },
      Shanira: { name: 'Shanira Gonzalez', lines: ['1/149 Carlton Rd', 'Dandenong North VIC 3175'], phone: '+61 473 196 332', email: '', abn: '94 293 140 554', payName: 'Shanira Gonzalez', bsb: '733186', acct: '584056', payPhone: '+61 473 196 332' },
    };
    try { if (process.env.TIME_AGENT_DETAILS) agentDetails = JSON.parse(process.env.TIME_AGENT_DETAILS); } catch { /* keep defaults */ }

    // Manager notification emails (best-effort, bounded so they never delay a clock
    // action; the message is already saved before we email). To vignesh@ by default.
    const MANAGER_EMAILS = (process.env.TIME_MANAGER_EMAIL || 'vignesh@goldsure.com.au,amit@goldsure.com.au')
      .split(',').map(s => s.trim()).filter(Boolean);
    const LOGO = 'https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg';
    const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mel = (iso, opts) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', ...opts });
    const durStrOf = (ms) => { const m = Math.floor(ms / 60000); return Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
    const emailShell = (eyebrow, bodyRows) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eceef3;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eceef3" style="background:#eceef3;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid #e4e6ee;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:20px 28px;border-bottom:3px solid #7367f0;"><table width="100%"><tr>
        <td><img src="${LOGO}" alt="Goldsure" height="30" style="height:30px;display:block;border:0;"></td>
        <td align="right" style="font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#7367f0;">${escH(eyebrow)}</td>
      </tr></table></td></tr>
      ${bodyRows}
    </table>
  </td></tr></table>
</body></html>`;
    const clockInEmail = (a, whenStr) => emailShell('Time Tracker · Clock In', `
      <tr><td style="padding:26px 28px;">
        <p style="margin:0 0 4px;font-size:13px;color:#8a8a93;">Clocked in</p>
        <p style="margin:0 0 14px;font-size:22px;font-weight:800;color:#1d1d1f;">${escH(a)}</p>
        <div style="background:#f3f2ff;border-left:4px solid #7367f0;border-radius:8px;padding:14px 16px;font-size:15px;color:#1d1d1f;">Started <b>${escH(whenStr)}</b> <span style="color:#8a8a93;">(Melbourne time)</span></div>
      </td></tr>`);
    const row2 = (label, val, first) => `<tr><td style="padding:12px 16px;background:#f7f8fa;${first ? '' : 'border-top:1px solid #e7e7ec;'}font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8a8a93;width:42%;">${escH(label)}</td><td style="padding:12px 16px;${first ? '' : 'border-top:1px solid #e7e7ec;'}font-size:14px;font-weight:600;color:#1d1d1f;">${escH(val)}</td></tr>`;
    const clockOutEmail = (a, dayStr, inStr, outStr, dur) => emailShell('Time Tracker · Shift Complete', `
      <tr><td style="padding:24px 28px 6px;">
        <p style="margin:0 0 4px;font-size:13px;color:#8a8a93;">Shift complete</p>
        <p style="margin:0 0 2px;font-size:22px;font-weight:800;color:#1d1d1f;">${escH(a)}</p>
        <p style="margin:0 0 16px;font-size:13px;color:#8a8a93;">${escH(dayStr)}</p>
      </td></tr>
      <tr><td style="padding:0 28px 24px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ec;border-radius:10px;overflow:hidden;">
        ${row2('Clock in', inStr, true)}
        ${row2('Clock out', outStr)}
        <tr><td style="padding:14px 16px;background:#7367f0;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">Hours worked</td><td style="padding:14px 16px;background:#7367f0;font-size:18px;font-weight:800;color:#ffffff;">${escH(dur)}</td></tr>
      </table></td></tr>`);
    const sendManagerMail = async (subject, html, text) => {
      if (!process.env.RESEND_API_KEY) { console.warn('[Time] RESEND_API_KEY not set — email skipped'); return; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Goldsure Time <vignesh@goldsure.com.au>', to: MANAGER_EMAILS, subject, html, text }),
          signal: ctrl.signal,
        });
        if (!r.ok) console.error('[Time] email failed', r.status, await r.text());
      } catch (e) { console.error('[Time] email error (continuing):', e.message); }
      finally { clearTimeout(timer); }
    };

    try {
      // Verify a PIN (used by the login screen) — returns the caller's role, or 403.
      if (t.action === 'verify') {
        if (!pinsOn) return res.status(200).json({ ok: true, role: 'open' });
        if (isManager) return res.status(200).json({ ok: true, role: 'manager' });
        if (agentOk(agent)) return res.status(200).json({ ok: true, role: 'agent' });
        return res.status(403).json({ ok: false, error: 'Incorrect PIN.' });
      }

      // Manager only: every agent's entries (powers the all-agents overview).
      if (t.action === 'list-all') {
        if (pinsOn && !isManager) return res.status(403).json({ error: 'Manager PIN required.' });
        const r = await fetch(`${TABLE}?select=${COLS}&order=clock_in.desc&limit=5000`, { headers: anonH });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] list-all failed:', detail);
          return res.status(500).json({ error: 'Failed to load entries.', detail });
        }
        // Rates go ONLY to the manager here — never in the per-agent `list` response,
        // so agents can't read their pay rate/earnings from the page.
        return res.status(200).json({ entries: await r.json(), rates, details: agentDetails });
      }

      // Current open shift for an agent (clock_out is null), if any.
      if (t.action === 'status') {
        if (!agent) return res.status(400).json({ error: 'Agent is required.' });
        if (!agentOk(agent)) return res.status(403).json({ error: 'Incorrect PIN.' });
        const r = await fetch(
          `${TABLE}?agent=eq.${encodeURIComponent(agent)}&clock_out=is.null&order=clock_in.desc&limit=1&select=${COLS}`,
          { headers: anonH }
        );
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] status failed:', detail);
          return res.status(500).json({ error: 'Failed to load status.', detail });
        }
        const rows = await r.json();
        return res.status(200).json({ open: Array.isArray(rows) && rows.length ? rows[0] : null });
      }

      // Clock in: open a new entry. If already clocked in, return the existing open one.
      if (t.action === 'clock-in') {
        if (!agent) return res.status(400).json({ error: 'Agent is required.' });
        if (!agentOk(agent)) return res.status(403).json({ error: 'Incorrect PIN.' });
        const existing = await fetch(
          `${TABLE}?agent=eq.${encodeURIComponent(agent)}&clock_out=is.null&order=clock_in.desc&limit=1&select=${COLS}`,
          { headers: anonH }
        );
        const openRows = existing.ok ? await existing.json() : [];
        if (Array.isArray(openRows) && openRows.length) {
          return res.status(200).json({ entry: openRows[0], alreadyOpen: true });
        }
        const r = await fetch(TABLE, {
          method: 'POST',
          headers: { ...anonH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify({ agent, clock_in: new Date().toISOString() }),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] clock-in failed:', detail);
          return res.status(500).json({ error: 'Failed to clock in.', detail });
        }
        const inserted = await r.json();
        const inEntry = Array.isArray(inserted) ? inserted[0] : inserted;
        const whenStr = mel(inEntry.clock_in, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
        await sendManagerMail(
          `${agent} clocked IN — ${mel(inEntry.clock_in, { hour: 'numeric', minute: '2-digit', hour12: true })}`,
          clockInEmail(agent, whenStr),
          `${agent} clocked in at ${whenStr} (Melbourne time).`
        );
        return res.status(200).json({ entry: inEntry });
      }

      // Clock out: close this agent's open entry (set clock_out = now).
      if (t.action === 'clock-out') {
        if (!agent) return res.status(400).json({ error: 'Agent is required.' });
        if (!agentOk(agent)) return res.status(403).json({ error: 'Incorrect PIN.' });
        const r = await fetch(
          `${TABLE}?agent=eq.${encodeURIComponent(agent)}&clock_out=is.null`,
          {
            method: 'PATCH',
            headers: { ...anonH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({ clock_out: new Date().toISOString() }),
          }
        );
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] clock-out failed:', detail);
          return res.status(500).json({ error: 'Failed to clock out.', detail });
        }
        const closed = await r.json().catch(() => []);
        if (!Array.isArray(closed) || closed.length === 0) {
          return res.status(200).json({ success: false, warning: 'You were not clocked in.' });
        }
        const outEntry = closed[0];
        const ms = Math.max(0, new Date(outEntry.clock_out).getTime() - new Date(outEntry.clock_in).getTime());
        const dayStr = mel(outEntry.clock_in, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const inStr = mel(outEntry.clock_in, { hour: 'numeric', minute: '2-digit', hour12: true });
        const outStr = mel(outEntry.clock_out, { hour: 'numeric', minute: '2-digit', hour12: true });
        const dur = durStrOf(ms);
        // Time only — no pay in the email (earnings stay in the manager portal view).
        await sendManagerMail(
          `${agent} clocked OUT — ${dur}`,
          clockOutEmail(agent, dayStr, inStr, outStr, dur),
          `${agent} clocked out. ${dayStr}. In ${inStr}, out ${outStr}. Hours worked: ${dur}.`
        );
        return res.status(200).json({ success: true, entry: outEntry });
      }

      // List ONE agent's entries (newest first). Requires that agent's PIN (or manager).
      if (t.action === 'list') {
        if (!agent) return res.status(400).json({ error: 'Agent is required.' });
        if (!agentOk(agent)) return res.status(403).json({ error: 'Incorrect PIN.' });
        const r = await fetch(
          `${TABLE}?agent=eq.${encodeURIComponent(agent)}&select=${COLS}&order=clock_in.desc&limit=2000`,
          { headers: anonH }
        );
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] list failed:', detail);
          return res.status(500).json({ error: 'Failed to load entries.', detail });
        }
        return res.status(200).json({ entries: await r.json() });
      }

      // Update an entry by id (fix a forgotten clock-out or a wrong time).
      if (t.action === 'update') {
        const id = String(t.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Entry id is required.' });
        if (pinsOn && !isManager) {
          const cur = await fetch(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=agent&limit=1`, { headers: anonH });
          const owner = cur.ok ? ((await cur.json())[0] || {}).agent : null;
          if (!agentOk(owner)) return res.status(403).json({ error: 'Incorrect PIN.' });
        }
        const patch = {};
        if (t.clock_in !== undefined) patch.clock_in = t.clock_in || null;
        if (t.clock_out !== undefined) patch.clock_out = t.clock_out || null;
        if (t.note !== undefined) patch.note = String(t.note || '').trim() || null;
        if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });
        const r = await fetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { ...adminH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] update failed:', detail);
          return res.status(500).json({ error: 'Failed to update entry.', detail });
        }
        const updated = await r.json().catch(() => []);
        if (!Array.isArray(updated) || updated.length === 0) {
          return res.status(200).json({ success: false, warning: 'Nothing was updated — RLS may be blocking it. Set SUPABASE_SERVICE_ROLE_KEY or disable RLS on time_entries.' });
        }
        return res.status(200).json({ success: true, entry: updated[0] });
      }

      // Delete an entry by id (service-role key so RLS can't silently no-op it).
      if (t.action === 'delete') {
        const id = String(t.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Entry id is required.' });
        if (pinsOn && !isManager) {
          const cur = await fetch(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=agent&limit=1`, { headers: anonH });
          const owner = cur.ok ? ((await cur.json())[0] || {}).agent : null;
          if (!agentOk(owner)) return res.status(403).json({ error: 'Incorrect PIN.' });
        }
        const r = await fetch(`${TABLE}?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { ...adminH, Prefer: 'return=representation' },
        });
        if (!r.ok) {
          const detail = await r.text();
          console.error('[Time] delete failed:', detail);
          return res.status(500).json({ error: 'Failed to delete entry.', detail });
        }
        const removed = await r.json().catch(() => []);
        if (!Array.isArray(removed) || removed.length === 0) {
          return res.status(200).json({ success: false, warning: 'Nothing was deleted — RLS may be blocking it. Set SUPABASE_SERVICE_ROLE_KEY or disable RLS on time_entries.' });
        }
        return res.status(200).json({ success: true, deleted: removed.length });
      }

      return res.status(400).json({ error: `Unknown time action: ${t.action}` });
    } catch (err) {
      console.error('[Time] server error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  // ── Route: staff leave planner notification ──
  // Powers /calendar/staff-leave-planner.html — when someone marks days as
  // unavailable, the browser posts { leave: { staff_name, leave_type, reason,
  // leave_start, leave_end, days } } and we email the manager a branded summary.
  // Kept in this handler (routed on body.leave) to stay under Vercel's function limit.
  if (body.leave !== undefined) {
    const leave = body.leave || {};
    const staffName = String(leave.staff_name || '').trim();
    const leaveType = String(leave.leave_type || '').trim();
    if (!staffName || !leave.leave_start || !leave.leave_end) {
      return res.status(400).json({ error: 'Missing leave details (staff_name, leave_start, leave_end).' });
    }

    // Notify both the manager and Amit. Override with LEAVE_NOTIFY_EMAIL (comma-separated).
    const NOTIFY_EMAILS = (process.env.LEAVE_NOTIFY_EMAIL || 'vignesh@goldsure.com.au,amit@goldsure.com.au')
      .split(',').map(e => e.trim()).filter(Boolean);
    const LOGO = 'https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg';
    const escL = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtLeaveDate = (iso) => {
      const d = new Date(String(iso) + 'T00:00:00');
      return isNaN(d) ? String(iso) : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    };
    const startStr = fmtLeaveDate(leave.leave_start);
    const endStr = fmtLeaveDate(leave.leave_end);
    const rangeStr = leave.leave_start === leave.leave_end ? startStr : `${startStr} → ${endStr}`;
    const days = Number(leave.days) || 1;
    const reason = String(leave.reason || '').trim();

    const row = (label, val, first) => `<tr><td style="padding:12px 16px;background:#f7f8fa;${first ? '' : 'border-top:1px solid #e7e7ec;'}font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#8a8a93;width:38%;">${escL(label)}</td><td style="padding:12px 16px;${first ? '' : 'border-top:1px solid #e7e7ec;'}font-size:14px;font-weight:600;color:#1d1d1f;">${escL(val)}</td></tr>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eceef3;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eceef3" style="background:#eceef3;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border:1px solid #e4e6ee;border-radius:14px;overflow:hidden;">
      <tr><td style="padding:20px 28px;border-bottom:3px solid #caa84a;"><table width="100%"><tr>
        <td><img src="${LOGO}" alt="Goldsure" height="30" style="height:30px;display:block;border:0;"></td>
        <td align="right" style="font-size:10px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:#b8962e;">Staff Leave Planner</td>
      </tr></table></td></tr>
      <tr><td style="padding:26px 28px 8px;">
        <p style="margin:0 0 4px;font-size:13px;color:#8a8a93;">Marked as unavailable</p>
        <p style="margin:0 0 16px;font-size:22px;font-weight:800;color:#1d1d1f;">${escL(staffName)}</p>
      </td></tr>
      <tr><td style="padding:0 28px 26px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e7ec;border-radius:10px;overflow:hidden;">
        ${row('Leave type', leaveType || 'Leave', true)}
        ${row('Dates', rangeStr)}
        ${row('Days', days + (days === 1 ? ' day' : ' days'))}
        ${reason
          ? `<tr><td style="padding:14px 16px;background:#caa84a;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">Reason</td><td style="padding:14px 16px;background:#fbf6e8;font-size:14px;font-weight:600;color:#1d1d1f;">${escL(reason)}</td></tr>`
          : ''}
      </table></td></tr>
      <tr><td style="padding:0 28px 28px;"><p style="margin:0;font-size:12px;color:#8a8a93;">Logged from the Goldsure Staff Leave Planner.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    const text = `${staffName} marked as unavailable.\nLeave type: ${leaveType || 'Leave'}\nDates: ${rangeStr} (${days} ${days === 1 ? 'day' : 'days'})${reason ? `\nReason: ${reason}` : ''}`;

    if (!process.env.RESEND_API_KEY) {
      console.warn('[Leave] RESEND_API_KEY not set — email skipped');
      return res.status(200).json({ success: false, skipped: true, warning: 'Email not configured on the server.' });
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Goldsure Leave Planner <vignesh@goldsure.com.au>',
          to: NOTIFY_EMAILS,
          subject: `${staffName} unavailable — ${rangeStr}${leaveType ? ` (${leaveType})` : ''}`,
          html,
          text,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(async () => ({ error: await response.text() }));
        console.error('[Leave] notification send failed:', error);
        return res.status(500).json({ error: 'Failed to send email.', detail: error });
      }
      const result = await response.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch (err) {
      console.error('[Leave] notification server error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  // ── Route: install-summary relay (pre-built HTML from frontend) ──
  if (body.html !== undefined) {
    const { from, to, subject, html } = body;
    const toAddresses = Array.isArray(to) ? to : [to];
    if (!toAddresses.length || !toAddresses.every(e => e.includes('@'))) {
      return res.status(400).json({ error: 'Missing or invalid recipient email(s).' });
    }
    if (!html) {
      return res.status(400).json({ error: 'No HTML body provided.' });
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from || 'Goldsure Pty Ltd <info@goldsure.com.au>',
          to: toAddresses,
          bcc: ['vignesh@goldsure.com.au'],
          subject: subject || 'Install Summary Report — Goldsure',
          html,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        console.error('[Resend] Install summary send failed:', error);
        return res.status(500).json({ error: 'Failed to send email.', detail: error });
      }
      const result = await response.json();
      console.log('[Resend] Install summary sent OK — id:', result.id);
      return res.status(200).json({ success: true, id: result.id });
    } catch (err) {
      console.error('[Resend] Install summary server error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  // ── Route: installer pay summary (builds HTML from structured data) ──
  if (body.summary !== undefined) {
    const { to, subject, summary } = body;
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
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Goldsure Pty Ltd <info@goldsure.com.au>',
          to: toAddresses,
          subject: subject || `${summary.worker} Installer Pay Summary`,
          html: buildPaySummaryHtml(summary),
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(async () => ({ error: await response.text() }));
        console.error('[Resend] Pay summary send failed:', error);
        return res.status(500).json({ error: 'Failed to send email.', detail: error });
      }
      const result = await response.json();
      return res.status(200).json({ success: true, id: result.id });
    } catch (err) {
      console.error('[Resend] Pay summary server error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }

  return res.status(400).json({ error: 'Invalid request: provide either html or summary in the request body.' });
}
