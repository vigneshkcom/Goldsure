export const config = { maxDuration: 300 };

const DAY_MS = 86400000;
const REMINDER_DAYS = [7, 14, 20];

function parseQuoteDate(value) {
  if (!value) return null;
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

async function claimReminder(supabaseUrl, serviceKey, quote, reminderNumber, claimedAt) {
  const currentCount = Math.max(0, parseInt(quote.reminder_count, 10) || 0);
  const countFilter = quote.reminder_count === null || quote.reminder_count === undefined
    ? 'reminder_count=is.null'
    : `reminder_count=eq.${currentCount}`;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/quote_emails?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent&${countFilter}`,
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

async function releaseReminderClaim(supabaseUrl, serviceKey, quote, reminderNumber) {
  await fetch(
    `${supabaseUrl}/rest/v1/quote_emails?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent&reminder_count=eq.${reminderNumber}`,
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
  const quotesResponse = await fetch(
    `${supabaseUrl}/rest/v1/quote_emails?select=*&status=eq.sent&order=sent_at.asc&limit=1000`,
    { headers: supabaseHeaders(serviceKey) }
  );
  if (!quotesResponse.ok) {
    return res.status(502).json({ error: 'Could not load sent quotes' });
  }

  const quotes = await quotesResponse.json();
  const expired = [];
  const due = [];
  let invalidDates = 0;

  for (const quote of quotes) {
    const issued = parseQuoteDate(quote.sent_at || quote.created_at);
    if (!issued) { invalidDates += 1; continue; }
    const ageDays = (now.getTime() - issued.getTime()) / DAY_MS;
    if (ageDays >= 21) {
      expired.push(quote);
      continue;
    }

    const reminderCount = Math.max(0, parseInt(quote.reminder_count, 10) || 0);
    if (reminderCount >= REMINDER_DAYS.length) continue;
    const dueDay = REMINDER_DAYS[reminderCount];
    if (ageDays < dueDay) continue;

    // A manual reminder also advances reminder_count. This cooldown prevents an
    // automatic email arriving too soon after a staff-triggered reminder.
    const lastReminder = parseQuoteDate(quote.last_reminder_sent_at);
    const previousDueDay = reminderCount === 0 ? 0 : REMINDER_DAYS[reminderCount - 1];
    const minimumGapDays = dueDay - previousDueDay;
    if (lastReminder && (now.getTime() - lastReminder.getTime()) / DAY_MS < minimumGapDays) continue;

    if (quote.quote_token && quote.customer_email) {
      due.push({ quote, reminderNumber: reminderCount + 1 });
    }
  }

  const expiryResults = await runInBatches(expired, 10, async quote => {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/quote_emails?id=eq.${encodeURIComponent(quote.id)}&status=eq.sent`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(serviceKey, 'return=minimal'),
        body: JSON.stringify({ status: 'expired' }),
      }
    );
    return response.ok;
  });

  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const reminderResults = await runInBatches(due, 4, async ({ quote, reminderNumber }) => {
    const claimedAt = new Date().toISOString();
    try {
      const claimed = await claimReminder(supabaseUrl, serviceKey, quote, reminderNumber, claimedAt);
      if (!claimed) return { state: 'duplicate' };

      const response = await fetch(`${origin}/api/smoke-alarms/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...quote, send_sms: false }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        await releaseReminderClaim(supabaseUrl, serviceKey, quote, reminderNumber);
        return { state: 'failed' };
      }
      return { state: 'sent' };
    } catch (error) {
      await releaseReminderClaim(supabaseUrl, serviceKey, quote, reminderNumber).catch(() => {});
      return { state: 'failed' };
    }
  });

  const count = state => reminderResults.filter(result => result.state === state).length;
  return res.status(200).json({
    ok: true,
    checked_sent_quotes: quotes.length,
    expired: expiryResults.filter(Boolean).length,
    reminders_sent: count('sent'),
    duplicates_skipped: count('duplicate'),
    reminders_failed: count('failed'),
    invalid_dates_skipped: invalidDates,
    completed_at: new Date().toISOString(),
  });
}
