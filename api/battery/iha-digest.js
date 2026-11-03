import { sendHostingerMail } from '../../lib/hostinger-mail.js';

// Daily assessor emails for battery in-home assessments.
//   ?mode=evening  18:00 Sydney  appointments booked for tomorrow
//   ?mode=morning  07:00 Sydney  reminder of today's appointments
// Vercel cron runs in UTC, so each mode is scheduled at both possible UTC hours and
// only sends when the Sydney hour matches (correct across AEST and AEDT).
export const config = { maxDuration: 60 };

const SYDNEY = 'Australia/Sydney';
const MODES = {
  evening: { hour: '18', dayOffset: 1 },
  morning: { hour: '07', dayOffset: 0 },
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function sydneyParts(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((r, x) => { r[x.type] = x.value; return r; }, {});
  return { date: `${p.year}-${p.month}-${p.day}`, hour: p.hour === '24' ? '00' : p.hour, minute: p.minute };
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayLabel = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const timeLabel = iso => new Date(iso).toLocaleTimeString('en-AU', { timeZone: SYDNEY, hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase();

export function buildEmail({ mode, assessorName, day, bookings }) {
  const when = mode === 'evening' ? 'tomorrow' : 'today';
  const count = bookings.length;
  const subject = `${count} battery assessment${count === 1 ? '' : 's'} ${mode === 'evening' ? 'booked for tomorrow' : 'today'} (${dayLabel(day)})`;
  const rows = bookings.map(b => {
    const c = b.customer;
    const maps = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.formatted_address)}`;
    return `<tr><td style="padding:14px 0;border-bottom:1px solid #e6e9ef;vertical-align:top">
<div style="font:700 15px Arial,sans-serif;color:#172b4d">${esc(timeLabel(b.starts_at))} &ndash; ${esc(timeLabel(b.ends_at))} &middot; ${esc(c.full_name)}</div>
<div style="font:13px/1.5 Arial,sans-serif;color:#4f5870;margin-top:4px"><a href="${esc(maps)}" style="color:#1769e0">${esc(c.formatted_address)}</a><br>${esc(c.phone)}${c.email ? ` &middot; ${esc(c.email)}` : ''}</div>
${b.access_notes ? `<div style="font:13px/1.5 Arial,sans-serif;color:#172b4d;margin-top:6px"><strong>Access:</strong> ${esc(b.access_notes)}</div>` : ''}
<div style="font:11px Arial,sans-serif;color:#667085;margin-top:6px">${esc(b.reference)}</div></td></tr>`;
  }).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" style="max-width:600px;background:#fff;border-radius:10px"><tr><td style="padding:24px 28px 8px"><div style="font:700 11px Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#9e7416">Goldsure battery assessments</div><div style="font:700 20px Arial,sans-serif;color:#172b4d;margin-top:6px">Hi ${esc(assessorName)}, you have ${count} appointment${count === 1 ? '' : 's'} ${when}</div><div style="font:14px Arial,sans-serif;color:#667085;margin-top:4px">${esc(dayLabel(day))}</div></td></tr><tr><td style="padding:0 28px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table></td></tr></table></body></html>`;
  const text = [`Hi ${assessorName}, you have ${count} battery assessment${count === 1 ? '' : 's'} ${when} (${dayLabel(day)}):`, '',
    ...bookings.map(b => `${timeLabel(b.starts_at)}-${timeLabel(b.ends_at)}  ${b.customer.full_name}\n  ${b.customer.formatted_address}\n  ${b.customer.phone}${b.access_notes ? `\n  Access: ${b.access_notes}` : ''}\n  ${b.reference}`)].join('\n');
  return { subject, html, text };
}

function headers(key, prefer) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const mode = req.query?.mode;
  const cfg = MODES[mode];
  if (!cfg) return res.status(400).json({ error: 'mode must be evening or morning' });

  const local = sydneyParts(new Date());
  if (local.hour !== cfg.hour) return res.status(200).json({ ok: true, skipped: true, reason: `outside_sydney_${cfg.hour}`, checked: `${local.date} ${local.hour}:${local.minute}` });

  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase is not configured' });

  const day = addDays(local.date, cfg.dayOffset);
  try {
    // Wide UTC window, then keep the bookings whose Sydney date is the target day.
    const from = `${addDays(day, -1)}T12:00:00Z`, to = `${day}T15:00:00Z`;
    const r = await fetch(`${url}/rest/v1/battery_iha_bookings?select=id,reference,starts_at,ends_at,access_notes,assessor:battery_iha_assessors(id,full_name,email),customer:battery_iha_customers(full_name,phone,email,formatted_address)&status=in.(scheduled,confirmed)&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at.asc`, { headers: headers(key) });
    if (!r.ok) return res.status(502).json({ error: 'Could not load bookings' });
    const bookings = (await r.json()).filter(b => sydneyParts(new Date(b.starts_at)).date === day && b.assessor?.email);

    const byAssessor = new Map();
    for (const b of bookings) {
      if (!byAssessor.has(b.assessor.id)) byAssessor.set(b.assessor.id, { assessor: b.assessor, list: [] });
      byAssessor.get(b.assessor.id).list.push(b);
    }

    const results = [];
    for (const { assessor, list } of byAssessor.values()) {
      // Claim (date, kind, assessor) so a Vercel retry cannot send the same email twice.
      const claim = await fetch(`${url}/rest/v1/battery_iha_digest_runs`, {
        method: 'POST', headers: headers(key, 'resolution=ignore-duplicates,return=representation'),
        body: JSON.stringify({ digest_date: day, kind: mode, assessor_id: assessor.id, booking_count: list.length }),
      });
      if (!claim.ok) { results.push({ assessor: assessor.full_name, sent: false, reason: 'claim_failed' }); continue; }
      if (!(await claim.json()).length) { results.push({ assessor: assessor.full_name, sent: false, reason: 'already_sent' }); continue; }
      const mail = buildEmail({ mode, assessorName: assessor.full_name.split(' ')[0], day, bookings: list });
      try {
        await sendHostingerMail({ to: [assessor.email], displayName: 'Goldsure Assessments', ...mail });
        results.push({ assessor: assessor.full_name, sent: true, count: list.length });
      } catch (error) {
        console.error('[IHA digest]', assessor.full_name, error);
        await fetch(`${url}/rest/v1/battery_iha_digest_runs?digest_date=eq.${day}&kind=eq.${mode}&assessor_id=eq.${assessor.id}`, { method: 'DELETE', headers: headers(key) });
        results.push({ assessor: assessor.full_name, sent: false, reason: 'email_failed' });
      }
    }
    return res.status(200).json({ ok: results.every(x => x.sent || x.reason === 'already_sent'), mode, day, results });
  } catch (error) {
    console.error('[IHA digest]', error);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
