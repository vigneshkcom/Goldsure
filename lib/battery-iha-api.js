import { BatteryQuoteError, clean, verifySession } from './battery-quote-model.js';
import { BatteryQuoteGhl } from './battery-quote-ghl.js';
import { sydneyParts, addDays } from './battery-iha-digest.js';

// Battery in-home assessment (IHA) bookings: schedule board, booking, job numbers, status.
// Routed from api/battery/request-callback.js with ?module=iha.

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['scheduled', 'confirmed', 'en_route', 'arrived', 'completed', 'cancelled', 'no_show'];
const ACTIVE = ['scheduled', 'confirmed', 'en_route', 'arrived'];
const STATES = 'NSW|VIC|QLD|SA|WA|TAS|ACT|NT';

/** Sydney wall-clock date + "HH:MM" to a UTC Date (handles daylight saving). */
export function sydneyToUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wanted;
  for (let i = 0; i < 3; i++) {
    const p = sydneyParts(new Date(utc));
    utc += wanted - Date.parse(`${p.date}T${p.hour}:${p.minute}:00Z`);
  }
  return new Date(utc);
}

/** "12 Banksia Ave, Penrith NSW 2750, Australia" -> parts the customers table needs. */
export function parseAddress(text, postcode) {
  // Google's suggestions usually omit the postcode ("12 Banksia Ave, Penrith NSW, Australia"),
  // so a separate postcode (looked up or typed) is accepted and wins over one in the text.
  const base = clean(text).replace(/,?\s*Australia$/i, '');
  const pc = /^\d{4}$/.test(clean(postcode)) ? clean(postcode) : null;
  let m = base.match(new RegExp(`^(.+?),\\s*([^,]+?)[,\\s]+(${STATES})[,\\s]+(\\d{4})$`, 'i'));
  if (!m && pc) {
    const n = base.match(new RegExp(`^(.+?),\\s*([^,]+?)[,\\s]+(${STATES})$`, 'i'));
    if (n) m = [n[0], n[1], n[2], n[3], pc];
  }
  if (!m) return null;
  if (pc) m[4] = pc;
  const street = m[1].trim();
  const unit = street.match(/^(?:unit\s+|u\s*)?(\w+)\s*\/\s*(.+)$/i);
  const rest = unit ? unit[2] : street;
  const num = rest.match(/^(\d+\w?(?:-\d+\w?)?)\s+(.+)$/);
  return {
    formatted_address: `${street}, ${m[2].trim()} ${m[3].toUpperCase()} ${m[4]}`,
    unit_number: unit ? unit[1] : null,
    street_number: num ? num[1] : null,
    street_name: num ? num[2] : rest,
    suburb: m[2].trim(), state: m[3].toUpperCase(), postcode: m[4],
  };
}

