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

// Google Ads spend (ex-GST) — uses same Vercel endpoint as dashboard
async function fetchGoogleSpend(since, until) {
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    const url = `${base}/api/MetaAdPerformace/google-spend?from=${since}&to=${until}`;
    const resp = await fetch(url, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
    });
    if (!resp.ok) return 0;
    const json = await resp.json();
    // Endpoint returns inc-GST; divide by 1.1 for ex-GST
    const raw = typeof json.totalSpend === 'number' ? json.totalSpend
              : typeof json.spend      === 'number' ? json.spend : 0;
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

function buildEmail({ today, last7, prior7, dailyDates, allOpps, metaToday, metaLast7, googleToday, googleLast7, dateStr }) {
  const todayKPIs  = calcKPIs(filterRange(allOpps, today.from,  today.to));
  const last7KPIs  = calcKPIs(filterRange(allOpps, last7.from,  last7.to));
  const prior7KPIs = calcKPIs(filterRange(allOpps, prior7.from, prior7.to));

  const totalSpendToday = metaToday + googleToday;
  const totalSpendLast7 = metaLast7 + googleLast7;

  const todayCPL  = todayKPIs.total > 0 && totalSpendToday > 0 ? totalSpendToday / todayKPIs.total : null;
  const last7CPL  = last7KPIs.total > 0 && totalSpendLast7 > 0 ? totalSpendLast7 / last7KPIs.total : null;
  const last7CPI  = last7KPIs.inst  > 0 && totalSpendLast7 > 0 ? totalSpendLast7 / last7KPIs.inst  : null;
  const noLeadsToday = todayKPIs.total === 0;

  // ── Colours from Goldsure design language ──
  const GOLD    = '#b08d2e';
  const DARK    = '#141c2e';
  const MUTED   = '#6b7899';
  const GREEN   = '#18a96e';
  const RED     = '#e04f4f';
  const BLUE    = '#2d6be4';
  const BORDER  = '#e3e7ef';
  const SURFACE = '#f5f6f8';

  // ── Trend arrow helper ──
  function trend(curr, prior, invert = false, unit = '') {
    if (prior == null || prior === 0) return '';
    const diff = curr - prior;
    if (Math.abs(diff) < 0.01) return `<span style="color:${MUTED};font-size:10px;">No change</span>`;
    const up   = diff > 0;
    const good = invert ? !up : up;
    const col  = good ? GREEN : RED;
    const arrow = up ? '&#8593;' : '&#8595;';
    const abs  = unit === '$' ? `$${Math.abs(diff).toFixed(2)}` : Math.abs(diff).toFixed(unit === '%' ? 1 : 0);
    return `<span style="color:${col};font-size:10px;">${arrow} ${abs}${unit === '%' ? '%' : ''} vs prior 7d</span>`;
  }

  // ── Day-by-day rows ──
  const dayRows = dailyDates.map((day, i) => {
    const kpi     = calcKPIs(filterRange(allOpps, day, day));
    const isToday = i === 0;
    const label   = isToday ? 'Today'
      : new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const rowBg      = isToday ? '#fef7e7' : (i % 2 === 0 ? '#ffffff' : SURFACE);
    const fw         = isToday ? 'bold' : 'normal';
    const labelColor = isToday ? GOLD : DARK;
    return `
      <tr>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:${fw};color:${labelColor};background-color:${rowBg};border-bottom:1px solid ${BORDER};">${label}</td>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:${fw};color:${BLUE};text-align:center;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${kpi.total}</td>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:${fw};color:${GREEN};text-align:center;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${kpi.inst}</td>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:${fw};color:${MUTED};text-align:center;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${kpi.closeRate}%</td>
        <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:${fw};color:${RED};text-align:center;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${kpi.notInt}</td>
      </tr>`;
  }).join('');

  // ── Stage breakdown rows (today) ──
  const stageRows = todayKPIs.breakdown.length > 0
    ? todayKPIs.breakdown.map(({ stage, count }, i) => {
        const display = stage === 'Won/Installed' ? 'Installed' : stage === 'Qualified/IHA Complete' ? 'Qualified' : stage;
        const pct     = todayKPIs.total > 0 ? ((count / todayKPIs.total) * 100).toFixed(1) : '0';
        const rowBg   = i % 2 === 0 ? '#ffffff' : SURFACE;
        return `
          <tr>
            <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${DARK};background-color:${rowBg};border-bottom:1px solid ${BORDER};">${display}</td>
            <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${DARK};text-align:center;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${count}</td>
            <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};text-align:right;background-color:${rowBg};border-bottom:1px solid ${BORDER};">${pct}%</td>
          </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};text-align:center;">No leads recorded today</td></tr>`;

  // ── Journey path rows (7-day) ──
  const PLATFORM_COLORS_EMAIL = {
    'Meta': BLUE, 'Google': GREEN, 'Organic Social': GOLD,
    'Direct': '#7251c2', 'Referral': '#0ea4ac', 'Unknown': MUTED,
  };
  const journeyRows = last7KPIs.journeyPaths.length > 0
    ? last7KPIs.journeyPaths.map(({ platform, t, i, subPaths }) => {
        const col     = PLATFORM_COLORS_EMAIL[platform] || MUTED;
        const pPct    = t > 0 ? ((i / t) * 100).toFixed(1) : '0.0';
        const pctColor = parseFloat(pPct) >= 30 ? GREEN : parseFloat(pPct) >= 15 ? GOLD : MUTED;
        const hasMulti = subPaths.length > 1;
        const subRows  = hasMulti ? subPaths.map(([label, sv]) => {
          const sPct = sv.t > 0 ? ((sv.i / sv.t) * 100).toFixed(1) : '0.0';
          return `<tr bgcolor="#ffffff">
            <td style="padding:7px 14px 7px 26px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};border-bottom:1px solid ${SURFACE};">&#8627; ${label}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};text-align:center;border-bottom:1px solid ${SURFACE};">${sv.t}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GREEN};text-align:center;border-bottom:1px solid ${SURFACE};">${sv.i}</td>
            <td style="padding:7px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};text-align:center;border-bottom:1px solid ${SURFACE};">${sPct}%</td>
          </tr>`;
        }).join('') : '';
        const totalLabel = hasMulti ? `Total ${platform}` : platform;
        const totalBg    = hasMulti ? SURFACE : '#ffffff';
        const totalRow   = `<tr bgcolor="${totalBg}">
          <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${col};border-bottom:1px solid ${BORDER};">&bull; ${totalLabel}</td>
          <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${BLUE};text-align:center;border-bottom:1px solid ${BORDER};">${t}</td>
          <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${GREEN};text-align:center;border-bottom:1px solid ${BORDER};">${i}</td>
          <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${pctColor};text-align:center;border-bottom:1px solid ${BORDER};">${pPct}%</td>
        </tr>`;
        return subRows + totalRow;
      }).join('')
    : `<tr><td colspan="4" style="padding:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};text-align:center;">No attribution data available</td></tr>`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Goldsure Daily Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f6f8;">

<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f6f8">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table width="620" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:1px solid ${BORDER};">

        <!-- ══ HEADER ══ -->
        <tr>
          <td bgcolor="${DARK}" style="padding:0;">
            <!-- Gold top bar -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td bgcolor="${GOLD}" style="height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:28px 32px 24px 32px;">
                  <!-- Logo row -->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td valign="middle">
                        <img src="https://vigneshkcom.github.io/Goldsure/assets/48%20PX.png"
                             alt="Goldsure" width="44" height="44"
                             style="display:inline-block;vertical-align:middle;margin-right:14px;" />
                        <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;vertical-align:middle;letter-spacing:-0.3px;">Goldsure</span>
                        <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${GOLD};vertical-align:middle;margin-left:6px;">Smoke Alarms</span>
                      </td>
                      <td align="right" valign="middle">
                        <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;color:#4b5b7a;text-transform:uppercase;letter-spacing:1.5px;">Daily Report</span>
                      </td>
                    </tr>
                  </table>
                  <!-- Divider -->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                    <tr><td style="height:1px;background-color:rgba(255,255,255,0.08);font-size:0;">&nbsp;</td></tr>
                  </table>
                  <!-- Greeting -->
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
                    <tr>
                      <td>
                        <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;">Hi team,</p>
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#94a3b8;line-height:1.6;">
                          Please find below today's ad performance summary for Smoke Alarms.${noLeadsToday ? ' <strong style="color:#f59e0b;">&#9888; No new leads were recorded today.</strong>' : ''}
                        </p>
                      </td>
                      <td align="right" valign="bottom" style="white-space:nowrap;padding-left:20px;">
                        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#4b5b7a;">${dateStr}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ SECTION LABEL: TODAY ══ -->
        <tr>
          <td style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${SURFACE}" style="padding:12px 32px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:2px;">&#9632; Today&rsquo;s Snapshot</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ TODAY KPI TILES ══ -->
        <tr>
          <td style="padding:20px 32px 8px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <!-- Leads -->
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${BLUE};">
                    <tr><td bgcolor="#ffffff" style="padding:16px 14px;">
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${BLUE};text-transform:uppercase;letter-spacing:1px;">New Leads</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;color:${BLUE};line-height:1;">${todayKPIs.total}</p>
                    </td></tr>
                  </table>
                </td>
                <!-- Installed -->
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${GREEN};">
                    <tr><td bgcolor="#ffffff" style="padding:16px 14px;">
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GREEN};text-transform:uppercase;letter-spacing:1px;">Installed</p>
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;color:${GREEN};line-height:1;">${todayKPIs.inst}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${MUTED};">${todayKPIs.closeRate}% close rate</p>
                    </td></tr>
                  </table>
                </td>
                <!-- Total Spend -->
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${GOLD};">
                    <tr><td bgcolor="#ffffff" style="padding:16px 14px;">
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GOLD};text-transform:uppercase;letter-spacing:1px;">Total Spend</p>
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:${DARK};line-height:1;">$${totalSpendToday.toFixed(2)}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${MUTED};">Meta + Google ex-GST</p>
                    </td></tr>
                  </table>
                </td>
                <!-- CPL -->
                <td width="25%" valign="top">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${MUTED};">
                    <tr><td bgcolor="#ffffff" style="padding:16px 14px;">
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Cost / Lead</p>
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:${DARK};line-height:1;">${todayCPL !== null ? `$${todayCPL.toFixed(2)}` : '&mdash;'}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${MUTED};">Meta + Google</p>
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ SPEND BREAKDOWN ROW (today) ══ -->
        <tr>
          <td style="padding:8px 32px 20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" style="border:1px solid ${BORDER};">
              <tr>
                <td style="padding:10px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">
                  &#8627; <strong style="color:${DARK};">Meta:</strong> $${metaToday.toFixed(2)} ex-GST
                  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
                  <strong style="color:${DARK};">Google:</strong> $${googleToday.toFixed(2)} ex-GST
                  ${todayKPIs.notInt > 0 ? `&nbsp;&nbsp;&bull;&nbsp;&nbsp;<strong style="color:${RED};">Not Interested:</strong> ${todayKPIs.notInt}` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ SECTION LABEL: 7 DAYS ══ -->
        <tr>
          <td style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${SURFACE}" style="padding:12px 32px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:2px;">&#9632; Last 7 Days</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ 7-DAY KPI TILES ══ -->
        <tr>
          <td style="padding:20px 32px 8px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${BLUE};">
                    <tr><td bgcolor="#ffffff" style="padding:14px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${BLUE};text-transform:uppercase;letter-spacing:1px;">Leads</p>
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:${BLUE};line-height:1;">${last7KPIs.total}</p>
                      <p style="margin:0;">${trend(last7KPIs.total, prior7KPIs.total)}</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${GREEN};">
                    <tr><td bgcolor="#ffffff" style="padding:14px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GREEN};text-transform:uppercase;letter-spacing:1px;">Installed</p>
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:bold;color:${GREEN};line-height:1;">${last7KPIs.inst}</p>
                      <p style="margin:0;">${trend(last7KPIs.inst, prior7KPIs.inst)}</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top" style="padding-right:8px;">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${GOLD};">
                    <tr><td bgcolor="#ffffff" style="padding:14px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GOLD};text-transform:uppercase;letter-spacing:1px;">Total Spend</p>
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:${DARK};line-height:1;">$${totalSpendLast7.toFixed(2)}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${MUTED};">Meta + Google ex-GST</p>
                    </td></tr>
                  </table>
                </td>
                <td width="25%" valign="top">
                  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-top:3px solid ${MUTED};">
                    <tr><td bgcolor="#ffffff" style="padding:14px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;">Cost / Lead</p>
                      <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;color:${DARK};line-height:1;">${last7CPL !== null ? `$${last7CPL.toFixed(2)}` : '&mdash;'}</p>
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:${MUTED};">Cost / Install: ${last7CPI !== null ? `$${last7CPI.toFixed(2)}` : '&mdash;'}</p>
                    </td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ SPEND BREAKDOWN ROW (7d) ══ -->
        <tr>
          <td style="padding:8px 32px 16px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${SURFACE}" style="border:1px solid ${BORDER};">
              <tr>
                <td style="padding:10px 16px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${MUTED};">
                  &#8627; <strong style="color:${DARK};">Meta:</strong> $${metaLast7.toFixed(2)}
                  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
                  <strong style="color:${DARK};">Google:</strong> $${googleLast7.toFixed(2)}
                  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
                  <strong style="color:${DARK};">Close rate:</strong> ${last7KPIs.closeRate}%
                  &nbsp;&nbsp;&bull;&nbsp;&nbsp;
                  <strong style="color:${RED};">Not Interested:</strong> ${last7KPIs.notInt}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ DAY-BY-DAY TABLE ══ -->
        <tr>
          <td style="padding:4px 32px 24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
              <tr bgcolor="${SURFACE}">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Day</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${BLUE};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Leads</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GREEN};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Installed</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Close %</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${RED};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Not Int.</td>
              </tr>
              ${dayRows}
              <tr bgcolor="${SURFACE}">
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${DARK};border-top:2px solid ${BORDER};">7-Day Total</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${BLUE};text-align:center;border-top:2px solid ${BORDER};">${last7KPIs.total}</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${GREEN};text-align:center;border-top:2px solid ${BORDER};">${last7KPIs.inst}</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${DARK};text-align:center;border-top:2px solid ${BORDER};">${last7KPIs.closeRate}%</td>
                <td style="padding:11px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${RED};text-align:center;border-top:2px solid ${BORDER};">${last7KPIs.notInt}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ SECTION LABEL: STAGE BREAKDOWN ══ -->
        <tr>
          <td style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${SURFACE}" style="padding:12px 32px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:2px;">&#9632; Stage Breakdown &mdash; Today</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
              <tr bgcolor="${SURFACE}">
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Stage</td>
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Count</td>
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-align:right;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Share</td>
              </tr>
              ${stageRows}
            </table>
          </td>
        </tr>

        <!-- ══ SECTION LABEL: JOURNEY PATHS ══ -->
        <tr>
          <td style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${SURFACE}" style="padding:12px 32px;border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};">
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:2px;">&#9632; Lead Sources &amp; Journey Paths &mdash; Last 7 Days</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 32px 8px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
              <tr bgcolor="${SURFACE}">
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};">Source / Path</td>
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${BLUE};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};width:58px;">Leads</td>
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${GREEN};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};width:58px;">Closed</td>
                <td style="padding:9px 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:bold;color:${MUTED};text-align:center;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ${BORDER};width:62px;">Close %</td>
              </tr>
              ${journeyRows}
              <tr bgcolor="${DARK}">
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;">All Sources</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#93c5fd;text-align:center;">${last7KPIs.total}</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#86efac;text-align:center;">${last7KPIs.inst}</td>
                <td style="padding:10px 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#ffffff;text-align:center;">${last7KPIs.closeRate}%</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Legend -->
        <tr>
          <td style="padding:6px 32px 24px 32px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#94a3b8;line-height:1.8;">
              <strong style="color:${MUTED};">Path notation:</strong> &ldquo;Meta &#8594; Google&rdquo; means first clicked a Meta ad, then converted after a Google search.<br>
              <strong style="color:${MUTED};">Unknown:</strong> No UTM tracking on the ad URL &mdash; platform cannot be identified.
            </p>
          </td>
        </tr>

        <!-- ══ CTA ══ -->
        <tr>
          <td align="center" style="padding:4px 32px 32px 32px;">
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${DARK}" style="border:2px solid ${GOLD};padding:0;">
                  <a href="https://vigneshkcom.github.io/Goldsure/Ads%20reporting/Meta%20Ad%20Performance.html"
                     style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${GOLD};text-decoration:none;display:block;padding:13px 32px;text-transform:uppercase;letter-spacing:1px;">
                    Open Full Dashboard &#8594;
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ══ FOOTER ══ -->
        <tr>
          <td bgcolor="${DARK}" style="padding:0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td bgcolor="${GOLD}" style="height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:20px 32px;" align="center">
                  <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#ffffff;">Goldsure Pty Ltd</p>
                  <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#4b5b7a;">Suite 4, Level 1, 293 High Street, Preston VIC 3072</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#4b5b7a;">Auto-generated &bull; ${dateStr}</p>
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
    const [metaToday, metaLast7, googleToday, googleLast7] = await Promise.all([
      fetchMetaSpend(ranges.today.from, ranges.today.to),
      fetchMetaSpend(ranges.last7.from, ranges.last7.to),
      fetchGoogleSpend(ranges.today.from, ranges.today.to),
      fetchGoogleSpend(ranges.last7.from, ranges.last7.to),
    ]);

    const html = buildEmail({ today: ranges.today, last7: ranges.last7, prior7: ranges.prior7, dailyDates, allOpps, metaToday, metaLast7, googleToday, googleLast7, dateStr });

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
      today:   { ...calcKPIs(filterRange(allOpps, ranges.today.from, ranges.today.to)), metaSpend: metaToday, googleSpend: googleToday, totalSpend: metaToday + googleToday },
      last7:   { ...calcKPIs(filterRange(allOpps, ranges.last7.from, ranges.last7.to)),  metaSpend: metaLast7, googleSpend: googleLast7, totalSpend: metaLast7 + googleLast7 },
    });

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
