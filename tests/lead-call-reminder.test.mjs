import test from 'node:test';
import assert from 'node:assert/strict';
import { leadCallReminder, phoneLabel, reminderEmail, reminderGroups, reminderSkipReason } from '../lib/lead-call-reminder.js';

const today = '2026-10-06';
const row = (name, extra) => ({
  contactId: name, name, phone: '+61412345678', pipeline: 'Smoke Alarms', stage: 'New Lead', stageProgress: 'new', reachability: 'unreachable',
  leadAt: '2026-10-05T01:00:00.000Z', link: `https://example.com/${name}`, callsChecked: true, lastContactAt: '2026-10-05T23:00:00.000Z', lastContactType: 'call',
  callDays: [{ day: '2026-10-05', calls: 1, status: 'short' }, { day: today, calls: 1, status: 'today' }], ...extra,
});

test('the reminder lists New Lead customers not reached, by calls made today', () => {
  const rows = [
    row('One call'),
    row('Not tried', { reachability: 'untried', lastContactAt: '', callDays: [{ day: today, calls: 0, status: 'today' }] }),
    row('Two calls', { callDays: [{ day: today, calls: 2, status: 'today' }] }),
    row('Done today', { callDays: [{ day: today, calls: 3, status: 'met' }] }),
    row('Shared phone', { callsChecked: false }),
    row('Reached', { reachability: 'reached' }),
    row('Quoted', { stage: 'Quote Sent', stageProgress: 'moved-on', reachability: 'reached' }),
    row('Moved to Not Reachable', { stage: 'Not Reachable', stageProgress: 'not-reachable' }),
    row('Unclear', { reachability: 'review' }),
    row('Earlier contact', { lastContactAt: '2026-10-05T20:00:00.000Z' }),
  ];
  const { leads, groups, unchecked, done } = reminderGroups(rows, today);
  assert.deepEqual(leads.map(lead => lead.name), ['One call', 'Not tried', 'Two calls', 'Done today', 'Shared phone', 'Earlier contact']);
  assert.deepEqual(groups.map(group => group.rows.map(lead => lead.name)), [['Not tried'], ['Earlier contact', 'One call'], ['Two calls']], 'longest since last contact first');
  assert.deepEqual(unchecked.map(lead => lead.name), ['Shared phone']);
  assert.deepEqual(done.map(lead => lead.name), ['Done today']);
});

test('the reminder email groups customers and escapes names', () => {
  const now = new Date('2026-10-06T01:00:00Z'); // 12 pm Sydney
  const email = reminderEmail({ now, rows: [row('<b>Ann</b>'), row('Ben', { reachability: 'untried', lastContactAt: '', callDays: [{ day: today, calls: 0, status: 'today' }] }), row('Cal', { callDays: [{ day: today, calls: 3, status: 'met' }] })] });
  assert.equal(email.needCalls, 2);
  assert.equal(email.subject, 'Call reminder 12 pm: 2 customers need more calls today');
  assert.match(email.html, /No calls yet today \(1\)/);
  assert.match(email.html, /1 call so far today \(1\)/);
  assert.match(email.html, /Needs 2 more calls today/);
  assert.match(email.html, /3\+ calls done today \(1\)[\s\S]*Cal/);
  assert.match(email.html, /&lt;b&gt;Ann&lt;\/b&gt;/);
  assert.doesNotMatch(email.html, /<b>Ann<\/b>/);
  assert.match(email.html, /href="tel:\+61412345678"[^>]*>0412 345 678</);
  assert.match(email.html, /including 1 with no call or SMS at all/);
  assert.match(email.text, /No calls yet today \(1\):\n- Ben 0412 345 678/);
  assert.equal(phoneLabel('0298765432'), '02 9876 5432');
  assert.equal(reminderEmail({ now, rows: [row('Cal', { callDays: [{ day: today, calls: 3, status: 'met' }] })] }).needCalls, 0);
});

function mockServices(sent) {
  const hour = 3600000, now = Date.now();
  return async (url, options = {}) => {
    const value = String(url);
    const json = body => new Response(JSON.stringify(body), { status: 200 });
    if (value.startsWith('https://api.mail.hostinger.com/')) { sent.push(JSON.parse(options.body)); return json({}); }
    if (value.includes('/opportunities/search')) return json({ opportunities: [
      { id: 'o1', contactId: 'c1', contact: { id: 'c1', name: 'Judith Lynch', phone: '+61448660757' }, pipelineId: 'p', pipelineStageId: 'new', dateAdded: new Date(now - 2 * hour).toISOString(), source: 'Google' },
      { id: 'o2', contactId: 'c2', contact: { id: 'c2', name: 'Quoted Person', phone: '+61411111111' }, pipelineId: 'p', pipelineStageId: 'quoted', dateAdded: new Date(now - 3 * hour).toISOString(), source: 'Meta' },
    ] });
    if (value.includes('/opportunities/pipelines')) return json({ pipelines: [{ id: 'p', name: 'Smoke Alarms', stages: [{ id: 'new', name: 'New Lead' }, { id: 'quoted', name: 'Quote Sent' }] }] });
    if (/\/contacts\/[^/]+\/notes/.test(value)) return json({ notes: [{ id: 'n', dateAdded: new Date(now - hour).toISOString(), body: 'Tried calling, no answer. Texted "Not Reachable – 1st Attempt" via SMS Portal.' }] });
    if (value.includes('/conversations/search')) return json({ conversations: [], total: 0 });
    if (value.includes('/call-log')) return json({ records: [{ id: 'r1', sessionId: 's1', startTime: new Date(now - 90 * 60000).toISOString(), direction: 'Outbound', to: { phoneNumber: '+61448660757' }, result: 'No Answer', duration: 0 }] });
    if (value.includes('/sms_messages')) return json([]);
    throw new Error(`Unexpected request: ${value}`);
  };
}

