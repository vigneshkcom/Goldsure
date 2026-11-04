import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { runHourReminders } from '../lib/battery-iha-reminders.js';
import digestHandler, { buildEmail, sydneyParts } from '../lib/battery-iha-digest.js';

const booking = () => ({ id: 'job-1', reference: 'J1002', status: 'scheduled', starts_at: '2026-11-05T02:00:00Z', ends_at: '2026-11-05T03:00:00Z', assessor: { id: 'amit-id', full_name: 'Amit', email: 'amit@example.test' }, customer: { full_name: 'Customer', formatted_address: '1 Test St', phone: '0400000000' } });
function fixture() {
  const claims = new Map(), mails = [];
  let current = booking(), fresh = null, failure = null;
  const key = b => [b.booking_id, b.starts_at, b.assessor_id].join('|');
  const options = {
    url: 'https://db.example.test', key: 'test', buildEmail, sydneyParts, now: () => new Date('2026-11-05T01:00:00Z'),
    send: async mail => { if (failure) throw failure; mails.push(mail); },
    fetchImpl: async (raw, init) => {
      const url = new URL(raw), p = url.searchParams;
      let value;
      if (url.pathname.endsWith('/battery_iha_bookings')) value = p.has('id') ? [fresh || current] : [current];
      else if (init.method === 'POST') {
        const body = JSON.parse(init.body), id = key(body);
        value = claims.has(id) ? [] : [body];
        if (value.length) claims.set(id, { ...body, status: 'sending' });
      } else {
        const id = key(Object.fromEntries([...p].map(([k,v]) => [k,v.slice(3)])));
        if (init.method === 'DELETE') claims.delete(id);
        if (init.method === 'PATCH') Object.assign(claims.get(id), JSON.parse(init.body));
        return new Response(null, { status: 204 });
      }
      return Response.json(value);
    },
  };
  return { options, claims, mails, setCurrent: b => current = b, setFresh: b => fresh = b, setFailure: e => failure = e };
}

test('one email under concurrent runs and retries, with dated phone link', async () => {
  const f = fixture();
  await Promise.all([runHourReminders(f.options), runHourReminders(f.options)]);
  await runHourReminders(f.options);
  assert.equal(f.mails.length, 1);
  assert.deepEqual(f.mails[0].to, ['amit@example.test']);
  assert.match(f.mails[0].text, /day=2026-11-05/);
  assert.match(f.mails[0].text, /assessor=amit-id/);
  assert.match(f.mails[0].subject, /1:00pm.*J1002/);
  assert.equal([...f.claims.values()][0].status, 'sent');
});

test('cancelled, completed, past and more-than-hour-away appointments are skipped', async () => {
  for (const change of [{status:'cancelled'}, {status:'completed'}, {status:'no_show'}, {starts_at:'2026-11-05T01:00:00Z'}, {starts_at:'2026-11-05T02:00:01Z'}]) {
    const f = fixture(); f.setCurrent({ ...booking(), ...change });
    await runHourReminders(f.options); assert.equal(f.mails.length, 0);
  }
});

test('changes after the claim are rechecked; a rescheduled job gets its own reminder', async () => {
  const f = fixture();
  f.setFresh({ ...booking(), status:'cancelled' });
  await runHourReminders(f.options); assert.equal(f.mails.length, 0); assert.equal(f.claims.size, 0);
  f.setFresh(null); await runHourReminders(f.options);
  f.setCurrent({ ...booking(), starts_at:'2026-11-05T01:45:00Z' });
  await runHourReminders(f.options);
  assert.equal(f.mails.length, 2);
  const g = fixture(); g.setFresh({ ...booking(), assessor:{ ...booking().assessor, id:'different' } });
  await runHourReminders(g.options); assert.equal(g.mails.length, 0);
});

test('definite rejection retries, ambiguous delivery does not duplicate', async () => {
  const f = fixture(); f.setFailure(Object.assign(new Error('rate limited'), {status:429}));
  assert.equal((await runHourReminders(f.options)).ok, false);
  f.setFailure(null); await runHourReminders(f.options); assert.equal(f.mails.length, 1);
  const g = fixture(); g.setFailure(new Error('timeout'));
  await runHourReminders(g.options); g.setFailure(null); await runHourReminders(g.options);
  assert.equal(g.mails.length, 0); assert.equal([...g.claims.values()][0].status, 'uncertain');
});

test('hourly reminders require the cron secret', async () => {
  let status, body;
  const res = { status: s => { status = s; return res; }, json: b => body = b };
  await digestHandler({method:'GET', headers:{}, query:{mode:'hour'}}, res);
  assert.equal(status, 401); assert.equal(body.error, 'Unauthorized');
});

test('Sydney date links and appointment times work across daylight savings', () => {
  assert.deepEqual(sydneyParts(new Date('2026-07-04T23:00:00Z')), {date:'2026-07-05',hour:'09',minute:'00'});
  assert.deepEqual(sydneyParts(new Date('2026-11-04T23:00:00Z')), {date:'2026-11-05',hour:'10',minute:'00'});
});

test('SQL claim uniqueness includes time and assessor; browser roles have no access', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create table battery_iha_bookings(id uuid primary key); create table battery_iha_assessors(id uuid primary key);');
    await db.exec(await readFile(new URL('../supabase/migrations/20261104015011_battery_iha_hour_reminders.sql', import.meta.url), 'utf8'));
    await db.exec("insert into battery_iha_bookings values('00000000-0000-0000-0000-000000000001'); insert into battery_iha_assessors values('00000000-0000-0000-0000-000000000002');");
    const insert = time => db.query("insert into battery_iha_reminder_runs(booking_id,assessor_id,starts_at) values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',$1) on conflict do nothing returning *", [time]);
    assert.equal((await insert('2026-11-05T02:00:00Z')).rows.length, 1);
    assert.equal((await insert('2026-11-05T13:00:00+11')).rows.length, 0);
    assert.equal((await insert('2026-11-05T03:00:00Z')).rows.length, 1);
    const {rows} = await db.query("select relrowsecurity,has_table_privilege('anon',oid,'SELECT') as anon_read,has_table_privilege('authenticated',oid,'INSERT') as user_write from pg_class where relname='battery_iha_reminder_runs'");
    assert.deepEqual(rows[0], {relrowsecurity:true,anon_read:false,user_write:false});
  } finally { await db.close(); }
});
