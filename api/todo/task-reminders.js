import { sendHostingerMail } from '../../lib/hostinger-mail.js';

// Sweeps the task board every 15 minutes and emails an assignee when a task
// they own reaches its optional due time. Tasks without a due_time are covered
// by the daily digest in api/smoke-alarms/automatic-reminders.js instead.
export const config = { maxDuration: 60 };

const SYDNEY = 'Australia/Sydney';
// Don't chase tasks whose time slipped by long ago — the daily digest already
// lists everything overdue, and a cron outage should not fire a burst of mail.
const LATE_GRACE_MINUTES = 180;

const AGENT_EMAIL_FALLBACK = {
  Vignesh: 'vignesh@goldsure.com.au',
  David: 'david@goldsure.com.au',
  Shanira: 'shanira@goldsure.com.au',
  Alda: 'alda@goldsure.com.au',
  Amit: 'amit@goldsure.com.au',
};

// TODO_AGENT_EMAILS overrides the map above, e.g. "Vignesh:v@x.com,Amit:a@x.com".
function agentEmails() {
  const map = { ...AGENT_EMAIL_FALLBACK };
  for (const pair of String(process.env.TODO_AGENT_EMAILS || '').split(',')) {
    const [name, email] = pair.split(':').map(part => part && part.trim());
    if (name && email) map[name] = email;
  }
  return map;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Sydney wall-clock parts, so due_date/due_time compare as plain local values
// and never drift with UTC offset or daylight saving.
function sydneyNow(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  // Intl can render midnight as hour 24; normalise it to 00.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` };
}

const minutesOf = hhmm => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h * 60) + m;
};

function reminderHtml({ task, origin, dueLabel }) {
  const priorityColour = { urgent: '#d83a52', high: '#c26b00', normal: '#0073ea', low: '#087657' };
  return `<!doctype html><html><body style="margin:0;background:#f3f5f8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#fff;border:1px solid #e2e5eb;border-radius:10px;overflow:hidden">
  <tr><td style="background:#111827;padding:22px 26px;border-bottom:3px solid #c9a13b">
    <div style="font:700 19px Arial,sans-serif;color:#fff">Task due now</div>
    <div style="font:12px Arial,sans-serif;color:#c8ced9;margin-top:5px">${escapeHtml(dueLabel)}</div>
  </td></tr>
  <tr><td style="padding:24px 26px 6px">
    <div style="font:700 17px Arial,sans-serif;color:#323338;line-height:1.4">${escapeHtml(task.title)}</div>
    ${task.description ? `<div style="font:13px/1.55 Arial,sans-serif;color:#676879;margin-top:8px">${escapeHtml(task.description)}</div>` : ''}
    <div style="margin-top:14px">
      <span style="display:inline-block;font:700 10px Arial,sans-serif;text-transform:uppercase;letter-spacing:.6px;color:${priorityColour[task.priority] || '#0073ea'}">${escapeHtml(task.priority)} priority</span>
    </div>
  </td></tr>
  <tr><td style="padding:18px 26px 26px">
    <a href="${origin}/todo/" style="display:inline-block;background:#0073ea;color:#fff;text-decoration:none;border-radius:6px;padding:11px 18px;font:700 13px Arial,sans-serif">Open task board</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase is not configured' });
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const now = new Date();
  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const { date: todayText, time: nowText } = sydneyNow(now);

  try {
    // Candidates: unfinished, un-reminded tasks carrying a due time, due today
    // or earlier. The exact time comparison happens below in Sydney terms.
    const query = `${supabaseUrl}/rest/v1/portal_tasks`
      + `?select=id,title,description,assignee,due_date,due_time,priority`
      + `&status=in.(todo,followup)&archived_at=is.null`
      + `&due_time=not.is.null&reminder_sent_at=is.null&due_date=lte.${todayText}`
      + `&order=due_date.asc`;
    const response = await fetch(query, { headers });
    if (!response.ok) {
      return res.status(200).json({ ok: false, error: 'task_table_unavailable' });
    }

    const nowMinutes = minutesOf(nowText);
    const due = (await response.json()).filter(task => {
      const taskTime = String(task.due_time).slice(0, 5);
      if (task.due_date < todayText) {
        // Yesterday or earlier: only chase it if it slipped inside the grace window.
        const minutesLate = ((new Date(`${todayText}T00:00:00Z`) - new Date(`${task.due_date}T00:00:00Z`)) / 60000)
          + nowMinutes - minutesOf(taskTime);
        return minutesLate <= LATE_GRACE_MINUTES;
      }
      const minutesLate = nowMinutes - minutesOf(taskTime);
      return minutesLate >= 0 && minutesLate <= LATE_GRACE_MINUTES;
    });

    if (!due.length) return res.status(200).json({ ok: true, checked: todayText, sent: 0 });

    const emails = agentEmails();
    const results = [];
    for (const task of due) {
      const to = emails[task.assignee];
      if (!to) { results.push({ id: task.id, sent: false, reason: 'no_email_for_assignee' }); continue; }

      // Claim the task before sending so a retried invocation cannot double-mail.
      const claim = await fetch(
        `${supabaseUrl}/rest/v1/portal_tasks?id=eq.${task.id}&reminder_sent_at=is.null`,
        { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ reminder_sent_at: new Date().toISOString() }) }
      );
      if (!claim.ok || !(await claim.json()).length) {
        results.push({ id: task.id, sent: false, reason: 'already_claimed' });
        continue;
      }

      const timeLabel = String(task.due_time).slice(0, 5);
      const dueLabel = `${new Date(`${task.due_date}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} at ${timeLabel}`;
      try {
        await sendHostingerMail({
          to: [to],
          displayName: 'Goldsure Team Tasks',
          subject: `Due now: ${task.title}`,
          html: reminderHtml({ task, origin, dueLabel }),
          text: `${task.title}\n\n${task.description || ''}\n\nDue ${dueLabel}\nPriority: ${task.priority}\n\nOpen: ${origin}/todo/`,
        });
        results.push({ id: task.id, sent: true, to });
      } catch (error) {
        // Release the claim so the next sweep retries this task.
        await fetch(`${supabaseUrl}/rest/v1/portal_tasks?id=eq.${task.id}`, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_sent_at: null }),
        }).catch(() => {});
        console.error('[Task reminder]', task.id, error);
        results.push({ id: task.id, sent: false, reason: 'email_failed' });
      }
    }

    return res.status(200).json({
      ok: true,
      checked: `${todayText} ${nowText}`,
      candidates: due.length,
      sent: results.filter(item => item.sent).length,
      results,
    });
  } catch (error) {
    console.error('[Task reminders]', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
