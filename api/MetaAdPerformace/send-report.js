// api/send-report.js
// Goldsure — Smoke Alarms Daily Report
//
// Cron: "30 6 * * *" -> 06:30 UTC = 4:30 PM AEDT (UTC+10)
//
// Required Vercel Environment Variables:
//   RESEND_API_KEY, GHL_API_KEY, META_TOKEN, REPORT_RECIPIENTS, CRON_SECRET

const GHL_LOCATION_ID = '11epCbQAg9B4rQt5yHjw';
const SMOKE_ACCOUNT   = 'act_1420815159464502';

// Stage classification (matches dashboard renderSmoke exactly)
const isInstalled     = s => /install|won/i.test(s);
const isNotInterested = s => /not.?interest|spam/i.test(s);
const isLost          = s => isNotInterested(s) || s === 'Not Reachable' || s === 'Out of Area' || s === 'Quote Not Accepted (Lost)';

const STAGE_ORDER = [
  'Not Interested/Spam','Not Reachable','Out of Area','Quote Not Accepted (Lost)',
  'Won/Installed','Installed','IHA Booked','Qualified/IHA Complete',
  'Quote Sent','Follow-Up','Follow Up','Shopping Around','New Lead','Today',
];

// Date helpers
const isoDate = d => d.toISOString().slice(0, 10);

function buildRanges(today) {
  const todayStr = isoDate(today);
  const w7start  = new Date(today); w7start.setDate(today.getDate() - 6);
  const p7end    = new Date(today); p7end.setDate(today.getDate() - 7);
  const p7start  = new Date(today); p7start.setDate(today.getDate() - 13);
  return {
    today:  { from: todayStr,         to: todayStr },
    last7:  { from: isoDate(w7start), to: todayStr },
    prior7: { from: isoDate(p7start), to: isoDate(p7end) },
  };
}

function buildDailyDates(today) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() - i); return isoDate(d);
  });
}

