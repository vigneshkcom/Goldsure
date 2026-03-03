// api/send-report.js
// Goldsure — Smoke Alarms daily email report
//
// Sends one email per day showing:
//   • Today's snapshot (leads, installed, close rate, Meta spend, CPL)
//   • Last 7 days comparison table
//   • Lead source breakdown for today
//
// Triggered by Vercel Cron: "30 7 * * *" → 07:30 UTC = 5:30 PM AEDT
//
// Required Vercel Environment Variables:
//   RESEND_API_KEY     = re_xxxx...
//   GHL_API_KEY        = pit-xxxx...
//   META_TOKEN         = EAAia7...
//   REPORT_RECIPIENTS  = email1@example.com,email2@example.com
//   CRON_SECRET        = any random string

const GHL_LOCATION_ID = '11epCbQAg9B4rQt5yHjw';
const SMOKE_ACCOUNT   = 'act_1420815159464502';

// ── Stage classification (exact names from your GHL dashboard) ─
// Matches renderSmoke() in Meta Ad Performance.html exactly

const isInstalled = stage =>
  /install|won/i.test(stage);

const isNotInterested = stage =>
  /not.?interest|spam/i.test(stage);

const isLost = stage =>
  isNotInterested(stage) ||
  stage === 'Not Reachable' ||
  stage === 'Out of Area' ||
  stage === 'Quote Not Accepted (Lost)';

// Stage display order — matches dashboard STAGE_ORDER
const STAGE_ORDER = [
  'Not Interested/Spam',
  'Not Reachable',
  'Out of Area',
  'Quote Not Accepted (Lost)',
  'Won/Installed',
  'Installed',
  'IHA Booked',
  'Qualified/IHA Complete',
  'Quote Sent',
  'Follow-Up',
  'Follow Up',
  'Shopping Around',
  'New Lead',
  'Today',
];

const STAGE_COLORS = {
  'Not Interested/Spam':        '#e04f4f',
  'Not Reachable':              '#d98c1e',
  'Out of Area':                '#7251c2',
  'Quote Not Accepted (Lost)':  '#c0392b',
  'Won/Installed':              '#18a96e',
  'Installed':                  '#18a96e',
  'IHA Booked':                 '#2d6be4',
  'Qualified/IHA Complete':     '#0ea4ac',
  'Quote Sent':                 '#2d6be4',
  'Follow-Up':                  '#0ea4ac',
  'Follow Up':                  '#0ea4ac',
  'Shopping Around':            '#e0833b',
  'New Lead':                   '#94a3b8',
  'Today':                      '#f39c12',
};

const SOURCE_COLORS = ['#1877f2','#18a96e','#d98c1e','#7251c2','#e04f4f','#0ea4ac','#e0833b','#94a3b8'];

// ── Date helpers ──────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildRanges(today) {
  // Today
  const todayStr = isoDate(today);

  // Last 7 days: today-6 → today
  const w7start = new Date(today);
  w7start.setDate(today.getDate() - 6);

  // Prior 7 days: today-13 → today-7 (for comparison)
  const p7end   = new Date(today); p7end.setDate(today.getDate() - 7);
  const p7start = new Date(today); p7start.setDate(today.getDate() - 13);

  return {
    today:    { from: todayStr,        to: todayStr },
    last7:    { from: isoDate(w7start), to: todayStr },
    prior7:   { from: isoDate(p7start), to: isoDate(p7end) },
  };
}

// Build array of individual days for the 7-day table (today first)
function buildDailyRows(today) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(isoDate(d));
  }
  return days; // [today, yesterday, ..., 6 days ago]
}

// ── GHL ───────────────────────────────────────────────────────

async function ghlFetch(path) {
  const resp = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Version':       '2021-07-28',
      'Accept':        'application/json',
    },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.message || `GHL HTTP ${resp.status}`);
  return json;
}

