import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { AGENT_EMAILS } from '../../lib/portal-agents.js';

// Vercel cron schedules are UTC. This endpoint is invoked at both possible UTC
// equivalents of 9:05 am Sydney, then only sends during Sydney's 9 am hour.
// That keeps the delivery time correct across AEST and AEDT.
export const config = { maxDuration: 60 };

const SYDNEY = 'Australia/Sydney';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function sydneyParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, minute: parts.minute };
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function timeLabel(value) {
  if (!value) return '';
  const [hour, minute] = String(value).slice(0, 5).split(':').map(Number);
  const suffix = hour < 12 ? 'am' : 'pm';
  const displayHour = hour % 12 || 12;
  return `${displayHour}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${suffix}`;
}

function taskRows(tasks, today) {
  if (!tasks.length) {
    return `<tr><td style="padding:26px 28px"><div style="font:700 16px Arial,sans-serif;color:#323338">Nothing due today</div><div style="font:13px/1.55 Arial,sans-serif;color:#676879;margin-top:6px">You have no To Do tasks due or overdue.</div></td></tr>`;
  }

  const sections = [
    { title: 'Overdue', colour: '#d83a52', tasks: tasks.filter(task => task.due_date < today) },
    { title: 'Due today', colour: '#0073ea', tasks: tasks.filter(task => task.due_date === today) },
  ].filter(section => section.tasks.length);

  return sections.map(section => `<tr><td style="padding:20px 28px 7px"><div style="font:700 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:.8px;color:${section.colour}">${section.title} (${section.tasks.length})</div></td></tr><tr><td style="padding:0 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${section.tasks.map(task => {
    const due = task.due_date === today ? (timeLabel(task.due_time) || 'Today') : dateLabel(task.due_date);
    const customer = task.customer_name
      ? `<div style="font:12px Arial,sans-serif;color:#4f5870;margin-top:7px"><strong>${escapeHtml(task.customer_name)}</strong>${task.customer_phone ? ` &middot; ${escapeHtml(task.customer_phone)}` : ''}</div>`
      : '';
    return `<tr><td style="padding:13px 0;border-bottom:1px solid #e6e9ef;vertical-align:top"><div style="font:700 14px Arial,sans-serif;color:#323338">${escapeHtml(task.title)}</div>${task.description ? `<div style="font:12px/1.5 Arial,sans-serif;color:#676879;margin-top:4px">${escapeHtml(task.description)}</div>` : ''}${customer}</td><td align="right" style="padding:13px 0 13px 16px;border-bottom:1px solid #e6e9ef;vertical-align:top;white-space:nowrap"><div style="font:700 12px Arial,sans-serif;color:${section.colour}">${escapeHtml(due)}</div><div style="font:700 9px Arial,sans-serif;text-transform:uppercase;color:#8b91a0;margin-top:6px">${escapeHtml(task.priority)}</div></td></tr>`;
  }).join('')}</table></td></tr>`).join('');
}

export function personalEmail({ name, tasks, today, origin }) {
  const count = tasks.length;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e2e5eb;border-radius:10px;overflow:hidden"><tr><td style="background:#111827;padding:24px 28px;border-bottom:3px solid #c9a13b"><div style="font:700 21px Arial,sans-serif;color:#fff">Your To Do for today</div><div style="font:12px Arial,sans-serif;color:#c8ced9;margin-top:6px">Hi ${escapeHtml(name)} &middot; ${dateLabel(today)}</div></td></tr>${taskRows(tasks, today)}<tr><td style="padding:18px 28px 26px"><a href="${origin}/todo/" style="display:inline-block;background:#0073ea;color:#fff;text-decoration:none;border-radius:6px;padding:11px 18px;font:700 13px Arial,sans-serif">Open my task board</a></td></tr></table></td></tr></table></body></html>`;
  const lines = tasks.length
    ? tasks.map(task => `${task.due_date < today ? `OVERDUE ${task.due_date}` : (timeLabel(task.due_time) || 'TODAY')} | ${task.priority.toUpperCase()} | ${task.title}`)
    : ['Nothing due today.'];
  return {
    subject: `Your To Do for today${count ? ` (${count})` : ''}`,
    html,
    text: `Hi ${name},\n\nHere is your To Do for today:\n\n${lines.join('\n')}\n\nOpen your task board: ${origin}/todo/`,
  };
}

