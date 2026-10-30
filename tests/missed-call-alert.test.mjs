import test from 'node:test';
import assert from 'node:assert/strict';
import { callbackHours, callbackRange, callbackEmail, callbackRecipients, outstandingCallbacks, missedCallAlert } from '../lib/missed-call-alert.js';

const call = (hour, direction = 'Inbound', result = 'Missed', extra = {}) => ({ startTime: `2026-10-28T${hour}:00Z`, direction, result, from: { phoneNumber: '+61412345678', name: 'Customer <A>' }, to: { phoneNumber: '0412345678' }, ...extra });
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('9am to 6pm gates use Sydney time including daylight saving', () => {
  assert.equal(callbackHours(new Date('2026-10-28T07:01:00Z')), false);
  for (const [date, expected] of [['2026-10-27T21:59:00Z', false], ['2026-10-27T22:00:00Z', true], ['2026-10-28T06:30:00Z', true], ['2026-10-28T07:00:00Z', true], ['2026-10-28T07:30:00Z', false], ['2026-06-01T23:00:00Z', true], ['2026-06-02T08:30:00Z', false]]) {
    assert.equal(callbackHours(new Date(date)), expected, date);
  }
});

test('no alerts on Saturday or Sunday in Sydney, resuming Monday 9am', () => {
  for (const [date, expected] of [['2026-10-30T07:00:00Z', true], ['2026-10-30T22:30:00Z', false], ['2026-10-31T03:00:00Z', false], ['2026-11-01T06:00:00Z', false], ['2026-11-01T21:59:00Z', false], ['2026-11-01T22:00:00Z', true]]) {
    assert.equal(callbackHours(new Date(date)), expected, date);
  }
});

test('previous-day 5:30pm cutoff, or 6:30pm Friday on Mondays, across month, year and DST boundaries', () => {
  for (const [now, start] of [
    ['2026-10-27T22:00:00Z', '2026-10-27T06:30:00.000Z'], // Wed 9am AEDT -> Tue 5:30pm AEDT
    ['2026-10-28T07:00:00Z', '2026-10-27T06:30:00.000Z'],
    ['2026-10-04T22:00:00Z', '2026-10-02T08:30:00.000Z'], // Mon 9am AEDT -> Fri 6:30pm AEST
    ['2026-10-05T22:00:00Z', '2026-10-05T06:30:00.000Z'], // Tue 9am AEDT -> Mon 5:30pm AEDT
    ['2026-04-05T23:00:00Z', '2026-04-03T07:30:00.000Z'], // Mon 9am AEST -> Fri 6:30pm AEDT
    ['2026-04-06T23:00:00Z', '2026-04-06T07:30:00.000Z'], // Tue 9am AEST -> Mon 5:30pm AEST
    ['2026-11-01T22:00:00Z', '2026-10-30T07:30:00.000Z'], // Mon 9am -> Fri 6:30pm across the month
    ['2026-11-02T07:00:00Z', '2026-10-30T07:30:00.000Z'], // Mon 6pm still covers the weekend
    ['2026-10-30T22:30:00Z', '2026-10-30T07:30:00.000Z'], // Saturday dry run previews Monday's window
    ['2026-12-31T22:00:00Z', '2026-12-31T06:30:00.000Z'],
  ]) assert.deepEqual(callbackRange(new Date(now)), { timeFrom: start, timeTo: new Date(now).toISOString() }, now);
});

test('Monday 9am alert includes calls since 6:30pm Friday, excluding earlier and returned calls', async () => {
  process.env.CRON_SECRET = 'test-secret';
  const now = new Date('2026-11-01T22:00:00Z');
  const record = (startTime, number, direction = 'Inbound', result = 'Missed') => ({ ...call('01:00', direction, result), startTime, from: { phoneNumber: number }, to: { phoneNumber: number } });
  const records = [
    record('2026-10-30T07:29:59.000Z', '+61400000001'),
    record('2026-10-30T07:30:00.000Z', '+61400000002'),
    record('2026-10-31T00:00:00.000Z', '+61400000003'),
    record('2026-11-01T21:59:00.000Z', '+61400000004'),
    record('2026-10-31T01:00:00.000Z', '+61400000005'),
    record('2026-10-31T02:00:00.000Z', '+61400000005', 'Outbound', 'No Answer'),
  ];
  const res = response();
  await missedCallAlert({ headers: { authorization: 'Bearer test-secret' }, query: { dryRun: '1' } }, res, { now, fetchRecords: async range => { assert.deepEqual(range, callbackRange(now)); return records; } });
  assert.equal(res.body.customers, 3);
  assert.match(res.body.preview.text, /\+61400000002[\s\S]*\+61400000003[\s\S]*\+61400000004/);
  assert.doesNotMatch(res.body.preview.text, /\+61400000001|\+61400000005/);
  assert.match(res.body.preview.text, /since Fri, 30 Oct, 6:30 pm/);
});

