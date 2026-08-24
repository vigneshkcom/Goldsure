export const config = { maxDuration: 300 };

const DAY_MS = 86400000;
const REMINDER_DAYS = [7, 14, 20];
const NSW_REMINDER_DAYS = [7, 14];
const VIC_REMINDER_DAYS = [7, 14];
// Only quotes sent after the user approved automation are eligible. Existing
// quotes must never be reminded or expired by this job.
const AUTOMATION_START = new Date('2026-08-24T06:20:32.673Z');
// NSW automation is intentionally backfilled across all existing Sent quotes;
// unlike the smoke-alarm rollout, the user requested historical NSW customers
// be included as well.
const NSW_AUTOMATION_START = new Date(0);
// VIC rollout starts at the beginning of today (AEST); older VIC quotes are
// deliberately excluded. Existing reminder_count values are preserved.
const VIC_AUTOMATION_START = new Date('2026-08-23T14:00:00.000Z');

const BLOCKED_GHL_STAGE_PHRASES = [
  'not interested',
  'spam',
  'quote not accepted',
  'unserviceable',
  'out of area',
  'lost',
  'won',
  'installed',
  'completed',
];

function isBlockedGhlOpportunity(info) {
  const stage = String(info?.stage || '').trim().toLowerCase();
  const status = String(info?.status || '').trim().toLowerCase();
  return ['lost', 'won', 'closed', 'abandoned'].includes(status)
    || BLOCKED_GHL_STAGE_PHRASES.some(phrase => stage.includes(phrase));
}

function parseQuoteDate(value) {
  if (!value) return null;
  // Older rows used a Queensland wall-clock string (MM/DD/YYYY HH:mm:ss)
  // without a timezone. Interpret those as AEST rather than Vercel's UTC.
  const legacy = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (legacy) {
    const [, month, day, year, hour, minute, second] = legacy.map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour - 10, minute, second));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function supabaseHeaders(serviceKey, prefer) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function claimReminder(supabaseUrl, serviceKey, table, quote, reminderNumber, claimedAt) {
  const currentCount = Math.max(0, parseInt(quote.reminder_count, 10) || 0);
  const countFilter = quote.reminder_count === null || quote.reminder_count === undefined
    ? 'reminder_count=is.null'
    : `reminder_count=eq.${currentCount}`;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent&${countFilter}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=representation'),
      body: JSON.stringify({ reminder_count: reminderNumber, last_reminder_sent_at: claimedAt }),
    }
  );
  if (!response.ok) throw new Error(`Reminder claim failed (${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function releaseReminderClaim(supabaseUrl, serviceKey, table, quote, reminderNumber) {
  await fetch(
    `${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent&reminder_count=eq.${reminderNumber}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=minimal'),
      body: JSON.stringify({
        reminder_count: Math.max(0, parseInt(quote.reminder_count, 10) || 0),
        last_reminder_sent_at: quote.last_reminder_sent_at || null,
      }),
    }
  );
}

async function runInBatches(items, batchSize, work) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...await Promise.all(batch.map(work)));
  }
  return results;
}

