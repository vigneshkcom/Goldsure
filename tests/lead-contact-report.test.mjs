import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { callEvidence, contactEvidence, dedupeCustomerCalls, isDirectCallOpportunity, isNotReachableTemplate, leadReachability, noteText, reportPhone, reportTotals, respondedAfter, smsTemplateFromNote, stageProgress } from '../lib/lead-contact-report.js';
import { leadContactReport, sydneyMidnight } from '../lib/lead-contact-report-api.js';

function recorder() {
  return { statusCode: 0, body: null, headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('phone matching rejects extensions and distinguishes call results', () => {
  assert.equal(reportPhone('+61 412 345 678'), '412345678');
  assert.equal(reportPhone('0412 345 678'), '412345678');
  assert.equal(reportPhone('12345678'), '');
  assert.equal(callEvidence({ result: 'Voicemail', duration: 25 }), 'no-answer');
  assert.equal(callEvidence({ result: 'Accepted', duration: 25 }), 'connected');
  assert.equal(callEvidence({ result: 'Unknown', duration: 25 }), 'unknown');
  assert.equal(dedupeCustomerCalls([{ sessionId: 'same', result: 'No Answer' }, { sessionId: 'same', result: 'Accepted', duration: 25 }])[0].result, 'Accepted');
});

test('Direct Call leads are identified by exact source or opportunity name', () => {
  assert.equal(isDirectCallOpportunity({ source: 'Direct Call' }), true);
  assert.equal(isDirectCallOpportunity({ source: 'direct_call' }), true);
  assert.equal(isDirectCallOpportunity({ name: 'ALEX LEAD - Direct Call' }), true);
  assert.equal(isDirectCallOpportunity({ source: 'Facebook', name: 'Direct Call advertising enquiry' }), false);
});

test('report dates use Sydney midnight across daylight saving changes', () => {
  assert.equal(new Date(sydneyMidnight('2026-10-05')).toISOString(), '2026-10-04T13:00:00.000Z');
  assert.equal(new Date(sydneyMidnight('2026-10-04')).toISOString(), '2026-10-03T14:00:00.000Z');
  assert.equal(new Date(sydneyMidnight('2026-04-05')).toISOString(), '2026-04-04T13:00:00.000Z');
  assert.equal(new Date(sydneyMidnight('2026-04-06')).toISOString(), '2026-04-05T14:00:00.000Z');
});

test('only connected calls or replies count as contact signals and uncertainty stays visible', () => {
  const leadAt = '2026-10-05T00:00:00Z';
  const missed = [{ startTime: '2026-10-05T01:00:00Z', direction: 'Outbound', result: 'No Answer' }];
  assert.equal(contactEvidence({ leadAt, calls: missed }).status, 'Attempted, no confirmed response');
  assert.equal(contactEvidence({ leadAt, calls: missed, complete: false }).status, 'Needs review');
  assert.equal(contactEvidence({ leadAt, calls: [{ ...missed[0], result: 'Unknown' }] }).status, 'Needs review');
  assert.equal(contactEvidence({ leadAt, sms: [{ createdAt: '2026-10-05T02:00:00Z', direction: 'inbound' }] }).status, 'Connected call or SMS reply');
  assert.equal(contactEvidence({ leadAt, calls: [{ ...missed[0], startTime: '2026-10-04T23:00:00Z' }] }).status, 'No attempt recorded');
  assert.deepEqual(reportTotals([{ contactStatus: 'Connected call or SMS reply' }, { contactStatus: 'Attempted, no confirmed response', callsMade: 3 }, { contactStatus: 'No attempt recorded', callsMade: 0 }, { contactStatus: 'Needs review' }]), { customers: 4, reached: 1, attempted: 1, noAttempt: 1, needsReview: 1, notChecked: 0, calledNoConnection: 1, callsToUnconnected: 3 });
});

test('a lead past New Lead in GHL counts as reached; New Lead leads use call and SMS records', () => {
  assert.equal(stageProgress('New Lead'), 'new');
  assert.equal(stageProgress('Today'), 'new');
  assert.equal(stageProgress('Unknown stage'), 'new');
  assert.equal(stageProgress('Not Reachable'), 'not-reachable');
  for (const stage of ['Quote Sent', 'Follow Up', 'IHA Booked', 'Installed', 'Not Interested/Spam']) assert.equal(stageProgress(stage), 'moved-on', stage);
  assert.equal(leadReachability({ stage: 'Quote Sent', contactStatus: 'No attempt recorded' }), 'reached');
  assert.equal(leadReachability({ stage: 'Quote Sent', contactStatus: 'Needs review' }), 'reached');
  assert.equal(leadReachability({ stage: 'Not Reachable', contactStatus: 'Connected call or SMS reply' }), 'unreachable');
  assert.equal(leadReachability({ stage: 'New Lead', contactStatus: 'Connected call or SMS reply' }), 'reached');
  assert.equal(leadReachability({ stage: 'New Lead', contactStatus: 'Attempted, no confirmed response' }), 'unreachable');
  assert.equal(leadReachability({ stage: 'New Lead', contactStatus: 'No attempt recorded' }), 'untried');
  assert.equal(leadReachability({ stage: 'Today', contactStatus: 'Needs review' }), 'review');
});

test('GHL notes are shown as plain text and Not Reachable templates are recognised', () => {
  assert.equal(noteText('<p style="margin:0px; padding-left: 0px!important;">Said number is not connected, not sure if sms is going to reach him.</p>'), 'Said number is not connected, not sure if sms is going to reach him.');
  assert.equal(noteText('<p>Line one<br>Line &amp; two</p><p>&lt;b&gt; &#39;x&#39; &#x2013; &bogus;</p>'), "Line one\nLine & two\n<b> 'x' – &bogus;");
  const portalNote = '[SMS Portal Note]\nTried calling, no answer. Texted "Not Reachable – 1st Attempt" via SMS Portal. Sent by Shanira.';
  assert.equal(smsTemplateFromNote(portalNote), 'Not Reachable – 1st Attempt');
  assert.equal(smsTemplateFromNote('<p>Tried calling, no answer. Texted &quot;Not Reachable – 2nd Attempt&quot; via SMS Portal.</p>'), 'Not Reachable – 2nd Attempt');
  assert.equal(smsTemplateFromNote('$30 off code SMOKE30 sent via SMS as the final not-reachable lure. Sent by Amit.'), 'Not Reachable – Final');
  assert.equal(smsTemplateFromNote('Called and booked in for Tuesday.'), '');
  assert.equal(isNotReachableTemplate('Not Reachable – Final (30 Off)'), true);
  assert.equal(isNotReachableTemplate('Referral / Incoming Call – Consent'), false);
});

test('a Not Reachable template means not reachable so far until the customer replies or calls in', () => {
  const sentAt = '2026-10-06T00:51:00Z';
  assert.equal(respondedAfter(sentAt, { calls: [{ direction: 'Outbound', result: 'Call connected', duration: 40, startTime: '2026-10-06T01:00:00Z' }] }), false, 'our own connected call (often voicemail) is not a response');
  assert.equal(respondedAfter(sentAt, { sms: [{ direction: 'inbound', createdAt: '2026-10-06T00:30:00Z' }] }), false, 'a reply before the template does not count');
  assert.equal(respondedAfter(sentAt, { ghlMessages: [{ direction: 'inbound', dateAdded: '2026-10-06T02:00:00Z' }] }), true);
  assert.equal(respondedAfter(sentAt, { calls: [{ direction: 'Inbound', result: 'Accepted', duration: 30, startTime: '2026-10-06T02:00:00Z' }] }), true);
  assert.equal(leadReachability({ stage: 'New Lead', contactStatus: 'Connected call or SMS reply', notReachableSms: true }), 'unreachable');
  assert.equal(leadReachability({ stage: 'New Lead', contactStatus: 'Needs review', notReachableSms: true }), 'unreachable');
  assert.equal(leadReachability({ stage: 'Quote Sent', contactStatus: 'Attempted, no confirmed response', notReachableSms: true }), 'reached');
});

test('report checks all three sources and reads GHL notes without writes', async () => {
  const savedFetch = global.fetch;
  const saved = Object.fromEntries(['GHL_API_KEY', 'GHL_LOCATION_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { GHL_API_KEY: 'ghl-test', GHL_LOCATION_ID: 'location123', SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'supa-test' });
  const seen = [];
  let incompleteLeads = false;
  global.fetch = async (url, options = {}) => {
    const value = String(url); seen.push({ value, method: options.method || 'GET' });
    const json = body => new Response(JSON.stringify(body), { status: 200 });
    if (value.includes('/opportunities/search')) return json(incompleteLeads ? {} : { opportunities: [
      { id: 'direct', contactId: 'direct-contact', name: 'DIRECT PERSON - Direct Call', pipelineId: 'pipe1', pipelineStageId: 'stage1', dateAdded: '2026-10-05T02:00:00Z', source: 'Direct Call' },
      { id: 'lead1', contactId: 'contact1', pipelineId: 'pipe1', pipelineStageId: 'stage1', dateAdded: '2026-10-05T01:00:00Z', source: 'Facebook campaign' },
    ] });
    if (value.includes('/opportunities/pipelines')) return json({ pipelines: [{ id: 'pipe1', name: 'Smoke Alarms', stages: [{ id: 'stage1', name: 'New Lead' }] }] });
    if (value.includes('/contacts/contact1/notes')) return json({ notes: [{ id: 'n1', dateAdded: '2026-10-05T03:00:00Z', body: 'Tried calling, no answer. Texted "Not Reachable – 1st Attempt" via SMS Portal.' }] });
    if (value.includes('/contacts/contact1')) return json({ contact: { id: 'contact1', firstName: 'Alex', lastName: 'Lead', phone: '0412345678' } });
    if (value.includes('/conversations/search')) return json({ conversations: [{ id: 'conversation1' }], total: 1 });
    if (value.includes('/conversations/conversation1/messages')) return json({ messages: { nextPage: false, messages: [{ id: 'm1', dateAdded: '2026-10-05T04:00:00Z', messageType: 'TYPE_SMS', direction: 'inbound', body: 'Please call me' }] } });
    if (value.includes('/call-log')) return json({ records: [{ id: 'call1', sessionId: 'session1', startTime: '2026-10-05T02:00:00Z', direction: 'Outbound', to: { phoneNumber: '+61412345678' }, result: 'No Answer', duration: 0 }] });
    if (value.includes('/sms_messages')) return json([{ id: 1, created_at: '2026-10-05T03:00:00Z', phone_number: '0412345678', direction: 'outbound', status: 'sent', message: 'Hi Alex' }]);
    throw new Error(`Unexpected read: ${value}`);
  };
  try {
    const response = recorder();
    await leadContactReport({ headers: {}, query: { leadReport: 'report', from: '2026-10-05', to: '2026-10-05' } }, response, { ringcentralToken: async () => 'rc-test', ringcentralServer: () => 'https://ringcentral.example' });
    assert.equal(response.statusCode, 200, response.body?.error);
    assert.equal(response.body.rows.length, 1);
    assert.equal(response.body.rows[0].stage, 'New Lead');
    assert.equal(response.body.rows[0].stageProgress, 'new');
    assert.equal(response.body.rows[0].reachability, 'reached', 'the customer replied after the Not Reachable SMS');
    assert.equal(response.body.rows[0].notReachableSms, false);
    assert.equal(response.body.rows[0].lastTemplateAt, '2026-10-05T03:00:00Z');
    assert.equal(response.body.rows[0].leadAt, '2026-10-05T01:00:00.000Z');
    assert.equal(response.body.totals.reached, 1);
    assert.equal(response.body.rows[0].callsMade, 1);
    assert.equal(response.body.rows[0].lastTemplate, 'Not Reachable – 1st Attempt');
    const notes = recorder();
    await leadContactReport({ headers: {}, query: { leadReport: 'notes', contactId: 'contact1' } }, notes, { ringcentralToken: async () => 'rc-test', ringcentralServer: () => 'https://ringcentral.example' });
    assert.equal(notes.body.notes[0].id, 'n1');
    assert.ok(seen.every(call => call.method === 'GET'));
    incompleteLeads = true;
    const incomplete = recorder();
    await leadContactReport({ headers: {}, query: { leadReport: 'report', from: '2026-10-05', to: '2026-10-05' } }, incomplete, { ringcentralToken: async () => 'rc-test', ringcentralServer: () => 'https://ringcentral.example' });
    assert.equal(incomplete.statusCode, 502);
    assert.equal(incomplete.body.totals, undefined);
  } finally {
    global.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('lead report page script compiles', () => {
  const html = readFileSync(new URL('../leads/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  new vm.Script(script);
  assert.match(html, /GHL stage/);
  assert.match(html, /Calls to leads not reachable so far/);
  assert.match(html, /<option value="open">Not reached yet/);
  assert.match(html, /<button type="button" data-days="7">Last 7 days<\/button>/);
  assert.match(html, /label:'Not reachable so far'/);
  assert.match(html, /Direct Call leads are excluded/);
  assert.doesNotMatch(html, /Assigned staff member|First call\/SMS time/);
  assert.doesNotMatch(html, /Portal access PIN|x-lead-report-pin/);
});

test('lead page answers the follow-up question first and groups leads under each pipeline', () => {
  const html = readFileSync(new URL('../leads/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'view' ? 'open' : '', innerHTML: '', textContent: '', addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const page = vm.runInNewContext(`${script}\n({ state, pipelineGroups, statusKey, render, renderSummary, rangeParts, mergeRows, setRange, percent })`, {
    document: { getElementById, addEventListener() {} }, URLSearchParams, fetch: () => new Promise(() => {}),
  });
  const to = getElementById('to').value;
  assert.equal(getElementById('from').value, new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
  const names = ['Smoke Alarms', 'Aircons', 'HWS Pipeline', 'NSW HWS Pipeline'];
  const leads = [['Quote Sent', 'moved-on', 'reached'], ['New Lead', 'new', 'unreachable'], ['New Lead', 'new', 'untried'], ['Not Reachable', 'not-reachable', 'unreachable']];
  page.state.rows = names.map((pipeline, index) => ({
    pipeline, stage: leads[index][0], stageProgress: leads[index][1], reachability: leads[index][2], name: `Customer ${index}`, phone: '0412345678', source: 'Meta',
    leadAt: `2026-10-05T0${index}:00:00Z`, callsMade: index, smsSent: 0, contactStatus: 'Attempted, no confirmed response', link: 'https://example.com', contactId: `contact${index}`,
  }));
  page.state.rows.push({ ...page.state.rows[0], name: 'Unclear record', contactId: 'contact4', stage: 'New Lead', stageProgress: 'new', reachability: 'review', callsMade: 0, leadAt: '2026-10-05T00:30:00Z' });
  page.state.rows.push({ ...page.state.rows[1], name: 'Not called yet', contactId: 'contact5', reachability: 'untried', callsMade: 0, leadAt: '2026-10-04T23:00:00Z' });
  page.state.loaded = true;
  page.renderSummary();
  page.render();
  assert.equal(getElementById('answerTitle').textContent, '1 of 6 new leads reached (17%)');
  assert.match(getElementById('answerDetail').innerHTML, /5 of 6 leads \(83%\) not reached yet<\/strong>: 2 not reachable so far \(33%\), 2 not tried yet \(33%\), 1 needs a manual check \(17%\)\./);
  assert.match(getElementById('pipelineSummary').innerHTML, /<b>2<\/b><em>33%<\/em>/, 'each count shows its share of the leads');
  assert.equal(page.percent(199, 200), '>99%');
  assert.equal(page.percent(1, 300), '<1%');
  assert.equal(page.percent(0, 5), '0%');
  assert.equal((getElementById('pipelineSummary').innerHTML.match(/class="pipe-row( total)?"/g) || []).length, 5);
  assert.equal(getElementById('callNote').textContent, 'Calls to leads not reachable so far: 4 calls to 2 customers.');
  const sections = getElementById('pipelineSections').innerHTML;
  assert.equal((sections.match(/class="group"/g) || []).length, 4, 'opens on leads not reached yet, still grouped by pipeline');
  assert.doesNotMatch(sections, /Customer 0/, 'Quote Sent counts as reached and is hidden by default');
  assert.ok(sections.indexOf('Not called yet') < sections.indexOf('Customer 1'), 'within a pipeline, not tried yet is listed before not reachable even when older');
  assert.equal(page.statusKey({ reachability: 'something new' }), 'review');
  assert.deepEqual(JSON.parse(JSON.stringify(page.rangeParts('2026-09-30', '2026-10-06'))), [{ from: '2026-10-04', to: '2026-10-06' }, { from: '2026-10-02', to: '2026-10-03' }, { from: '2026-09-30', to: '2026-10-01' }], 'a week is read in three parts with no gaps');
  assert.equal(page.rangeParts('2026-10-05', '2026-10-06').length, 1);
  const merged = page.mergeRows([[{ contactId: 'a', leadAt: '2026-10-06T01:00:00Z', stage: 'New Lead', opportunityCount: 1 }], [{ contactId: 'a', leadAt: '2026-10-02T01:00:00Z', stage: 'Quote Sent', opportunityCount: 1 }]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stage, 'New Lead', 'keeps the newest lead for a customer found in two parts');
  assert.equal(merged[0].opportunityCount, 2);
  page.setRange(7);
  assert.equal(getElementById('from').value, new Date(Date.parse(`${getElementById('to').value}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10));
  const savedRows = page.state.rows;
  page.state.rows = [{ ...savedRows[0], reachability: 'reached' }, { ...savedRows[1], reachability: 'unreachable' }, { ...savedRows[3], reachability: 'unreachable' }];
  page.renderSummary();
  assert.equal(getElementById('answerTitle').textContent, '1 of 3 new leads reached (33%)');
  assert.match(getElementById('answerDetail').innerHTML, /<strong>2 of 3 leads \(67%\) not reachable so far<\/strong>\./);
  page.state.rows = savedRows;
  page.renderSummary();
  getElementById('view').value = 'all';
  page.render();
  assert.equal((getElementById('pipelineSections').innerHTML.match(/<table class="leads">/g) || []).length, 4);
  assert.ok(getElementById('pipelineSections').innerHTML.indexOf('Unclear record') < getElementById('pipelineSections').innerHTML.indexOf('Customer 0'), 'reached leads sink to the bottom');
});

function ghlMock({ opportunities, notes = [], messages = [], fail429 = 0 }) {
  const seen = [];
  let throttled = 0;
  const fetch = async url => {
    const value = String(url); seen.push(value);
    const json = body => new Response(JSON.stringify(body), { status: 200 });
    if (value.includes('/opportunities/search')) return json({ opportunities });
    if (value.includes('/opportunities/pipelines')) return json({ pipelines: [{ id: 'pipe1', name: 'Smoke Alarms', stages: [{ id: 'new', name: 'New Lead' }, { id: 'quoted', name: 'Quote Sent' }] }] });
    if (/\/contacts\/[^/]+\/notes/.test(value)) {
      if (throttled < fail429) { throttled++; return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }); }
      return json({ notes });
    }
    if (value.includes('/contacts/')) return json({ contact: { id: value.split('/contacts/')[1], firstName: 'Fetched', phone: '0499999999' } });
    if (value.includes('/conversations/search')) return json({ conversations: [{ id: 'conversation1' }], total: 1 });
    if (value.includes('/messages')) return json({ messages: { nextPage: false, messages } });
    if (value.includes('/call-log')) return json({ records: [{ id: 'call1', sessionId: 's1', startTime: '2026-10-05T02:00:00Z', direction: 'Outbound', to: { phoneNumber: '+61412345678' }, result: 'Call connected', duration: 35 }] });
    if (value.includes('/sms_messages')) return json([]);
    throw new Error(`Unexpected read: ${value}`);
  };
  return { fetch, seen };
}

async function runReport(mock) {
  const savedFetch = global.fetch;
  const saved = Object.fromEntries(['GHL_API_KEY', 'GHL_LOCATION_ID', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { GHL_API_KEY: 'ghl-test', GHL_LOCATION_ID: 'location123', SUPABASE_URL: 'https://supabase.example', SUPABASE_ANON_KEY: 'supa-test' });
  global.fetch = mock.fetch;
  try {
    const response = recorder();
    await leadContactReport({ headers: {}, query: { leadReport: 'report', from: '2026-10-05', to: '2026-10-05' } }, response, { ringcentralToken: async () => 'rc-test', ringcentralServer: () => 'https://ringcentral.example' });
    return response;
  } finally {
    global.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test('a connected call followed by a Not Reachable SMS reads as not reachable so far', async () => {
  const mock = ghlMock({
    opportunities: [{ id: 'lead1', contactId: 'contact1', contact: { id: 'contact1', name: 'Manoj Jayasundara', phone: '+61412345678' }, pipelineId: 'pipe1', pipelineStageId: 'new', dateAdded: '2026-10-05T01:00:00Z', source: 'Meta' }],
    notes: [
      { id: 'n1', dateAdded: '2026-10-05T02:51:00Z', body: '[SMS Portal Note]\nTried calling, no answer. Texted "Not Reachable – 1st Attempt" via SMS Portal. Sent by Shanira.' },
      { id: 'n2', dateAdded: '2026-10-05T02:51:30Z', body: '<p style="margin:0px;">Said number is not connected, not sure if sms is going to reach him.</p>' },
    ],
  });
  const response = await runReport(mock);
  assert.equal(response.statusCode, 200, response.body?.error);
  const [row] = response.body.rows;
  assert.equal(row.contactStatus, 'Connected call or SMS reply');
  assert.equal(row.reachability, 'unreachable');
  assert.equal(row.notReachableSms, true);
  assert.equal(row.lastTemplate, 'Not Reachable – 1st Attempt');
  assert.equal(row.name, 'Manoj Jayasundara');
  assert.ok(!mock.seen.some(url => /\/contacts\/contact1$/.test(url)), 'uses the contact included with the opportunity instead of another GHL read');
});

test('leads past New Lead skip message and note reads; a GHL 429 is waited out', async () => {
  const mock = ghlMock({
    fail429: 1,
    opportunities: [
      { id: 'lead1', contactId: 'quoted1', contact: { id: 'quoted1', name: 'Quoted Customer', phone: '0411111111' }, pipelineId: 'pipe1', pipelineStageId: 'quoted', dateAdded: '2026-10-05T03:00:00Z', source: 'Meta' },
      { id: 'lead2', contactId: 'new1', pipelineId: 'pipe1', pipelineStageId: 'new', dateAdded: '2026-10-05T02:00:00Z', source: 'Meta' },
    ],
  });
  const response = await runReport(mock);
  assert.equal(response.statusCode, 200, response.body?.error);
  const quoted = response.body.rows.find(row => row.contactId === 'quoted1');
  const fresh = response.body.rows.find(row => row.contactId === 'new1');
  assert.equal(quoted.reachability, 'reached');
  assert.equal(quoted.contactStatus, 'Not checked');
  assert.ok(!mock.seen.some(url => url.includes('quoted1')), 'no per-contact GHL reads for a lead past New Lead');
  assert.equal(fresh.name, 'Fetched', 'a contact without a phone on the opportunity is looked up');
  assert.equal(fresh.reachability, 'untried');
  assert.equal(fresh.lastTemplate, 'Not recorded', 'notes were read after the 429 cleared');
  assert.equal(mock.seen.filter(url => url.includes('/contacts/new1/notes')).length, 2);
});

test('notes endpoint returns plain text', async () => {
  const mock = ghlMock({ opportunities: [], notes: [{ id: 'n1', dateAdded: '2026-10-05T02:51:00Z', body: '<p style="margin:0px;">Said number is not connected.</p>' }] });
  const savedFetch = global.fetch, savedKey = process.env.GHL_API_KEY, savedLocation = process.env.GHL_LOCATION_ID;
  Object.assign(process.env, { GHL_API_KEY: 'ghl-test', GHL_LOCATION_ID: 'location123' });
  global.fetch = mock.fetch;
  try {
    const response = recorder();
    await leadContactReport({ headers: {}, query: { leadReport: 'notes', contactId: 'contact1' } }, response, {});
    assert.equal(response.body.notes[0].body, 'Said number is not connected.');
  } finally {
    global.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GHL_API_KEY; else process.env.GHL_API_KEY = savedKey;
    if (savedLocation === undefined) delete process.env.GHL_LOCATION_ID; else process.env.GHL_LOCATION_ID = savedLocation;
  }
});
