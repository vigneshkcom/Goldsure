// api/ringcentral/timeline.js
// Call Analytics feed for /calls/ — authenticates to RingCentral with the JWT
// auth flow and pulls the Call Business Analytics *Timeline* (calls per user,
// broken down by hour). Returns a normalised shape the dashboard renders.
//
// Env vars (set in Vercel):
//   RINGCENTRAL_CLIENT_ID, RINGCENTRAL_CLIENT_SECRET, RINGCENTRAL_JWT
//   RINGCENTRAL_SERVER          e.g. https://platform.ringcentral.com  (Production)
//   RINGCENTRAL_TIMELINE_PATH   (optional) override the analytics endpoint path
//   RINGCENTRAL_TIMEZONE        (optional) default Australia/Melbourne
//
// Notes:
//  - The analytics endpoints are rate-limited, so a successful response is cached
//    in module memory for a few minutes (best-effort; resets on cold start).
//  - `?debug=1` returns the raw RingCentral JSON so the exact field names can be
//    confirmed, then the normaliser locked down.

const TOKEN_PATH = '/restapi/oauth/token';
const DEFAULT_TIMELINE_PATH = '/analytics/calls/v1/accounts/~/timeline/fetch';

let _token = null;            // { access_token, expires_at }
const _cache = new Map();     // key -> { at, payload }
const CACHE_MS = 3 * 60 * 1000;

function server() { return (process.env.RINGCENTRAL_SERVER || 'https://platform.ringcentral.com').replace(/\/+$/, ''); }
function tz() { return process.env.RINGCENTRAL_TIMEZONE || 'Australia/Melbourne'; }

// ── Auth: JWT bearer grant → access token (cached until ~1 min before expiry) ──
async function getAccessToken() {
  if (_token && Date.now() < _token.expires_at - 60000) return _token.access_token;
  const id = process.env.RINGCENTRAL_CLIENT_ID, secret = process.env.RINGCENTRAL_CLIENT_SECRET, jwt = process.env.RINGCENTRAL_JWT;
  if (!id || !secret || !jwt) { const e = new Error('RingCentral env vars are not set.'); e.code = 'NO_CREDS'; throw e; }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt });
  const r = await fetch(server() + TOKEN_PATH, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Token request failed: ${r.status} ${data.error_description || data.error || ''}`.trim()); e.status = r.status; e.detail = data; throw e; }
  _token = { access_token: data.access_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return _token.access_token;
}

// ── Melbourne day → UTC instant range ──
function dayRange(which) {
  const now = new Date();
  const zone = tz();
  const ymdOf = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  // start-of-day (in `zone`) as a UTC instant, for the given yyyy-mm-dd
  const zonedMidnight = (ymd) => {
    const guess = new Date(`${ymd}T00:00:00Z`);
    const asZone = new Date(guess.toLocaleString('en-US', { timeZone: zone }));
    const asUtc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
    return new Date(guess.getTime() + (asUtc - asZone));
  };
  const todayYmd = ymdOf(now);
  if (which === 'yday') {
    const y = new Date(now.getTime() - 86400000);
    const ymd = ymdOf(y);
    return { timeFrom: zonedMidnight(ymd).toISOString(), timeTo: zonedMidnight(todayYmd).toISOString() };
  }
  return { timeFrom: zonedMidnight(todayYmd).toISOString(), timeTo: now.toISOString() };
}

// ── Best-effort normaliser (finalised once the raw shape is confirmed) ──
const HOURS = [8,9,10,11,12,13,14,15,16,17];
function num(v) { return typeof v === 'number' ? v : (v && typeof v === 'object' ? (v.value ?? v.count ?? 0) : (Number(v) || 0)); }
function hourFromIso(iso, zone) {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(new Date(iso))); }
  catch { return null; }
}
function normalize(raw) {
  const zone = tz();
  const records = raw?.data?.records || raw?.records || [];
  const agents = [];
  for (const rec of records) {
    const name = rec?.key?.name || rec?.grouping?.name || rec?.name || rec?.key?.id || 'Unknown';
    const series = rec?.dataItems || rec?.points || rec?.timeline || rec?.data || [];
    const hours = {};
    for (const p of (Array.isArray(series) ? series : [])) {
      const iso = p?.timeFrom || p?.time || p?.date || p?.key;
      const h = iso ? hourFromIso(iso, zone) : null;
      if (h == null) continue;
      const c = p?.counters || p?.counter || {};
      const t = p?.timers || p?.timer || {};
      const made = num(c.allCalls) || num(c.callsByDirection?.values?.Outbound) || num(c.outbound);
      const conn = num(c.callsByResult?.values?.Connected) || num(c.connected) || num(c.callsByResult?.values?.Answered);
      const dur = num(t.allCallsDuration) || num(t.callsDuration) || num(t.duration);
      hours[h] = { made, conn, dur };
    }
    if (Object.keys(hours).length) agents.push({ name, hours });
  }
  return agents;
}

async function fetchTimeline(range) {
  const token = await getAccessToken();
  const path = process.env.RINGCENTRAL_TIMELINE_PATH || DEFAULT_TIMELINE_PATH;
  const url = `${server()}${path}?perPage=1000&interval=Hour`;
  const bodyObj = {
    grouping: { groupBy: 'Users' },
    timeSettings: { timeZone: tz(), timeRange: { timeFrom: range.timeFrom, timeTo: range.timeTo } },
    responseOptions: {
      counters: { allCalls: true, callsByDirection: true, callsByResult: true },
      timers: { allCallsDuration: true },
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(bodyObj),
  });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Timeline request failed: ${r.status}`); e.status = r.status; e.detail = raw; e.sent = bodyObj; throw e; }
  return raw;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const which = (req.query?.date === 'yday') ? 'yday' : 'today';
  const debug = req.query?.debug === '1' || req.query?.debug === 'true';

  try {
    const cacheKey = which;
    const hit = _cache.get(cacheKey);
    if (hit && !debug && Date.now() - hit.at < CACHE_MS) {
      return res.status(200).json({ ok: true, cached: true, ...hit.payload });
    }
    const range = dayRange(which);
    const raw = await fetchTimeline(range);
    if (debug) return res.status(200).json({ ok: true, range, raw });
    const agents = normalize(raw);
    const payload = { date: which, range, agents, hours: HOURS, source: 'ringcentral' };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json({ ok: true, ...payload });
  } catch (err) {
    // Never hard-fail the dashboard — it falls back to its own demo data.
    const status = err.code === 'NO_CREDS' ? 200 : (err.status || 500);
    return res.status(status).json({ ok: false, error: err.message, detail: debug ? (err.detail || null) : undefined, sent: debug ? (err.sent || null) : undefined });
  }
}