// GHL
async function ghlFetch(path) {
  const resp = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: { 'Authorization': `Bearer ${process.env.GHL_API_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' },
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.message || `GHL ${resp.status}`);
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
    startAfter = json.meta?.startAfter; startAfterId = json.meta?.startAfterId;
    if (!startAfter || page > 50) break;
  }
  return all;
}

// ── Source categorisation (mirrors dashboard logic) ──
function categoriseSource(rawSource, attr) {
  if (attr) {
    const { type, medium, utmSource, referrer, gclid } = attr;
    if (utmSource === 'adwords' || utmSource.includes('google_ads') || gclid ||
        type === 'paid search' || medium === 'paid search' ||
        (utmSource && referrer.includes('google.com'))) return 'Google';
    if (utmSource === 'fb_ad' || utmSource === 'facebook' || utmSource === 'instagram' ||
        type === 'paid social' || medium === 'paid social') return 'Meta';
    const social = ['facebook.com','instagram.com','linkedin.com','twitter.com','tiktok.com'];
    if (social.some(d => referrer.includes(d))) return 'Organic Social';
    const search = ['google.com','bing.com','yahoo.com','duckduckgo.com'];
    if (search.some(d => referrer.includes(d))) return 'Organic Search';
    if (type === 'direct traffic' || type === 'direct') return 'Direct';
    if (type === 'referral') return 'Referral';
  }
  const raw = (attr?.contactSource || rawSource || '').toLowerCase().trim();
  if (!raw || raw === 'unknown') return 'Unknown';
  if (raw === 'paid search' || raw.includes('adword') || raw.includes('google ads')) return 'Google';
  if (raw.includes('google')) return 'Google';
  if (raw === 'paid social' || raw === 'fb_ad' || raw.includes('facebook') ||
      raw.includes('fb') || raw.includes('meta') || raw.includes('instagram')) return 'Meta';
  if (raw === 'organic search') return 'Organic Search';
  if (raw === 'organic social' || raw === 'social media') return 'Organic Social';
  if (raw === 'direct traffic' || raw === 'direct') return 'Direct';
  if (raw === 'referral') return 'Referral';
  if (raw === 'landing page') return 'Landing Page';
  return rawSource || 'Unknown';
}

async function fetchContactAttributionBatch(contactIds) {
  const map = {};
  const BATCH = 10;
  for (let i = 0; i < contactIds.length; i += BATCH) {
    const batch = contactIds.slice(i, i + BATCH);
    await Promise.all(batch.map(async (cid) => {
      try {
        const json = await ghlFetch(`/contacts/${cid}`);
        const c = json.contact || json;
        const attrFirst  = c.attributionSource || c.firstAttributionSource || {};
        const attrLatest = c.lastAttributionSource || c.latestAttributionSource || attrFirst;
        const parse = (a) => ({
          type:          (a.type        || '').toLowerCase(),
          medium:        (a.medium      || '').toLowerCase(),
          utmSource:     (a.utmSource   || a.utm_source   || '').toLowerCase(),
          referrer:      (a.referrer    || a.url          || '').toLowerCase(),
          gclid:         !!(a.gclid || a.wbraid || a.gbraid),
          contactSource: (c.source      || '').toLowerCase(),
        });
        map[cid] = { first: parse(attrFirst), latest: parse(attrLatest) };
      } catch(e) { map[cid] = null; }
    }));
  }
  return map;
}

function mapOpp(opp, contactAttrMap) {
  const contactId = opp.contactId || opp.contact?.id || '';
  const cData     = contactAttrMap ? (contactAttrMap[contactId] || null) : null;
  return {
    stage:      (opp.pipelineStage?.name || opp.status || 'Unknown').trim(),
    stageId:    (opp.pipelineStageId || opp.pipelineStage?.id || '').trim(),
    source:     categoriseSource(opp.source, cData?.first  || null),
    latestSrc:  categoriseSource(opp.source, cData?.latest || null),
    pipeline:   (opp.pipeline?.name || opp.pipelineName || '').trim(),
    pipelineId: (opp.pipelineId || opp.pipeline?.id || '').trim(),
    created:    opp.createdAt ? opp.createdAt.slice(0, 10) : '',
  };
}

async function loadSmokeOpportunities() {
  let smokePipelineId = '', pipelines = [];
  try {
    const pipeJson = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`);
    pipelines = (pipeJson.pipelines || []).map(p => ({
      id: p.id, name: p.name, stages: (p.stages || []).map(s => ({ id: s.id, name: s.name }))
    }));
    const smokePipe = pipelines.find(p => /smoke/i.test(p.name));
    if (smokePipe) smokePipelineId = smokePipe.id;
  } catch(e) { console.error('Pipeline fetch failed:', e.message); }

  const rawOpps    = await fetchAllOpportunities();
  const contactIds = [...new Set(rawOpps.map(o => o.contactId || o.contact?.id).filter(Boolean))];
  let contactAttrMap = {};
  try { contactAttrMap = await fetchContactAttributionBatch(contactIds); }
  catch(e) { console.warn('Attribution batch failed:', e.message); }
  const mapped = rawOpps.map(o => mapOpp(o, contactAttrMap)).filter(r => r.created);

  const stageNameMap = {};
  pipelines.forEach(p => p.stages.forEach(s => { stageNameMap[s.id] = s.name; }));
  mapped.forEach(r => { if (r.stageId && stageNameMap[r.stageId]) r.stage = stageNameMap[r.stageId]; });

  return smokePipelineId
    ? mapped.filter(r => r.pipelineId === smokePipelineId)
    : mapped.filter(r => !/hws|hot.?water|sales/i.test(r.pipeline));
}

// KPI calculation
const filterRange = (leads, from, to) => leads.filter(r => r.created >= from && r.created <= to);

