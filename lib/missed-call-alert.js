import { hasHostingerMailConfig, sendHostingerMail } from './hostinger-mail.js';

export const callbackRecipients = ['vignesh@goldsure.com.au', 'alda@goldsure.com.au', 'david@goldsure.com.au', 'shanira@goldsure.com.au'];
const zone = 'Australia/Sydney';
const phone = value => String(value || '').replace(/\D/g, '').slice(-9);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function callbackHours(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const minutes = Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
  return minutes >= 9 * 60 && minutes <= 18 * 60;
}

export function callbackRange(now) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const previousDay = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const wallTime = Date.parse(`${previousDay}T17:30:00Z`);
  const formatter = new Intl.DateTimeFormat('en-AU', { timeZone: zone, timeZoneName: 'shortOffset' });
  let candidate = wallTime;
  for (let attempt = 0; attempt < 3; attempt++) {
    const offsetName = formatter.formatToParts(new Date(candidate)).find(part => part.type === 'timeZoneName')?.value || '';
    const match = offsetName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!match) throw new Error('Could not determine the Sydney callback window.');
    const offset = (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '-' ? -1 : 1);
    const next = wallTime - offset * 60000;
    if (next === candidate) break;
    candidate = next;
  }
  return { timeFrom: new Date(candidate).toISOString(), timeTo: now.toISOString() };
}

// A fresh missed call reopens a callback even if an earlier call was returned.
// An outbound attempt counts as called back; an answered inbound call also clears it.
export function outstandingCallbacks(records) {
  const latest = new Map();
  const seen = new Set();
  const calls = [...records].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  for (const call of calls) {
    if (call.sessionId && seen.has(call.sessionId)) continue;
    if (call.sessionId) seen.add(call.sessionId);
    if (!Number.isFinite(new Date(call.startTime).getTime())) continue;
    const inbound = call.direction === 'Inbound';
    if (!inbound && call.direction !== 'Outbound') continue;
    const party = inbound ? call.from : call.to;
    const key = phone(party?.phoneNumber);
    if (key.length !== 9) continue;
    if (inbound && /miss|voicemail|no ?answer|abandon/i.test(String(call.result || ''))) {
      const previous = latest.get(key);
      latest.set(key, { number: party.phoneNumber, name: party.name || previous?.name || '', missedAt: call.startTime, count: (previous?.count || 0) + 1 });
    } else if (!inbound || /^(accepted|call connected|answered|connected)$/i.test(String(call.result || ''))) {
      latest.delete(key);
    }
  }
  return [...latest.values()].sort((a, b) => new Date(a.missedAt) - new Date(b.missedAt));
}

export function callbackEmail(items, now) {
  const stamp = new Intl.DateTimeFormat('en-AU', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(now);
  const lines = items.map(item => {
    const time = new Intl.DateTimeFormat('en-AU', { timeZone: zone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.missedAt));
    return `${item.name ? `${item.name} | ` : ''}${item.number} | Missed: ${time} | ${item.count} missed call${item.count === 1 ? '' : 's'}`;
  });
  const subject = `URGENT: ${items.length} customer${items.length === 1 ? '' : 's'} awaiting a callback | Call ASAP`;
  const intro = 'Hi team,\n\nThese customers have not been called back. Please call them ASAP.';
  const footer = `Checked: ${stamp} (${zone}).\nIncludes unresolved missed calls from 5:30pm the previous day through now, including overnight calls before 9am. Alerts are sent every 30 minutes between 9am and 6pm only. A callback attempt or an answered return call removes a customer from this list.\nhttps://portal.goldsure.com.au/calls/`;
  return {
    to: callbackRecipients,
    displayName: 'Goldsure Call Alerts', subject,
    text: `${intro}\n\n${lines.join('\n')}\n\n${footer}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:680px;margin:24px auto;padding:16px"><h1 style="font-size:24px;color:#b42318">URGENT: Call these customers ASAP</h1><p>Hi team,</p><p><strong>These customers have not been called back. Please call them ASAP.</strong></p><table style="width:100%;border-collapse:collapse"><tr><th align="left" style="padding:12px;background:#fff0ed">Customers awaiting a callback</th></tr>${lines.map(line => `<tr><td style="padding:14px 12px;border-bottom:1px solid #ddd">${escapeHtml(line)}</td></tr>`).join('')}</table><p style="font-size:12px;color:#666">${escapeHtml(footer).replace(/\n/g, '<br>')}</p><p><a href="https://portal.goldsure.com.au/calls/">Open live Call Analytics</a></p></body></html>`,
  };
}

export async function missedCallAlert(req, res, { fetchRecords, now = new Date(), send = sendHostingerMail }) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const dryRun = req.query?.dryRun === '1';
  if (!dryRun && !callbackHours(now)) return res.status(200).json({ ok: true, sent: false, skipped: 'outside-reporting-hours' });
  try {
    const range = callbackRange(now);
    const records = await fetchRecords(range);
    const start = Date.parse(range.timeFrom), end = Date.parse(range.timeTo);
    const items = outstandingCallbacks(records.filter(call => {
      const timestamp = Date.parse(call.startTime);
      return timestamp >= start && timestamp <= end;
    }));
    if (!items.length) return res.status(200).json({ ok: true, sent: false, skipped: 'no-outstanding-callbacks' });
    const mail = callbackEmail(items, now);
    if (dryRun) return res.status(200).json({ ok: true, sent: false, preview: mail, customers: items.length });
    if (!hasHostingerMailConfig()) throw new Error('Hostinger Mail API credentials are not configured.');
    await send(mail);
    return res.status(200).json({ ok: true, sent: true, customers: items.length, recipients: callbackRecipients });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
