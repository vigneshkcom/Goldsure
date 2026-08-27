import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { AGENT_EMAILS } from '../../lib/portal-agents.js';
import { supabaseHeaders, sydneyParts } from './daily-todos.js';

export const config = { maxDuration: 60 };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function htmlText(value) {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function dateLabel(value) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function timeLabel(value) {
  if (!value) return '';
  const [hour, minute] = String(value).slice(0, 5).split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`;
}

function noteDate(value) {
  return new Date(value).toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function isPastDue(task, local) {
  if (task.due_date < local.date) return true;
  if (task.due_date > local.date || !task.due_time) return false;
  return String(task.due_time).slice(0, 5) <= `${local.hour}:${local.minute}`;
}

export function davidReportEmail({ tasks, local, origin, sample = false }) {
  const taskHtml = tasks.length ? tasks.map(task => {
    const notes = [...(task.notes || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const notesHtml = notes.length
      ? notes.map(note => `<div style="border-left:3px solid #c9a13b;padding:7px 10px;margin-top:8px;background:#f8f6ef"><div style="font:700 11px Arial,sans-serif;color:#4b5563">${escapeHtml(note.author)} &middot; ${escapeHtml(noteDate(note.created_at))}</div><div style="font:12px/1.5 Arial,sans-serif;color:#374151;margin-top:3px">${htmlText(note.body)}</div></div>`).join('')
      : '<div style="font:700 12px Arial,sans-serif;color:#b42318;margin-top:8px">No notes - probably not actioned</div>';
    const due = `${dateLabel(task.due_date)}${task.due_time ? ` at ${timeLabel(task.due_time)}` : ''}`;
    const customerHeading = task.customer_name
      ? `<div style="font:700 17px Arial,sans-serif;color:#111827">${escapeHtml(task.customer_name)}</div>${task.customer_phone ? `<div style="font:12px Arial,sans-serif;color:#4b5563;margin-top:3px">${escapeHtml(task.customer_phone)}</div>` : ''}`
      : '';
    const titleMargin = task.customer_name ? '10px' : '0';
    return `<tr><td style="padding:18px 24px;border-bottom:1px solid #e5e7eb">${customerHeading}<div style="font:700 14px Arial,sans-serif;color:#111827;margin-top:${titleMargin}">${escapeHtml(task.title)}</div><div style="font:12px Arial,sans-serif;color:#b42318;margin-top:6px"><strong>Overdue:</strong> ${escapeHtml(due)} &middot; To Do &middot; ${escapeHtml(task.priority)}</div>${task.description ? `<div style="font:12px/1.5 Arial,sans-serif;color:#4b5563;margin-top:8px">${htmlText(task.description)}</div>` : ''}<div style="font:700 11px Arial,sans-serif;color:#6b7280;text-transform:uppercase;margin-top:12px">Notes</div>${notesHtml}</td></tr>`;
  }).join('') : '<tr><td style="padding:26px 24px;font:700 15px Arial,sans-serif;color:#166534">David has no overdue To Do tasks.</td></tr>';

  const taskText = tasks.length ? tasks.map((task, index) => {
    const notes = [...(task.notes || [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const notesText = notes.length
      ? notes.map(note => `- ${note.author} (${noteDate(note.created_at)}): ${note.body}`).join('\n')
      : 'No notes - probably not actioned';
    const customerText = task.customer_name
      ? `${task.customer_name}${task.customer_phone ? `\n${task.customer_phone}` : ''}\n`
      : '';
    return `${index + 1}. ${customerText}Task: ${task.title}\nDue: ${dateLabel(task.due_date)}${task.due_time ? ` at ${timeLabel(task.due_time)}` : ''}\nStatus: To Do | Priority: ${task.priority}\nNotes:\n${notesText}`;
  }).join('\n\n') : 'David has no overdue To Do tasks.';

  const prefix = sample ? 'SAMPLE — ' : '';
  return {
    subject: `${prefix}David overdue To Do report (${tasks.length})`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f5f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#fff;border:1px solid #e2e5eb;border-radius:10px;overflow:hidden"><tr><td style="background:#111827;padding:22px 24px;border-bottom:3px solid #c9a13b"><div style="font:700 20px Arial,sans-serif;color:#fff">${sample ? 'Sample: ' : ''}David's overdue To Do tasks</div><div style="font:12px Arial,sans-serif;color:#c8ced9;margin-top:6px">To Do tasks due before ${escapeHtml(timeLabel(`${local.hour}:${local.minute}`))} on ${escapeHtml(dateLabel(local.date))}</div></td></tr>${taskHtml}<tr><td style="padding:18px 24px 24px"><a href="${origin}/todo/" style="display:inline-block;background:#0073ea;color:#fff;text-decoration:none;border-radius:6px;padding:11px 18px;font:700 13px Arial,sans-serif">Open team tasks</a></td></tr></table></td></tr></table></body></html>`,
    text: `${sample ? 'SAMPLE: ' : ''}David's overdue To Do tasks\n\n${taskText}\n\nOpen team tasks: ${origin}/todo/`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const local = sydneyParts(new Date());
  const sample = req.query?.sample === '1';
  if (!sample && (local.hour !== '21' || Number(local.minute) < 40)) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'outside_sydney_940pm' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase is not configured' });
  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/portal_tasks?select=id,title,description,due_date,due_time,status,priority,customer_name,customer_phone,notes:portal_task_notes(id,author,body,created_at)&assignee=eq.David&status=eq.todo&archived_at=is.null&order=due_date.asc,due_time.asc`,
      { headers: supabaseHeaders(serviceKey) }
    );
    if (!response.ok) return res.status(502).json({ error: 'Could not load David overdue tasks' });
    let tasks = (await response.json()).filter(task => isPastDue(task, local));
    if (sample && tasks.length) {
      tasks = [tasks.find(task => !(task.notes || []).length) || tasks[0]];
    }

    const message = davidReportEmail({ tasks, local, origin, sample });
    await sendHostingerMail({
      to: [AGENT_EMAILS.Vignesh],
      displayName: 'Goldsure Team Tasks',
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    return res.status(200).json({ ok: true, sample, sent: 1, recipient: 'Vignesh', taskCount: tasks.length });
  } catch (error) {
    console.error('[David overdue report]', error);
    return res.status(500).json({ error: 'Could not send David overdue report' });
  }
}
