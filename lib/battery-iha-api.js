import { randomUUID } from 'node:crypto';
import { BatteryQuoteStore } from './battery-quote-store.js';
import { BatteryQuoteError, clean, verifySession, quoteSnapshot } from './battery-quote-model.js';
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
    // PGRST002 means Supabase's API is still loading its schema; the request was not processed, so it is safe to retry.
    let r;
    for (let attempt = 0; ; attempt++) {
      r = await this.fetch(`${base}/rest/v1/${path}`, {
        ...options,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok || attempt >= 2) break;
      const peek = await r.clone().json().catch(() => ({}));
      if (peek.code !== 'PGRST002') break;
      await new Promise(done => setTimeout(done, 800 * (attempt + 1)));
    }
    if (!r.ok) {
      let detail = {};
      try { detail = await r.json(); } catch { /* ignore */ }
      const error = new Error(detail.message || `Supabase ${r.status}`);
      error.code = detail.code; error.status = r.status; error.store = true;
      throw error;
    }
    return r.status === 204 ? [] : r.json();
  }
  assessors() { return this.rest('battery_iha_assessors?select=id,full_name,phone,email,colour,base_address,active&active=eq.true&order=full_name'); }
  availability() { return this.rest('battery_iha_availability?select=assessor_id,weekday,start_time,end_time'); }
  timeOff(from, to) { return this.rest(`battery_iha_time_off?select=assessor_id,starts_at,ends_at,reason&ends_at=gte.${from}&starts_at=lt.${to}`); }
  async settings() { return (await this.rest('battery_iha_settings?id=eq.default&select=*'))[0] || { visit_minutes: 60, buffer_minutes: 0 }; }
  bookings(from, to) {
    return this.rest(`battery_iha_bookings?select=*,customer:battery_iha_customers(*),assessment:battery_iha_assessments(*),quote:battery_quotes!battery_iha_bookings_battery_quote_id_fkey(id,reference,status,sent_at)&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at.asc`);
  }
  async booking(id) { return (await this.rest(`battery_iha_bookings?id=eq.${id}&select=*,customer:battery_iha_customers(*),assessment:battery_iha_assessments(*)`))[0]; }
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
  async saveAssessment(row, complete = false) { return this.rest('rpc/save_battery_assessment', {method:'POST', body:JSON.stringify({p_row:row,p_complete:complete})}); }
  async updateCustomer(id, patch) { return (await this.rest(`battery_iha_customers?id=eq.${id}`, {method:'PATCH',body:JSON.stringify(patch)}))[0]; }
  event(booking_id, event_type, details = {}, created_by = null) { return this.rest('battery_iha_events', { method: 'POST', body: JSON.stringify({ booking_id, event_type, details, created_by }) }).catch(() => null); }
}