async function fetchAllOpportunities() {
  let all = [], startAfter = null, startAfterId = null, page = 0;
  while (true) {
    page++;
    let path = `/opportunities/search?location_id=${GHL_LOCATION_ID}&limit=100`;
    if (startAfter) path += `&startAfter=${startAfter}&startAfterId=${startAfterId}`;
    const json = await ghlFetch(path);
    const opps = json.opportunities || [];
    all = all.concat(opps);
    if (opps.length < 100 || !json.meta?.nextPageUrl) break;
    startAfter   = json.meta?.startAfter;
    startAfterId = json.meta?.startAfterId;
    if (!startAfter || page > 50) break;
  }
  return all;
}

function mapOpp(opp) {
  return {
    stage:      (opp.pipelineStage?.name || opp.status || 'Unknown').trim(),
    stageId:    (opp.pipelineStageId || opp.pipelineStage?.id || '').trim(),
    source:     (opp.source || 'Unknown').trim(),
    pipeline:   (opp.pipeline?.name || opp.pipelineName || '').trim(),
    pipelineId: (opp.pipelineId || opp.pipeline?.id || '').trim(),
    created:    opp.createdAt ? opp.createdAt.slice(0, 10) : '',
  };
}

// Resolve pipeline IDs then split opps — same logic as loadGHLData() in dashboard
async function loadSmokeOpportunities() {
  let smokePipelineId = '';
  let pipelines = [];

  try {
    const pipeJson = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`);
    pipelines = (pipeJson.pipelines || []).map(p => ({
      id:     p.id,
      name:   p.name,
      stages: (p.stages || []).map(s => ({ id: s.id, name: s.name })),
    }));
    const smokePipe = pipelines.find(p => /smoke/i.test(p.name));
    if (smokePipe) smokePipelineId = smokePipe.id;
  } catch(e) {
    console.error('Pipeline fetch failed:', e.message);
  }

  const rawOpps = await fetchAllOpportunities();
  const mapped  = rawOpps.map(mapOpp).filter(r => r.created);

  // Resolve stage names from stage IDs (same as dashboard stageNameMap logic)
  const stageNameMap = {};
  pipelines.forEach(p => p.stages.forEach(s => { stageNameMap[s.id] = s.name; }));
  mapped.forEach(r => { if (r.stageId && stageNameMap[r.stageId]) r.stage = stageNameMap[r.stageId]; });

  // Filter to smoke pipeline only
  let smokeOpps;
  if (smokePipelineId) {
    smokeOpps = mapped.filter(r => r.pipelineId === smokePipelineId);
  } else {
    // fallback — exclude anything that looks like HWS
    smokeOpps = mapped.filter(r => !/hws|hot.?water|sales/i.test(r.pipeline));
  }

  return smokeOpps;
}

// ── KPI calculation ───────────────────────────────────────────

function calcKPIs(leads) {
  const total     = leads.length;
  const inst      = leads.filter(r => isInstalled(r.stage)).length;
  const notInt    = leads.filter(r => isNotInterested(r.stage)).length;
  const lost      = leads.filter(r => isLost(r.stage)).length;
  const closeRate = total > 0 ? ((inst / total) * 100).toFixed(1) : '0.0';

  // Stage breakdown
  const stageCount = {};
  leads.forEach(r => stageCount[r.stage] = (stageCount[r.stage] || 0) + 1);
  const breakdown = [
    ...STAGE_ORDER.filter(s => stageCount[s]).map(s => ({ stage: s, count: stageCount[s] })),
    ...Object.entries(stageCount)
        .filter(([s]) => !STAGE_ORDER.includes(s))
        .sort((a, b) => b[1] - a[1])
        .map(([s, c]) => ({ stage: s, count: c })),
  ];

  // Lead sources — same logic as dashboard src-tbody
  const srcMap = {};
  leads.forEach(r => {
    if (!srcMap[r.source]) srcMap[r.source] = { total: 0, inst: 0 };
    srcMap[r.source].total++;
    if (isInstalled(r.stage)) srcMap[r.source].inst++;
  });
  const sources = Object.entries(srcMap)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([src, v]) => ({
      source:    src,
      total:     v.total,
      inst:      v.inst,
      closeRate: v.total > 0 ? ((v.inst / v.total) * 100).toFixed(1) : '0.0',
    }));

  return { total, inst, notInt, lost, closeRate, breakdown, sources };
}

function filterRange(leads, from, to) {
  return leads.filter(r => r.created >= from && r.created <= to);
}

// ── Meta spend (ex-GST) ───────────────────────────────────────

async function fetchMetaSpend(since, until) {
  const token = process.env.META_TOKEN || '';
  if (!token) return 0;
  try {
    const url = `https://graph.facebook.com/v19.0/${SMOKE_ACCOUNT}/insights`
      + `?fields=spend`
      + `&time_range={"since":"${since}","until":"${until}"}`
      + `&time_increment=1`
      + `&access_token=${token}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.error) { console.error('Meta error:', json.error.message); return 0; }
    const raw = (json.data || []).reduce((s, d) => s + parseFloat(d.spend || 0), 0);
    return raw / 1.1; // Meta API is inc-GST → ex-GST (matches dashboard ÷1.1 logic)
  } catch(e) { console.error('Meta fetch error:', e.message); return 0; }
}

// ── Email HTML ────────────────────────────────────────────────

function fmt$(n)  { return `$${n.toFixed(2)}`; }
function fmtPct(n){ return `${n}%`; }

function chip(text, bg, color) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;
    font-size:11px;font-weight:700;background:${bg};color:${color};">${text}</span>`;
}

function deltaChip(curr, prior, invertColor = false, isCurrency = false, isPct = false) {
  if (prior === null || prior === undefined) return '';
  const diff = curr - prior;
  if (diff === 0) return chip('→ same', '#f0f2f5', '#94a3b8');
  const up    = diff > 0;
  const good  = invertColor ? !up : up;
  const bg    = good ? '#eaf7f2' : '#fdf0f0';
  const color = good ? '#18a96e' : '#e04f4f';
  const arrow = up ? '↑' : '↓';
  const abs   = Math.abs(diff);
  const label = isCurrency ? `$${abs.toFixed(2)}` : isPct ? `${abs.toFixed(1)}pp` : `${abs}`;
  return chip(`${arrow} ${label}`, bg, color);
}

function buildEmail({ today, last7, prior7, dailyRows, allSmokeOpps, metaToday, metaLast7, dateStr }) {
  const todayKPIs  = calcKPIs(filterRange(allSmokeOpps, today.from, today.to));
  const last7KPIs  = calcKPIs(filterRange(allSmokeOpps, last7.from, last7.to));
  const prior7KPIs = calcKPIs(filterRange(allSmokeOpps, prior7.from, prior7.to));

  const todayCPL  = todayKPIs.total  > 0 ? metaToday  / todayKPIs.total  : null;
  const last7CPL  = last7KPIs.total  > 0 ? metaLast7  / last7KPIs.total  : null;
  const prior7CPL = prior7KPIs.total > 0 ? (metaLast7) / prior7KPIs.total : null; // approx

  // Per-day rows for the 7-day table
  const dayTableRows = dailyRows.map((day, i) => {
    const leads = filterRange(allSmokeOpps, day, day);
    const kpi   = calcKPIs(leads);
    const isToday = i === 0;
    const label = isToday
      ? `<strong>Today</strong>`
      : new Date(day + 'T00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const rowBg = isToday ? '#f0f4ff' : (i % 2 === 0 ? '#ffffff' : '#fafbfc');
    return `
      <tr style="background:${rowBg};">
        <td style="padding:8px 10px;font-size:12px;color:${isToday ? '#2d6be4' : '#141c2e'};
                   border-bottom:1px solid #f0f2f5;white-space:nowrap;">${label}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:${isToday ? '700' : '400'};
                   color:#2d6be4;text-align:center;border-bottom:1px solid #f0f2f5;">${kpi.total}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:${isToday ? '700' : '400'};
                   color:#18a96e;text-align:center;border-bottom:1px solid #f0f2f5;">${kpi.inst}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:${isToday ? '700' : '400'};
                   color:#141c2e;text-align:center;border-bottom:1px solid #f0f2f5;">${fmtPct(kpi.closeRate)}</td>
        <td style="padding:8px 10px;font-size:12px;font-weight:${isToday ? '700' : '400'};
                   color:#e04f4f;text-align:center;border-bottom:1px solid #f0f2f5;">${kpi.notInt}</td>
      </tr>`;
  }).join('');

  // Stage breakdown for today
  const stageRows = todayKPIs.breakdown.map(({ stage, count }) => {
    const color   = STAGE_COLORS[stage] || '#94a3b8';
    const pct     = todayKPIs.total > 0 ? ((count / todayKPIs.total) * 100).toFixed(1) : '0';
    const barW    = Math.round((count / Math.max(todayKPIs.total, 1)) * 100);
    const display = stage === 'Won/Installed' ? 'Installed'
                  : stage === 'Qualified/IHA Complete' ? 'Qualified' : stage;
    return `
      <tr>
        <td style="padding:6px 10px;font-size:11px;color:#141c2e;border-bottom:1px solid #f5f6f8;width:38%;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;
                       background:${color};margin-right:6px;vertical-align:middle;"></span>${display}
        </td>
        <td style="padding:6px 10px;font-size:11px;font-weight:700;color:#141c2e;
                   text-align:right;border-bottom:1px solid #f5f6f8;font-family:monospace;width:10%;">${count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f5f6f8;width:42%;">
          <div style="background:#f0f2f5;border-radius:4px;height:6px;">
            <div style="width:${barW}%;height:100%;background:${color};border-radius:4px;"></div>
          </div>
        </td>
        <td style="padding:6px 10px;font-size:11px;color:#94a3b8;text-align:right;
                   border-bottom:1px solid #f5f6f8;width:10%;">${pct}%</td>
      </tr>`;
  }).join('');

  // Lead sources for today
  const sourceRows = todayKPIs.sources.map(({ source, total, inst, closeRate }, i) => {
    const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
    return `
      <tr style="background:${i % 2 === 0 ? '#ffffff' : '#fafbfc'};">
        <td style="padding:7px 10px;font-size:11px;color:#141c2e;border-bottom:1px solid #f5f6f8;">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;
                       background:${color};margin-right:6px;vertical-align:middle;"></span>${source}
        </td>
        <td style="padding:7px 10px;font-size:11px;font-weight:700;color:#2d6be4;
                   text-align:center;border-bottom:1px solid #f5f6f8;">${total}</td>
        <td style="padding:7px 10px;font-size:11px;font-weight:700;color:#18a96e;
                   text-align:center;border-bottom:1px solid #f5f6f8;">${inst}</td>
        <td style="padding:7px 10px;font-size:11px;color:#141c2e;
                   text-align:center;border-bottom:1px solid #f5f6f8;">${closeRate}%</td>
      </tr>`;
  }).join('') || `<tr><td colspan="4" style="padding:12px;font-size:12px;color:#94a3b8;text-align:center;">No leads today</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8;
             font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="max-width:600px;margin:28px auto 40px;">

  <!-- ── HEADER ── -->
  <div style="background:#141c2e;border-radius:16px 16px 0 0;padding:24px 32px;">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:10px;font-weight:600;color:#6b7899;text-transform:uppercase;
                    letter-spacing:1.2px;margin-bottom:6px;">Goldsure Pty Ltd</div>
        <div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
          🔥 Smoke Alarms — Daily Report
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:5px;">${dateStr}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;margin-top:4px;">
        <div style="width:9px;height:9px;border-radius:50%;background:#18a96e;
                    box-shadow:0 0 0 3px rgba(24,169,110,0.25);margin:0 0 6px auto;"></div>
        <div style="font-size:10px;color:#6b7899;">Live · GHL + Meta</div>
      </div>
    </div>
  </div>

  <div style="background:#ffffff;border-radius:0 0 16px 16px;
              box-shadow:0 2px 16px rgba(0,0,0,0.09);overflow:hidden;">

    <!-- ── TODAY SNAPSHOT ── -->
    <div style="padding:24px 32px 0;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                  letter-spacing:0.8px;margin-bottom:14px;">Today's Snapshot</div>

      <!-- 4 KPI tiles -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <!-- Total Leads -->
          <td style="width:25%;padding:0 6px 0 0;vertical-align:top;">
            <div style="background:#f0f4ff;border-radius:10px;padding:14px 16px;">
              <div style="font-size:9px;font-weight:700;color:#2d6be4;text-transform:uppercase;
                          letter-spacing:0.6px;margin-bottom:6px;">Total Leads</div>
              <div style="font-size:26px;font-weight:700;color:#2d6be4;line-height:1;
                          font-family:monospace;">${todayKPIs.total}</div>
              <div style="margin-top:6px;">
                ${deltaChip(todayKPIs.total, last7KPIs.total > 0 ? Math.round(metaLast7 > 0 ? last7KPIs.total / 7 : 0) : null)}
              </div>
            </div>
          </td>
          <!-- Installed -->
          <td style="width:25%;padding:0 6px;vertical-align:top;">
            <div style="background:#eaf7f2;border-radius:10px;padding:14px 16px;">
              <div style="font-size:9px;font-weight:700;color:#18a96e;text-transform:uppercase;
                          letter-spacing:0.6px;margin-bottom:6px;">Installed</div>
              <div style="font-size:26px;font-weight:700;color:#18a96e;line-height:1;
                          font-family:monospace;">${todayKPIs.inst}</div>
              <div style="font-size:11px;color:#18a96e;margin-top:6px;">${fmtPct(todayKPIs.closeRate)} close</div>
            </div>
          </td>
          <!-- Not Interested -->
          <td style="width:25%;padding:0 6px;vertical-align:top;">
            <div style="background:#fdf0f0;border-radius:10px;padding:14px 16px;">
              <div style="font-size:9px;font-weight:700;color:#e04f4f;text-transform:uppercase;
                          letter-spacing:0.6px;margin-bottom:6px;">Not Interested</div>
              <div style="font-size:26px;font-weight:700;color:#e04f4f;line-height:1;
                          font-family:monospace;">${todayKPIs.notInt}</div>
              <div style="font-size:11px;color:#e04f4f;margin-top:6px;">
                ${todayKPIs.total > 0 ? ((todayKPIs.notInt / todayKPIs.total) * 100).toFixed(1) : '0'}% of total
              </div>
            </div>
          </td>
          <!-- Meta Spend -->
          <td style="width:25%;padding:0 0 0 6px;vertical-align:top;">
            <div style="background:#f5f6f8;border-radius:10px;padding:14px 16px;">
              <div style="font-size:9px;font-weight:700;color:#6b7899;text-transform:uppercase;
                          letter-spacing:0.6px;margin-bottom:6px;">Meta Spend</div>
              <div style="font-size:22px;font-weight:700;color:#141c2e;line-height:1;
                          font-family:monospace;">${fmt$(metaToday)}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:6px;">ex-GST</div>
            </div>
          </td>
        </tr>
      </table>

      <!-- CPL row -->
      ${todayCPL !== null ? `
      <div style="background:#fef7e7;border-radius:8px;padding:10px 16px;
                  display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <span style="font-size:12px;color:#b8860b;font-weight:600;">Cost Per Lead (CPL) today</span>
        <span style="font-size:16px;font-weight:700;color:#b8860b;font-family:monospace;">${fmt$(todayCPL)}</span>
      </div>` : ''}
    </div>

    <!-- ── 7-DAY TABLE ── -->
    <div style="padding:0 32px 24px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                  letter-spacing:0.8px;margin-bottom:10px;">Last 7 Days</div>

      <!-- 7d summary chips vs prior 7d -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
        <div style="background:#f0f4ff;border-radius:8px;padding:8px 14px;flex:1;min-width:120px;">
          <div style="font-size:9px;font-weight:600;color:#2d6be4;text-transform:uppercase;margin-bottom:3px;">Leads (7d)</div>
          <div style="font-size:18px;font-weight:700;color:#2d6be4;font-family:monospace;">${last7KPIs.total}</div>
          <div style="margin-top:4px;">${deltaChip(last7KPIs.total, prior7KPIs.total, false)}</div>
        </div>
        <div style="background:#eaf7f2;border-radius:8px;padding:8px 14px;flex:1;min-width:120px;">
          <div style="font-size:9px;font-weight:600;color:#18a96e;text-transform:uppercase;margin-bottom:3px;">Installed (7d)</div>
          <div style="font-size:18px;font-weight:700;color:#18a96e;font-family:monospace;">${last7KPIs.inst}</div>
          <div style="margin-top:4px;">${deltaChip(last7KPIs.inst, prior7KPIs.inst, false)}</div>
        </div>
        <div style="background:#f5f6f8;border-radius:8px;padding:8px 14px;flex:1;min-width:120px;">
          <div style="font-size:9px;font-weight:600;color:#6b7899;text-transform:uppercase;margin-bottom:3px;">Meta Spend (7d)</div>
          <div style="font-size:18px;font-weight:700;color:#141c2e;font-family:monospace;">${fmt$(metaLast7)}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:4px;">ex-GST</div>
        </div>
        <div style="background:#fef7e7;border-radius:8px;padding:8px 14px;flex:1;min-width:120px;">
          <div style="font-size:9px;font-weight:600;color:#b8860b;text-transform:uppercase;margin-bottom:3px;">CPL (7d)</div>
          <div style="font-size:18px;font-weight:700;color:#b8860b;font-family:monospace;">
            ${last7CPL !== null ? fmt$(last7CPL) : '—'}
          </div>
          <div style="margin-top:4px;">${last7CPL !== null && prior7CPL !== null ? deltaChip(last7CPL, prior7CPL, true, true) : ''}</div>
        </div>
      </div>

      <!-- Day-by-day table -->
      <table style="width:100%;border-collapse:collapse;border-radius:8px;overflow:hidden;
                    border:1px solid #e3e7ef;">
        <thead>
          <tr style="background:#f5f6f8;">
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:left;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Day</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#2d6be4;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Leads</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#18a96e;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Installed</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Close %</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#e04f4f;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Not Int.</th>
          </tr>
        </thead>
        <tbody>
          ${dayTableRows}
          <!-- Totals row -->
          <tr style="background:#f5f6f8;">
            <td style="padding:9px 10px;font-size:12px;font-weight:700;color:#141c2e;border-top:2px solid #e3e7ef;">7-day total</td>
            <td style="padding:9px 10px;font-size:12px;font-weight:700;color:#2d6be4;text-align:center;border-top:2px solid #e3e7ef;">${last7KPIs.total}</td>
            <td style="padding:9px 10px;font-size:12px;font-weight:700;color:#18a96e;text-align:center;border-top:2px solid #e3e7ef;">${last7KPIs.inst}</td>
            <td style="padding:9px 10px;font-size:12px;font-weight:700;color:#141c2e;text-align:center;border-top:2px solid #e3e7ef;">${fmtPct(last7KPIs.closeRate)}</td>
            <td style="padding:9px 10px;font-size:12px;font-weight:700;color:#e04f4f;text-align:center;border-top:2px solid #e3e7ef;">${last7KPIs.notInt}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── STAGE BREAKDOWN (today) ── -->
    ${stageRows ? `
    <div style="padding:0 32px 24px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                  letter-spacing:0.8px;margin-bottom:10px;">Stage Breakdown — Today</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e3e7ef;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f5f6f8;">
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:left;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Stage</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:right;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">#</th>
            <th style="padding:8px 10px;border-bottom:1px solid #e3e7ef;" colspan="2"></th>
          </tr>
        </thead>
        <tbody>${stageRows}</tbody>
      </table>
    </div>` : ''}

    <!-- ── LEAD SOURCES (today) ── -->
    <div style="padding:0 32px 24px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;
                  letter-spacing:0.8px;margin-bottom:10px;">Lead Sources — Today</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e3e7ef;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f5f6f8;">
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:left;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Source</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#2d6be4;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Leads</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#18a96e;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Installed</th>
            <th style="padding:8px 10px;font-size:10px;font-weight:700;color:#6b7899;
                       text-align:center;text-transform:uppercase;border-bottom:1px solid #e3e7ef;">Close %</th>
          </tr>
        </thead>
        <tbody>${sourceRows}</tbody>
      </table>
    </div>

    <!-- ── CTA ── -->
    <div style="padding:4px 32px 28px;text-align:center;">
      <a href="https://vigneshkcom.github.io/Goldsure/Ads%20reporting/Meta%20Ad%20Performance.html"
         style="display:inline-block;padding:13px 36px;background:#2d6be4;color:#ffffff;
                border-radius:9px;text-decoration:none;font-size:13px;font-weight:700;">
        Open Full Dashboard →
      </a>
    </div>

    <!-- ── FOOTER ── -->
    <div style="background:#f5f6f8;padding:14px 32px;text-align:center;font-size:11px;
                color:#94a3b8;border-top:1px solid #e3e7ef;line-height:1.7;">
      Goldsure Pty Ltd · Suite 4, Level 1, 293 High Street, Preston VIC 3072<br>
      Auto-generated · ${dateStr}
    </div>

  </div><!-- /white card -->
</div><!-- /600px wrapper -->
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resendKey  = process.env.RESEND_API_KEY || '';
  const recipients = (process.env.REPORT_RECIPIENTS || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  if (!resendKey)              return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!recipients.length)      return res.status(500).json({ error: 'REPORT_RECIPIENTS not set' });
  if (!process.env.GHL_API_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const today   = new Date();
    const ranges  = buildRanges(today);
    const dailyRows = buildDailyRows(today);

    const dateStr = today.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    // Fetch GHL (smoke pipeline only, same logic as dashboard)
    const allSmokeOpps = await loadSmokeOpportunities();

    // Fetch Meta spend in parallel
    const [metaToday, metaLast7] = await Promise.all([
      fetchMetaSpend(ranges.today.from, ranges.today.to),
      fetchMetaSpend(ranges.last7.from, ranges.last7.to),
    ]);

    const html = buildEmail({
      today:        ranges.today,
      last7:        ranges.last7,
      prior7:       ranges.prior7,
      dailyRows,
      allSmokeOpps,
      metaToday,
      metaLast7,
      dateStr,
    });

    const todayStr = ranges.today.from;
    const subject  = `🔥 Smoke Alarms — ${todayStr}`;

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'Goldsure Reports <reports@goldsure.com.au>',
        to:      recipients,
        subject,
        html,
      }),
    });

    const emailData = await emailResp.json();
    if (!emailResp.ok) return res.status(500).json({ error: 'Resend failed', detail: emailData });

    const todayKPIs = calcKPIs(filterRange(allSmokeOpps, ranges.today.from, ranges.today.to));
    const last7KPIs = calcKPIs(filterRange(allSmokeOpps, ranges.last7.from, ranges.last7.to));

    return res.status(200).json({
      ok:        true,
      sent_to:   recipients,
      date:      todayStr,
      today:     { ...todayKPIs, metaSpend: metaToday },
      last7:     { ...last7KPIs, metaSpend: metaLast7 },
      ghl_total: allSmokeOpps.length,
    });

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