export function supabaseHeaders(serviceKey, prefer) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const local = sydneyParts(now);
  // One of the two UTC cron runs is 8:05/10:05 locally. Ignore that run.
  // Accept the full 9 am hour in case Vercel starts the 9:05 job slightly late.
  if (local.hour !== '09') {
    return res.status(200).json({ ok: true, skipped: true, reason: 'outside_sydney_9am', checked: `${local.date} ${local.hour}:${local.minute}` });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase is not configured' });
  }

  const headers = supabaseHeaders(serviceKey);
  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');

  try {
    // Personal morning email: To Do only, assigned to the recipient, and due
    // today or overdue. Follow Up, Completed, future and archived tasks stay out.
    const taskResponse = await fetch(
      `${supabaseUrl}/rest/v1/portal_tasks?select=id,title,description,assignee,due_date,due_time,priority,customer_name,customer_phone&status=eq.todo&archived_at=is.null&due_date=lte.${local.date}&order=due_date.asc,due_time.asc`,
      { headers }
    );
    if (!taskResponse.ok) {
      return res.status(502).json({ error: 'Could not load personal To Do tasks' });
    }
    const tasks = await taskResponse.json();

    // Claim the Sydney calendar day once so Vercel retries cannot duplicate the
    // five private emails. Amit's 7:30 run reserves today's row with task_count
    // -1; the 9:05 run atomically takes over that reservation before sending to
    // everyone, so the early email never suppresses the normal team email.
    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs`, {
      method: 'POST',
      headers: supabaseHeaders(serviceKey, 'resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify({ digest_date: local.date, task_count: tasks.length }),
    });
    if (!claimResponse.ok) return res.status(502).json({ error: 'Could not claim daily To Do run' });
    let claimed = (await claimResponse.json()).length > 0;

    if (!claimed) {
      const takeoverResponse = await fetch(
        `${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${local.date}&task_count=eq.-1`,
        {
          method: 'PATCH',
          headers: supabaseHeaders(serviceKey, 'return=representation'),
          body: JSON.stringify({
            claimed_at: new Date().toISOString(),
            sent_at: null,
            task_count: tasks.length,
          }),
        }
      );
      if (!takeoverResponse.ok) return res.status(502).json({ error: 'Could not claim daily To Do run' });
      claimed = (await takeoverResponse.json()).length > 0;
    }

    if (!claimed) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent', date: local.date });
    }

    const results = [];
    for (const [name, email] of Object.entries(AGENT_EMAILS)) {
      const assigned = tasks.filter(task => task.assignee === name);
      const message = personalEmail({ name, tasks: assigned, today: local.date, origin });
      try {
        // Deliberately one recipient per API call. No CC or BCC: an employee can
        // never see another employee or another employee's tasks in this email.
        await sendHostingerMail({
          to: [email],
          displayName: 'Goldsure Team Tasks',
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
        results.push({ name, sent: true, taskCount: assigned.length });
      } catch (error) {
        console.error('[Daily personal To Do]', name, error);
        results.push({ name, sent: false, taskCount: assigned.length, reason: 'email_failed' });
      }
    }

    await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${local.date}`, {
      method: 'PATCH',
      headers: supabaseHeaders(serviceKey, 'return=minimal'),
      body: JSON.stringify({ sent_at: new Date().toISOString() }),
    });

    return res.status(200).json({
      ok: results.every(result => result.sent),
      date: local.date,
      sent: results.filter(result => result.sent).length,
      failed: results.filter(result => !result.sent).length,
      results,
    });
  } catch (error) {
    console.error('[Daily personal To Do]', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
