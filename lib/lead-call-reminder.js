// Twice-daily (12 pm and 3 pm Sydney, weekdays) team email listing customers still in New Lead who
// have not been reached, grouped by how many calls they have had today. Staff should call
// each one at least 3 times a day until it is reached or moved to Not Reachable.
import { CALLS_PER_DAY } from './lead-contact-report.js';
import { buildLeadReport } from './lead-contact-report-api.js';
import { hasHostingerMailConfig, sendHostingerMail } from './hostinger-mail.js';

export const REMINDER_HOURS = [12, 15];
export const REMINDER_RECIPIENTS = Object.freeze(['info@goldsure.com.au']);
// Leads that arrived in the last week (the most the lead report checks at once).
const REMINDER_DAYS = 7;
const SYDNEY = 'Australia/Sydney';
// Manual sends from the lead report: at most one a minute (per server instance).
const MANUAL_GAP_MS = 60000;
let lastManualSend = 0;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const daysBack = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) - count * 86400000).toISOString().slice(0, 10);

export function sydneyNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: SYDNEY, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute), weekday: parts.weekday };
}

// Weekdays only, at 12 pm and 3 pm Sydney time. Returns why not, or '' when the reminder is due.
export function reminderSkipReason(now = new Date()) {
  const local = sydneyNow(now);
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return 'weekend';
  return REMINDER_HOURS.includes(local.hour) ? '' : 'outside_reminder_hours';
}

function whenLabel(value, today) {
  const date = new Date(value || '');
  if (!Number.isFinite(date.getTime())) return '';
  const day = sydneyNow(date).date;
  const name = day === today ? 'Today' : day === daysBack(today, 1) ? 'Yesterday' : date.toLocaleDateString('en-AU', { timeZone: SYDNEY, weekday: 'short', day: 'numeric', month: 'short' });
  return `${name}, ${date.toLocaleTimeString('en-AU', { timeZone: SYDNEY, hour: 'numeric', minute: '2-digit' })}`;
}

// 0412345678 / +61412345678 → "0412 345 678"; landlines → "02 1234 5678"; anything else as given.
export function phoneLabel(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('61') && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  if (/^04\d{8}$/.test(local)) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  if (/^0[2378]\d{8}$/.test(local)) return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  return String(value || '');
}

// Customers in New Lead not reached yet, by calls made to them today. Within a group the
// one contacted longest ago comes first.
export function reminderGroups(rows, today) {
  const leads = rows
    .filter(row => row.stageProgress === 'new' && (row.reachability === 'unreachable' || row.reachability === 'untried'))
    .map(row => ({ ...row, callsToday: row.callsChecked ? (row.callDays || []).find(day => day.day === today)?.calls ?? 0 : null }));
  const order = (a, b) => String(a.lastContactAt || '').localeCompare(String(b.lastContactAt || '')) || String(a.leadAt).localeCompare(String(b.leadAt));
  return {
    leads,
    groups: Array.from({ length: CALLS_PER_DAY }, (_, calls) => ({ calls, rows: leads.filter(row => row.callsToday === calls).sort(order) })),
    unchecked: leads.filter(row => row.callsToday === null).sort(order),
    done: leads.filter(row => row.callsToday >= CALLS_PER_DAY).sort(order),
  };
}

const DAY_STYLE = { met: 'background:#e4f4ea;color:#1d6b41', short: 'background:#fbe9e7;color:#a43428', today: 'background:#fdf1db;color:#86570a', late: 'background:#edf0f4;color:#4f5c73' };

function dayChips(row, today) {
  return (row.callDays || []).slice(-7).map(day => {
    const name = day.day === today ? 'Today' : new Date(`${day.day}T00:00:00Z`).toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short' });
    return `<span style="display:inline-block;margin:0 4px 4px 0;padding:2px 6px;border-radius:4px;font:11px Arial,sans-serif;${DAY_STYLE[day.status] || DAY_STYLE.late}">${escapeHtml(name)} <b>${day.calls}${day.status === 'today' ? `/${CALLS_PER_DAY}` : ''}</b></span>`;
  }).join('');
}

