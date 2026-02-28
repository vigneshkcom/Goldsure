// api/MetaAdPerformace/send-report.js
// Sends a daily KPI summary email via Resend.
// Triggered by Vercel Cron at 45 7 * * * UTC = 5:45 PM AEST (UTC+10).
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

// ── Stage name constants (must match GHL exactly) ─────────────
const STAGE_WON = ['Won/Installed', 'Installed', 'IHA Booked', 'Qualified/IHA Complete'];
const STAGE_LOST = ['Not Interested/Spam', 'Not Reachable', 'Out of Area', 'Quote Not Accepted (Lost)'];

// ── Helpers ───────────────────────────────────────────────────

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

async function fetchPipelines(ghlKey) {
  try {
    const json = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, ghlKey);
    return json.pipelines || [];
  } catch (e) {
    console.warn('Could not fetch pipelines:', e.message);
    return [];
  }
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
  if (json.error) {
    console.warn(`Meta API error for ${account}:`, json.error.message);
    return 0;
  }
  return (json.data || []).reduce((sum, d) => sum + parseFloat(d.spend || 0), 0);
}

// ── Stage resolution ──────────────────────────────────────────
// Builds a map of stageId → stageName from pipeline data
// so we get the real stage name even if the opportunity only has an ID
function buildStageNameMap(pipelines) {
  const map = {};
  pipelines.forEach(p => {
    (p.stages || []).forEach(s => {
      if (s.id && s.name) map[s.id] = s.name;
    });
  });
  return map;
}

function resolveStage(opp, stageNameMap) {
  // Try stage name from pipelineStage object first
  const nameFromObj = opp.pipelineStage?.name;
  if (nameFromObj) return nameFromObj.trim();

  // Fall back to resolving via stage ID
  const stageId = opp.pipelineStageId || opp.pipelineStage?.id;
  if (stageId && stageNameMap[stageId]) return stageNameMap[stageId].trim();

  // Last resort: use status field
  return (opp.status || 'Unknown').trim();
}

// ── KPI calculation ───────────────────────────────────────────
function calcKPIs(opps, label) {
  const total = opps.length;

  const inst = opps.filter(o => STAGE_WON.includes(o.stage)).length;

  const ni = opps.filter(o => STAGE_LOST.includes(o.stage)).length;

  const inProgress = total - inst - ni;

  const rate = total ? ((inst / total) * 100).toFixed(1) : '0.0';

  return { label, total, inst, ni, inProgress, rate };
}