test('9am alert includes previous evening and morning, excluding earlier and returned calls', async () => {
  process.env.CRON_SECRET = 'test-secret';
  const now = new Date('2026-10-27T22:00:00Z');
  const record = (startTime, number, direction = 'Inbound', result = 'Missed') => ({ ...call('01:00', direction, result), startTime, from: { phoneNumber: number }, to: { phoneNumber: number } });
  const records = [
    record('2026-10-27T06:29:59.000Z', '+61400000001'),
    record('2026-10-27T06:30:00.000Z', '+61400000002'),
    record('2026-10-27T12:00:00.000Z', '+61400000003'),
    record('2026-10-27T21:59:00.000Z', '+61400000004'),
    record('2026-10-27T07:00:00.000Z', '+61400000005'),
    record('2026-10-27T21:00:00.000Z', '+61400000005', 'Outbound', 'No Answer'),
  ];
  const res = response();
  await missedCallAlert({ headers: { authorization: 'Bearer test-secret' }, query: { dryRun: '1' } }, res, { now, fetchRecords: async range => { assert.deepEqual(range, callbackRange(now)); return records; } });
  assert.equal(res.body.customers, 3);
  assert.match(res.body.preview.text, /\+61400000002/);
  assert.match(res.body.preview.text, /\+61400000003/);
  assert.match(res.body.preview.text, /\+61400000004/);
  assert.doesNotMatch(res.body.preview.text, /\+61400000001|\+61400000005/);
});

test('callback attempt and answered inbound clear a miss; later miss reopens it', () => {
  const miss = call('01:00');
  const callback = call('01:10', 'Outbound', 'No Answer');
  const laterMiss = call('01:20');
  assert.equal(outstandingCallbacks([miss, callback]).length, 0);
  assert.equal(outstandingCallbacks([laterMiss, callback, miss])[0].count, 1);
  assert.equal(outstandingCallbacks([miss, call('01:10', 'Inbound', 'Accepted')]).length, 0);
  assert.equal(outstandingCallbacks([miss, call('01:10', 'Inbound', 'Unknown')]).length, 1);
  assert.equal(outstandingCallbacks([miss, { ...miss, sessionId: 'same' }, { ...miss, sessionId: 'same' }])[0].count, 2);
  assert.equal(outstandingCallbacks([call('01:00', 'Inbound', 'Missed', { from: { phoneNumber: '101' } })]).length, 0);
});

test('mail contains requested wording, four recipients, name, number and escaped HTML', () => {
  const mail = callbackEmail(outstandingCallbacks([call('01:00')]), new Date('2026-10-28T02:00:00Z'));
  assert.deepEqual(mail.to, callbackRecipients);
  assert.equal(mail.to.length, 4);
  assert.match(mail.text, /Hi team,[\s\S]*These customers have not been called back.[\s\S]*ASAP/);
  assert.match(mail.text, /Customer <A>.*\+61412345678.*12:00/);
  assert.match(mail.html, /Customer &lt;A&gt;/);
  assert.doesNotMatch(mail.html, /Customer <A>/);
});

test('authentication, quiet hours, empty results, dry run and live mail decisions', async () => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.HOSTINGER_MAILBOX_RESOURCE_ID = 'test';
  process.env.HOSTINGER_MAIL_API_TOKEN = 'test';
  const req = { headers: { authorization: 'Bearer test-secret' }, query: {} };
  let fetched = 0, sent = 0;
  const deps = { now: new Date('2026-10-28T02:00:00Z'), fetchRecords: async () => { fetched++; return [call('01:00')]; }, send: async mail => { sent++; assert.deepEqual(mail.to, callbackRecipients); } };
  let res = response();
  await missedCallAlert({ headers: {} }, res, deps);
  assert.equal(res.code, 401); assert.equal(fetched, 0);
  res = response();
  await missedCallAlert(req, res, { ...deps, now: new Date('2026-10-28T08:00:00Z') });
  assert.equal(res.body.skipped, 'outside-reporting-hours'); assert.equal(fetched, 0);
  res = response();
  await missedCallAlert(req, res, { ...deps, now: new Date('2026-10-30T22:30:00Z') });
  assert.equal(res.body.skipped, 'outside-reporting-hours'); assert.equal(fetched, 0); assert.equal(sent, 0);
  res = response();
  await missedCallAlert(req, res, { ...deps, fetchRecords: async () => [] });
  assert.equal(res.body.skipped, 'no-outstanding-callbacks'); assert.equal(sent, 0);
  res = response();
  await missedCallAlert({ ...req, query: { dryRun: '1' } }, res, { ...deps, now: new Date('2026-10-28T08:00:00Z') });
  assert.equal(res.body.sent, false); assert.ok(res.body.preview); assert.equal(sent, 0);
  res = response();
  await missedCallAlert(req, res, deps);
  assert.equal(res.body.sent, true); assert.equal(sent, 1);
  res = response();
  await missedCallAlert(req, res, { ...deps, fetchRecords: async () => { throw new Error('Call log unavailable'); } });
  assert.equal(res.code, 500); assert.equal(sent, 1);
});