export class IhaGhl {
  constructor(env = process.env, fetchImpl = fetch) { this.quoteGhl = new BatteryQuoteGhl(env, fetchImpl); this.env = env; this.fetch = fetchImpl; }
  search(q) { return this.quoteGhl.search(q); }
  // Find the customer in GHL by phone or email; if they are not there, create them with source "Direct Call".
  async ensure({ name, phone, email, address }) {
    const loc = this.env.GHL_LOCATION_ID, last9 = v => String(v || '').replace(/\D/g, '').slice(-9);
    const p9 = last9(phone), em = String(email || '').trim().toLowerCase(), found = new Map();
    for (const q of [phone, email].filter(Boolean)) {
      const d = await this.quoteGhl.call(`/contacts/?locationId=${encodeURIComponent(loc)}&query=${encodeURIComponent(q)}&limit=100`);
      for (const c of d.contacts || []) if ((p9 && last9(c.phone) === p9) || (em && String(c.email || '').toLowerCase() === em)) found.set(c.id, c);
    }
    if (found.size > 1) throw new BatteryQuoteError('More than one GHL contact matches this customer. Pick the right one from the GHL search.', 409);
    if (found.size === 1) return { id: [...found.keys()][0], created: false };
    const [firstName, ...rest] = clean(name).split(/\s+/);
    const made = await this.quoteGhl.call('/contacts/', { method: 'POST', body: JSON.stringify({ locationId: loc, firstName, lastName: rest.join(' '), phone, ...(email ? { email } : {}), address1: address, source: 'Direct Call' }) });
    const id = made.contact?.id || made.id;
    if (!id) throw new BatteryQuoteError('GHL did not confirm the new customer.', 502);
    return { id, created: true };
  }
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
  const quotes = deps.quotes || new BatteryQuoteStore(env);
  const now = deps.now || (() => new Date());
  async function checkSlot(assessorId,date,time,excludeId=null) {
    if(!DATE.test(date||'')||!TIME.test(time||''))throw new BatteryQuoteError('Choose a valid date and time.');
    const settings=await store.settings(),start=sydneyToUtc(date,time),today=sydneyParts(now()).date;
    if(!DATE.test(date||'')||!TIME.test(time||'')||sydneyParts(start).date!==date||start<=now()||date>addDays(today,settings.max_days_ahead||21))throw new BatteryQuoteError('Choose a future appointment within the booking window.');
    const minutes=Number(time.slice(0,2))*60+Number(time.slice(3)), duration=settings.visit_minutes||60, buffer=settings.buffer_minutes||0;
    const hours=(await store.availability()).filter(a=>a.assessor_id===assessorId&&a.weekday===new Date(date+'T00:00:00Z').getUTCDay());
    const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
    if(!hours.some(h=>minutes>=mins(h.start_time)&&minutes+duration<=mins(h.end_time)&&(minutes-mins(h.start_time))%(settings.slot_step_minutes||60)===0))throw new BatteryQuoteError('That assessor does not work at that time.',409);
    const end=new Date(+start+duration*60000),buffered=new Date(+end+buffer*60000);
    if((await store.timeOff(start.toISOString(),buffered.toISOString())).some(t=>t.assessor_id===assessorId&&new Date(t.starts_at)<buffered&&new Date(t.ends_at)>start))throw new BatteryQuoteError('That assessor is on leave at that time.',409);
    const near=await store.bookings(new Date(+start-864e5).toISOString(),new Date(+end+864e5).toISOString());
    if(near.some(b=>b.id!==excludeId&&b.assessor_id===assessorId&&ACTIVE.includes(b.status)&&new Date(b.starts_at)<buffered&&Date.parse(b.ends_at)+buffer*60000>+start))throw new BatteryQuoteError('That assessor already has a visit or travel buffer at that time.',409);
    return {start,end};
  }

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

      if (action === 'booking') {
        if(!UUID.test(req.query?.id||''))throw new BatteryQuoteError('Invalid job.');
        const booking=await store.booking(req.query.id);if(!booking)throw new BatteryQuoteError('Job not found.',404);
        const list=await quotes.quoteRows(`assessment_booking_id=eq.${booking.id}&order=created_at.desc`);
        return res.status(200).json({booking,quotes:list.map(({public_token,...q})=>q)});
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
        await checkSlot(body.assessor_id,body.date,body.time);
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

        let ghlContactId = clean(c.ghl_contact_id) || null, ghlCreated = false, ghlProblem = null;
        if (!ghlContactId && ghl.ensure) {
          try { const r = await ghl.ensure({ name, phone, email, address: addr.formatted_address }); ghlContactId = r.id; ghlCreated = r.created; }
          catch (error) { ghlProblem = String(error.message).slice(0, 300); }   // booking still goes ahead; the quote step will retry GHL
        }
        const customerRow = { full_name: name, phone, email: email || null, place_id: clean(c.place_id) || null, ...addr, ghl_contact_id: ghlContactId };
        const existing=await store.findCustomer(customerRow);
        const customer=existing ? await store.updateCustomer(existing.id,customerRow) : await store.insertCustomer(customerRow);

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
        if (ghlProblem) { ghlStatus = 'failed'; await store.updateBooking(booking.id, { ghl_status: 'failed', ghl_error: ghlProblem }).catch(() => {}); }
        if (ghlContactId) {
          try {
            await ghl.note(ghlContactId, `Battery assessment booked: ${booking.reference} on ${dayLabel(booking.starts_at)} at ${timeLabel(booking.starts_at)} with ${assessor.full_name}. Address: ${addr.formatted_address}.`);
            ghlStatus = 'synced'; await store.updateBooking(booking.id, { ghl_status: 'synced', ghl_error: null });
          } catch (error) {
            ghlStatus = 'failed'; await store.updateBooking(booking.id, { ghl_status: 'failed', ghl_error: String(error.message).slice(0, 300) }).catch(() => {});
          }
        }
        return res.status(200).json({ success: true, ghl_created: ghlCreated, booking: { ...booking, ghl_status: ghlStatus, customer, assessor } });
      }

