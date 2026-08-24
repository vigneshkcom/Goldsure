import { sendHostingerMail } from '../../lib/hostinger-mail.js';

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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function addCalendarDays(dateText, days) {
  const [year, month, day] = dateText.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function sendTaskDigest({ supabaseUrl, serviceKey, origin, now }) {
  try {
    const digestDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    const horizon = addCalendarDays(digestDate, 7);
    const tasksResponse = await fetch(
      `${supabaseUrl}/rest/v1/portal_tasks?select=id,title,description,assignee,due_date,priority&status=eq.open&archived_at=is.null&due_date=lte.${horizon}&order=due_date.asc`,
      { headers: supabaseHeaders(serviceKey) }
    );
    if (!tasksResponse.ok) return { sent: false, error: 'task_table_unavailable' };
    // Priority is text, so ordering it in SQL sorts alphabetically
    // (high, low, normal, urgent) and buries urgent work. Rank it explicitly.
    const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
    const tasks = (await tasksResponse.json())
      .sort((a, b) => a.due_date.localeCompare(b.due_date)
        || ((priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)));
    if (!tasks.length) return { sent: false, taskCount: 0, reason: 'nothing_due' };

    // Claim the Sydney calendar day before sending, preventing duplicate mail
    // if Vercel retries the cron invocation.
    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs`, {
      method: 'POST',
      headers: supabaseHeaders(serviceKey, 'resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify({ digest_date: digestDate, task_count: tasks.length }),
    });
    if (!claimResponse.ok) return { sent: false, error: 'digest_claim_failed' };
    const claimed = await claimResponse.json();
    if (!claimed.length) return { sent: false, taskCount: tasks.length, reason: 'already_sent' };

    const priorityColour = { urgent: '#d83a52', high: '#c26b00', normal: '#0073ea', low: '#087657' };
    const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const sections = [
      { title: 'Overdue', rows: tasks.filter(task => task.due_date < digestDate), colour: '#d83a52' },
      { title: 'Due today', rows: tasks.filter(task => task.due_date === digestDate), colour: '#0073ea' },
      { title: 'Coming up', rows: tasks.filter(task => task.due_date > digestDate), colour: '#00a86b' },
    ].filter(section => section.rows.length);
    const sectionsHtml = sections.map(section => `<tr><td style="padding:18px 28px 8px"><div style="font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;color:${section.colour}">${section.title} (${section.rows.length})</div></td></tr><tr><td style="padding:0 28px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${section.rows.map(task => `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e9ef;vertical-align:top"><div style="font:700 14px Arial,sans-serif;color:#323338">${escapeHtml(task.title)}</div>${task.description ? `<div style="font:12px/1.45 Arial,sans-serif;color:#676879;margin-top:3px">${escapeHtml(task.description)}</div>` : ''}</td><td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid #e6e9ef;vertical-align:top;white-space:nowrap"><div style="font:700 13px Arial,sans-serif;color:#323338">${escapeHtml(task.assignee)}</div><div style="font:12px Arial,sans-serif;color:#676879;margin-top:3px">${dateLabel(task.due_date)}</div><div style="font:700 10px Arial,sans-serif;text-transform:uppercase;color:${priorityColour[task.priority] || '#0073ea'};margin-top:5px">${escapeHtml(task.priority)}</div></td></tr>`).join('')}</table></td></tr>`).join('');
    const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#fff;border:1px solid #e2e5eb;border-radius:10px;overflow:hidden"><tr><td style="background:#111827;padding:24px 28px;border-bottom:3px solid #c9a13b"><div style="font:700 21px Arial,sans-serif;color:#fff">Goldsure Team Tasks</div><div style="font:12px Arial,sans-serif;color:#c8ced9;margin-top:6px">Daily assignment summary · ${dateLabel(digestDate)}</div></td></tr>${sectionsHtml}<tr><td style="padding:18px 28px 26px"><a href="${origin}/todo/" style="display:inline-block;background:#0073ea;color:#fff;text-decoration:none;border-radius:6px;padding:11px 18px;font:700 13px Arial,sans-serif">Open task board</a></td></tr></table></td></tr></table></body></html>`;
    const text = tasks.map(task => `${task.due_date} | ${task.assignee} | ${task.priority.toUpperCase()} | ${task.title}`).join('\n');
    // Every assignable agent gets the digest; Shanira and Alda were previously
    // omitted from the fallback list and so never received it.
    const recipients = String(process.env.TODO_DIGEST_RECIPIENTS || 'vignesh@goldsure.com.au,david@goldsure.com.au,amit@goldsure.com.au,shanira@goldsure.com.au,alda@goldsure.com.au').split(',').map(item => item.trim()).filter(Boolean);
    try {
      await sendHostingerMail({ to: recipients, displayName: 'Goldsure Team Tasks', subject: `Team tasks for ${dateLabel(digestDate)} (${tasks.length})`, html, text: `Goldsure team tasks\n\n${text}\n\nOpen: ${origin}/todo/` });
      await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${digestDate}`, { method: 'PATCH', headers: supabaseHeaders(serviceKey, 'return=minimal'), body: JSON.stringify({ sent_at: new Date().toISOString() }) });
      return { sent: true, taskCount: tasks.length, recipients: recipients.length };
    } catch (error) {
      await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${digestDate}&sent_at=is.null`, { method: 'DELETE', headers: supabaseHeaders(serviceKey, 'return=minimal') }).catch(() => {});
      return { sent: false, taskCount: tasks.length, error: 'email_failed' };
    }
  } catch (error) {
    console.error('[Task digest]', error);
    return { sent: false, error: 'unexpected_error' };
  }
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
    const [smoke, nsw, vicHotwater, vicAircon, taskDigest] = await Promise.all([
      runService({ table: 'quote_emails', reminderDays: REMINDER_DAYS, automationStart: AUTOMATION_START, sendPath: '/api/smoke-alarms/send-reminder', isNsw: false, ghlEndpoint: '/api/smoke-alarms/ghl', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'nsw_hws_quotes', reminderDays: NSW_REMINDER_DAYS, automationStart: NSW_AUTOMATION_START, sendPath: '/api/hotwater-nsw/send', isNsw: true, ghlPipeline: 'hotwater-nsw', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'hotwater_quotes', reminderDays: VIC_REMINDER_DAYS, automationStart: VIC_AUTOMATION_START, sendPath: '/api/battery/request-callback', action: 'hws-quote', isNsw: false, ghlPipeline: 'hotwater', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
      runService({ table: 'aircon_quotes', reminderDays: VIC_REMINDER_DAYS, automationStart: VIC_AUTOMATION_START, sendPath: '/api/battery/request-callback', action: 'aircon-quote', isNsw: false, ghlPipeline: 'aircon', ghlEndpoint: '/api/battery/request-callback', supabaseUrl, serviceKey, origin, now }),
      sendTaskDigest({ supabaseUrl, serviceKey, origin, now }),
    ]);
    return res.status(200).json({ ok: true, smoke, nsw, vicHotwater, vicAircon, taskDigest, completed_at: new Date().toISOString() });
  } catch (error) {
    console.error('[Automatic reminders]', error);
    return res.status(502).json({ error: 'Could not process automatic reminders.' });
  }
}
