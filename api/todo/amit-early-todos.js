import { sendHostingerMail } from '../../lib/hostinger-mail.js';
import { AGENT_EMAILS } from '../../lib/portal-agents.js';
import { personalEmail, supabaseHeaders, sydneyParts } from './daily-todos.js';

// Vercel cron schedules are UTC. This endpoint is invoked at both possible UTC
// equivalents of 7:30 am Sydney, then only sends during Sydney's 7:30 hour.
// That keeps the delivery time correct across AEST and AEDT.
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const local = sydneyParts(new Date());
  // The other UTC invocation lands at 6:30 or 8:30 in Sydney. Accept the rest
  // of the 7 am hour in case Vercel starts the 7:30 job slightly late.
  if (local.hour !== '07' || Number(local.minute) < 30) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'outside_sydney_730am',
      checked: `${local.date} ${local.hour}:${local.minute}`,
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase is not configured' });
  }

  const headers = supabaseHeaders(serviceKey);
  const origin = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');

  try {
    // Load only Amit's private To Do list: due today or overdue. Follow Up,
    // Completed, future and archived tasks remain excluded.
    const taskResponse = await fetch(
      `${supabaseUrl}/rest/v1/portal_tasks?select=id,title,description,assignee,due_date,due_time,priority,customer_name,customer_phone&status=eq.todo&archived_at=is.null&assignee=eq.Amit&due_date=lte.${local.date}&order=due_date.asc,due_time.asc`,
      { headers }
    );
    if (!taskResponse.ok) {
      return res.status(502).json({ error: 'Could not load Amit To Do tasks' });
    }
    const tasks = await taskResponse.json();

    // Reserve today's shared run row with a sentinel value. The 9:05 endpoint
    // atomically converts this reservation into the normal team run.
    const claimResponse = await fetch(`${supabaseUrl}/rest/v1/portal_task_digest_runs`, {
      method: 'POST',
      headers: supabaseHeaders(serviceKey, 'resolution=ignore-duplicates,return=representation'),
      body: JSON.stringify({ digest_date: local.date, task_count: -1 }),
    });
    if (!claimResponse.ok) return res.status(502).json({ error: 'Could not claim Amit early To Do run' });
    if (!(await claimResponse.json()).length) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'already_sent', date: local.date });
    }

    const message = personalEmail({
      name: 'Amit',
      tasks,
      today: local.date,
      origin,
    });

    try {
      await sendHostingerMail({
        to: [AGENT_EMAILS.Amit],
        displayName: 'Goldsure Team Tasks',
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } catch (error) {
      console.error('[Amit early To Do]', error);
      // Release an unsent claim so a safe retry can try again.
      await fetch(
        `${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${local.date}&task_count=eq.-1&sent_at=is.null`,
        { method: 'DELETE', headers: supabaseHeaders(serviceKey, 'return=minimal') }
      ).catch(() => {});
      return res.status(502).json({ error: 'Could not send Amit early To Do email' });
    }

    const logResponse = await fetch(
      `${supabaseUrl}/rest/v1/portal_task_digest_runs?digest_date=eq.${local.date}&task_count=eq.-1`,
      {
        method: 'PATCH',
        headers: supabaseHeaders(serviceKey, 'return=minimal'),
        body: JSON.stringify({ sent_at: new Date().toISOString() }),
      }
    );
    if (!logResponse.ok) {
      return res.status(502).json({ error: 'Amit email sent but the run log could not be updated' });
    }

    return res.status(200).json({
      ok: true,
      date: local.date,
      sent: 1,
      results: [{ name: 'Amit', sent: true, taskCount: tasks.length }],
    });
  } catch (error) {
    console.error('[Amit early To Do]', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