test('the reminder is due at 12 pm and 3 pm Sydney on weekdays only, across daylight saving', () => {
  assert.equal(reminderSkipReason(new Date('2026-10-12T01:00:00Z')), '', 'Monday 12 pm AEDT');
  assert.equal(reminderSkipReason(new Date('2026-10-16T04:30:00Z')), '', 'Friday 3:30 pm AEDT');
  assert.equal(reminderSkipReason(new Date('2026-06-15T02:00:00Z')), '', 'Monday 12 pm AEST');
  assert.equal(reminderSkipReason(new Date('2026-06-15T01:00:00Z')), 'outside_reminder_hours', '11 am AEST, the other UTC run');
  assert.equal(reminderSkipReason(new Date('2026-10-12T02:00:00Z')), 'outside_reminder_hours', '1 pm AEDT, the other UTC run');
  assert.equal(reminderSkipReason(new Date('2026-10-10T01:00:00Z')), 'weekend', 'Saturday 12 pm');
  assert.equal(reminderSkipReason(new Date('2026-10-11T04:00:00Z')), 'weekend', 'Sunday 3 pm');
});

test('reminder endpoint: cron secret required, preview never sends, force sends one team email', async () => {
  const keys = ['GHL_API_KEY', 'GHL_LOCATION_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'CRON_SECRET', 'HOSTINGER_MAILBOX_RESOURCE_ID', 'HOSTINGER_MAIL_API_TOKEN', 'LEAD_REMINDER_TO'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])), savedFetch = global.fetch;
  Object.assign(process.env, { GHL_API_KEY: 'k', GHL_LOCATION_ID: 'loc', SUPABASE_URL: 'https://sb.example', SUPABASE_ANON_KEY: 'a', CRON_SECRET: 'cron', HOSTINGER_MAILBOX_RESOURCE_ID: 'box', HOSTINGER_MAIL_API_TOKEN: 'mail', LEAD_REMINDER_TO: 'team@goldsure.com.au, owner@goldsure.com.au' });
  const sent = [];
  global.fetch = mockServices(sent);
  const deps = { ringcentralToken: async () => 'rc', ringcentralServer: () => 'https://rc.example' };
  const call = async (query, headers = {}) => {
    const res = { statusCode: 0, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
    await leadCallReminder({ query: { leadReport: 'reminder', ...query }, headers }, res, deps);
    return res;
  };
  try {
    assert.equal((await call({})).statusCode, 401);
    assert.equal((await call({ force: '1' }, { authorization: 'Bearer wrong' })).statusCode, 401);
    // A scheduled run sends only at 12 pm or 3 pm on a weekday; check whichever applies right now.
    const skip = reminderSkipReason(), scheduled = await call({}, { authorization: 'Bearer cron' });
    if (skip) assert.equal(scheduled.body.reason, skip);
    else assert.equal(scheduled.body.sent, 2);
    const before = sent.length;
    const preview = await call({ preview: '1' });
    assert.equal(preview.statusCode, 200);
    assert.match(preview.body, /1 customer needs more calls today/);
    assert.match(preview.body, /Judith Lynch/);
    assert.doesNotMatch(preview.body, /Quoted Person/);
    assert.equal(sent.length, before, 'preview does not send');
    const forced = await call({ force: '1' }, { authorization: 'Bearer cron' });
    assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
    assert.equal(sent.length, before + 1);
    assert.deepEqual(sent.at(-1).to, ['team@goldsure.com.au', 'owner@goldsure.com.au']);
    assert.match(sent.at(-1).subject, /^Call reminder .+: 1 customer needs more calls today$/);
    assert.match(sent.at(-1).html, /Sent “Not Reachable – 1st Attempt”/);
    delete process.env.LEAD_REMINDER_TO;
    await call({ force: '1' }, { authorization: 'Bearer cron' });
    assert.deepEqual(sent.at(-1).to, ['info@goldsure.com.au'], 'goes to info@ by default');
  } finally {
    global.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