      if(action==='reschedule') {
        if(!UUID.test(body.id||'')||!UUID.test(body.assessor_id||''))throw new BatteryQuoteError('Invalid job or assessor.');
        const b=await store.booking(body.id);if(!b)throw new BatteryQuoteError('Job not found.',404);
        if(!ACTIVE.includes(b.status))throw new BatteryQuoteError('Only active visits can be rescheduled.');
        if(!(await store.assessors()).some(a=>a.id===body.assessor_id))throw new BatteryQuoteError('Choose an active assessor.');
        const {start,end}=await checkSlot(body.assessor_id,body.date,body.time,b.id);
        let saved;try{saved=await store.updateBooking(b.id,{assessor_id:body.assessor_id,starts_at:start.toISOString(),ends_at:end.toISOString(),status:'scheduled',en_route_at:null,arrived_at:null});}catch(e){if(e.code==='23P01')throw new BatteryQuoteError('That appointment time was just taken.',409);throw e;}
        await store.event(b.id,'rescheduled',{from:b.starts_at,to:saved.starts_at},session.agent);
        return res.status(200).json({success:true,booking:saved});
      }
      if(action==='prepare-quote') {
        if(!UUID.test(body.booking_id||'')||!UUID.test(body.request_id||''))throw new BatteryQuoteError('Invalid assessment quote request.');
        const b=await store.booking(body.booking_id);if(!b)throw new BatteryQuoteError('Job not found.',404);
        const existing=await quotes.quote(body.request_id);
        if(existing){if(existing.assessment_booking_id!==b.id)throw new BatteryQuoteError('This quote belongs to another assessment.',409);return res.status(200).json({quote:existing,reused:true});}
        if(['cancelled','no_show'].includes(b.status))throw new BatteryQuoteError('Reopen the visit before quoting.');
        const a=Array.isArray(b.assessment)?b.assessment[0]:b.assessment;
        const pkg=(await quotes.listPackages()).find(p=>p.id===body.package_id);if(!pkg)throw new BatteryQuoteError('Choose an available system.');
        if(a?.outcome==='not_suitable')throw new BatteryQuoteError('The site is marked not suitable. Review and correct the assessment before quoting.');
        const mismatch=a?.supply_phase&&a.supply_phase!=='unsure'&&pkg.phase!==(a.supply_phase==='single'?'Single Phase':'Three Phase');
        if(mismatch&&clean(body.override_reason).length<10)throw new BatteryQuoteError('Explain why this system is appropriate for the recorded supply phase (at least 10 characters).');
        if(a?.outcome==='suitable_with_work'&&clean(body.customer_notes).length<10)throw new BatteryQuoteError('Describe the required work and what the price includes in the customer notes.');
        const assessor=(await store.assessors()).find(x=>x.id===b.assessor_id);
        const context={booking_reference:b.reference,assessor:assessor?.full_name||'',visit_at:b.starts_at,...(a||{}),override_reason:clean(body.override_reason)};delete context.photos;
        const snapshot=quoteSnapshot(pkg,body.customer,await quotes.settings(),await quotes.listDocuments(),{...body,internal_notes:[`From assessment booking ${b.reference}`,a?`Site: ${a.supply_phase||'unknown'} phase; ${a.outcome||'not assessed'}; ${a.notes||''}`:'Assessment not yet recorded',body.override_reason?`Phase override: ${clean(body.override_reason)}`:''].filter(Boolean).join('\n')});
        const result=await quotes.createAssessmentQuote({id:body.request_id,public_token:randomUUID(),...snapshot,created_by:assessor?.full_name||session.agent,assessment_booking_id:b.id,assessment_snapshot:context,ghl_contact_id:b.customer.ghl_contact_id||null});
        return res.status(200).json(result);
      }

