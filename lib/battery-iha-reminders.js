import { sendHostingerMail } from './hostinger-mail.js';

const SELECT = 'id,reference,status,starts_at,ends_at,access_notes,assessor:battery_iha_assessors(id,full_name,email),customer:battery_iha_customers(full_name,phone,email,formatted_address)';
const active = b => ['scheduled', 'confirmed', 'en_route'].includes(b?.status);
const due = (b, now) => active(b) && b.assessor?.email && b.customer && new Date(b.starts_at) > now && new Date(b.starts_at) <= new Date(now.getTime() + 3600000);
const sameSlot = (a, b) => a.assessor?.id === b.assessor?.id && Date.parse(a.starts_at) === Date.parse(b.starts_at);

export async function runHourReminders({ url, key, buildEmail, sydneyParts, now = () => new Date(), fetchImpl = fetch, send = sendHostingerMail }) {
  async function rest(path, method = 'GET', body, prefer) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Reminder storage request failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  const start = now();
  const until = new Date(start.getTime() + 3600000);
  const query = new URLSearchParams({ select: SELECT, status: 'in.(scheduled,confirmed,en_route)', order: 'starts_at.asc' });
  query.append('starts_at', `gt.${start.toISOString()}`);
  query.append('starts_at', `lte.${until.toISOString()}`);
  const bookings = await rest(`battery_iha_bookings?${query}`);
  const results = [];
  for (const booking of bookings) {
    // Leave time for the current send and its receipt within the function's 60s limit.
    if (now().getTime() - start.getTime() > 35000) break;
    if (!due(booking, now())) continue;
    const identity = { booking_id: booking.id, starts_at: booking.starts_at, assessor_id: booking.assessor.id };
    const filter = new URLSearchParams(Object.entries(identity).map(([k, v]) => [k, `eq.${v}`]));
    const path = `battery_iha_reminder_runs?${filter}`;
    const claimed = await rest('battery_iha_reminder_runs', 'POST', identity, 'resolution=ignore-duplicates,return=representation');
    if (!claimed.length) continue;
    // Recheck after claiming: office staff may have changed the appointment.
    let fresh;
    try {
      [fresh] = await rest(`battery_iha_bookings?${new URLSearchParams({ select: SELECT, id: `eq.${booking.id}` })}`);
    } catch (error) {
      // No mail was attempted; a later run may safely retry the lookup.
      await rest(path, 'DELETE');
      throw error;
    }
    if (!fresh || !sameSlot(booking, fresh) || !due(fresh, now())) {
      await rest(path, 'DELETE');
      results.push({ booking: booking.id, status: 'changed_or_cancelled' });
      continue;
    }
    const mail = buildEmail({ mode: 'hour', assessorName: fresh.assessor.full_name, assessorId: fresh.assessor.id, day: sydneyParts(new Date(fresh.starts_at)).date, bookings: [fresh] });
    try {
      await send({ to: [fresh.assessor.email], displayName: 'Goldsure Assessments', ...mail, signal: AbortSignal.timeout(10000) });
    } catch (error) {
      // Only retry definitive rejection. A timeout/5xx may mean mail was accepted;
      // keep its claim so a retry cannot send a second copy.
      const rejected = error.code === 'HOSTINGER_MAIL_NOT_CONFIGURED' || (error.status >= 400 && error.status < 500);
      if (rejected) await rest(path, 'DELETE');
      else await rest(path, 'PATCH', { status: 'uncertain' });
      results.push({ booking: booking.id, status: rejected ? 'rejected' : 'uncertain' });
      continue;
    }
    // If saving the receipt fails, retain the claim: never resend accepted mail.
    await rest(path, 'PATCH', { status: 'sent', sent_at: now().toISOString() });
    results.push({ booking: booking.id, status: 'sent' });
  }
  return { ok: results.every(r => !['rejected', 'uncertain'].includes(r.status)), mode: 'hour', results };
}