function leadRow(row, today) {
  const phone = phoneLabel(row.phone), tel = String(row.phone || '').replace(/[^\d+]/g, '');
  const short = (row.callDays || []).filter(day => day.status === 'short').length;
  const last = row.lastContactAt ? `Last contacted ${escapeHtml(whenLabel(row.lastContactAt, today))} by ${row.lastContactType === 'call' ? 'call' : 'SMS'}` : 'No call or SMS yet';
  const template = row.lastTemplate && !['Not recorded', 'Could not check', 'Not checked'].includes(row.lastTemplate) ? ` · Sent “${escapeHtml(row.lastTemplate)}”` : '';
  return `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e9ef;vertical-align:top">
    <div style="font:700 14px Arial,sans-serif;color:#17253b">${escapeHtml(row.name)}${phone ? ` &nbsp;<a href="tel:${escapeHtml(tel)}" style="font-weight:400;color:#1565b8;text-decoration:none">${escapeHtml(phone)}</a>` : ''}</div>
    <div style="font:12px/1.5 Arial,sans-serif;color:#5f6e84;margin-top:3px">${escapeHtml(row.pipeline)} · Received ${escapeHtml(whenLabel(row.leadAt, today))}</div>
    <div style="font:12px/1.5 Arial,sans-serif;color:#33415a">${last}${template}</div>
    ${row.callsChecked ? `<div style="margin-top:6px">${dayChips(row, today)}${short ? `<span style="font:11px Arial,sans-serif;color:#a43428">Under ${CALLS_PER_DAY} calls on ${plural(short, 'day')}</span>` : ''}</div>` : `<div style="font:11px Arial,sans-serif;color:#a43428;margin-top:4px">Phone missing or shared, so calls could not be counted. Check in GHL.</div>`}
    <div style="margin-top:6px"><a href="${escapeHtml(row.link)}" style="font:700 12px Arial,sans-serif;color:#1565b8;text-decoration:none">Open in GHL ›</a></div>
  </td></tr>`;
}

function section(title, note, colour, rows, today) {
  if (!rows.length) return '';
  return `<tr><td style="padding:22px 28px 0"><div style="font:700 11px Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:${colour}">${escapeHtml(title)} (${rows.length})</div>${note ? `<div style="font:12px Arial,sans-serif;color:#5f6e84;margin-top:3px">${escapeHtml(note)}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(row => leadRow(row, today)).join('')}</table></td></tr>`;
}

export function reminderEmail({ rows, now = new Date(), origin = 'https://portal.goldsure.com.au' }) {
  const local = sydneyNow(now), today = local.date;
  const { leads, groups, unchecked, done } = reminderGroups(rows, today);
  const needCalls = groups.reduce((sum, group) => sum + group.rows.length, 0) + unchecked.length;
  const untried = leads.filter(row => row.reachability === 'untried').length;
  const time = new Date(now).toLocaleTimeString('en-AU', { timeZone: SYDNEY, hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  const dateText = new Date(now).toLocaleDateString('en-AU', { timeZone: SYDNEY, weekday: 'long', day: 'numeric', month: 'long' });
  const reportLink = `${origin}/leads/`;
  const headline = needCalls ? `${plural(needCalls, 'customer')} ${needCalls === 1 ? 'needs' : 'need'} more calls today` : `Every New Lead customer has had ${CALLS_PER_DAY} calls today`;
  const summary = `${plural(leads.length, 'customer')} in New Lead ${leads.length === 1 ? 'has' : 'have'} not been reached yet${untried ? `, including ${untried} with no call or SMS at all` : ''}. Call each one at least ${CALLS_PER_DAY} times a day until they answer or you move them to Not Reachable.`;
  const sections = [
    ...groups.map(group => section(group.calls ? `${plural(group.calls, 'call')} so far today` : 'No calls yet today', `Needs ${CALLS_PER_DAY - group.calls} more ${CALLS_PER_DAY - group.calls === 1 ? 'call' : 'calls'} today`, group.calls ? '#b7741a' : '#c0392b', group.rows, today)),
    section('Calls could not be counted', 'Check these in GHL', '#4f5c73', unchecked, today),
  ].join('');
  const doneList = done.length ? `<tr><td style="padding:22px 28px 0"><div style="font:700 11px Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#1d6b41">${CALLS_PER_DAY}+ calls done today (${done.length})</div><div style="font:12px/1.6 Arial,sans-serif;color:#33415a;margin-top:5px">${done.map(row => escapeHtml(row.name)).join(' · ')}</div></td></tr>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e3e8ef;border-radius:10px">