      if (action === 'update-status' || action === 'cancel') {
        if (!UUID.test(body.id || '')) throw new BatteryQuoteError('Invalid job.');
        const status = action === 'cancel' ? 'cancelled' : body.status;
        if (!STATUSES.includes(status)) throw new BatteryQuoteError('Unknown status.');
        const current = await store.booking(body.id);
        if (!current) throw new BatteryQuoteError('Job not found.', 404);
        if(status==='completed'){const a=Array.isArray(current.assessment)?current.assessment[0]:current.assessment;if(!a?.submitted_at)throw new BatteryQuoteError('Submit the assessment before completing this visit.');}
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

      if (action === 'link-quote') {
        if (!UUID.test(body.booking_id || '') || !UUID.test(body.quote_id || '')) throw new BatteryQuoteError('Invalid job or quote.');
        const b=await store.booking(body.booking_id),q=await quotes.quote(body.quote_id);
        if(!b||!q||q.assessment_booking_id!==b.id)throw new BatteryQuoteError('Choose a quote created for this assessment.',409);
        const saved = await store.updateBooking(body.booking_id, { battery_quote_id: body.quote_id });
        if (!saved) throw new BatteryQuoteError('Job not found.', 404);
        await store.event(body.booking_id, 'quote_linked', { quote_id: body.quote_id }, session.agent);
        return res.status(200).json({ success: true });
      }

      if (action === 'save-assessment') {
        if (!UUID.test(body.booking_id || '')) throw new BatteryQuoteError('Invalid job.');
        const booking=await store.booking(body.booking_id);if(!booking)throw new BatteryQuoteError('Job not found.',404);
        const a = body.assessment || {};
        for(const key of ['existing_solar_kw','install_distance_to_switchboard_m'])if(a[key]!==''&&a[key]!=null&&(!Number.isFinite(Number(a[key]))||Number(a[key])<0||Number(a[key])>999))throw new BatteryQuoteError('Enter non-negative site measurements below 1,000.');
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
          notes: clean(a.notes).slice(0, 3000),
          submitted_at: body.complete ? new Date().toISOString() : null,
        };
        if(body.complete&&(!row.supply_phase||!row.outcome||(['suitable_with_work','not_suitable'].includes(row.outcome)&&row.notes.length<3)))throw new BatteryQuoteError('Select supply and outcome, and explain any required work or unsuitable result.');
        const saved = await store.saveAssessment(row,body.complete===true);
        await store.event(body.booking_id, 'assessment_saved', { outcome: row.outcome }, session.agent);
        return res.status(200).json({ success: true, assessment: saved });
      }

      throw new BatteryQuoteError('Unknown action.');
    } catch (error) {
      if (!(error instanceof BatteryQuoteError)) console.error('[Battery IHA]', error);
      // Staff-only portal: show what Supabase said so a setup problem (missing table, permissions) is obvious.
      if (error.store) return res.status(502).json({ error: `Supabase said: ${error.message}${error.code ? ` (${error.code})` : ''}. Check supabase/battery-iha-bookings.sql has been run.` });
      return res.status(error.status && error.status < 600 && error instanceof BatteryQuoteError ? error.status : 500)
        .json({ error: error instanceof BatteryQuoteError ? error.message : 'The booking service hit an error. Refresh and try again.' });
    }
  };
}

export default createIhaHandler();
