// Read-only Dataforce lookups for the rescheduling page.
// Uses the same OAuth client and endpoints as the rest of the portal. Never writes.
const BASE = 'https://asap-api.dataforce.com.au';
const INSTANCE = 'GOLDSURE_ASAP';
const WORKERS = { 'Alex Symonds': 1009, 'Mason Adams': 1012 };
export const DAYS = { '2026-11-26': 'Alex Symonds', '2026-12-14': 'Mason Adams', '2026-12-15': 'Mason Adams', '2026-12-16': 'Mason Adams' };

const text = v => String(v ?? '').trim();
export function dateKey(value) {
  const t = text(value);
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const df = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!df) return '';
  const m = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(df[2].toLowerCase());
  return m < 0 ? '' : `${df[3]}-${String(m + 1).padStart(2, '0')}-${String(df[1]).padStart(2, '0')}`;
}
export function hourOf(value) {
  const t = text(value);
  const iso = t.match(/T(\d{1,2}):(\d{2})/);
  if (iso) return Number(iso[1]);
  const df = t.match(/\s(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!df) return null;
  let h = Number(df[1]);
  const pm = df[3].toUpperCase() === 'PM';
  if (pm && h < 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h;
}
export function timeLabel(value) {
  const h = hourOf(value);
  if (h === null) return '';
  const m = (text(value).match(/(?:T|\s)\d{1,2}:(\d{2})/) || [])[1] || '00';
  return `${((h + 11) % 12) + 1}:${m}${h >= 12 ? 'PM' : 'AM'}`;
}
const cancelled = a => /cancel/i.test(text(a?.completionStatusDescription));
const slotOf = value => { const h = hourOf(value); return h === null ? null : h < 12 ? 'AM' : 'PM'; };

async function token(fetchImpl, env) {
  const id = text(env.DATAFORCE_CLIENT_ID), secret = text(env.DATAFORCE_CLIENT_SECRET);
  if (!id || !secret) { const e = new Error('Dataforce is not connected'); e.status = 503; throw e; }
  const r = await fetchImpl(`${BASE}/authorization/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'appointment customer fieldworker job' }),
    signal: AbortSignal.timeout(10000),
  });
  const p = await r.json().catch(() => ({}));
  if (!r.ok || !p.access_token) { const e = new Error('Dataforce sign-in failed'); e.status = 502; throw e; }
  return p.access_token;
}
async function call(fetchImpl, tk, path, init = {}) {
  const r = await fetchImpl(`${BASE}/${INSTANCE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tk}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 404) return null;
  if (!r.ok) { const e = new Error(`Dataforce request failed (${r.status})`); e.status = 502; throw e; }
  return r.json();
}
const nextDay = d => { const v = new Date(`${d}T00:00:00Z`); v.setUTCDate(v.getUTCDate() + 1); return v.toISOString().slice(0, 10); };
async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// The appointment that currently represents a job: not cancelled, latest scheduled.
export function activeAppointment(list) {
  const live = (list || []).filter(a => a && !cancelled(a));
  if (!live.length) return null;
  return live.slice().sort((a, b) => text(b.scheduledDate).localeCompare(text(a.scheduledDate)))[0];
}

export async function readLive({ jobIds, fetchImpl = fetch, env = process.env }) {
  const tk = await token(fetchImpl, env);
  const jobs = {};
  const jobResults = await pool(jobIds, 6, async id => {
    try {
      const payload = await call(fetchImpl, tk, `/jobs/${encodeURIComponent(id)}/appointments`);
      const list = Array.isArray(payload) ? payload : (payload?.records || []);
      return [id, activeAppointment(list), list.length, null];
    } catch (e) { return [id, null, 0, e.message]; }
  });
  for (const [id, a, n, err] of jobResults) {
    if (err) { jobs[id] = { error: err }; continue; }
    if (!a) { jobs[id] = { found: false, appointments: n }; continue; }
    jobs[id] = {
      found: true, appointment_id: a.appointmentId ?? null, scheduled: text(a.scheduledDate),
      date: dateKey(a.scheduledDate), time: timeLabel(a.scheduledDate), slot: slotOf(a.scheduledDate),
      fieldworker_id: a.fieldworkerId ?? null, status: text(a.completionStatusDescription),
    };
  }
  // Real load on each worker/day (every appointment, including jobs not in the tracker).
  const days = {};
  await Promise.all(Object.entries(DAYS).map(async ([date, worker]) => {
    try {
      const items = []; let after = 0;
      for (let page = 0; page < 5; page++) {
        const r = await call(fetchImpl, tk, '/appointments/search', {
          method: 'POST',
          body: JSON.stringify({
            filterGroups: [{ filters: [
              { propertyName: 'fieldworkerId', value: String(WORKERS[worker]), operator: 'EQ' },
              { propertyName: 'scheduledDate', value: `${date}T00:00:00`, operator: 'GTE' },
              { propertyName: 'scheduledDate', value: `${nextDay(date)}T00:00:00`, operator: 'LT' },
            ] }],
            sorts: [{ propertyName: 'appointmentId', direction: 'asc' }], limit: 100, after,
          }),
        });
        const rows = r?.records || [];
        items.push(...rows); after += rows.length;
        if (!rows.length) break;
      }
      days[date] = { worker, ok: true, items: items.filter(a => !cancelled(a)).map(a => ({ job_id: a.jobId ?? null, slot: slotOf(a.scheduledDate), time: timeLabel(a.scheduledDate), status: text(a.completionStatusDescription) })) };
    } catch (e) { days[date] = { worker, ok: false, error: e.message }; }
  }));
  return { jobs, days, fetched_at: new Date().toISOString() };
}