// ── Email template ────────────────────────────────────────────
function buildEmail(smoke, hws, smokeSpend, hwsSpend, dateStr) {
  const row = (label, value, color = '#141c2e') =>
    `<tr>
      <td style="padding:9px 0;font-size:13px;color:#6b7899;border-bottom:1px solid #f0f2f5;">${label}</td>
      <td style="padding:9px 0;font-size:13px;font-weight:700;color:${color};text-align:right;border-bottom:1px solid #f0f2f5;font-family:monospace;">${value}</td>
    </tr>`;

  const section = (kpi, spend) => `
    <div style="margin-bottom:32px;">
      <div style="font-size:15px;font-weight:700;color:#141c2e;border-bottom:2px solid #b08d2e;padding-bottom:8px;margin-bottom:14px;">${kpi.label}</div>
      <table style="width:100%;border-collapse:collapse;">
        ${row('Total Leads', kpi.total, '#2d6be4')}
        ${row('Installed / Won', kpi.inst, '#18a96e')}
        ${row('Not Interested / Lost', kpi.ni, '#e04f4f')}
        ${row('In Progress', kpi.inProgress, '#d98c1e')}
        ${row('Close Rate', kpi.rate + '%', kpi.rate >= 20 ? '#18a96e' : kpi.rate >= 10 ? '#d98c1e' : '#e04f4f')}
        ${row('Ad Spend (MTD)', '$' + spend.toFixed(2))}
      </table>
    </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f6f8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#000000;padding:0 0 0 0;border-top:3px solid #b08d2e;">
      <div style="padding:22px 32px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <img src="https://assets.cdn.filesafe.space/11epCbQAg9B4rQt5yHjw/media/699a73ab3a2afd85cbdb392f.jpg"
               alt="Goldsure" style="height:36px;width:auto;display:block;margin-bottom:10px;">
          <div style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Daily Report</div>
          <div style="font-size:12px;color:#6b7899;margin-top:3px;">${dateStr}</div>
        </div>
        <div style="text-align:right;">
          <div style="width:10px;height:10px;border-radius:50%;background:#18a96e;box-shadow:0 0 0 3px rgba(24,169,110,0.3);margin-left:auto;margin-bottom:8px;"></div>
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#b08d2e;">Auto Report</div>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      ${section(smoke, smokeSpend)}
      ${section(hws, hwsSpend)}

      <!-- Summary row -->
      <div style="background:#f5f6f8;border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div style="font-size:12px;color:#6b7899;">Total MTD Ad Spend</div>
        <div style="font-size:16px;font-weight:700;font-family:monospace;color:#141c2e;">$${(smokeSpend + hwsSpend).toFixed(2)}</div>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-top:8px;">
        <a href="https://portal.goldsure.com.au/Ads%20reporting/Meta%20Ad%20Performance.html"
           style="display:inline-block;padding:13px 32px;background:#b08d2e;color:#000;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">
          Open Dashboard →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f5f6f8;padding:16px 32px;text-align:center;font-size:11px;color:#6b7899;border-top:1px solid #e3e7ef;">
      Goldsure Pty Ltd · ABN: 66 683 305 106 · Suite 4, Level 1, 293 High Street, Preston VIC 3072
    </div>
  </div>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  // Secure the endpoint — Vercel automatically sends CRON_SECRET as Bearer token
  const secret = process.env.CRON_SECRET || '';
  const authHeader = req.headers['authorization'] || '';
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ghlKey     = process.env.GHL_API_KEY       || '';
  const metaToken  = process.env.META_TOKEN         || '';
  const resendKey  = process.env.RESEND_API_KEY     || '';
  const recipients = (process.env.REPORT_RECIPIENTS || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  if (!resendKey)         return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!recipients.length) return res.status(500).json({ error: 'REPORT_RECIPIENTS not set' });

  try {
    // ── 1. Fetch pipelines so we can resolve stage IDs → stage names ──
    const pipelines = ghlKey ? await fetchPipelines(ghlKey) : [];
    const stageNameMap = buildStageNameMap(pipelines);

    let smokePipelineId = '';
    let hwsPipelineId   = '';
    pipelines.forEach(p => {
      if (/smoke/i.test(p.name))              smokePipelineId = p.id;
      if (/hws|hot.?water|water/i.test(p.name)) hwsPipelineId = p.id;
    });

    // ── 2. Fetch all opportunities ──
    const rawOpps = ghlKey ? await fetchAllOpportunities(ghlKey) : [];

    // Map each opp — resolve real stage name using stageNameMap
    const mapped = rawOpps.map(o => ({
      stage:      resolveStage(o, stageNameMap),
      pipelineId: (o.pipelineId || o.pipeline?.id || '').trim(),
    }));

    // ── 3. Split into smoke vs HWS ──
    let smokeOpps, hwsOpps;

    if (smokePipelineId || hwsPipelineId) {
      smokeOpps = smokePipelineId
        ? mapped.filter(o => o.pipelineId === smokePipelineId)
        : mapped.filter(o => o.pipelineId !== hwsPipelineId);
      hwsOpps = hwsPipelineId
        ? mapped.filter(o => o.pipelineId === hwsPipelineId)
        : mapped.filter(o => o.pipelineId !== smokePipelineId);
    } else {
      // Fallback: use all opps for smoke, empty for HWS
      smokeOpps = mapped;
      hwsOpps   = [];
    }

    const smokeKPIs = calcKPIs(smokeOpps, '🔥 Smoke Alarms');
    const hwsKPIs   = calcKPIs(hwsOpps,   '💧 Hot Water Systems');

    // ── 4. Fetch Meta spend MTD ──
    const today = new Date();
    const since = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().slice(0, 10);
    const until = today.toISOString().slice(0, 10);

    let smokeSpend = 0, hwsSpend = 0;
    if (metaToken) {
      [smokeSpend, hwsSpend] = await Promise.all([
        fetchMetaSpend(SMOKE_ACCOUNT, metaToken, since, until),
        fetchMetaSpend(HWS_ACCOUNT,   metaToken, since, until),
      ]);
    }

    // ── 5. Build & send email ──
    const dateStr = today.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Australia/Brisbane',
    });

    const html = buildEmail(smokeKPIs, hwsKPIs, smokeSpend, hwsSpend, dateStr);

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Goldsure Reports <reports@goldsure.com.au>',
        to:      recipients,
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
      sent_to:    recipients,
      smoke:      smokeKPIs,
      hws:        hwsKPIs,
      smokeSpend,
      hwsSpend,
    });

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
