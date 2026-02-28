// api/send-report.js
// Sends a daily KPI summary email via Resend.
// Triggered by Vercel Cron at 07:30 UTC = 5:30 PM AEDT (UTC+10).
//
// Required Vercel Environment Variables:
//   RESEND_API_KEY     = re_xxxx...
//   GHL_API_KEY        = pit-xxxx...
//   META_TOKEN         = EAAia7...
//   REPORT_RECIPIENTS  = email1@example.com,email2@example.com
//   CRON_SECRET        = any random string (to secure the endpoint)

const GHL_LOCATION_ID = '11epCbQAg9B4rQt5yHjw';
const SMOKE_ACCOUNT   = 'act_1420815159464502';
const HWS_ACCOUNT     = 'act_716067364534837';

// ── Helpers ──────────────────────────────────────────────────

async function ghlFetch(path, ghlKey) {
  const resp = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      'Authorization': `Bearer ${ghlKey}`,
      'Version': '2021-07-28',
      'Accept': 'application/json',
    },
  });
  return resp.json();
}

async function fetchAllOpportunities(ghlKey) {
  let all = [], startAfter = null, startAfterId = null, page = 0;
  while (true) {
    page++;
    let path = `/opportunities/search?location_id=${GHL_LOCATION_ID}&limit=100`;
    if (startAfter) path += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    const json = await ghlFetch(path, ghlKey);
    const opps = json.opportunities || [];
    all = all.concat(opps);
    if (opps.length < 100 || !json.meta?.nextPageUrl) break;
    startAfter = json.meta?.startAfter;
    startAfterId = json.meta?.startAfterId;
    if (!startAfter || page > 50) break;
  }
  return all;
}

async function fetchMetaSpend(account, token, since, until) {
  const url = `https://graph.facebook.com/v19.0/${account}/insights?fields=spend&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${token}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.error) return 0;
  return (json.data || []).reduce((sum, d) => sum + parseFloat(d.spend || 0), 0);
}

function calcKPIs(opps, pipelineId, label) {
  const leads = pipelineId ? opps.filter(o => o.pipelineId === pipelineId) : opps;
  const total  = leads.length;
  const inst   = leads.filter(o => /install|won/i.test(o.stage || '')).length;
  const ni     = leads.filter(o => /not.?interest|spam/i.test(o.stage || '')).length;
  const rate   = total ? ((inst / total) * 100).toFixed(1) : '0.0';
  return { label, total, inst, ni, rate };
}

// ── Email template ────────────────────────────────────────────

function buildEmail(smoke, hws, smokeSpend, hwsSpend, dateStr) {
  const row = (label, value, color = '#141c2e') =>
    `<tr><td style="padding:8px 0;font-size:13px;color:#6b7899;border-bottom:1px solid #f0f2f5;">${label}</td>
     <td style="padding:8px 0;font-size:13px;font-weight:700;color:${color};text-align:right;border-bottom:1px solid #f0f2f5;font-family:monospace;">${value}</td></tr>`;

  const section = (kpi, spend) => `
    <div style="margin-bottom:28px;">
      <div style="font-size:14px;font-weight:700;color:#141c2e;border-bottom:2px solid #2d6be4;padding-bottom:8px;margin-bottom:12px;">${kpi.label}</div>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Total Leads', kpi.total, '#2d6be4')}
        ${row('Installed / Won', kpi.inst, '#18a96e')}
        ${row('Not Interested', kpi.ni, '#e04f4f')}
        ${row('Close Rate', kpi.rate + '%', '#d98c1e')}
        ${row('Ad Spend (MTD)', '$' + spend.toFixed(2))}
      </table>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background:#141c2e;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Goldsure Daily Report</div>
        <div style="font-size:12px;color:#6b7899;margin-top:4px;">${dateStr}</div>
      </div>
      <div style="width:8px;height:8px;border-radius:50%;background:#18a96e;box-shadow:0 0 0 3px rgba(24,169,110,0.3);"></div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      ${section(smoke, smokeSpend)}
      ${section(hws, hwsSpend)}

      <!-- CTA -->
      <div style="text-align:center;margin-top:8px;">
        <a href="https://portal.goldsure.com.au/Ads%20reporting/Meta%20Ad%20Performance.html"
           style="display:inline-block;padding:12px 28px;background:#2d6be4;color:#fff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
          Open Dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f5f6f8;padding:16px 32px;text-align:center;font-size:11px;color:#6b7899;border-top:1px solid #e3e7ef;">
      Goldsure Pty Ltd · Suite 4, Level 1, 293 High Street, Preston VIC 3072
    </div>
  </div>
</body>
</html>`;
}

// ── Handler ──────────────────────────────────────────────────

export default async function handler(req, res) {
  // Secure the endpoint with a secret so only Vercel cron can call it
  const secret = process.env.CRON_SECRET || '';
  const authHeader = req.headers['authorization'] || '';
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ghlKey    = process.env.GHL_API_KEY    || '';
  const metaToken = process.env.META_TOKEN      || '';
  const resendKey = process.env.RESEND_API_KEY  || '';
  const recipients = (process.env.REPORT_RECIPIENTS || '').split(',').map(e => e.trim()).filter(Boolean);

  if (!resendKey)    return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!recipients.length) return res.status(500).json({ error: 'REPORT_RECIPIENTS not set' });

  try {
    // ── Fetch GHL data ──
    let smokePipelineId = '', hwsPipelineId = '';
    try {
      const pipeJson = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, ghlKey);
      const pipes = pipeJson.pipelines || [];
      smokePipelineId = (pipes.find(p => /smoke/i.test(p.name)) || {}).id || '';
      hwsPipelineId   = (pipes.find(p => /hws|hot.?water/i.test(p.name)) || {}).id || '';
    } catch(e) {}

    const opps = await fetchAllOpportunities(ghlKey);
    const mapped = opps.map(o => ({
      stage: (o.pipelineStage?.name || o.status || '').trim(),
      pipelineId: (o.pipelineId || o.pipeline?.id || '').trim(),
    }));

    const smokeOpps = smokePipelineId ? mapped.filter(o => o.pipelineId === smokePipelineId) : mapped;
    const hwsOpps   = hwsPipelineId   ? mapped.filter(o => o.pipelineId === hwsPipelineId)   : [];

    const smokeKPIs = calcKPIs(smokeOpps, null, '🔥 Smoke Alarms');
    const hwsKPIs   = calcKPIs(hwsOpps,   null, '💧 Hot Water Systems');

    // ── Fetch Meta spend MTD ──
    const today = new Date();
    const since = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const until = today.toISOString().slice(0, 10);

    let smokeSpend = 0, hwsSpend = 0;
    if (metaToken) {
      [smokeSpend, hwsSpend] = await Promise.all([
        fetchMetaSpend(SMOKE_ACCOUNT, metaToken, since, until),
        fetchMetaSpend(HWS_ACCOUNT,   metaToken, since, until),
      ]);
    }

    // ── Build & send email ──
    const dateStr = today.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    const html = buildEmail(smokeKPIs, hwsKPIs, smokeSpend, hwsSpend, dateStr);

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Goldsure Reports <reports@goldsure.com.au>',
        to: recipients,
        subject: `Goldsure Daily Report — ${dateStr}`,
        html,
      }),
    });

    const emailData = await emailResp.json();
    if (!emailResp.ok) {
      return res.status(500).json({ error: 'Resend failed', detail: emailData });
    }

    return res.status(200).json({
      ok: true,
      sent_to: recipients,
      smoke: smokeKPIs,
      hws: hwsKPIs,
      smokeSpend,
      hwsSpend,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