<tr><td style="padding:24px 28px 0"><div style="font:800 10px Arial,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#9a7026">Goldsure · Lead call reminder</div>
<div style="font:700 22px/1.25 Arial,sans-serif;color:#17253b;margin-top:8px">${escapeHtml(headline)}</div>
<div style="font:13px Arial,sans-serif;color:#5f6e84;margin-top:4px">${escapeHtml(dateText)} · ${escapeHtml(time)} check</div>
<div style="font:13px/1.55 Arial,sans-serif;color:#33415a;margin-top:12px">${escapeHtml(summary)}</div></td></tr>
${sections}${doneList}
<tr><td style="padding:24px 28px 26px"><a href="${escapeHtml(reportLink)}" style="display:inline-block;background:#17375e;color:#ffffff;font:700 13px Arial,sans-serif;text-decoration:none;padding:10px 16px;border-radius:6px">Open the lead report</a>
<div style="font:11px/1.55 Arial,sans-serif;color:#8794a6;margin-top:14px">Customers in New Lead who arrived in the last ${REMINDER_DAYS} days and have not answered a call or replied. Calls are counted from RingCentral (Sydney time), so calls made from other phones are not seen. Chips show calls per day: green ${CALLS_PER_DAY} or more, red under ${CALLS_PER_DAY}, amber today so far, grey the evening a lead arrived.</div></td></tr>
</table></td></tr></table></body></html>`;
  const textRow = row => `- ${row.name}${row.phone ? ` ${phoneLabel(row.phone)}` : ''} (${row.pipeline}) · ${row.lastContactAt ? `last contacted ${whenLabel(row.lastContactAt, today)} by ${row.lastContactType}` : 'no call or SMS yet'} · ${row.link}`;
  const text = [`${headline} (${dateText}, ${time} check)`, '', summary, '',
    ...groups.flatMap(group => group.rows.length ? [`${group.calls ? `${plural(group.calls, 'call')} so far today` : 'No calls yet today'} (${group.rows.length}):`, ...group.rows.map(textRow), ''] : []),
    ...(unchecked.length ? [`Calls could not be counted (${unchecked.length}):`, ...unchecked.map(textRow), ''] : []),
    ...(done.length ? [`${CALLS_PER_DAY}+ calls done today: ${done.map(row => row.name).join(', ')}`, ''] : []),
    `Lead report: ${reportLink}`].join('\n');
  return { subject: `Call reminder ${time}: ${headline}`, html, text, needCalls };
}

function recipients() {
  const configured = String(process.env.LEAD_REMINDER_TO || '').split(',').map(item => item.trim()).filter(item => /^[^@\s]+@[^@\s]+$/.test(item));
  return configured.length ? configured : [...REMINDER_RECIPIENTS];
}

// GET ?leadReport=reminder, sent to info@goldsure.com.au unless LEAD_REMINDER_TO (comma-separated) is set.
// Vercel cron calls it on weekdays at both UTC equivalents of 12 pm and 3 pm
// Sydney; it only sends during those Sydney hours, Monday to Friday. ?preview=1 shows the email without sending.
// ?force=1 (with the cron secret) sends now, for testing. A POST is the lead report's
// "Send now" button: no secret, but only to the fixed recipients, only from this site and
// at most once a minute.
export async function leadCallReminder(req, res, { ringcentralToken, ringcentralServer }) {
  res.setHeader('Cache-Control', 'no-store');
  const manual = req.method === 'POST', preview = !manual && req.query?.preview === '1', force = req.query?.force === '1';
  const now = new Date(), local = sydneyNow(now);
  if (manual) {
    const from = String(req.headers?.origin || '');
    let sameSite = !from;
    try { sameSite = sameSite || new URL(from).host === req.headers?.host; } catch { sameSite = false; }
    if (!sameSite) return res.status(403).json({ error: 'The reminder can only be sent from the lead report.' });
    if (!hasHostingerMailConfig()) return res.status(500).json({ error: 'Email is not set up for the portal.' });
    if (Date.now() - lastManualSend < MANUAL_GAP_MS) return res.status(429).json({ error: 'A reminder was sent less than a minute ago. Please wait a moment before sending another.' });
    lastManualSend = Date.now();
  } else if (!preview) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    const skip = force ? '' : reminderSkipReason(now);
    if (skip) return res.status(200).json({ ok: true, skipped: true, reason: skip, sydney: `${local.weekday} ${local.date} ${local.hour}:00` });
    if (!hasHostingerMailConfig()) return res.status(500).json({ error: 'Hostinger Mail API credentials are not configured.' });
  }
  const origin = (process.env.SITE_URL || 'https://portal.goldsure.com.au').replace(/\/$/, '');
  let report;
  try {
    report = await buildLeadReport({ from: daysBack(local.date, REMINDER_DAYS - 1), to: local.date, ringcentralToken, ringcentralServer, newLeadsOnly: true });
  } catch (error) {
    if (manual) lastManualSend = 0;
    if (preview || manual) return res.status(502).json({ error: error.message });
    try {
      await sendHostingerMail({ to: recipients(), displayName: 'Goldsure Lead Reminders', subject: 'Call reminder could not be prepared', text: `The ${local.hour === 15 ? '3 pm' : '12 pm'} call reminder could not be prepared: ${error.message}\n\nPlease check the lead report instead: ${origin}/leads/` });
    } catch (mailError) { console.error('[Lead call reminder]', mailError); }
    return res.status(502).json({ error: error.message });
  }
  const email = reminderEmail({ rows: report.rows, now, origin });
  if (preview) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(email.html);
  }
  if (!email.needCalls) return res.status(200).json({ ok: true, skipped: true, reason: 'nobody_needs_calls', sent: 0 });
  const to = recipients();
  try {
    await sendHostingerMail({ to, displayName: 'Goldsure Lead Reminders', subject: email.subject, html: email.html, text: email.text });
  } catch (error) {
    console.error('[Lead call reminder]', error);
    if (manual) lastManualSend = 0;
    return res.status(502).json({ error: 'The reminder email could not be sent.' });
  }
  return res.status(200).json({ ok: true, sent: to.length, to, needCalls: email.needCalls, subject: email.subject });
}
