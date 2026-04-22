// api/send-report.js
// Goldsure â€" Smoke Alarms Daily Report
//
// Cron: "0 6 * * 1-5" -> 06:00 UTC = 5:00 PM AEDT (UTC+11)
//
// Required Vercel Environment Variables:
//   RESEND_API_KEY, GHL_API_KEY, GHL_LOCATION_ID, META_TOKEN, REPORT_RECIPIENTS, CRON_SECRET

const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const SMOKE_ACCOUNT   = 'act_1420815159464502';

// Supabase — same publishable key used client-side in the calendar
const SB_URL = 'https://yxgdixwneprhjxzdlaqw.supabase.co';
const SB_KEY = 'sb_publishable_94nQfItNfgNZZc2P1Slb1Q_ECjCmu47';

async function loadDateOverrides() {
  try {
    const resp = await fetch(
      `${SB_URL}/rest/v1/Webco%20Created%20Dates?select=email,real_date`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    if (!resp.ok) return new Map();
    const rows = await resp.json();
    return new Map(rows.map(r => [r.email.toLowerCase().trim(), r.real_date.slice(0, 10)]));
  } catch(e) {
    console.warn('[DateOverrides] Failed:', e.message);
    return new Map();
  }
}

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

// â"€â"€ Source categorisation (mirrors dashboard logic) â"€â"€
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
  return s.includes('landing page') ||
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
    // Referrer: Facebook/Instagram domain = paid or organic social â€" disambiguate via contactSource below
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
    // Facebook/Instagram URL â€" paid vs organic determined by campaign name on contact source
    const csCheck = (attr?.contactSource || '').toLowerCase();
    if (looksLikeMetaCampaign(csCheck)) return 'Meta';
    return 'Meta'; // l.facebook.com as opp source almost always means a paid ad click
  }
  if (oppSrcUrl.includes('google.com') || oppSrcUrl.includes('googleads') || oppSrcUrl.includes('gclid')) return 'Google';
  // Exact GHL workflow labels — must check before contactSource shadows rawSource
  if (oppSrcUrl === 'meta' || oppSrcUrl === 'facebook') return 'Meta';
  if (oppSrcUrl === 'google') return 'Google';
  if (oppSrcUrl === 'direct') return 'Google';

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

function mapOpp(opp, contactAttrMap, dateOverrides = new Map()) {
  const contactEmail = (opp.contact?.email || '').toLowerCase().trim();
  const contactId = opp.contactId || opp.contact?.id || '';
  const cData     = contactAttrMap ? (contactAttrMap[contactId] || null) : null;

  // opp.source may be a URL (e.g. "https://l.facebook.com") or a form/campaign name.
  // opp.opportunitySource is the "Opportunity Source" dropdown in the GHL UI.
  // Fall back through all source fields so Facebook/Google labels are always found.
  const oppTags    = Array.isArray(opp.tags) ? opp.tags.map(t => (t||'').toLowerCase()) : [];
  const tagSource  = oppTags.find(t => t.includes('facebook') || t.includes('instagram') || t.includes('meta') || t.includes('google'));
  const oppSrcRaw  = opp.source || opp.opportunitySource || opp.leadSource || tagSource || '';
  const latestRefUrl = cData?.latest?.referrer || '';

  // formName: use contact source only when it contains an explicit Meta-only label.
  // Generic branded form names are useful for UX labels, but not safe as source evidence.
  const GENERIC_SOURCES = ['social media','paid social','paid search','organic search','organic social','direct traffic','direct','referral','unknown',''];
  const rawContactSrc = (cData?.first?.contactSource || '').trim();

  // Tags fallback â€" e.g. ["smoke alarm landing page"] â†' "Smoke Alarm Landing Page"
  const rawOppTags = Array.isArray(opp.tags) ? opp.tags : [];
  const tagLabel = rawOppTags.length > 0
    ? rawOppTags.map(t => t.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')).join(', ')
    : '';

  const hasLandingPageTag = rawOppTags.some(t => (t||'').toLowerCase().includes('landing page'));
  const formName = isLandingPageTouchpoint(rawContactSrc) || isLandingPageTouchpoint(oppSrcRaw) || hasLandingPageTag
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
    created:    (contactEmail && dateOverrides.has(contactEmail))
                  ? dateOverrides.get(contactEmail)
                  : toAestDate(opp.createdAt),
  };
}

