// api/send-report.js
// Goldsure â€” Smoke Alarms Daily Report
//
// Cron: "0 6 * * 1-5" -> 06:00 UTC = 5:00 PM AEDT (UTC+11)
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

// Convert any UTC ISO timestamp from GHL to a YYYY-MM-DD string in AEST/AEDT
function toAestDate(utcString) {
  if (!utcString) return '';
  return new Date(utcString).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

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

// â”€â”€ Source categorisation (mirrors dashboard logic) â”€â”€
// Only explicit Meta-only tokens belong here.
// Broad brand/form labels like "Gold sure", "Smoke Alarms", or
// "Above the fold" can exist on non-Meta lead paths and were causing
// Google or ambiguous leads to be over-counted as Meta in daily emails.
const META_CAMPAIGN_PATTERNS = [
  'fb_ad',
  'facebook ad',
  'facebook lead ad',
  'meta ad',
  'meta lead ad',
  'ig_ad',
  'instagram ad',
  'instagram lead ad',
];
function looksLikeMetaCampaign(str) {
  const s = (str || '').toLowerCase();
  return META_CAMPAIGN_PATTERNS.some(p => s.includes(p));
}

function isLandingPageLabel(str) {
  const s = (str || '').toLowerCase().trim();
  return s === 'landing page' ||
    s.includes('gold sure - smoke alarms') ||
    s.includes('goldsure - smoke alarms');
}

function isLandingPageTouchpoint(str) {
  const s = (str || '').toLowerCase().trim();
  return isLandingPageLabel(s) ||
    s.includes('offers.goldsure.com.au') ||
    s.includes('/smoke-alarm');
}

function displaySourceLabel(str) {
  return isLandingPageTouchpoint(str) ? 'Google' : (str || 'Unknown');
}

function displayJourneyLabel(str) {
  return isLandingPageTouchpoint(str) ? 'Landing Page' : displaySourceLabel(str);
}

function categoriseSource(rawSource, attr) {
  if (attr) {
    const { type, medium, utmSource, referrer, gclid } = attr;
    if (utmSource === 'adwords' || utmSource.includes('google_ads') || gclid ||
        type === 'paid search' || medium === 'paid search' ||
        (utmSource && referrer.includes('google.com'))) return 'Google';
    if (utmSource === 'fb_ad' || utmSource === 'facebook' || utmSource === 'instagram' ||
        type === 'paid social' || medium === 'paid social') return 'Meta';
    // Referrer: Facebook/Instagram domain = paid or organic social â€” disambiguate via contactSource below
    const metaSocial = ['facebook.com','instagram.com'];
    const otherSocial = ['linkedin.com','twitter.com','tiktok.com'];
    const isMeta  = metaSocial.some(d => referrer.includes(d));
    const isOther = otherSocial.some(d => referrer.includes(d));
    const search  = ['google.com','bing.com','yahoo.com','duckduckgo.com'];
    // Check contactSource for campaign name before committing to Organic Social
    const csRaw = (attr.contactSource || '').toLowerCase();
    if (isMeta && looksLikeMetaCampaign(csRaw)) return 'Meta';
    if (isMeta || isOther) return 'Organic Social';
    if (search.some(d => referrer.includes(d))) return 'Organic Search';
    // Business rule: GHL "Direct traffic" is treated as Google for reporting.
    if (type === 'direct traffic' || type === 'direct') return 'Google';
    if (type === 'referral') return 'Referral';
  }
  // Check rawSource as a URL/referrer (e.g. "https://l.facebook.com", "https://www.google.com/...")
  const oppSrcUrl = (rawSource || '').toLowerCase();
  if (oppSrcUrl.includes('facebook.com') || oppSrcUrl.includes('instagram.com') || oppSrcUrl.includes('l.facebook')) {
    // Facebook/Instagram URL â€” paid vs organic determined by campaign name on contact source
    const csCheck = (attr?.contactSource || '').toLowerCase();
    if (looksLikeMetaCampaign(csCheck)) return 'Meta';
    return 'Meta'; // l.facebook.com as opp source almost always means a paid ad click
  }
  if (oppSrcUrl.includes('google.com') || oppSrcUrl.includes('googleads') || oppSrcUrl.includes('gclid')) return 'Google';

  const raw = (attr?.contactSource || rawSource || '').toLowerCase().trim();
  if (!raw || raw === 'unknown') return 'Unknown';
  if (raw === 'paid search' || raw.includes('adword') || raw.includes('google ads')) return 'Google';
  if (raw.includes('google')) return 'Google';
  if (raw === 'paid social' || raw === 'fb_ad' || raw.includes('facebook') ||
      raw.includes('fb') || raw.includes('meta') || raw.includes('instagram')) return 'Meta';
  // Campaign-name pattern match should only fire for explicit Meta labels.
  if (looksLikeMetaCampaign(raw)) return 'Meta';
  if (raw === 'organic search') return 'Organic Search';
  if (raw === 'organic social') return 'Organic Social';
  if (raw === 'social media') return 'Organic Social';
  // Business rule: GHL "Direct traffic" is treated as Google for reporting.
  if (raw === 'direct traffic' || raw === 'direct') return 'Google';
  if (raw === 'referral') return 'Referral';
  if (isLandingPageTouchpoint(raw)) return 'Google';
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

  // opp.source may be a URL (e.g. "https://l.facebook.com") or a form/campaign name.
  // For latest-touch we use the latest attribution's own referrer so it can differ from first-touch.
  const oppSrcRaw    = opp.source || '';
  const latestRefUrl = cData?.latest?.referrer || '';

  // formName: use contact source only when it contains an explicit Meta-only label.
  // Generic branded form names are useful for UX labels, but not safe as source evidence.
  const GENERIC_SOURCES = ['social media','paid social','paid search','organic search','organic social','direct traffic','direct','referral','unknown',''];
  const rawContactSrc = (cData?.first?.contactSource || '').trim();

  // Tags fallback â€” e.g. ["smoke alarm landing page"] â†’ "Smoke Alarm Landing Page"
  const oppTags = Array.isArray(opp.tags) ? opp.tags : [];
  const tagLabel = oppTags.length > 0
    ? oppTags.map(t => t.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(', ')
    : '';

  const formName = isLandingPageTouchpoint(rawContactSrc) || isLandingPageTouchpoint(oppSrcRaw)
    ? 'Landing Page'
    : rawContactSrc && !GENERIC_SOURCES.includes(rawContactSrc.toLowerCase())
    ? rawContactSrc
    : (() => {
        const isUrl = /^https?:\/\//i.test(oppSrcRaw);
        if (!isUrl && oppSrcRaw) return oppSrcRaw.trim();
        return tagLabel;
      })();

  // latest raw source: prefer the latest attribution's own referrer; fall back to opp.source
  const latestRaw = latestRefUrl || oppSrcRaw;

  return {
    stage:      (opp.pipelineStage?.name || opp.status || 'Unknown').trim(),
    stageId:    (opp.pipelineStageId || opp.pipelineStage?.id || '').trim(),
    source:     categoriseSource(oppSrcRaw, cData?.first  || null),
    latestSrc:  categoriseSource(latestRaw, cData?.latest || null),
    formName,
    pipeline:   (opp.pipeline?.name || opp.pipelineName || '').trim(),
    pipelineId: (opp.pipelineId || opp.pipeline?.id || '').trim(),
    created:    toAestDate(opp.createdAt),
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
    // If a form/campaign name is available, append it as the conversion touchpoint label
    const latestLabel = r.formName ? r.formName : displayJourneyLabel(latest);
    const pathLabel = (first === latestLabel || (!r.latestSrc && !r.formName))
      ? displayJourneyLabel(first)
      : `${displayJourneyLabel(first)} &rarr; ${latestLabel}`;
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

// Google Ads spend (ex-GST) â€” calls Google Ads API directly (same logic as google-spend.js)
// Avoids unreliable internal Vercel self-calls from cron jobs.
async function fetchGoogleSpend(since, until) {
  try {
    const {
      GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REFRESH_TOKEN,
      GOOGLE_ADS_MANAGER_ID,
      GOOGLE_ADS_CUSTOMER_ID,
    } = process.env;

    if (!GOOGLE_ADS_DEVELOPER_TOKEN || !GOOGLE_ADS_CLIENT_ID ||
        !GOOGLE_ADS_CLIENT_SECRET   || !GOOGLE_ADS_REFRESH_TOKEN ||
        !GOOGLE_ADS_MANAGER_ID      || !GOOGLE_ADS_CUSTOMER_ID) {
      console.warn('[Google] Missing env vars â€” skipping Google spend');
      return 0;
    }

    const customerId = GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
    const managerId  = GOOGLE_ADS_MANAGER_ID.replace(/-/g, '');

    // 1. Get access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.warn('[Google] OAuth failed:', tokenData);
      return 0;
    }

    // 2. Query spend for date range
    const query = `
      SELECT metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND metrics.cost_micros > 0
        AND campaign.status != 'REMOVED'
    `;
    const adsRes = await fetch(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':       `Bearer ${tokenData.access_token}`,
          'developer-token':     GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id':   managerId,
          'Content-Type':        'application/json',
        },
        body: JSON.stringify({ query }),
      }
    );
    if (!adsRes.ok) { console.warn('[Google] Ads API error:', adsRes.status); return 0; }

    const data = await adsRes.json();
    let totalMicros = 0;
    if (Array.isArray(data.results)) {
      data.results.forEach(row => {
        const m = row.metrics || {};
        totalMicros += parseInt(m.costMicros ?? m.cost_micros ?? '0', 10) || 0;
      });
    }

    // Google returns inc-GST AUD â†’ divide by 1.1 for ex-GST (matches dashboard)
    return (totalMicros / 1_000_000) / 1.1;
  } catch(e) {
    console.warn('[Google] fetchGoogleSpend error:', e.message);
    return 0;
  }
}

// Email HTML â€” Outlook-safe: tables only, all inline styles, no flexbox or CSS grid
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

  // Today's leads broken down by source â€” for the source pills row
  const todayLeads = filterRange(allOpps, today.from, today.to);
  const SOURCE_COLORS = { Meta: '#2d6be4', Google: '#18a96e', 'Organic Search': '#7251c2', 'Organic Social': '#d98c1e', Direct: '#0ea4ac', Referral: '#6b7899', Unknown: '#94a3b8' };
  const todaySrcCount = {};
  todayLeads.forEach(r => {
    const src = r.source || 'Unknown';
    todaySrcCount[src] = (todaySrcCount[src] || 0) + 1;
  });
  const todaySourcePills = Object.entries(todaySrcCount)
    .sort((a, b) => b[1] - a[1])
    .map(([src, cnt]) => {
      const col = SOURCE_COLORS[src] || '#94a3b8';
      const labelSrc = displaySourceLabel(src);
      const label = cnt === 1 ? `1 ${labelSrc}` : `${cnt} ${labelSrc}`;
      return `<span style="display:inline-block;background:${col}18;border:1px solid ${col}44;color:${col};font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;padding:4px 10px;border-radius:20px;margin:0 4px 4px 0;">${label}</span>`;
    }).join('');
  const totalSpendLast7 = metaLast7 + googleLast7;

  const todayCPL  = todayKPIs.total > 0 && totalSpendToday > 0 ? totalSpendToday / todayKPIs.total : null;
  const todayCPI  = todayKPIs.inst  > 0 && totalSpendToday > 0 ? totalSpendToday / todayKPIs.inst  : null;
  const last7CPL  = last7KPIs.total > 0 && totalSpendLast7 > 0 ? totalSpendLast7 / last7KPIs.total : null;
  const last7CPI  = last7KPIs.inst  > 0 && totalSpendLast7 > 0 ? totalSpendLast7 / last7KPIs.inst  : null;
  const noLeadsToday = todayKPIs.total === 0;

  // â”€â”€ Colours from Goldsure design language â”€â”€
  const GOLD    = '#b08d2e';
  const DARK    = '#141c2e';
  const MUTED   = '#6b7899';
  const GREEN   = '#18a96e';
  const RED     = '#e04f4f';
  const BLUE    = '#2d6be4';
  const BORDER  = '#e3e7ef';
  const SURFACE = '#f5f6f8';

  // â”€â”€ Shared style strings (must be declared before dayRows / stageRows etc.) â”€â”€
  const F   = 'font-family:Arial,Helvetica,sans-serif;';
  const sec = `${F}font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;color:${MUTED};margin:0 0 16px 0;`;
  const th  = `${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:0.8px;color:${MUTED};padding:9px 12px;border-bottom:2px solid ${BORDER};background-color:#f8f9fb;`;
  const td0 = `${F}font-size:13px;color:${DARK};padding:10px 12px;border-bottom:1px solid ${BORDER};`;

  // â”€â”€ Trend arrow helper â”€â”€
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

  // â”€â”€ Day-by-day rows â”€â”€
  const dayRows = dailyDates.map((day, i) => {
    const kpi     = calcKPIs(filterRange(allOpps, day, day));
    const isToday = i === 0;
    const label   = isToday ? 'Today'
      : new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const rowBg      = isToday ? '#fffdf5' : '#ffffff';
    const fw         = isToday ? 'bold' : 'normal';
    const labelColor = isToday ? GOLD : DARK;
    const B          = `border-bottom:1px solid ${BORDER};`;
    return `
      <tr>
        <td style="padding:10px 12px;${F}font-size:13px;font-weight:${fw};color:${labelColor};background-color:${rowBg};${B}">${label}</td>
        <td style="padding:10px 12px;${F}font-size:13px;font-weight:${fw};color:${DARK};text-align:center;background-color:${rowBg};${B}">${kpi.total}</td>
        <td style="padding:10px 12px;${F}font-size:13px;font-weight:${fw};color:${DARK};text-align:center;background-color:${rowBg};${B}">${kpi.inst}</td>
        <td style="padding:10px 12px;${F}font-size:13px;color:${MUTED};text-align:center;background-color:${rowBg};${B}">${kpi.closeRate}%</td>
        <td style="padding:10px 12px;${F}font-size:13px;color:${kpi.notInt > 0 ? RED : MUTED};text-align:center;background-color:${rowBg};${B}">${kpi.notInt}</td>
      </tr>`;
  }).join('');

  // â”€â”€ Stage breakdown rows (today) â”€â”€
  const stageRows = todayKPIs.breakdown.length > 0
    ? todayKPIs.breakdown.map(({ stage, count }) => {
        const display = stage === 'Won/Installed' ? 'Installed' : stage === 'Qualified/IHA Complete' ? 'Qualified' : stage;
        const pct     = todayKPIs.total > 0 ? ((count / todayKPIs.total) * 100).toFixed(1) : '0';
        const B = `border-bottom:1px solid ${BORDER};`;
        return `<tr>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${DARK};${B}">${display}</td>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${DARK};text-align:center;${B}">${count}</td>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};text-align:right;${B}">${pct}%</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="3" style="padding:16px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};text-align:center;">No leads recorded today</td></tr>`;

  // â”€â”€ Journey path rows (7-day) â”€â”€
  const PLATFORM_COLORS_EMAIL = {
    'Meta': BLUE, 'Google': GREEN, 'Organic Social': GOLD,
    'Direct': '#7251c2', 'Referral': '#0ea4ac', 'Unknown': MUTED,
  };
  const journeyRows = last7KPIs.journeyPaths.length > 0
    ? last7KPIs.journeyPaths.map(({ platform, t, i, subPaths }) => {
        const col      = PLATFORM_COLORS_EMAIL[platform] || MUTED;
        const pPct     = t > 0 ? ((i / t) * 100).toFixed(1) : '0.0';
        const hasMulti = subPaths.length > 0;
        const B = `border-bottom:1px solid ${BORDER};`;
        const subRows  = hasMulti ? subPaths.map(([label, sv]) => {
          const sPct = sv.t > 0 ? ((sv.i / sv.t) * 100).toFixed(1) : '0.0';
          return `<tr>
            <td style="padding:8px 12px 8px 22px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};${B}">&#8627; ${label}</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${DARK};text-align:center;${B}">${sv.t}</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${DARK};text-align:center;${B}">${sv.i}</td>
            <td style="padding:8px 12px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${MUTED};text-align:center;${B}">${sPct}%</td>
          </tr>`;
        }).join('') : '';
        const totalLabel = hasMulti ? `${platform} (total)` : platform;
        const totalRow   = `<tr>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${col};${B}">${totalLabel}</td>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${DARK};text-align:center;${B}">${t}</td>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${DARK};text-align:center;${B}">${i}</td>
          <td style="padding:10px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${DARK};text-align:center;${B}">${pPct}%</td>
        </tr>`;
        return subRows + totalRow;
      }).join('')
    : `<tr><td colspan="4" style="padding:16px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};text-align:center;">No attribution data available</td></tr>`;

  // â”€â”€ Big stat cell builder â”€â”€
  function stat(label, value, sub = '', valueColor = DARK) {
    return `<td valign="top" width="16%" style="padding:0 12px 0 0;">
      <p style="${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin:0 0 6px 0;">${label}</p>
      <p style="${F}font-size:38px;font-weight:bold;line-height:1;color:${valueColor};margin:0;">${value}</p>
      ${sub ? `<p style="${F}font-size:11px;color:${MUTED};margin:5px 0 0 0;">${sub}</p>` : ''}
    </td>`;
  }
  function statMoney(label, value, sub = '') {
    return `<td valign="top" width="26%" style="padding:0 12px 0 0;">
      <p style="${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin:0 0 6px 0;">${label}</p>
      <p style="${F}font-size:28px;font-weight:bold;line-height:1;color:${DARK};margin:0;">${value}</p>
      ${sub ? `<p style="${F}font-size:11px;color:${MUTED};margin:5px 0 0 0;">${sub}</p>` : ''}
    </td>`;
  }
  // CPL and CPI as separate stat cells
  function statCPL(cpl) {
    const val = cpl !== null ? `$${cpl.toFixed(2)}` : '$0.00';
    return `<td valign="top" width="21%" style="padding:0 12px 0 0;">
      <p style="${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin:0 0 6px 0;">Cost / Lead</p>
      <p style="${F}font-size:28px;font-weight:bold;line-height:1;color:${DARK};margin:0;">${val}</p>
      <p style="${F}font-size:10px;color:${MUTED};margin:4px 0 0 0;">ex-GST</p>
    </td>`;
  }
  function statCPI(cpi) {
    const val = cpi !== null ? `$${cpi.toFixed(2)}` : '$0.00';
    return `<td valign="top" width="21%" style="padding:0;">
      <p style="${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin:0 0 6px 0;">Cost / Install</p>
      <p style="${F}font-size:28px;font-weight:bold;line-height:1;color:${DARK};margin:0;">${val}</p>
      <p style="${F}font-size:10px;color:${MUTED};margin:4px 0 0 0;">ex-GST</p>
    </td>`;
  }

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Goldsure Daily Report</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f0f2f5">
<tr><td align="center" style="padding:24px 16px;">
<table width="580" cellpadding="0" cellspacing="0" border="0">

  <!-- HEADER -->
  <tr>
    <td bgcolor="#000000" style="padding:28px 32px 24px;border-radius:6px 6px 0 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle">
            <img src="https://raw.githubusercontent.com/vigneshkcom/Goldsure/277e079b062a260a6792933542c58229d3801b86/assets/goldsure-inverted-logo.jpg"
                 alt="Goldsure" width="110" style="display:block;border:0;" />
            <p style="${F}font-size:11px;color:${GOLD};margin:5px 0 0 0;letter-spacing:0.3px;">Smoke Alarms</p>
          </td>
          <td align="right" valign="top">
            <p style="${F}font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,0.35);margin:0 0 4px 0;">Daily Report</p>
            <p style="${F}font-size:12px;color:#ffffff;margin:0;">${dateStr}</p>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;border-top:1px solid rgba(255,255,255,0.1);">
        <tr><td style="padding-top:20px;">
          <p style="${F}font-size:17px;font-weight:bold;color:#ffffff;margin:0 0 6px 0;">Hi All,</p>
          <p style="${F}font-size:13px;color:rgba(255,255,255,0.65);line-height:1.6;margin:0;">Please find below today's ad performance summary for Smoke Alarms.</p>
          ${noLeadsToday ? `<p style="${F}font-size:12px;font-weight:bold;color:#f59e0b;margin:12px 0 0 0;">&#9888;&nbsp; No new leads were recorded today.</p>` : ''}
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- WHITE BODY -->
  <tr>
    <td bgcolor="#ffffff" style="padding:32px 32px 0;">

      <!-- TODAY -->
      <p style="${sec}">Today &mdash; ${today.from}</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BORDER};padding-top:20px;">
        <tr>
          ${stat('New Leads', todayKPIs.total)}
          ${stat('Installed', todayKPIs.inst, `${todayKPIs.closeRate}% close rate`, todayKPIs.inst > 0 ? GREEN : DARK)}
          ${statMoney('Ad Spend', totalSpendToday > 0 ? `$${totalSpendToday.toFixed(2)}` : '&mdash;', `Meta $${metaToday.toFixed(2)} &nbsp;+&nbsp; Google $${googleToday.toFixed(2)}`)}
          ${statCPL(todayCPL)}
          ${statCPI(todayCPI)}
        </tr>
      </table>

      ${todayKPIs.total > 0 ? `
      <!-- TODAY SOURCE PILLS -->
      <div style="margin-top:14px;line-height:1.8;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin-right:8px;">Sources</span>
        ${todaySourcePills}
      </div>` : ''}

      <!-- LAST 7 DAYS -->
      <p style="${sec}margin-top:28px;">Last 7 Days</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${BORDER};padding-top:20px;">
        <tr>
          ${stat('Leads', last7KPIs.total, (() => { const t = trend(last7KPIs.total, prior7KPIs.total); return t || '&nbsp;'; })())}
          ${stat('Installed', last7KPIs.inst, (() => { const t = trend(last7KPIs.inst, prior7KPIs.inst); return t || '&nbsp;'; })(), last7KPIs.inst > 0 ? GREEN : DARK)}
          ${statMoney('Ad Spend', `$${totalSpendLast7.toFixed(2)}`, `Meta $${metaLast7.toFixed(2)} &nbsp;+&nbsp; Google $${googleLast7.toFixed(2)}`)}
          ${statCPL(last7CPL)}
          ${statCPI(last7CPI)}
        </tr>
      </table>

    </td>
  </tr>

  <!-- DAILY BREAKDOWN TABLE -->
  <tr>
    <td bgcolor="#ffffff" style="padding:28px 32px 0;">
      <p style="${sec}">Daily Breakdown</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
        <tr>
          <td style="${th}text-align:left;width:40%;">Day</td>
          <td style="${th}text-align:center;">Leads</td>
          <td style="${th}text-align:center;">Installed</td>
          <td style="${th}text-align:center;">Close %</td>
          <td style="${th}text-align:center;">Not Int.</td>
        </tr>
        ${dayRows}
        <tr bgcolor="#f8f9fb">
          <td style="${td0}font-weight:bold;border-bottom:none;">7-Day Total</td>
          <td style="${td0}text-align:center;font-weight:bold;border-bottom:none;">${last7KPIs.total}</td>
          <td style="${td0}text-align:center;font-weight:bold;color:${last7KPIs.inst > 0 ? GREEN : DARK};border-bottom:none;">${last7KPIs.inst}</td>
          <td style="${td0}text-align:center;border-bottom:none;">${last7KPIs.closeRate}%</td>
          <td style="${td0}text-align:center;border-bottom:none;">${last7KPIs.notInt}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- STAGE BREAKDOWN -->
  <tr>
    <td bgcolor="#ffffff" style="padding:28px 32px 0;">
      <p style="${sec}">Stage Breakdown &mdash; Today</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
        <tr>
          <td style="${th}text-align:left;">Stage</td>
          <td style="${th}text-align:center;width:80px;">Count</td>
          <td style="${th}text-align:right;width:70px;">Share</td>
        </tr>
        ${stageRows}
      </table>
    </td>
  </tr>

  <!-- LEAD SOURCES -->
  <tr>
    <td bgcolor="#ffffff" style="padding:28px 32px 0;">
      <p style="${sec}">Lead Sources &amp; Journey Paths &mdash; Last 7 Days</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
        <tr>
          <td style="${th}text-align:left;">Source</td>
          <td style="${th}text-align:center;width:70px;">Leads</td>
          <td style="${th}text-align:center;width:70px;">Installed</td>
          <td style="${th}text-align:center;width:70px;">Close %</td>
        </tr>
        ${journeyRows}
        <tr bgcolor="#000000">
          <td style="${F}font-size:12px;font-weight:bold;color:#fff;padding:10px 12px;">All Sources</td>
          <td style="${F}font-size:12px;font-weight:bold;color:#fff;padding:10px 12px;text-align:center;">${last7KPIs.total}</td>
          <td style="${F}font-size:12px;font-weight:bold;color:#fff;padding:10px 12px;text-align:center;">${last7KPIs.inst}</td>
          <td style="${F}font-size:12px;font-weight:bold;color:#fff;padding:10px 12px;text-align:center;">${last7KPIs.closeRate}%</td>
        </tr>
      </table>
      <p style="${F}font-size:10px;color:${MUTED};margin:8px 0 0 0;line-height:1.6;">
        Path notation: "Meta &rarr; Landing Page" means the lead first came from Meta and converted via the landing page. "Google &rarr; Landing Page" means the lead is grouped under Google/direct traffic and converted via the landing page.
      </p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td bgcolor="#ffffff" style="padding:28px 32px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="1" bgcolor="${BORDER}" style="font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td>
  </tr>
  <tr>
    <td bgcolor="#000000" style="padding:18px 32px;border-radius:0 0 6px 6px;" align="center">
      <p style="${F}font-size:12px;font-weight:bold;color:#ffffff;margin:0 0 3px 0;">Goldsure Pty Ltd</p>
      <p style="${F}font-size:10px;color:rgba(255,255,255,0.4);margin:0;">Suite 4, Level 1, 293 High Street, Preston VIC 3072 &nbsp;&bull;&nbsp; Auto-generated</p>
    </td>
  </tr>

</table>
</td></tr>
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
  const recipients = ['accounts@goldsure.com.au'];
  const bcc        = ['vignesh@goldsure.com.au'];

  if (!resendKey)               return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  if (!process.env.GHL_API_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const nowUtc     = new Date();
    const todayStr   = nowUtc.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); // â†’ "YYYY-MM-DD"
    const today      = new Date(todayStr + 'T12:00:00'); // noon anchor for safe date arithmetic
    const ranges     = buildRanges(today);
    const dailyDates = buildDailyDates(today);
    const dateStr    = nowUtc.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
        from:    'Vignesh <vignesh@goldsure.com.au>',
        to:      recipients,
        bcc:     bcc,
        subject: `Goldsure Ad Performance Report - ${dateStr}`,
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