function calcKPIs(leads) {
  const total     = leads.length;
  const inst      = leads.filter(r => isInstalled(r.stage)).length;
  const notInt    = leads.filter(r => isNotInterested(r.stage)).length;
  const closeRate = total > 0 ? ((inst / total) * 100).toFixed(1) : '0.0';

  const stageCount = {};
  leads.forEach(r => stageCount[r.stage] = (stageCount[r.stage] || 0) + 1);
  const breakdown = [
    ...STAGE_ORDER.filter(s => stageCount[s]).map(s => ({ stage: s, count: stageCount[s] })),
    ...Object.entries(stageCount).filter(([s]) => !STAGE_ORDER.includes(s)).sort((a,b) => b[1]-a[1]).map(([s,c]) => ({ stage: s, count: c })),
  ];

  const srcMap = {};
  leads.forEach(r => {
    if (!srcMap[r.source]) srcMap[r.source] = { total: 0, inst: 0 };
    srcMap[r.source].total++;
    if (isInstalled(r.stage)) srcMap[r.source].inst++;
  });
  const sources = Object.entries(srcMap).sort((a,b) => b[1].total - a[1].total).map(([src, v]) => ({
    source: src, total: v.total, inst: v.inst,
    closeRate: v.total > 0 ? ((v.inst / v.total) * 100).toFixed(1) : '0.0',
  }));

  // Journey paths: group by first-touch platform with sub-paths
  const PLATFORM_ORDER = ['Meta', 'Google', 'Organic Social', 'Direct', 'Referral', 'Unknown'];
  const getPlatform = src => {
    if (!src || src === 'Unknown') return 'Unknown';
    if (src === 'Meta'           || src.startsWith('Meta'))    return 'Meta';
    if (src === 'Google'         || src.startsWith('Google'))  return 'Google';
    if (src === 'Organic Social' || src.startsWith('Organic')) return 'Organic Social';
    if (src === 'Direct')   return 'Direct';
    if (src === 'Referral') return 'Referral';
    return 'Unknown';
  };
  const pathData = {};
  leads.forEach(r => {
    const first    = r.source    || 'Unknown';
    const latest   = r.latestSrc || r.source || 'Unknown';
    const platform = getPlatform(first);
    const pathLabel = (first === latest || !r.latestSrc) ? first : `${first} → ${latest}`;
    if (!pathData[platform]) pathData[platform] = { t:0, i:0, paths:{} };
    pathData[platform].t++;
    if (isInstalled(r.stage)) pathData[platform].i++;
    if (!pathData[platform].paths[pathLabel]) pathData[platform].paths[pathLabel] = { t:0, i:0 };
    pathData[platform].paths[pathLabel].t++;
    if (isInstalled(r.stage)) pathData[platform].paths[pathLabel].i++;
  });
  const journeyPaths = PLATFORM_ORDER
    .filter(p => pathData[p])
    .map(p => ({ platform: p, ...pathData[p], subPaths: Object.entries(pathData[p].paths).sort((a,b)=>b[1].t-a[1].t) }));

  return { total, inst, notInt, closeRate, breakdown, sources, journeyPaths };
}

// Meta spend (ex-GST)
async function fetchMetaSpend(since, until) {
  const token = process.env.META_TOKEN || '';
  if (!token) return 0;
  try {
    const url = `https://graph.facebook.com/v19.0/${SMOKE_ACCOUNT}/insights?fields=spend&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${token}`;
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.error) return 0;
    const raw = (json.data || []).reduce((s, d) => s + parseFloat(d.spend || 0), 0);
    return raw / 1.1;
  } catch(e) { return 0; }
}

// Email HTML — Outlook-safe: tables only, all inline styles, no flexbox or CSS grid
const fmt$   = n => `$${n.toFixed(2)}`;
const fmtPct = n => `${n}%`;

function trendText(curr, prior, invert = false) {
  if (prior === null || prior === undefined) return '';
  const diff = curr - prior;
  if (diff === 0) return '<span style="color:#94a3b8;">No change</span>';
  const up    = diff > 0;
  const good  = invert ? !up : up;
  const color = good ? '#15803d' : '#b91c1c';
  const arrow = up ? '&#8593;' : '&#8595;';
  return `<span style="color:${color};">${arrow} ${Math.abs(diff)} vs prior 7d</span>`;
}