async function loadAllOpportunities() {
  let pipelines = [];
  try {
    const pipeJson = await ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`);
    pipelines = (pipeJson.pipelines || []).map(p => ({
      id: p.id, name: p.name, stages: (p.stages || []).map(s => ({ id: s.id, name: s.name }))
    }));
  } catch(e) { console.error('Pipeline fetch failed:', e.message); }

  const [rawOpps, dateOverrides] = await Promise.all([
    fetchAllOpportunities(),
    loadDateOverrides(),
  ]);
  console.log(`[DateOverrides] Loaded ${dateOverrides.size} email->date overrides`);

  const contactIds = [...new Set(rawOpps.map(o => o.contactId || o.contact?.id).filter(Boolean))];
  let contactAttrMap = {};
  try { contactAttrMap = await fetchContactAttributionBatch(contactIds); }
  catch(e) { console.warn('Attribution batch failed:', e.message); }

  const stageNameMap = {};
  pipelines.forEach(p => p.stages.forEach(s => { stageNameMap[s.id] = s.name; }));

  const mapped = rawOpps.map(o => mapOpp(o, contactAttrMap, dateOverrides)).filter(r => r.created);
  mapped.forEach(r => { if (r.stageId && stageNameMap[r.stageId]) r.stage = stageNameMap[r.stageId]; });

  const smokePipe = pipelines.find(p => /smoke/i.test(p.name));
  const hwsPipe   = pipelines.find(p => /hws|hot.?water/i.test(p.name));

  const smokeOpps = smokePipe
    ? mapped.filter(r => r.pipelineId === smokePipe.id)
    : mapped.filter(r => !/hws|hot.?water|sales/i.test(r.pipeline));

  const hwsOpps = hwsPipe
    ? mapped.filter(r => r.pipelineId === hwsPipe.id)
    : mapped.filter(r => /hws|hot.?water/i.test(r.pipeline));

  console.log(`[Opps] Smoke: ${smokeOpps.length}, HWS: ${hwsOpps.length}`);
  return { smokeOpps, hwsOpps };
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

// Google Ads spend (ex-GST) â€" calls Google Ads API directly (same logic as google-spend.js)
// Avoids unreliable internal Vercel self-calls from cron jobs.
async function fetchGoogleSpend(since, until, campaignFilter = '', excludeFilter = '') {
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
      console.warn('[Google] Missing env vars â€" skipping Google spend');
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
      SELECT campaign.name, metrics.cost_micros
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
        const name = (row.campaign?.name || '').toLowerCase();
        if (campaignFilter && !name.includes(campaignFilter.toLowerCase())) return;
        if (excludeFilter && name.includes(excludeFilter.toLowerCase())) return;
        const m = row.metrics || {};
        totalMicros += parseInt(m.costMicros ?? m.cost_micros ?? '0', 10) || 0;
      });
    }

    // Google returns inc-GST AUD â†' divide by 1.1 for ex-GST (matches dashboard)
    return (totalMicros / 1_000_000) / 1.1;
  } catch(e) {
    console.warn('[Google] fetchGoogleSpend error:', e.message);
    return 0;
  }
}



function buildEmail({ today, last7, prior7, dailyDates, dateStr, smoke, hws }) {
  const GOLD   = '#b08d2e';
  const DARK   = '#141c2e';
  const MUTED  = '#6b7899';
  const GREEN  = '#18a96e';
  const RED    = '#e04f4f';
  const BLUE   = '#2d6be4';
  const TEAL   = '#0ea4ac';
  const BORDER = '#e3e7ef';
  const F      = 'font-family:Arial,Helvetica,sans-serif;';

  // Section label style
  const SL = `${F}font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1.4px;color:${MUTED};margin:0 0 12px 0;`;
  // Table header cell style
  const TH = `${F}font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:0.7px;color:${MUTED};padding:9px 14px;border-bottom:2px solid ${BORDER};background:#f8f9fb;white-space:nowrap;`;
  // Table data cell style
  const TD = `${F}font-size:13px;color:${DARK};padding:10px 14px;border-bottom:1px solid ${BORDER};`;

  function trend(curr, prior) {
    if (!prior) return '';
    const diff = curr - prior;
    if (Math.abs(diff) < 0.005) return `<span style="${F}font-size:10px;color:${MUTED};">No change</span>`;
    const col = diff > 0 ? GREEN : RED;
    const arrow = diff > 0 ? '&#8593;' : '&#8595;';
    return `<span style="${F}font-size:10px;color:${col};">${arrow}&nbsp;${Math.abs(diff)} vs prior 7d</span>`;
  }

  // ── Stat grid: 5 equal cells in one bordered table row ──
  function statGrid(cells) {
    const last = cells.length - 1;
    const tds = cells.map((c, i) => {
      const br = i < last ? `border-right:1px solid ${BORDER};` : '';
      return `<td valign="top" width="20%" style="padding:16px 14px;${br}vertical-align:top;">
        <p style="${F}font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:${MUTED};margin:0 0 8px 0;">${c.label}</p>
        <p style="${F}font-size:28px;font-weight:bold;line-height:1;color:${c.color || DARK};margin:0;">${c.value}</p>
        ${c.sub ? `<p style="${F}font-size:10px;color:${MUTED};margin:5px 0 0 0;line-height:1.4;">${c.sub}</p>` : ''}
      </td>`;
    }).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};border-collapse:collapse;">\n<tr>${tds}</tr>\n</table>`;
  }

  const SOURCE_COLORS = {
    Meta: BLUE, Google: GREEN, 'Organic Search': '#7251c2',
    'Organic Social': '#d98c1e', Direct: TEAL, Referral: '#6b7899', Unknown: '#94a3b8',
  };

  function buildSection(label, accentColor, opps, metaSpendToday, metaSpendLast7, googleSpendToday, googleSpendLast7, showMeta) {
    const todayKPIs  = calcKPIs(filterRange(opps, today.from,  today.to));
    const last7KPIs  = calcKPIs(filterRange(opps, last7.from,  last7.to));
    const prior7KPIs = calcKPIs(filterRange(opps, prior7.from, prior7.to));

    const spendToday = metaSpendToday + googleSpendToday;
    const spendLast7 = metaSpendLast7 + googleSpendLast7;

    const todayCPL = todayKPIs.total > 0 && spendToday > 0 ? spendToday / todayKPIs.total : null;
    const todayCPI = todayKPIs.inst  > 0 && spendToday > 0 ? spendToday / todayKPIs.inst  : null;
    const last7CPL = last7KPIs.total > 0 && spendLast7 > 0 ? spendLast7 / last7KPIs.total : null;
    const last7CPI = last7KPIs.inst  > 0 && spendLast7 > 0 ? spendLast7 / last7KPIs.inst  : null;

    const spendSubToday = showMeta
      ? `Meta $${metaSpendToday.toFixed(2)} + Google $${googleSpendToday.toFixed(2)}`
      : `Google $${googleSpendToday.toFixed(2)}`;
    const spendSubLast7 = showMeta
      ? `Meta $${metaSpendLast7.toFixed(2)} + Google $${googleSpendLast7.toFixed(2)}`
      : `Google $${googleSpendLast7.toFixed(2)}`;

    // Source pills for today
    const todaySrcCount = {};
    filterRange(opps, today.from, today.to).forEach(r => {
      const src = r.source || 'Unknown';
      todaySrcCount[src] = (todaySrcCount[src] || 0) + 1;
    });
    const pills = Object.entries(todaySrcCount)
      .sort((a, b) => b[1] - a[1])
      .map(([src, cnt]) => {
        const col = SOURCE_COLORS[src] || '#94a3b8';
        return `<span style="display:inline-block;background:${col}18;border:1px solid ${col}44;color:${col};${F}font-size:11px;font-weight:bold;padding:3px 10px;border-radius:20px;margin:0 4px 4px 0;">${cnt} ${displaySourceLabel(src)}</span>`;
      }).join('');

    // Stage table rows (today)
    const stageRows = todayKPIs.breakdown.length > 0
      ? todayKPIs.breakdown.map(({ stage, count }) => {
          const display = stage === 'Won/Installed' ? 'Installed' : stage === 'Qualified/IHA Complete' ? 'Qualified' : stage;
          const pct = todayKPIs.total > 0 ? ((count / todayKPIs.total) * 100).toFixed(1) : '0';
          const barW = Math.round((count / todayKPIs.total) * 100);
          return `<tr>
            <td style="${TD}width:55%;">${display}</td>
            <td style="${TD}text-align:center;font-weight:bold;width:60px;">${count}</td>
            <td style="${TD}width:120px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="width:${barW}%;background:${accentColor}55;height:6px;border-radius:3px 0 0 3px;font-size:0;">&nbsp;</td>
                  ${barW < 100 ? `<td style="width:${100-barW}%;height:6px;font-size:0;">&nbsp;</td>` : ''}
                </tr>
              </table>
              <p style="${F}font-size:11px;color:${MUTED};margin:3px 0 0 0;">${pct}%</p>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="3" style="padding:14px;${F}font-size:13px;color:${MUTED};text-align:center;">No leads recorded today</td></tr>`;

    // Daily breakdown rows
    const dayRows = dailyDates.map((day, i) => {
      const kpi      = calcKPIs(filterRange(opps, day, day));
      const isToday  = i === 0;
      const dayLabel = isToday ? 'Today'
        : new Date(day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
      const bg  = isToday ? '#fffdf5' : '#ffffff';
      const fw  = isToday ? 'bold' : 'normal';
      const lc  = isToday ? GOLD : DARK;
      const B   = `border-bottom:${isToday ? `2px solid ${accentColor}` : `1px solid ${BORDER}`};background:${bg};`;
      return `<tr>
        <td style="${TD}font-weight:${fw};color:${lc};${B}">${dayLabel}</td>
        <td style="${TD}text-align:center;font-weight:${fw};${B}">${kpi.total}</td>
        <td style="${TD}text-align:center;font-weight:${fw};color:${kpi.inst > 0 ? GREEN : DARK};${B}">${kpi.inst}</td>
        <td style="${TD}text-align:center;color:${MUTED};${B}">${kpi.closeRate}%</td>
        <td style="${TD}text-align:center;color:${kpi.notInt > 0 ? RED : MUTED};${B}">${kpi.notInt}</td>
      </tr>`;
    }).join('');

    const P = 'padding:24px 32px 0;'; // section padding

    return `
    <!-- ===== ${label} ===== -->
    <tr><td style="${P}background:#ffffff;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="border-left:4px solid ${accentColor};padding:10px 0 10px 16px;background:#fafbfc;">
            <p style="${F}font-size:15px;font-weight:bold;color:${DARK};margin:0;">${label}</p>
          </td>
        </tr>
      </table>
    </td></tr>

    <!-- TODAY -->
    <tr><td style="${P}background:#ffffff;">
      <p style="${SL}">Today &mdash; ${today.from}</p>
      ${todayKPIs.total === 0 ? `<p style="${F}font-size:12px;font-weight:bold;color:#d97706;margin:0 0 12px 0;">&#9888; No new leads recorded today.</p>` : ''}
      ${statGrid([
        { label: 'New Leads',    value: todayKPIs.total, color: DARK },
        { label: 'Installed',    value: todayKPIs.inst,  color: todayKPIs.inst > 0 ? GREEN : DARK, sub: `${todayKPIs.closeRate}% close rate` },
        { label: 'Ad Spend',     value: spendToday > 0 ? `$${spendToday.toFixed(2)}` : '&mdash;', sub: spendSubToday },
        { label: 'Cost / Lead',  value: todayCPL !== null ? `$${todayCPL.toFixed(2)}` : '&mdash;', sub: 'ex-GST' },
        { label: 'Cost / Install', value: todayCPI !== null ? `$${todayCPI.toFixed(2)}` : '&mdash;', sub: 'ex-GST' },
      ])}
      ${todayKPIs.total > 0 ? `<p style="margin:10px 0 0 0;">${pills}</p>` : ''}
    </td></tr>

    <!-- PIPELINE STAGES: TODAY -->
    <tr><td style="${P}background:#ffffff;">
      <p style="${SL}">Pipeline Stages &mdash; Today</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
        <tr>
          <td style="${TH}text-align:left;">Stage</td>
          <td style="${TH}text-align:center;width:60px;">Count</td>
          <td style="${TH}width:120px;">Share</td>
        </tr>
        ${stageRows}
      </table>
    </td></tr>

    <!-- LAST 7 DAYS -->
    <tr><td style="${P}background:#ffffff;">
      <p style="${SL}">Last 7 Days</p>
      ${statGrid([
        { label: 'Leads',        value: last7KPIs.total, sub: trend(last7KPIs.total, prior7KPIs.total) },
        { label: 'Installed',    value: last7KPIs.inst,  color: last7KPIs.inst > 0 ? GREEN : DARK, sub: trend(last7KPIs.inst, prior7KPIs.inst) || `${last7KPIs.closeRate}% close rate` },
        { label: 'Ad Spend',     value: `$${spendLast7.toFixed(2)}`, sub: spendSubLast7 },
        { label: 'Cost / Lead',  value: last7CPL !== null ? `$${last7CPL.toFixed(2)}` : '&mdash;', sub: 'ex-GST' },
        { label: 'Cost / Install', value: last7CPI !== null ? `$${last7CPI.toFixed(2)}` : '&mdash;', sub: 'ex-GST' },
      ])}
    </td></tr>

    <!-- DAILY BREAKDOWN -->
    <tr><td style="${P}padding-bottom:0;background:#ffffff;">
      <p style="${SL}">Daily Breakdown &mdash; Last 7 Days</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${BORDER};">
        <tr>
          <td style="${TH}text-align:left;">Day</td>
          <td style="${TH}text-align:center;width:70px;">Leads</td>
          <td style="${TH}text-align:center;width:80px;">Installed</td>
          <td style="${TH}text-align:center;width:70px;">Close %</td>
          <td style="${TH}text-align:center;width:70px;">Not Int.</td>
        </tr>
        ${dayRows}
        <tr style="background:#f8f9fb;">
          <td style="${TD}font-weight:bold;border-bottom:none;">7-Day Total</td>
          <td style="${TD}text-align:center;font-weight:bold;border-bottom:none;">${last7KPIs.total}</td>
          <td style="${TD}text-align:center;font-weight:bold;color:${last7KPIs.inst > 0 ? GREEN : DARK};border-bottom:none;">${last7KPIs.inst}</td>
          <td style="${TD}text-align:center;color:${MUTED};border-bottom:none;">${last7KPIs.closeRate}%</td>
          <td style="${TD}text-align:center;color:${MUTED};border-bottom:none;">${last7KPIs.notInt}</td>
        </tr>
      </table>
    </td></tr>

    <!-- DIVIDER -->
    <tr><td style="padding:28px 32px 0;background:#ffffff;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="1" bgcolor="${BORDER}" style="font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>
    </td></tr>`;
  }

  const smokeSection = buildSection(
    'Smoke Alarms', GOLD,
    smoke.opps, smoke.metaToday, smoke.metaLast7, smoke.googleToday, smoke.googleLast7, true
  );
  const hwsSection = buildSection(
    'Hot Water Systems (HWS)', TEAL,
    hws.opps, 0, 0, hws.googleToday, hws.googleLast7, false
  );

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Goldsure Daily Report</title>
</head>
<body style="margin:0;padding:0;background-color:#eef0f4;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef0f4">
<tr><td align="center" style="padding:28px 16px;">
<table width="620" cellpadding="0" cellspacing="0" border="0" style="border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

  <!-- HEADER -->
  <tr>
    <td bgcolor="#0d1117" style="padding:28px 32px 26px;border-radius:8px 8px 0 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle">
            <img src="https://raw.githubusercontent.com/vigneshkcom/Goldsure/277e079b062a260a6792933542c58229d3801b86/assets/goldsure-inverted-logo.jpg"
                 alt="Goldsure" width="100" style="display:block;border:0;" />
            <p style="${F}font-size:10px;color:${GOLD};margin:6px 0 0 0;letter-spacing:1px;text-transform:uppercase;">Daily Performance Report</p>
          </td>
          <td align="right" valign="middle">
            <p style="${F}font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,0.3);margin:0 0 5px 0;">Report Date</p>
            <p style="${F}font-size:13px;color:#ffffff;margin:0;font-weight:bold;">${dateStr}</p>
          </td>
        </tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);">
        <tr><td>
          <p style="${F}font-size:12px;color:rgba(255,255,255,0.5);line-height:1.6;margin:0;">Today's performance summary &mdash; Smoke Alarms &amp; Hot Water Systems.</p>
        </td></tr>
      </table>
    </td>
  </tr>

  <!-- WHITE BODY -->
  <tr><td bgcolor="#ffffff">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      ${smokeSection}
      ${hwsSection}
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr>
    <td bgcolor="#0d1117" style="padding:16px 32px;border-radius:0 0 8px 8px;" align="center">
      <p style="${F}font-size:11px;font-weight:bold;color:rgba(255,255,255,0.7);margin:0 0 2px 0;">Goldsure Pty Ltd</p>
      <p style="${F}font-size:10px;color:rgba(255,255,255,0.3);margin:0;">Suite 4, Level 1, 293 High Street, Preston VIC 3072 &bull; Auto-generated report</p>
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
  const recipients = ['vignesh@goldsure.com.au', 'accounts@goldsure.com.au'];

  if (!resendKey)               return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!process.env.GHL_API_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const nowUtc     = new Date();
    const todayStr   = nowUtc.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
    const today      = new Date(todayStr + 'T12:00:00');
    const ranges     = buildRanges(today);
    const dailyDates = buildDailyDates(today);
    const dateStr    = nowUtc.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const { smokeOpps, hwsOpps } = await loadAllOpportunities();

    const [
      metaSmokeToday, metaSmokeLast7,
      googleSmokeToday, googleSmokeLast7,
      googleHwsToday, googleHwsLast7,
    ] = await Promise.all([
      fetchMetaSpend(ranges.today.from, ranges.today.to),
      fetchMetaSpend(ranges.last7.from, ranges.last7.to),
      fetchGoogleSpend(ranges.today.from, ranges.today.to, '', 'heatpump'),
      fetchGoogleSpend(ranges.last7.from, ranges.last7.to, '', 'heatpump'),
      fetchGoogleSpend(ranges.today.from, ranges.today.to, 'heatpump'),
      fetchGoogleSpend(ranges.last7.from, ranges.last7.to, 'heatpump'),
    ]);

    const html = buildEmail({
      today: ranges.today, last7: ranges.last7, prior7: ranges.prior7, dailyDates, dateStr,
      smoke: { opps: smokeOpps, metaToday: metaSmokeToday, metaLast7: metaSmokeLast7, googleToday: googleSmokeToday, googleLast7: googleSmokeLast7 },
      hws:   { opps: hwsOpps,   googleToday: googleHwsToday, googleLast7: googleHwsLast7 },
    });

    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    'Vignesh <vignesh@goldsure.com.au>',
        to:      recipients,
        subject: `Goldsure Daily Report — ${dateStr}`,
        html,
      }),
    });

    const emailData = await emailResp.json();
    if (!emailResp.ok) return res.status(500).json({ error: 'Resend failed', detail: emailData });

    return res.status(200).json({
      ok:      true,
      sent_to: recipients,
      date:    ranges.today.from,
      smoke: {
        leads:       smokeOpps.length,
        metaSpend:   metaSmokeToday,
        googleSpend: googleSmokeToday,
      },
      hws: {
        leads:       hwsOpps.length,
        googleSpend: googleHwsToday,
      },
    });

  } catch (err) {
    console.error('send-report error:', err);
    return res.status(500).json({ error: err.message });
  }
}