async function filterDueByGhl({ due, ghlPipeline, ghlEndpoint, origin }) {
  if (!due.length) return { eligible: [], excluded: 0, unverified: 0 };
  const emails = [...new Set(due.map(item => String(item.quote.customer_email || '').toLowerCase().trim()).filter(Boolean))];
  try {
    const response = await fetch(`${origin}${ghlEndpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ghlPipeline ? { action: 'quote-ghl-stages', pipeline: ghlPipeline, emails } : { emails }),
    });
    if (!response.ok) return { eligible: [], excluded: 0, unverified: due.length };
    const data = await response.json();
    const map = ghlPipeline ? data?.map : data;
    if (!map || typeof map !== 'object') return { eligible: [], excluded: 0, unverified: due.length };

    const eligible = [];
    let excluded = 0, unverified = 0;
    for (const item of due) {
      const email = String(item.quote.customer_email || '').toLowerCase().trim();
      const info = map[email];
      // Fail closed: if GHL cannot confirm the opportunity and stage, do not
      // send a reminder that could reach a lost/not-interested customer.
      if (!info || !info.stage) { unverified += 1; continue; }
      if (isBlockedGhlOpportunity(info)) { excluded += 1; continue; }
      eligible.push(item);
    }
    return { eligible, excluded, unverified };
  } catch (_) {
    return { eligible: [], excluded: 0, unverified: due.length };
  }
}

async function runService({ table, reminderDays, automationStart, sendPath, action, isNsw, ghlPipeline, ghlEndpoint, supabaseUrl, serviceKey, origin, now }) {
  const quotesResponse = await fetch(
    `${supabaseUrl}/rest/v1/${table}?select=*&status=eq.sent&order=sent_at.asc&limit=1000`,
    { headers: supabaseHeaders(serviceKey) }
  );
  if (!quotesResponse.ok) throw new Error(`Could not load ${table}`);

  const quotes = await quotesResponse.json();
  const expired = [];
  const due = [];
  let invalidDates = 0;

  for (const quote of quotes) {
    const issued = parseQuoteDate(quote.sent_at || quote.created_at);
    if (!issued) { invalidDates += 1; continue; }
    if (issued < automationStart) continue;
    const ageDays = (now.getTime() - issued.getTime()) / DAY_MS;
    if (ageDays >= 21) { expired.push(quote); continue; }

    const reminderCount = Math.max(0, parseInt(quote.reminder_count, 10) || 0);
    if (reminderCount >= reminderDays.length) continue;
    const dueDay = reminderDays[reminderCount];
    if (ageDays < dueDay) continue;

    const lastReminder = parseQuoteDate(quote.last_reminder_sent_at);
    const previousDueDay = reminderCount === 0 ? 0 : reminderDays[reminderCount - 1];
    if (lastReminder && (now.getTime() - lastReminder.getTime()) / DAY_MS < dueDay - previousDueDay) continue;
    if (quote.quote_token && quote.customer_email) due.push({ quote, reminderNumber: reminderCount + 1 });
  }

  const expiryResults = await runInBatches(expired, 10, async quote => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`, {
      method: 'PATCH', headers: supabaseHeaders(serviceKey, 'return=minimal'), body: JSON.stringify({ status: 'expired' }),
    });
    return response.ok;
  });

  const ghlCheck = await filterDueByGhl({ due, ghlPipeline, ghlEndpoint, origin });
  const reminderResults = await runInBatches(ghlCheck.eligible, 4, async ({ quote, reminderNumber }) => {
    const claimedAt = new Date().toISOString();
    try {
      if (!await claimReminder(supabaseUrl, serviceKey, table, quote, reminderNumber, claimedAt)) return { state: 'duplicate' };
      const response = await fetch(`${origin}${sendPath}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...quote, ...(action ? { action } : {}), ...(isNsw || action ? { is_reminder: true } : {}), send_sms: false }),
      });
      if (!response.ok) {
        await releaseReminderClaim(supabaseUrl, serviceKey, table, quote, reminderNumber);
        return { state: 'failed' };
      }
      return { state: 'sent' };
    } catch (_) {
      await releaseReminderClaim(supabaseUrl, serviceKey, table, quote, reminderNumber).catch(() => {});
      return { state: 'failed' };
    }
  });

  const count = state => reminderResults.filter(result => result.state === state).length;
  return {
    checked: quotes.length,
    expired: expiryResults.filter(Boolean).length,
    remindersSent: count('sent'),
    duplicatesSkipped: count('duplicate'),
    remindersFailed: count('failed'),
    ghlExcluded: ghlCheck.excluded,
    ghlUnverifiedSkipped: ghlCheck.unverified,
    invalidDates,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Database configuration is incomplete' });
  }

  const now = new Date();
  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  try {
    const [smoke, nsw, vicHotwater, vicAircon] = await Promise.all([
      runService({ table: 'quote_emails', reminderDays: REMINDER_DAYS, automationStart: AUTOMATION_START, sendPath: '/api/smoke-alarms/send-reminder', isNsw: false, ghlEndpoint: '/api/smoke-alarms/ghl', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'nsw_hws_quotes', reminderDays: NSW_REMINDER_DAYS, automationStart: NSW_AUTOMATION_START, sendPath: '/api/hotwater-nsw/send', isNsw: true, ghlPipeline: 'hotwater-nsw', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'hotwater_quotes', reminderDays: VIC_REMINDER_DAYS, automationStart: VIC_AUTOMATION_START, sendPath: '/api/battery/request-callback', action: 'hws-quote', isNsw: false, ghlPipeline: 'hotwater', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'aircon_quotes', reminderDays: VIC_REMINDER_DAYS, automationStart: VIC_AUTOMATION_START, sendPath: '/api/battery/request-callback', action: 'aircon-quote', isNsw: false, ghlPipeline: 'aircon', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
    ]);
    return res.status(200).json({ ok: true, smoke, nsw, vicHotwater, vicAircon, completed_at: new Date().toISOString() });
  } catch (error) {
    console.error('[Automatic reminders]', error);
    return res.status(502).json({ error: 'Could not process automatic reminders.' });
  }
}