export class IhaStore {
  constructor(env = process.env, fetchImpl = fetch) { this.env = env; this.fetch = fetchImpl; }
  async rest(path, options = {}) {
    const { SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: key } = this.env;
    if (!base || !key) throw new BatteryQuoteError('Booking storage needs Supabase configuration.', 503);
    const r = await this.fetch(`${base}/rest/v1/${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      let detail = {};
      try { detail = await r.json(); } catch { /* ignore */ }
      const error = new Error(detail.message || `Supabase ${r.status}`);
      error.code = detail.code; error.status = r.status;
      throw error;
    }
    return r.status === 204 ? [] : r.json();
  }
  assessors() { return this.rest('battery_iha_assessors?select=id,full_name,phone,email,colour,base_address,active&active=eq.true&order=full_name'); }
  availability() { return this.rest('battery_iha_availability?select=assessor_id,weekday,start_time,end_time'); }
  timeOff(from, to) { return this.rest(`battery_iha_time_off?select=assessor_id,starts_at,ends_at,reason&ends_at=gte.${from}&starts_at=lt.${to}`); }
  async settings() { return (await this.rest('battery_iha_settings?id=eq.default&select=*'))[0] || { visit_minutes: 60, buffer_minutes: 0 }; }
  bookings(from, to) {
    return this.rest(`battery_iha_bookings?select=*,customer:battery_iha_customers(*),assessment:battery_iha_assessments(*)&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at.asc`);
  }
  async booking(id) { return (await this.rest(`battery_iha_bookings?id=eq.${id}&select=*,customer:battery_iha_customers(*)`))[0]; }
  async findCustomer(c) {
    if (c.ghl_contact_id) {
      const hit = (await this.rest(`battery_iha_customers?ghl_contact_id=eq.${encodeURIComponent(c.ghl_contact_id)}&formatted_address=eq.${encodeURIComponent(c.formatted_address)}&limit=1`))[0];
      if (hit) return hit;
    }
    return (await this.rest(`battery_iha_customers?phone=eq.${encodeURIComponent(c.phone)}&formatted_address=eq.${encodeURIComponent(c.formatted_address)}&limit=1`))[0];
  }
  async insertCustomer(c) { return (await this.rest('battery_iha_customers', { method: 'POST', body: JSON.stringify(c) }))[0]; }
  async insertBooking(b) { return (await this.rest('battery_iha_bookings', { method: 'POST', body: JSON.stringify(b) }))[0]; }
  async updateBooking(id, patch) { return (await this.rest(`battery_iha_bookings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) }))[0]; }
  async saveAssessment(row) { return (await this.rest('battery_iha_assessments?on_conflict=booking_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row) }))[0]; }
  event(booking_id, event_type, details = {}, created_by = null) { return this.rest('battery_iha_events', { method: 'POST', body: JSON.stringify({ booking_id, event_type, details, created_by }) }).catch(() => null); }
}

export class IhaGhl {
  constructor(env = process.env, fetchImpl = fetch) { this.quoteGhl = new BatteryQuoteGhl(env, fetchImpl); this.env = env; this.fetch = fetchImpl; }
  search(q) { return this.quoteGhl.search(q); }
  async note(contactId, body) {
    if (!contactId) return false;
    await this.quoteGhl.call(`/contacts/${encodeURIComponent(contactId)}/notes`, { method: 'POST', body: JSON.stringify({ body }) });
    return true;
  }
}

const dayLabel = iso => new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = iso => new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase();

export function createIhaHandler(deps = {}) {
  const env = deps.env || process.env;
  const store = deps.store || new IhaStore(env);
  const ghl = deps.ghl || new IhaGhl(env);

  return async function ihaHandler(req, res) {
    res.setHeader?.('Cache-Control', 'no-store');
    const action = req.query?.action || req.body?.action || 'bootstrap';
    const body = req.body || {};
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new BatteryQuoteError('Method not allowed.', 405);
      const session = req.headers?.['x-battery-session'] ? verifySession(req.headers['x-battery-session'], env) : { agent: 'Goldsure team', role: 'staff' };

      if (action === 'ghl-search') return res.status(200).json({ contacts: await ghl.search(req.query?.q || body.q) });

      if (action === 'bootstrap') {
        const today = sydneyParts(new Date()).date;
        const from = DATE.test(req.query?.from || '') ? req.query.from : today;
        const to = DATE.test(req.query?.to || '') ? req.query.to : from;
        if (to < from || (Date.parse(to) - Date.parse(from)) / 864e5 > 62) throw new BatteryQuoteError('Choose a date range of up to 62 days.');
        const startUtc = `${addDays(from, -1)}T12:00:00Z`, endUtc = `${addDays(to, 1)}T15:00:00Z`;
        const [assessors, availability, timeOff, settings, bookings] = await Promise.all([store.assessors(), store.availability(), store.timeOff(startUtc, endUtc), store.settings(), store.bookings(startUtc, endUtc)]);
        const inRange = bookings.filter(b => { const d = sydneyParts(new Date(b.starts_at)).date; return d >= from && d <= to; });
        return res.status(200).json({ today, from, to, session: { agent: session.agent }, settings, assessors: assessors.map(a => ({ ...a, availability: availability.filter(x => x.assessor_id === a.id) })), time_off: timeOff, bookings: inRange });
      }

      if (req.method !== 'POST') throw new BatteryQuoteError('Use POST for changes.', 405);

      if (action === 'create-booking') {
        const c = body.customer || {};
        const name = clean(c.name), phone = clean(c.phone).replace(/[^\d+ ]/g, '');
        if (name.length < 2 || name.length > 150) throw new BatteryQuoteError('Enter the customer name.');
        if (phone.replace(/\D/g, '').length < 8) throw new BatteryQuoteError('Enter a mobile or phone number.');
        const email = clean(c.email);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BatteryQuoteError('Check the customer email address.');
        const addr = parseAddress(c.address, c.postcode);
        if (!addr) throw new BatteryQuoteError('The address needs a street, suburb, state and 4-digit postcode. Choose it from the suggestions and check the postcode box.');
        if (!UUID.test(body.assessor_id || '')) throw new BatteryQuoteError('Choose an assessor.');
        if (!DATE.test(body.date || '') || !TIME.test(body.time || '')) throw new BatteryQuoteError('Choose a date and time.');
        const settings = await store.settings();
        const start = sydneyToUtc(body.date, body.time);
        const end = new Date(start.getTime() + settings.visit_minutes * 60000);
        const buffered = new Date(end.getTime() + (settings.buffer_minutes || 0) * 60000);
        const assessor = (await store.assessors()).find(a => a.id === body.assessor_id);
        if (!assessor) throw new BatteryQuoteError('That assessor is not available.', 404);
        const off = (await store.timeOff(start.toISOString(), buffered.toISOString())).find(t => t.assessor_id === assessor.id && new Date(t.starts_at) < end && new Date(t.ends_at) > start);
        if (off) throw new BatteryQuoteError(`${assessor.full_name} is on leave at that time${off.reason ? ` (${off.reason})` : ''}.`, 409);

        // Check first so a refused clash does not use up a job number; the database constraint still guards races.
        const near = await store.bookings(new Date(start.getTime() - 864e5).toISOString(), new Date(end.getTime() + 864e5).toISOString());
        if (near.some(b => b.assessor_id === assessor.id && ACTIVE.includes(b.status) && new Date(b.starts_at) < buffered && new Date(b.ends_at) > start)) {
          throw new BatteryQuoteError(`${assessor.full_name} already has a visit at that time. Choose another time.`, 409);
        }

        const ghlContactId = clean(c.ghl_contact_id) || null;
        const customerRow = { full_name: name, phone, email: email || null, place_id: clean(c.place_id) || null, ...addr, ghl_contact_id: ghlContactId };
        const customer = (await store.findCustomer(customerRow)) || (await store.insertCustomer(customerRow));

        let booking;
        try {
          booking = await store.insertBooking({
            customer_id: customer.id, assessor_id: assessor.id, starts_at: start.toISOString(), ends_at: end.toISOString(),
            access_notes: clean(body.access_notes).slice(0, 1000), internal_notes: clean(body.internal_notes).slice(0, 2000),
            source: 'staff', created_by: session.agent, ghl_status: ghlContactId ? 'pending' : 'not_sent',
            battery_quote_id: UUID.test(body.battery_quote_id || '') ? body.battery_quote_id : null,
          });
        } catch (error) {
          if (error.code === '23P01') throw new BatteryQuoteError(`${assessor.full_name} already has a visit at that time. Choose another time.`, 409);
          throw error;
        }
        await store.event(booking.id, 'created', { agent: session.agent, source: 'staff' }, session.agent);

        let ghlStatus = booking.ghl_status;
        if (ghlContactId) {
          try {
            await ghl.note(ghlContactId, `Battery assessment booked: ${booking.reference} on ${dayLabel(booking.starts_at)} at ${timeLabel(booking.starts_at)} with ${assessor.full_name}. Address: ${addr.formatted_address}.`);
            ghlStatus = 'synced'; await store.updateBooking(booking.id, { ghl_status: 'synced', ghl_error: null });
          } catch (error) {
            ghlStatus = 'failed'; await store.updateBooking(booking.id, { ghl_status: 'failed', ghl_error: String(error.message).slice(0, 300) }).catch(() => {});
          }
        }
        return res.status(200).json({ success: true, booking: { ...booking, ghl_status: ghlStatus, customer, assessor } });
      }

      if (action === 'update-status' || action === 'cancel') {
        if (!UUID.test(body.id || '')) throw new BatteryQuoteError('Invalid job.');
        const status = action === 'cancel' ? 'cancelled' : body.status;
        if (!STATUSES.includes(status)) throw new BatteryQuoteError('Unknown status.');
        const current = await store.booking(body.id);
        if (!current) throw new BatteryQuoteError('Job not found.', 404);
        const patch = { status };
        const now = new Date().toISOString();
        if (status === 'en_route') patch.en_route_at = now;
        if (status === 'arrived') patch.arrived_at = now;
        if (status === 'completed') patch.completed_at = now;
        if (status === 'cancelled') patch.cancelled_reason = clean(body.reason).slice(0, 300) || null;
        let saved;
        try { saved = await store.updateBooking(body.id, patch); } catch (error) {
          if (error.code === '23P01') throw new BatteryQuoteError('That time is now taken by another job.', 409);
          throw error;
        }
        await store.event(body.id, status, { from: current.status }, session.agent);
        return res.status(200).json({ success: true, booking: { ...current, ...saved } });
      }

      if (action === 'save-assessment') {
        if (!UUID.test(body.booking_id || '')) throw new BatteryQuoteError('Invalid job.');
        const a = body.assessment || {};
        const pick = (v, list) => (list.includes(v) ? v : null);
        const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
        const row = {
          booking_id: body.booking_id,
          supply_phase: pick(a.supply_phase, ['single', 'three', 'unsure']),
          switchboard_has_space: a.switchboard_has_space === true ? true : a.switchboard_has_space === false ? false : null,
          existing_solar_kw: num(a.existing_solar_kw),
          existing_inverter_brand: clean(a.existing_inverter_brand).slice(0, 80) || null,
          install_location: pick(a.install_location, ['garage', 'external_wall', 'internal_wall', 'other']),
          install_distance_to_switchboard_m: num(a.install_distance_to_switchboard_m),
          outcome: pick(a.outcome, ['suitable', 'suitable_with_work', 'not_suitable']),
          photos: Array.isArray(a.photos) ? a.photos.slice(0, 20) : [],
          notes: clean(a.notes).slice(0, 3000),
          submitted_at: new Date().toISOString(),
        };
        const saved = await store.saveAssessment(row);
        await store.event(body.booking_id, 'assessment_saved', { outcome: row.outcome }, session.agent);
        return res.status(200).json({ success: true, assessment: saved });
      }

      throw new BatteryQuoteError('Unknown action.');
    } catch (error) {
      if (!(error instanceof BatteryQuoteError)) console.error('[Battery IHA]', error);
      return res.status(error.status && error.status < 600 && error instanceof BatteryQuoteError ? error.status : 500)
        .json({ error: error instanceof BatteryQuoteError ? error.message : 'The booking service hit an error. Refresh and try again.' });
    }
  };
}

export default createIhaHandler();