function buildEmail({ today, last7, prior7, dailyDates, allOpps, metaToday, metaLast7, dateStr }) {
  const todayKPIs  = calcKPIs(filterRange(allOpps, today.from,  today.to));
  const last7KPIs  = calcKPIs(filterRange(allOpps, last7.from,  last7.to));
  const prior7KPIs = calcKPIs(filterRange(allOpps, prior7.from, prior7.to));

  const todayCPL = todayKPIs.total > 0 ? metaToday / todayKPIs.total : null;
  const last7CPL = last7KPIs.total > 0 ? metaLast7 / last7KPIs.total : null;
  const p7CPL    = prior7KPIs.total > 0 ? metaLast7 / prior7KPIs.total : null;

  // Day-by-day rows
  const dayRows = dailyDates.map((day, i) => {
    const kpi     = calcKPIs(filterRange(allOpps, day, day));
    const isToday = i === 0;
    const label   = isToday ? 'Today'
      : new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const rowBg      = isToday ? '#eff6ff' : (i % 2 === 0 ? '#ffffff' : '#f9fafb');
    const fw         = isToday ? 'bold' : 'normal';
    const labelColor = isToday ? '#1d4ed8' : '#374151';
    return `
      <tr>
        <td style="padding:10px 14px;font-size:13px;font-weight:${fw};color:${labelColor};background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${label}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:${fw};color:#1d4ed8;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${kpi.total}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:${fw};color:#15803d;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${kpi.inst}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:${fw};color:#374151;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${fmtPct(kpi.closeRate)}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:${fw};color:#b91c1c;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${kpi.notInt}</td>
      </tr>`;
  }).join('');

  // Stage rows
  const stageRows = todayKPIs.breakdown.length > 0
    ? todayKPIs.breakdown.map(({ stage, count }, i) => {
        const display = stage === 'Won/Installed' ? 'Installed' : stage === 'Qualified/IHA Complete' ? 'Qualified' : stage;
        const pct     = todayKPIs.total > 0 ? ((count / todayKPIs.total) * 100).toFixed(1) : '0';
        const rowBg   = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        return `
          <tr>
            <td style="padding:9px 14px;font-size:12px;color:#374151;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${display}</td>
            <td style="padding:9px 14px;font-size:12px;font-weight:bold;color:#111827;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${count}</td>
            <td style="padding:9px 14px;font-size:12px;color:#6b7280;text-align:right;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${pct}%</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:14px;font-size:12px;color:#9ca3af;text-align:center;background-color:#ffffff;">No leads recorded today</td></tr>`;

  // Source rows (kept for reference but replaced by journeyRows in email)
  const sourceRows = todayKPIs.sources.length > 0
    ? todayKPIs.sources.map(({ source, total, inst, closeRate }, i) => {
        const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
        return `
          <tr>
            <td style="padding:9px 14px;font-size:12px;color:#374151;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${source}</td>
            <td style="padding:9px 14px;font-size:12px;font-weight:bold;color:#1d4ed8;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${total}</td>
            <td style="padding:9px 14px;font-size:12px;font-weight:bold;color:#15803d;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${inst}</td>
            <td style="padding:9px 14px;font-size:12px;color:#374151;text-align:center;background-color:${rowBg};border-bottom:1px solid #e5e7eb;">${closeRate}%</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="4" style="padding:14px;font-size:12px;color:#9ca3af;text-align:center;background-color:#ffffff;">No leads recorded today</td></tr>`;

  // Journey Paths rows — grouped by platform with sub-paths (7-day data)
  const PLATFORM_COLORS_EMAIL = {
    'Meta':           '#1d4ed8',
    'Google':         '#15803d',
    'Organic Social': '#92400e',
    'Direct':         '#6d28d9',
    'Referral':       '#0e7490',
    'Unknown':        '#64748b',
  };
  const journeyRows = last7KPIs.journeyPaths.length > 0
    ? last7KPIs.journeyPaths.map(({ platform, t, i, subPaths }) => {
        const col     = PLATFORM_COLORS_EMAIL[platform] || '#64748b';
        const pPct    = t > 0 ? ((i / t) * 100).toFixed(1) : '0.0';
        const pctColor = parseFloat(pPct) >= 30 ? '#15803d' : parseFloat(pPct) >= 15 ? '#92400e' : '#64748b';
        const hasMulti = subPaths.length > 1;

        const subRows = hasMulti ? subPaths.map(([label, sv]) => {
          const sPct = sv.t > 0 ? ((sv.i / sv.t) * 100).toFixed(1) : '0.0';
          return `<tr bgcolor="#ffffff">
            <td style="padding:7px 14px 7px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;border-bottom:1px solid #f1f5f9;">&#8627; ${label}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-align:center;border-bottom:1px solid #f1f5f9;">${sv.t}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#15803d;text-align:center;border-bottom:1px solid #f1f5f9;">${sv.i}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6b7280;text-align:center;border-bottom:1px solid #f1f5f9;">${sPct}%</td>
          </tr>`;
        }).join('') : '';

        const totalLabel = hasMulti ? `Total ${platform}` : platform;
        const totalBg    = hasMulti ? '#f8fafc' : '#ffffff';
        const totalRow   = `<tr bgcolor="${totalBg}" style="${hasMulti ? 'border-top:1px solid #e2e8f0;' : ''}">
          <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${col};border-bottom:1px solid #e2e8f0;">&#9632; ${totalLabel}</td>
          <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#1d4ed8;text-align:center;border-bottom:1px solid #e2e8f0;">${t}</td>
          <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#15803d;text-align:center;border-bottom:1px solid #e2e8f0;">${i}</td>
          <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${pctColor};text-align:center;border-bottom:1px solid #e2e8f0;">${pPct}%</td>
        </tr>`;

        return subRows + totalRow;
      }).join('')
    : `<tr><td colspan="4" style="padding:14px;font-size:12px;color:#9ca3af;text-align:center;background-color:#ffffff;">No attribution data available</td></tr>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Goldsure Daily Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">

        <!-- HEADER -->
        <tr>
          <td bgcolor="#0f172a" style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:28px 32px 28px 32px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td>
                        <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:2px;">Goldsure Pty Ltd</p>
                        <p style="margin:0 0 7px 0;font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:bold;color:#ffffff;">Smoke Alarms &mdash; Daily Report</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;">${dateStr}</p>
                      </td>
                      <td align="right" valign="middle">
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#64748b;">GHL + Meta</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SECTION: TODAY -->
        <tr>
          <td bgcolor="#f8fafc" style="padding:14px 32px;border-top:3px solid #1d4ed8;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;">Today's Snapshot</p>
          </td>
        </tr>

        <!-- KPI TILES ROW -->
        <tr>
          <td style="padding:20px 32px 16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eff6ff">
                    <tr>
                      <td style="padding:16px;">
                        <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;">Total Leads</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:bold;color:#1d4ed8;line-height:1;">${todayKPIs.total}</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0fdf4">
                    <tr>
                      <td style="padding:16px;">
                        <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#15803d;text-transform:uppercase;letter-spacing:1px;">Installed</p>
                        <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:bold;color:#15803d;line-height:1;">${todayKPIs.inst}</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#16a34a;">${fmtPct(todayKPIs.closeRate)} close rate</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fef2f2">
                    <tr>
                      <td style="padding:16px;">
                        <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#b91c1c;text-transform:uppercase;letter-spacing:1px;">Not Interested</p>
                        <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:bold;color:#b91c1c;line-height:1;">${todayKPIs.notInt}</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#dc2626;">${todayKPIs.total > 0 ? ((todayKPIs.notInt / todayKPIs.total) * 100).toFixed(1) : '0'}% of total</p>
                      </td>
                    </tr>
                  </table>
                </td>
                <td width="25%" valign="top">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8fafc" style="border:1px solid #e2e8f0;">
                    <tr>
                      <td style="padding:16px;">
                        <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:1px;">Meta Spend</p>
                        <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;color:#0f172a;line-height:1;">${fmt$(metaToday)}</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;">ex-GST</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CPL TODAY -->
        ${todayCPL !== null ? `
        <tr>
          <td style="padding:0 32px 20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fefce8" style="border:1px solid #fde68a;">
              <tr>
                <td style="padding:12px 16px;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#92400e;">Cost Per Lead &mdash; Today</p>
                </td>
                <td align="right" style="padding:12px 16px;">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#92400e;">${fmt$(todayCPL)}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>` : ''}

        <!-- SECTION: LAST 7 DAYS -->
        <tr>
          <td bgcolor="#f8fafc" style="padding:14px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;">Last 7 Days</p>
          </td>
        </tr>

        <!-- 7D SUMMARY TILES -->
        <tr>
          <td style="padding:16px 32px 8px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eff6ff">
                    <tr><td style="padding:14px 16px;">
                      <p style="margin:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#1d4ed8;text-transform:uppercase;letter-spacing:1px;">Leads (7d)</p>
                      <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;color:#1d4ed8;line-height:1;">${last7KPIs.total}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;">${trendText(last7KPIs.total, prior7KPIs.total)}</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0fdf4">
                    <tr><td style="padding:14px 16px;">
                      <p style="margin:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#15803d;text-transform:uppercase;letter-spacing:1px;">Installed (7d)</p>
                      <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:24px;font-weight:bold;color:#15803d;line-height:1;">${last7KPIs.inst}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;">${trendText(last7KPIs.inst, prior7KPIs.inst)}</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:6px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8fafc" style="border:1px solid #e2e8f0;">
                    <tr><td style="padding:14px 16px;">
                      <p style="margin:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:1px;">Meta Spend (7d)</p>
                      <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#0f172a;line-height:1;">${fmt$(metaLast7)}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;">ex-GST</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fefce8" style="border:1px solid #fde68a;">
                    <tr><td style="padding:14px 16px;">
                      <p style="margin:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:#92400e;text-transform:uppercase;letter-spacing:1px;">Cost / Lead (7d)</p>
                      <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:#92400e;line-height:1;">${last7CPL !== null ? fmt$(last7CPL) : '&mdash;'}</p>
                      ${last7CPL !== null && p7CPL !== null ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${last7CPL <= p7CPL ? '#15803d' : '#b91c1c'};">${last7CPL <= p7CPL ? '&#8595;' : '&#8593;'} $${Math.abs(last7CPL - p7CPL).toFixed(2)} vs prior</p>` : '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;">7-day average</p>'}
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- DAY-BY-DAY TABLE -->
        <tr>
          <td style="padding:12px 32px 24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;">
              <tr bgcolor="#f1f5f9">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Day</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#1d4ed8;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Leads</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#15803d;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Installed</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Close %</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#b91c1c;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Not Int.</td>
              </tr>
              ${dayRows}
              <tr bgcolor="#f1f5f9">
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#0f172a;border-top:2px solid #cbd5e1;">7-Day Total</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1d4ed8;text-align:center;border-top:2px solid #cbd5e1;">${last7KPIs.total}</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#15803d;text-align:center;border-top:2px solid #cbd5e1;">${last7KPIs.inst}</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#0f172a;text-align:center;border-top:2px solid #cbd5e1;">${fmtPct(last7KPIs.closeRate)}</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#b91c1c;text-align:center;border-top:2px solid #cbd5e1;">${last7KPIs.notInt}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SECTION: STAGE BREAKDOWN -->
        <tr>
          <td bgcolor="#f8fafc" style="padding:14px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;">Stage Breakdown &mdash; Today</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;">
              <tr bgcolor="#f1f5f9">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Stage</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Count</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-align:right;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Share</td>
              </tr>
              ${stageRows}
            </table>
          </td>
        </tr>

        <!-- SECTION: LEAD SOURCES & JOURNEY PATHS -->
        <tr>
          <td bgcolor="#f8fafc" style="padding:14px 32px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;">Lead Sources &amp; Journey Paths &mdash; Last 7 Days</p>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 8px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;">
              <tr bgcolor="#f1f5f9">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;">Source / Path</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#1d4ed8;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;width:60px;">Leads</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#15803d;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;width:60px;">Closed</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#64748b;text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e2e8f0;width:65px;">Close %</td>
              </tr>
              ${journeyRows}
              <tr bgcolor="#0f172a">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;border-top:2px solid #334155;">All Sources</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#93c5fd;text-align:center;border-top:2px solid #334155;">${last7KPIs.total}</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#86efac;text-align:center;border-top:2px solid #334155;">${last7KPIs.inst}</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;text-align:center;border-top:2px solid #334155;">${last7KPIs.closeRate}%</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Journey Paths legend -->
        <tr>
          <td style="padding:6px 32px 24px 32px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#94a3b8;line-height:1.7;">
              <strong style="color:#64748b;">Path notation:</strong> "Meta &#8594; Google" = first clicked a Meta ad, then converted after a Google search.<br>
              <strong style="color:#64748b;">Organic Social:</strong> Clicked a non-paid Facebook/Instagram link (shared post, business page) — not from an ad.<br>
              <strong style="color:#64748b;">Unknown:</strong> No UTM tracking on the ad URL — platform cannot be identified.
            </p>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:8px 32px 32px 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="#1d4ed8" style="padding:13px 32px;">
                  <a href="https://vigneshkcom.github.io/Goldsure/Ads%20reporting/Meta%20Ad%20Performance.html"
                     style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;display:block;">
                    Open Full Dashboard
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td bgcolor="#f8fafc" style="padding:18px 32px;border-top:1px solid #e2e8f0;" align="center">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#94a3b8;line-height:1.8;">
              Goldsure Pty Ltd &nbsp;&bull;&nbsp; Suite 4, Level 1, 293 High Street, Preston VIC 3072<br>
              Auto-generated report &nbsp;&bull;&nbsp; ${dateStr}
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

// Handler
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || '';
  if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const resendKey  = process.env.RESEND_API_KEY || '';
  const recipients = (process.env.REPORT_RECIPIENTS || '').split(',').map(e => e.trim()).filter(Boolean);

  if (!resendKey)               return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!recipients.length)       return res.status(500).json({ error: 'REPORT_RECIPIENTS not set' });
  if (!process.env.GHL_API_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const today      = new Date();
    const ranges     = buildRanges(today);
    const dailyDates = buildDailyDates(today);
    const dateStr    = today.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const allOpps = await loadSmokeOpportunities();
    const [metaToday, metaLast7] = await Promise.all([
      fetchMetaSpend(ranges.today.from, ranges.today.to),
      fetchMetaSpend(ranges.last7.from, ranges.last7.to),
    ]);

    const html = buildEmail({ today: ranges.today, last7: ranges.last7, prior7: ranges.prior7, dailyDates, allOpps, metaToday, metaLast7, dateStr });

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Goldsure Reports <reports@goldsure.com.au>',
        to:      recipients,
        subject: `Smoke Alarms Daily Report — ${dateStr}`,
        html,
      }),
    });

    const emailData = await emailResp.json();
    if (!emailResp.ok) return res.status(500).json({ error: 'Resend failed', detail: emailData });

    return res.status(200).json({
      ok:      true,
      sent_to: recipients,
      date:    ranges.today.from,
      today:   { ...calcKPIs(filterRange(allOpps, ranges.today.from, ranges.today.to)), metaSpend: metaToday },
      last7:   { ...calcKPIs(filterRange(allOpps, ranges.last7.from, ranges.last7.to)),  metaSpend: metaLast7 },
    });

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
