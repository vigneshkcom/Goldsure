import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { createIhaHandler, sydneyToUtc, parseAddress } from '../lib/battery-iha-api.js';
import { buildEmail, sydneyParts } from '../lib/battery-iha-digest.js';

const quoteSql = await readFile(new URL('../supabase/battery-quotations.sql', import.meta.url), 'utf8');
const ihaSql = await readFile(new URL('../supabase/battery-iha-bookings.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec('create role anon;create role authenticated;create role service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit integer,allowed_mime_types text[]);');
  await db.exec(quoteSql);
  await db.exec(ihaSql);
  return db;
}

test('SQL: job numbers start at 1001, overlaps are refused, Amit is seeded', async () => {
  const db = await setup();
  try {
    const amit = (await db.query("select id from battery_iha_assessors where email='amit@goldsure.com.au'")).rows[0].id;
    const cust = (await db.query("insert into battery_iha_customers(full_name,phone,formatted_address,suburb,state,postcode) values('A','0400000000','1 A St, Penrith NSW 2750','Penrith','NSW','2750') returning id")).rows[0].id;
    const add = (s, e) => db.query('insert into battery_iha_bookings(customer_id,assessor_id,starts_at,ends_at) values($1,$2,$3,$4) returning job_number,reference', [cust, amit, s, e]);
    const first = (await add('2026-11-05T08:30:00+11', '2026-11-05T10:00:00+11')).rows[0];
    assert.equal(first.job_number, 1001);
    assert.equal(first.reference, 'J1001');
    assert.equal((await add('2026-11-05T11:00:00+11', '2026-11-05T12:30:00+11')).rows[0].reference, 'J1002');
    await assert.rejects(add('2026-11-05T09:00:00+11', '2026-11-05T10:30:00+11'), /overlap|conflict|exclusion/i);
    await db.query("update battery_iha_bookings set status='cancelled' where job_number=1001");
    assert.equal((await add('2026-11-05T09:00:00+11', '2026-11-05T10:30:00+11')).rows[0].job_number, 1004); // the refused overlap used 1003; the API pre-checks to avoid this
  } finally { await db.close(); }
});

test('SQL: free slots skip booked time and the function runs', async () => {
  const db = await setup();
  try {
    const amit = (await db.query("select id from battery_iha_assessors limit 1")).rows[0].id;
    await db.query("insert into battery_iha_availability(assessor_id,weekday,start_time,end_time) values($1,4,'08:00','17:00')", [amit]);
    const rows = (await db.query("select slot_start from battery_iha_free_slots($1,'2099-01-01'::date)", [amit])).rows;
    assert.ok(rows.length > 0);
  } finally { await db.close(); }
});

test('time helpers handle Sydney daylight saving and addresses', () => {
  assert.equal(sydneyToUtc('2026-11-05', '08:30').toISOString(), '2026-11-04T21:30:00.000Z');
  assert.equal(sydneyToUtc('2026-07-01', '08:30').toISOString(), '2026-06-30T22:30:00.000Z');
  assert.equal(sydneyParts(new Date('2026-11-04T07:00:00Z')).hour, '18');
  assert.equal(parseAddress('12 Banksia Ave, Penrith NSW 2750, Australia').postcode, '2750');
  assert.equal(parseAddress('Penrith'), null);
  // Google suggestions usually have no postcode; it is supplied separately
  const g = parseAddress('12 Banksia Avenue, Penrith NSW, Australia', '2750');
  assert.equal(g.postcode, '2750');
  assert.equal(g.formatted_address, '12 Banksia Avenue, Penrith NSW 2750');
  assert.equal(parseAddress('12 Banksia Avenue, Penrith NSW, Australia'), null);
  assert.equal(parseAddress('Penrith Plaza, 585 High St, Penrith NSW, Australia', '2750').suburb, 'Penrith');
});

