// api/smoke-alarms/reports/index.js
// Combined handler for install-summary and installer-pay-summary emails.
// Routes on body shape: { html } → install summary relay; { summary } → pay summary builder.

import { hasHostingerMailConfig, sendHostingerMail } from '../../../lib/hostinger-mail.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Route: RingCentral Call Analytics timeline (powers /calls/) ──
  // GET ?rc=timeline&date=today|yday[&debug=1]. Folded into this combined
  // handler to stay under Vercel's 12-function limit.
  if (req.method === 'GET' && req.query && req.query.rc === 'timeline') {
    return ringcentralTimeline(req, res);
  }
  if (req.method === 'GET' && req.query && req.query.rc === 'missed') {
    return ringcentralMissed(req, res);
  }
  if (req.method === 'GET' && req.query && req.query.rc === 'hourly-email') {
    return ringcentralHourlyEmail(req, res);
  }

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
    let agentPins = { David: '1018', Shanira: '5220', 'Alda Amonaki': '7902' };
    try { if (process.env.TIME_AGENT_PINS) agentPins = JSON.parse(process.env.TIME_AGENT_PINS); } catch { /* keep the built-in defaults */ }
    const pinsOn = managerPin !== '' || Object.keys(agentPins).length > 0;
    const pin = String(t.pin || '');
    const isManager = pinsOn && managerPin !== '' && pin === managerPin;
    const canManage = !pinsOn || isManager;
    const agentOk = (a) => !pinsOn || isManager || (!!a && agentPins[a] != null && pin !== '' && String(agentPins[a]) === pin);

    // Pay rates ($/hr) — defaults baked in; override with TIME_RATES env (JSON).
    let rates = { David: 13.54, Shanira: 25, 'Alda Amonaki': 10.4175 };
    try { if (process.env.TIME_RATES) rates = JSON.parse(process.env.TIME_RATES); } catch { /* keep defaults */ }
    const rateFor = (a) => Number(rates[a]) || 0;

    // Per-agent billing details for the manager invoice PDF. Sent ONLY to the
    // manager (in list-all), never to an agent's page. Override with TIME_AGENT_DETAILS.
    let agentDetails = {
      David:   { name: 'David', lines: ['2 Kaba Place, Field 40 New Subdivision', 'Lautoka, Fiji'], phone: '+679 507 5588', email: 'admin@optimumoutsourcing.org', abn: '', payName: 'Marijo Mcgoon', bsb: '736125', acct: '791581', payPhone: '' },
      Shanira: { name: 'Shanira Gonzalez', lines: ['1/149 Carlton Rd', 'Dandenong North VIC 3175'], phone: '+61 473 196 332', email: '', abn: '94 293 140 554', payName: 'Shanira Gonzalez', bsb: '733186', acct: '584056', payPhone: '+61 473 196 332' },
      'Alda Amonaki': { name: 'Alda Amonaki', lines: ['Votualevu', 'Nadi, Fiji'], phone: '+679 730 3900', email: 'alda.omanaki7@gmail.com', abn: '', payName: 'Alda Amonaki', bsb: '', acct: '', payPhone: '+679 730 3900' },
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
    const roundedWorkedMinutes = (minutes) => {
      const worked = Math.max(0, Math.floor(Number(minutes) || 0));
      const fullSlots = Math.floor(worked / 15);
      return (fullSlots + (worked % 15 >= 10 ? 1 : 0)) * 15;
    };
    const unpaidMinutesFromNote = (note) => {
      const match = String(note || '').match(/\[time-unpaid-minutes:(\d+)\]/);
      return match ? Math.max(0, Number(match[1]) || 0) : 0;
    };
    const noteWithUnpaidMinutes = (note, minutes) => {
      const cleaned = String(note || '')
        .replace(/\[time-unpaid-minutes:\d+\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      const unpaid = Math.max(0, Math.floor(Number(minutes) || 0));
      return [cleaned, unpaid ? `[time-unpaid-minutes:${unpaid}]` : ''].filter(Boolean).join('\n') || null;
    };
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
      if (!hasHostingerMailConfig()) { console.warn('[Time] Hostinger Mail API credentials not set — email skipped'); return; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        await sendHostingerMail({
          displayName: 'Goldsure Time',
          to: MANAGER_EMAILS,
          subject,
          html,
          text,
          signal: ctrl.signal,
        });
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
          // Service-role key so the insert can't be silently blocked by RLS,
          // matching clock-out / update / delete.
          method: 'POST',
          headers: { ...adminH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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
            // Service-role key: an anon PATCH is silently blocked by RLS (0 rows
            // changed), which drops the clock-out AND the shift-complete email.
            method: 'PATCH',
            headers: { ...adminH, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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
        const netMinutes = Math.max(0, Math.floor(ms / 60000) - unpaidMinutesFromNote(outEntry.note));
        const billedMs = roundedWorkedMinutes(netMinutes) * 60000;
        const dayStr = mel(outEntry.clock_in, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const inStr = mel(outEntry.clock_in, { hour: 'numeric', minute: '2-digit', hour12: true });
        const outStr = mel(outEntry.clock_out, { hour: 'numeric', minute: '2-digit', hour12: true });
        const dur = durStrOf(billedMs);
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
      // Manager only — agents clock in/out but cannot edit timesheet entries.
      if (t.action === 'update') {
        const id = String(t.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Entry id is required.' });
        if (pinsOn && !isManager) return res.status(403).json({ error: 'Manager PIN required to edit an entry.' });
        const cur = await fetch(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=${COLS}&limit=1`, { headers: anonH });
        if (!cur.ok) return res.status(500).json({ error: 'Failed to load the entry before updating it.' });
        const current = ((await cur.json())[0] || null);
        if (!current) return res.status(404).json({ error: 'Entry not found.' });
        const patch = {};
        if (t.clock_in !== undefined) patch.clock_in = t.clock_in || null;
        if (t.clock_out !== undefined) patch.clock_out = t.clock_out || null;
        if (t.note !== undefined) {
          const requestedNote = String(t.note || '').trim() || null;
          patch.note = canManage ? requestedNote : noteWithUnpaidMinutes(requestedNote, unpaidMinutesFromNote(current.note));
        }
        if (t.unpaid_minutes !== undefined) {
          if (!canManage) return res.status(403).json({ error: 'Manager PIN required to change unpaid time.' });
          const unpaidMinutes = Number(t.unpaid_minutes);
          if (!Number.isInteger(unpaidMinutes) || unpaidMinutes < 0) return res.status(400).json({ error: 'Unpaid time must be a whole number of minutes.' });
          const effectiveIn = patch.clock_in !== undefined ? patch.clock_in : current.clock_in;
          const effectiveOut = patch.clock_out !== undefined ? patch.clock_out : current.clock_out;
          const startMs = new Date(effectiveIn).getTime();
          const endMs = effectiveOut ? new Date(effectiveOut).getTime() : Date.now();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return res.status(400).json({ error: 'Clock-in and clock-out must be valid times.' });
          const shiftMinutes = Math.max(0, Math.floor((endMs - startMs) / 60000));
          if (unpaidMinutes > shiftMinutes) return res.status(400).json({ error: 'Unpaid time cannot be longer than the shift.' });
          patch.note = noteWithUnpaidMinutes(patch.note !== undefined ? patch.note : current.note, unpaidMinutes);
        }
        if (t.unpaid_minutes === undefined && (patch.clock_in !== undefined || patch.clock_out !== undefined)) {
          const effectiveIn = patch.clock_in !== undefined ? patch.clock_in : current.clock_in;
          const effectiveOut = patch.clock_out !== undefined ? patch.clock_out : current.clock_out;
          const startMs = new Date(effectiveIn).getTime();
          const endMs = effectiveOut ? new Date(effectiveOut).getTime() : Date.now();
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return res.status(400).json({ error: 'Clock-in and clock-out must be valid times.' });
          const shiftMinutes = Math.max(0, Math.floor((endMs - startMs) / 60000));
          const unpaidMinutes = unpaidMinutesFromNote(patch.note !== undefined ? patch.note : current.note);
          if (unpaidMinutes > shiftMinutes) return res.status(400).json({ error: 'Unpaid time cannot be longer than the shift.' });
        }
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
      // Manager only — agents can edit their own entries but not delete them.
      if (t.action === 'delete') {
        const id = String(t.id || '').trim();
        if (!id) return res.status(400).json({ error: 'Entry id is required.' });
        if (pinsOn && !isManager) return res.status(403).json({ error: 'Manager PIN required to delete an entry.' });
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

    if (!hasHostingerMailConfig()) {
      console.warn('[Leave] Hostinger Mail API credentials not set — email skipped');
      return res.status(200).json({ success: false, skipped: true, warning: 'Email not configured on the server.' });
    }
    try {
      await sendHostingerMail({
        displayName: 'Goldsure Leave Planner',
        to: NOTIFY_EMAILS,
        subject: `${staffName} unavailable — ${rangeStr}${leaveType ? ` (${leaveType})` : ''}`,
        html,
        text,
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[Leave] notification server error:', err);
      return res.status(500).json({ error: 'Failed to send email.', detail: err.message });
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
    const relaySubject = subject || 'Install Summary Report — Goldsure';
    // Send via Hostinger (from info@); fall back to Resend.
    let sent = false;
    try {
      await sendHostingerMail({ to: toAddresses, bcc: ['vignesh@goldsure.com.au'], displayName: 'Goldsure Pty Ltd', subject: relaySubject, html });
      sent = true;
    } catch (hostErr) {
      console.error('[Install summary] Hostinger failed, falling back to Resend:', hostErr.message);
    }
    if (sent) return res.status(200).json({ success: true });
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from || 'Goldsure Pty Ltd <info@goldsure.com.au>',
          to: toAddresses,
          bcc: ['vignesh@goldsure.com.au'],
          subject: relaySubject,
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
      await sendHostingerMail({
        displayName: 'Goldsure Pty Ltd',
        to: toAddresses,
        subject: subject || `${summary.worker} Installer Pay Summary`,
        html: buildPaySummaryHtml(summary),
      });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[Hostinger] Pay summary server error:', err);
      return res.status(500).json({ error: 'Failed to send email.', detail: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid request: provide either html or summary in the request body.' });
}

// ════════════════════════════════════════════════════════════
// RingCentral Call Analytics — Timeline feed (powers /calls/)
// JWT auth flow → access token → POST Call Business Analytics Timeline
// (groupBy Users, interval Hour). Normalised for the dashboard. Short in-memory
// cache to respect the analytics rate limits. ?debug=1 returns raw JSON.
// ════════════════════════════════════════════════════════════
const RC_TOKEN_PATH = '/restapi/oauth/token';
const RC_DEFAULT_TIMELINE_PATH = '/analytics/calls/v1/accounts/~/timeline/fetch';
const RC_HOURS = [8,9,10,11,12,13,14,15,16,17,18];
let _rcToken = null;                 // { access_token, expires_at }
const _rcCache = new Map();          // key -> { at, payload }
const RC_CACHE_MS = 3 * 60 * 1000;

function rcServer() { return (process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com').replace(/\/+$/, ''); }
function rcTz() { return process.env.RINGCENTRAL_TIMEZONE || 'Australia/Melbourne'; }

async function rcAccessToken() {
  if (_rcToken && Date.now() < _rcToken.expires_at - 60000) return _rcToken.access_token;
  const id = process.env.RINGCENTRAL_CLIENT_ID, secret = process.env.RINGCENTRAL_CLIENT_SECRET, jwt = process.env.RINGCENTRAL_JWT;
  if (!id || !secret || !jwt) { const e = new Error('RingCentral env vars are not set.'); e.code = 'NO_CREDS'; throw e; }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt });
  const r = await fetch(rcServer() + RC_TOKEN_PATH, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Token request failed: ${r.status} ${data.error_description || data.error || ''}`.trim()); e.status = r.status; e.detail = data; throw e; }
  _rcToken = { access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return _rcToken.access_token;
}

function rcDayRange(which) {
  const now = new Date(); const zone = rcTz();
  const ymdOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const zonedMidnight = (ymd) => { const g = new Date(`${ymd}T00:00:00Z`); const asZone = new Date(g.toLocaleString('en-US', { timeZone: zone })); const asUtc = new Date(g.toLocaleString('en-US', { timeZone: 'UTC' })); return new Date(g.getTime() + (asUtc - asZone)); };
  const todayYmd = ymdOf(now);
  if (which === 'yday') { const y = new Date(now.getTime() - 86400000); return { timeFrom: zonedMidnight(ymdOf(y)).toISOString(), timeTo: zonedMidnight(todayYmd).toISOString() }; }
  return { timeFrom: zonedMidnight(todayYmd).toISOString(), timeTo: now.toISOString() };
}

function rcHourFromIso(iso, zone) { try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date(iso))); } catch { return null; } }
// Users to leave out of the call report (matched case-insensitively as a
// substring of the name). Override with RINGCENTRAL_EXCLUDE_USERS (comma-sep).
function rcExcludedUsers() {
  return (process.env.RINGCENTRAL_EXCLUDE_USERS || 'Vignesh')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function rcNormalize(raw) {
  const zone = rcTz();
  const exclude = rcExcludedUsers();
  const records = raw?.data?.records || raw?.records || [];
  const agents = [];
  for (const rec of records) {
    const name = rec?.info?.name || rec?.key?.name || rec?.name || 'Unknown';
    if (exclude.some(x => name.toLowerCase().includes(x))) continue;
    const series = rec?.points || rec?.dataItems || [];
    const hours = {};
    let active = false;
    for (const p of (Array.isArray(series) ? series : [])) {
      const h = p?.time ? rcHourFromIso(p.time, zone) : null;
      if (h == null) continue;
      const dir = p?.counters?.callsByDirection?.values || {};
      const resu = p?.counters?.callsByResult?.values || {};
      const response = p?.counters?.callsByResponse?.values || {};
      const segments = p?.counters?.callsSegments?.values || {};
      const dur = Number(p?.timers?.allCalls?.values) || 0;
      const made = Number(dir.outbound) || 0;                              // calls made = outbound
      // callsByResult reports outbound PSTN calls as "unknown" and cannot tell us
      // whether they connected. callsByResponse is the authoritative outbound
      // connected/notConnected split. Treat a known voicemail phase as no-answer
      // too, even when the destination technically answered the call.
      const hasResponse = Object.prototype.hasOwnProperty.call(response, 'connected')
        || Object.prototype.hasOwnProperty.call(response, 'notConnected');
      const voicemail = Math.max(Number(segments.voicemail) || 0, Number(segments.vmGreeting) || 0);
      let conn, noans;
      if (hasResponse) {
        conn = Math.min(made, Math.max(0, (Number(response.connected) || 0) - voicemail));
        noans = Math.max(0, made - conn);
      } else {
        noans = Math.min(made, (Number(resu.missed) || 0) + (Number(resu.voicemail) || 0) + (Number(resu.abandoned) || 0));
        conn = Math.max(0, made - noans);
      }
      // aggregate into the hour bucket (multiple UTC points can share an hour)
      const prev = hours[h] || { made: 0, conn: 0, dur: 0 };
      hours[h] = { made: prev.made + made, conn: prev.conn + conn, dur: prev.dur + dur };
      if (made || dur) active = true;
    }
    if (active) agents.push({ name, hours });
  }
  return agents;
}

async function rcFetchTimeline(range) {
  const token = await rcAccessToken();
  const path = process.env.RINGCENTRAL_TIMELINE_PATH || RC_DEFAULT_TIMELINE_PATH;
  const url = `${rcServer()}${path}?perPage=20&interval=Hour`;
  const bodyObj = {
    grouping: { groupBy: 'Users' },
    timeSettings: { timeZone: rcTz(), timeRange: { timeFrom: range.timeFrom, timeTo: range.timeTo } },
    responseOptions: {
      counters: { allCalls: true, callsByDirection: true, callsByResponse: true, callsSegments: true, callsByResult: true },
      timers: { allCallsDuration: true },
    },
  };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(bodyObj) });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Timeline request failed: ${r.status}`); e.status = r.status; e.detail = raw; e.sent = bodyObj; throw e; }
  return raw;
}

// Inbound calls aren't broken out by hour in the Analytics Timeline response
// (its counters aggregate both directions per user), so inbound hourly stats
// are derived from the raw Call Log records instead — same source as the
// missed-calls panel. Answered/no-answer is inferred from `result`.
function rcNormalizeInboundHourly(raw) {
  const zone = rcTz();
  const exclude = rcExcludedUsers();
  const recs = raw?.records || [];
  const seen = new Set();
  const agents = new Map();
  for (const r of recs) {
    if (r.sessionId && seen.has(r.sessionId)) continue;
    if (r.sessionId) seen.add(r.sessionId);
    if (r.direction !== 'Inbound') continue;
    const name = r.to?.name || r.to?.extensionNumber || 'Unknown';
    if (exclude.some(x => name.toLowerCase().includes(x))) continue;
    const h = rcHourFromIso(r.startTime, zone);
    if (h == null) continue;
    const missed = /miss|voicemail|no ?answer|abandon/i.test(String(r.result || ''));
    const dur = Number(r.duration) || 0;
    const entry = agents.get(name) || {};
    const prev = entry[h] || { made: 0, conn: 0, dur: 0 };
    entry[h] = { made: prev.made + 1, conn: prev.conn + (missed ? 0 : 1), dur: prev.dur + dur };
    agents.set(name, entry);
  }
  return agents; // Map<name, {hour: {made,conn,dur}}>
}

async function ringcentralTimeline(req, res) {
  const which = (req.query?.date === 'yday') ? 'yday' : 'today';
  const debug = req.query?.debug === '1' || req.query?.debug === 'true';
  try {
    const hit = _rcCache.get(which);
    if (hit && !debug && Date.now() - hit.at < RC_CACHE_MS) return res.status(200).json({ ok: true, cached: true, ...hit.payload });
    const range = rcDayRange(which);
    const raw = await rcFetchTimeline(range);
    if (debug) return res.status(200).json({ ok: true, range, raw });
    const outAgents = rcNormalize(raw);

    // Best-effort: merge in inbound hourly stats from the call log. Never let
    // an inbound failure (e.g. missing Read Call Log scope) break outbound.
    let inAgents = new Map();
    try {
      const clRaw = await rcFetchCallLogCached(which, range);
      inAgents = rcNormalizeInboundHourly(clRaw);
    } catch (e) { /* inbound stays empty; outbound view still works */ }

    const names = new Set([...outAgents.map(a => a.name), ...inAgents.keys()]);
    const agents = [...names].map(name => ({
      name,
      hours: (outAgents.find(a => a.name === name) || {}).hours || {},
      hoursIn: inAgents.get(name) || {},
    }));

    const payload = { date: which, range, agents, hours: RC_HOURS, source: 'ringcentral' };
    _rcCache.set(which, { at: Date.now(), payload });
    return res.status(200).json({ ok: true, ...payload });
  } catch (err) {
    const status = err.code === 'NO_CREDS' ? 200 : (err.status || 500);
    return res.status(status).json({ ok: false, error: err.message, detail: debug ? (err.detail || null) : undefined, sent: debug ? (err.sent || null) : undefined });
  }
}

// ── Missed calls + return status (Call Log API) ──────────────
const _rcMissedCache = new Map();
const _rcCallLogCache = new Map();
async function rcFetchCallLog(range) {
  const token = await rcAccessToken();
  const url = `${rcServer()}/restapi/v1.0/account/~/call-log?view=Simple&type=Voice&perPage=1000`
    + `&dateFrom=${encodeURIComponent(range.timeFrom)}&dateTo=${encodeURIComponent(range.timeTo)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Call log request failed: ${r.status}`); e.status = r.status; e.detail = raw; throw e; }
  return raw;
}
// Shared across the timeline (inbound) and missed-calls routes so a single
// page load doesn't fetch the same day's call log twice.
async function rcFetchCallLogCached(which, range) {
  const hit = _rcCallLogCache.get(which);
  if (hit && Date.now() - hit.at < RC_CACHE_MS) return hit.raw;
  const raw = await rcFetchCallLog(range);
  _rcCallLogCache.set(which, { at: Date.now(), raw });
  return raw;
}

function rcDigits(s) { return String(s || '').replace(/\D/g, '').slice(-9); }
function rcNormalizeMissed(raw) {
  const zone = rcTz();
  const recs = raw?.records || [];
  const outbound = [], answeredIn = [], missedRecs = [];
  const seen = new Set();
  for (const r of recs) {
    if (r.sessionId && seen.has(r.sessionId)) continue;
    if (r.sessionId) seen.add(r.sessionId);
    const dir = r.direction || '';
    const result = String(r.result || '');
    const from = r.from || {}, to = r.to || {};
    const t = new Date(r.startTime).getTime();
    if (!Number.isFinite(t)) continue;
    if (dir === 'Outbound') {
      outbound.push({ num: rcDigits(to.phoneNumber), t, by: from.name || from.extensionNumber || 'Agent' });
    } else if (dir === 'Inbound') {
      if (/miss|voicemail|no ?answer|abandon/i.test(result)) {
        missedRecs.push({ num: rcDigits(from.phoneNumber), display: from.phoneNumber || from.name || 'Unknown', name: from.name || '', t, result });
      } else {
        answeredIn.push({ num: rcDigits(from.phoneNumber), t });
      }
    }
  }
  const byNum = new Map();
  for (const m of missedRecs) {
    if (!m.num) continue;
    const e = byNum.get(m.num) || { num: m.num, display: m.display, name: m.name, count: 0, firstT: m.t, lastT: m.t };
    e.count++; e.name = e.name || m.name; e.display = e.display || m.display;
    e.firstT = Math.min(e.firstT, m.t); e.lastT = Math.max(e.lastT, m.t);
    byNum.set(m.num, e);
  }
  const items = [];
  for (const e of byNum.values()) {
    const ob = outbound.filter(o => o.num === e.num && o.t > e.firstT).sort((a, b) => a.t - b.t)[0];
    const ib = answeredIn.filter(a => a.num === e.num && a.t > e.firstT).sort((a, b) => a.t - b.t)[0];
    let returned = false, returnedAt = null, returnedBy = null;
    if (ob) { returned = true; returnedAt = ob.t; returnedBy = ob.by; }
    else if (ib) { returned = true; returnedAt = ib.t; returnedBy = 'Customer called back (answered)'; }
    items.push({ number: e.display, name: e.name, count: e.count, missedAt: new Date(e.lastT).toISOString(), returned, returnedAt: returnedAt ? new Date(returnedAt).toISOString() : null, returnedBy });
  }
  items.sort((a, b) => (Number(a.returned) - Number(b.returned)) || (new Date(b.missedAt) - new Date(a.missedAt)));
  return { missed: items, total: items.length, unreturned: items.filter(i => !i.returned).length };
}

async function ringcentralMissed(req, res) {
  const which = (req.query?.date === 'yday') ? 'yday' : 'today';
  const debug = req.query?.debug === '1' || req.query?.debug === 'true';
  try {
    const key = 'missed:' + which;
    const hit = _rcMissedCache.get(key);
    if (hit && !debug && Date.now() - hit.at < RC_CACHE_MS) return res.status(200).json({ ok: true, cached: true, ...hit.payload });
    const range = rcDayRange(which);
    const raw = await rcFetchCallLogCached(which, range);
    if (debug) return res.status(200).json({ ok: true, range, raw });
    const data = rcNormalizeMissed(raw);
    const payload = { date: which, range, ...data };
    _rcMissedCache.set(key, { at: Date.now(), payload });
    return res.status(200).json({ ok: true, ...payload });
  } catch (err) {
    const status = err.code === 'NO_CREDS' ? 200 : (err.status || 500);
    return res.status(status).json({ ok: false, error: err.message, detail: debug ? (err.detail || null) : undefined });
  }
}

// ── Hourly call-performance email (GitHub Actions cron) ──────
function rcHourLabel(hour) {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  return `${((h + 11) % 12) + 1}${suffix}`;
}

function rcAgentStats(agent, onlyHour = null) {
  let made = 0, connected = 0, duration = 0;
  for (const [rawHour, raw] of Object.entries(agent?.hours || {})) {
    const hour = Number(rawHour);
    if (onlyHour == null ? (hour < 8 || hour > 18) : hour !== onlyHour) continue;
    made += Number(raw?.made) || 0;
    connected += Number(raw?.conn) || 0;
    duration += Number(raw?.dur) || 0;
  }
  return { made, connected, noAnswer: Math.max(0, made - connected), duration };
}

function rcCallReportRow(name, lastHour, today) {
  const rate = today.made ? Math.round((today.connected / today.made) * 100) : 0;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:0 0 16px;border:1px solid #ddd6c3;border-radius:12px;background:#ffffff;border-collapse:separate;overflow:hidden;">
    <tr><td colspan="3" style="padding:16px 18px 12px;font-size:20px;font-weight:800;color:#111111;">${esc(name)}</td></tr>
    <tr>
      <td width="33.33%" align="center" style="padding:12px 6px 15px;border-top:1px solid #eee9dc;border-right:1px solid #eee9dc;background:#fffdf7;">
        <div style="font-size:36px;line-height:1;font-weight:800;color:#111111;">${lastHour.made}</div>
        <div style="margin-top:7px;font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#756227;">CALLS MADE</div>
      </td>
      <td width="33.33%" align="center" style="padding:12px 6px 15px;border-top:1px solid #eee9dc;border-right:1px solid #eee9dc;background:#f5fbf7;">
        <div style="font-size:36px;line-height:1;font-weight:800;color:#167342;">${lastHour.connected}</div>
        <div style="margin-top:7px;font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#167342;">CONNECTED</div>
      </td>
      <td width="33.33%" align="center" style="padding:12px 6px 15px;border-top:1px solid #eee9dc;background:#fff7f5;">
        <div style="font-size:36px;line-height:1;font-weight:800;color:#b23b25;">${lastHour.noAnswer}</div>
        <div style="margin-top:7px;font-size:10px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#a63b28;">NO ANSWER</div>
      </td>
    </tr>
    <tr><td colspan="3" style="padding:11px 18px;font-size:12px;line-height:1.5;color:#666666;background:#fafafa;border-top:1px solid #eee9dc;"><strong style="color:#333333;">Today:</strong> ${today.made} made &middot; ${today.connected} connected &middot; ${today.noAnswer} no answer &middot; ${rate}% connected</td></tr>
  </table>`;
}

function rcMissedClock(iso) {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: rcTz(), hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function rcUnreturnedForHour(raw, todayUnreturned, targetHour) {
  const outstanding = new Map(todayUnreturned.map(item => [rcDigits(item.number), item]));
  const grouped = new Map();
  const seen = new Set();
  for (const record of raw?.records || []) {
    if (record.sessionId && seen.has(record.sessionId)) continue;
    if (record.sessionId) seen.add(record.sessionId);
    if (record.direction !== 'Inbound' || !/miss|voicemail|no ?answer|abandon/i.test(String(record.result || ''))) continue;
    if (rcHourFromIso(record.startTime, rcTz()) !== targetHour) continue;
    const number = rcDigits(record.from?.phoneNumber);
    const outstandingItem = outstanding.get(number);
    if (!number || !outstandingItem) continue;
    const timestamp = new Date(record.startTime).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const item = grouped.get(number) || {
      number: outstandingItem.number,
      name: outstandingItem.name,
      count: 0,
      missedAt: record.startTime,
    };
    item.count += 1;
    if (timestamp > new Date(item.missedAt).getTime()) item.missedAt = record.startTime;
    grouped.set(number, item);
  }
  return [...grouped.values()].sort((a, b) => new Date(b.missedAt) - new Date(a.missedAt));
}

function rcMissedEmailSection(label, items) {
  const callCount = items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);
  const rows = items.length ? items.map((item, index) => {
    const detail = [item.name, `missed ${rcMissedClock(item.missedAt)}`, item.count > 1 ? `${item.count} calls` : '']
      .filter(Boolean).map(value => esc(value)).join(' &middot; ');
    return `<tr>
      <td style="padding:10px 12px;${index ? 'border-top:1px solid #eee3df;' : ''}">
        <div style="font-size:14px;line-height:20px;font-weight:800;color:#222222;">${esc(item.number)}</div>
        <div style="font-size:11px;line-height:17px;color:#777777;">${detail}</div>
      </td>
      <td width="112" align="right" valign="middle" style="padding:10px 12px;${index ? 'border-top:1px solid #eee3df;' : ''}font-size:10px;line-height:15px;font-weight:800;color:#a63b28;">NOT CALLED BACK</td>
    </tr>`;
  }).join('') : `<tr><td colspan="2" style="padding:12px;font-size:12px;line-height:18px;color:#39704f;">No outstanding missed calls.</td></tr>`;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 14px;border:1px solid #e5d5cf;border-collapse:separate;table-layout:fixed;background-color:#ffffff;mso-table-lspace:0pt;mso-table-rspace:0pt;">
    <tr>
      <td colspan="2" width="100%" bgcolor="#fff3ef" style="width:100%;padding:13px 14px;background-color:#fff3ef;">
        <span style="font-size:11px;line-height:16px;font-weight:800;letter-spacing:1px;color:#7b3b2f;">${esc(label)}</span><br>
        <span style="font-size:30px;line-height:38px;font-weight:900;color:${callCount ? '#b23b25' : '#167342'};">${callCount}</span>
        <span style="font-size:12px;line-height:18px;font-weight:700;color:#555555;"> missed ${callCount === 1 ? 'call' : 'calls'} not called back</span>
      </td>
    </tr>
    ${rows}
  </table>`;
}

async function ringcentralHourlyEmail(req, res) {
  const expected = String(process.env.CALL_REPORT_CRON_SECRET || '');
  const supplied = String(req.headers?.authorization || '');
  if (!expected || supplied !== `Bearer ${expected}`) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  if (!hasHostingerMailConfig()) {
    return res.status(500).json({ ok: false, error: 'Hostinger Mail API credentials are not configured.' });
  }

  const now = new Date();
  const zone = rcTz();
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(now));
  const force = req.query?.force === '1' || req.query?.force === 'true';
  // Send after each completed reporting hour: 8–9am through 6–7pm.
  if (!force && (hour < 9 || hour > 19)) {
    return res.status(200).json({ ok: true, sent: false, skipped: 'outside-reporting-hours', localHour: hour, timeZone: zone });
  }

  try {
    const range = rcDayRange('today');
    const raw = await rcFetchTimeline(range);
    const callLogRaw = await rcFetchCallLog(range);
    const agents = rcNormalize(raw);
    const missedData = rcNormalizeMissed(callLogRaw);
    const todayUnreturned = missedData.missed.filter(item => !item.returned);
    const lastHourUnreturned = rcUnreturnedForHour(callLogRaw, todayUnreturned, hour - 1);
    const targets = [
      { label: 'Alda', match: 'alda' },
      { label: 'David', match: 'david' },
      { label: 'Shanira', match: 'shanira' },
    ].map(target => {
      const agent = agents.find(a => String(a.name || '').toLowerCase().includes(target.match));
      return {
        label: agent?.name || target.label,
        lastHour: rcAgentStats(agent, hour - 1),
        today: rcAgentStats(agent),
      };
    });
    const todayTotal = targets.reduce((sum, item) => ({
      made: sum.made + item.today.made,
      connected: sum.connected + item.today.connected,
      noAnswer: sum.noAnswer + item.today.noAnswer,
    }), { made: 0, connected: 0, noAnswer: 0 });
    const lastHourTotal = targets.reduce((sum, item) => ({
      made: sum.made + item.lastHour.made,
      connected: sum.connected + item.lastHour.connected,
      noAnswer: sum.noAnswer + item.lastHour.noAnswer,
    }), { made: 0, connected: 0, noAnswer: 0 });
    const period = `${rcHourLabel(hour - 1)}–${rcHourLabel(hour)}`;
    // Only send when calls were actually made in the reporting hour. With no calls
    // the email is skipped, so the last email of the day is the last active hour
    // (and 7pm is the hard cap via the reporting-hours gate above).
    if (!force && lastHourTotal.made === 0) {
      return res.status(200).json({ ok: true, sent: false, skipped: 'no-calls-in-hour', period, localHour: hour });
    }
    const dateLabel = new Intl.DateTimeFormat('en-AU', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(now);
    const recipients = ['vignesh@goldsure.com.au', 'amit@goldsure.com.au'];
    const subject = `Last hour: ${lastHourTotal.made} calls made | Goldsure ${period}`;
    const rows = targets.map(item => rcCallReportRow(item.label, item.lastHour, item.today)).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background-color:#f5f3ed;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f5f3ed" style="width:100%;border-collapse:collapse;background-color:#f5f3ed;mso-table-lspace:0pt;mso-table-rspace:0pt;">
        <tr><td align="center" style="padding:24px 12px;">
          <!--[if mso]><table role="presentation" width="660" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:660px;border-collapse:separate;font-family:Arial,Helvetica,sans-serif;color:#111111;mso-table-lspace:0pt;mso-table-rspace:0pt;">
            <tr><td bgcolor="#111111" style="padding:20px 22px;background-color:#111111;border-radius:12px 12px 0 0;">
              <span style="font-size:11px;line-height:16px;letter-spacing:2px;text-transform:uppercase;color:#c7a84b;">Goldsure Call Analytics</span><br>
              <span style="font-size:24px;line-height:34px;font-weight:800;color:#ffffff;">Last-hour call report</span><br>
              <span style="font-size:13px;line-height:20px;color:#bdbdbd;">${esc(period)} &middot; ${esc(dateLabel)} &middot; ${esc(zone)}</span>
            </td></tr>
            <tr><td bgcolor="#faf9f5" style="padding:18px;background-color:#faf9f5;border:1px solid #e8e3d5;border-top:0;border-radius:0 0 12px 12px;">
          <div style="margin:0 0 18px;padding:18px 10px 16px;border-radius:12px;background:#efe7cd;text-align:center;">
            <div style="margin-bottom:14px;font-size:12px;font-weight:800;letter-spacing:1.6px;color:#66531d;">COMBINED &mdash; LAST HOUR</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
              <tr>
                <td width="33.33%" align="center" style="padding:2px 4px;"><div style="font-size:44px;line-height:1;font-weight:900;color:#111111;">${lastHourTotal.made}</div><div style="margin-top:7px;font-size:10px;font-weight:800;letter-spacing:1px;color:#66531d;">CALLS MADE</div></td>
                <td width="33.33%" align="center" style="padding:2px 4px;border-left:1px solid #d5c79e;"><div style="font-size:44px;line-height:1;font-weight:900;color:#167342;">${lastHourTotal.connected}</div><div style="margin-top:7px;font-size:10px;font-weight:800;letter-spacing:1px;color:#167342;">CONNECTED</div></td>
                <td width="33.33%" align="center" style="padding:2px 4px;border-left:1px solid #d5c79e;"><div style="font-size:44px;line-height:1;font-weight:900;color:#b23b25;">${lastHourTotal.noAnswer}</div><div style="margin-top:7px;font-size:10px;font-weight:800;letter-spacing:1px;color:#a63b28;">NO ANSWER</div></td>
              </tr>
            </table>
          </div>
          <div style="margin:0 0 12px;font-size:14px;font-weight:800;letter-spacing:.5px;color:#333333;">INDIVIDUAL RESULTS &mdash; LAST HOUR</div>
          ${rows}
          <div style="margin:2px 0 16px;padding:12px 15px;border-radius:9px;background:#eeeeee;font-size:13px;line-height:1.5;color:#444444;"><strong>Combined today:</strong> ${todayTotal.made} made &middot; ${todayTotal.connected} connected &middot; ${todayTotal.noAnswer} no answer</div>
          <div style="margin:0 0 16px;font-size:11px;line-height:1.5;color:#777777;">No answer means the outbound call was not connected, including calls that reached voicemail.</div>
          <div style="margin:4px 0 12px;padding-top:16px;border-top:2px solid #ded7c6;font-size:14px;line-height:20px;font-weight:800;letter-spacing:.5px;color:#333333;">MISSED CALLS STILL NOT CALLED BACK</div>
          ${rcMissedEmailSection(`PREVIOUS HOUR — ${period}`, lastHourUnreturned)}
          ${rcMissedEmailSection('WHOLE OF TODAY', todayUnreturned)}
          <div style="padding-top:4px;text-align:center;font-size:12px;color:#777777;">
            <a href="https://portal.goldsure.com.au/calls/" style="color:#9a7920;text-decoration:none;font-weight:700;">Open the live Call Analytics dashboard</a>
          </div>
            </td></tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td></tr>
      </table>
    </body></html>`;
    const text = [
      `Goldsure hourly call report — ${period}, ${dateLabel}`,
      '',
      ...targets.map(item => `${item.label}: last hour ${item.lastHour.made} made, ${item.lastHour.connected} connected, ${item.lastHour.noAnswer} no answer; today ${item.today.made} made, ${item.today.connected} connected, ${item.today.noAnswer} no answer.`),
      '',
      `Combined last hour: ${lastHourTotal.made} made, ${lastHourTotal.connected} connected, ${lastHourTotal.noAnswer} no answer.`,
      `Combined today: ${todayTotal.made} made, ${todayTotal.connected} connected, ${todayTotal.noAnswer} no answer.`,
      '',
      `Missed calls not called back in the previous hour: ${lastHourUnreturned.reduce((sum, item) => sum + (Number(item.count) || 1), 0)}.`,
      ...lastHourUnreturned.map(item => `${item.number} — missed ${rcMissedClock(item.missedAt)}${item.name ? ` — ${item.name}` : ''}.`),
      `Missed calls not called back today: ${todayUnreturned.reduce((sum, item) => sum + (Number(item.count) || 1), 0)}.`,
      ...todayUnreturned.map(item => `${item.number} — missed ${rcMissedClock(item.missedAt)}${item.name ? ` — ${item.name}` : ''}.`),
      'https://portal.goldsure.com.au/calls/',
    ].join('\n');

    await sendHostingerMail({
      to: recipients,
      displayName: 'Goldsure Call Analytics',
      subject,
      text,
      html,
    });
    return res.status(200).json({
      ok: true,
      sent: true,
      recipients,
      period,
      date: dateLabel,
      totals: lastHourTotal,
      todayTotals: todayTotal,
      agents: targets,
      missedNotCalledBack: {
        lastHour: lastHourUnreturned.reduce((sum, item) => sum + (Number(item.count) || 1), 0),
        today: todayUnreturned.reduce((sum, item) => sum + (Number(item.count) || 1), 0),
      },
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