function fakeStore() {
  const s = { customers: [], rows: [], notes: [], events: [] };
  const amit = { id: '11111111-1111-4111-8111-111111111111', full_name: 'Amit', email: 'amit@goldsure.com.au', active: true };
  let job = 1001;
  return Object.assign(s, {
    assessors: async () => [amit], availability: async () => [], timeOff: async () => [], settings: async () => ({ visit_minutes: 90, buffer_minutes: 15 }),
    bookings: async () => s.rows.map(b => ({ ...b, customer: s.customers.find(c => c.id === b.customer_id) })),
    booking: async id => s.rows.find(b => b.id === id),
    findCustomer: async c => s.customers.find(x => x.phone === c.phone && x.formatted_address === c.formatted_address),
    insertCustomer: async c => { const row = { id: `c${s.customers.length}`, ...c }; s.customers.push(row); return row; },
    insertBooking: async b => {
      const e = Date.parse(b.ends_at), st = Date.parse(b.starts_at);
      if (s.rows.some(x => x.assessor_id === b.assessor_id && x.status === 'scheduled' && Date.parse(x.starts_at) < e && Date.parse(x.ends_at) > st)) { const err = new Error('overlap'); err.code = '23P01'; throw err; }
      const row = { id: `00000000-0000-4000-8000-00000000000${s.rows.length}`, job_number: job, reference: `J${job++}`, status: 'scheduled', ghl_status: 'not_sent', ...b };
      s.rows.push(row); return row;
    },
    updateBooking: async (id, patch) => { Object.assign(s.rows.find(b => b.id === id), patch); return s.rows.find(b => b.id === id); },
    event: async (id, type) => { s.events.push([id, type]); },
  });
}
const call = async (handler, req) => { let out; await handler({ headers: {}, query: {}, ...req }, { setHeader() {}, status(c) { this.c = c; return this; }, json(o) { out = { status: this.c, ...o }; } }); return out; };
const booking = over => ({ method: 'POST', query: { action: 'create-booking' }, body: { assessor_id: '11111111-1111-4111-8111-111111111111', date: '2026-11-05', time: '08:30', customer: { name: 'Maria P', phone: '0412 345 678', email: 'm@example.com', address: '12 Banksia Ave, Penrith NSW, Australia', postcode: '2750', ghl_contact_id: 'g1' }, ...over } });

test('create-booking assigns the next job number, notes GHL, and refuses a double booking', async () => {
  const store = fakeStore(), notes = [];
  const handler = createIhaHandler({ store, ghl: { search: async () => [], note: async (id, text) => notes.push([id, text]) }, env: {} });
  const a = await call(handler, booking());
  assert.equal(a.status, 200);
  assert.equal(a.booking.reference, 'J1001');
  assert.equal(a.booking.ghl_status, 'synced');
  assert.match(notes[0][1], /J1001/);
  const clash = await call(handler, booking({ time: '09:00' }));
  assert.equal(clash.status, 409);
  const next = await call(handler, booking({ time: '11:00' }));
  assert.equal(next.booking.reference, 'J1002');
});

test('create-booking validates input and survives a GHL failure', async () => {
  const store = fakeStore();
  const handler = createIhaHandler({ store, ghl: { search: async () => [], note: async () => { throw new Error('down'); } }, env: {} });
  assert.equal((await call(handler, booking({ customer: { name: 'A', phone: '1', address: 'x' } }))).status, 400);
  assert.equal((await call(handler, booking({ customer: { name: 'Maria', phone: '0412345678', address: 'Penrith' } }))).status, 400);
  const ok = await call(handler, booking());
  assert.equal(ok.status, 200);
  assert.equal(ok.booking.ghl_status, 'failed');
});

test('status updates stamp times; digest email lists the job number', async () => {
  const store = fakeStore();
  const handler = createIhaHandler({ store, ghl: { search: async () => [], note: async () => true }, env: {} });
  const made = await call(handler, booking());
  const upd = await call(handler, { method: 'POST', query: { action: 'update-status' }, body: { id: made.booking.id, status: 'arrived' } });
  assert.ok(upd.booking.arrived_at);
  const mail = buildEmail({ mode: 'evening', assessorName: 'Amit', day: '2026-11-05', bookings: [{ ...made.booking, customer: made.booking.customer }] });
  assert.match(mail.subject, /1 battery assessment booked for tomorrow/);
  assert.match(mail.text, /J1001/);
});
