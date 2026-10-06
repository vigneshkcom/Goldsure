import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { callEvidence, contactEvidence, dedupeCustomerCalls, isDirectCallOpportunity, reportPhone, reportTotals } from '../lib/lead-contact-report.js';
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
  assert.deepEqual(reportTotals([{ contactStatus: 'Connected call or SMS reply' }, { contactStatus: 'Attempted, no confirmed response', callsMade: 3 }, { contactStatus: 'No attempt recorded', callsMade: 0 }, { contactStatus: 'Needs review' }]), { customers: 4, reached: 1, attempted: 1, noAttempt: 1, needsReview: 1, calledNoConnection: 1, callsToUnconnected: 3 });
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
  assert.match(html, /Current GHL stage/);
  assert.match(html, /Calls to those customers/);
  assert.match(html, /value="unconnected">No connection recorded/);
  assert.match(html, /Direct Call leads are excluded/);
  assert.doesNotMatch(html, /Assigned staff member|First call\/SMS time/);
  assert.doesNotMatch(html, /Portal access PIN|x-lead-report-pin/);
});

test('lead page defaults to yesterday through today and renders four separate pipeline tables', () => {
  const html = readFileSync(new URL('../leads/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { value: id === 'view' ? 'all' : '', innerHTML: '', textContent: '', addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
  };
  const page = vm.runInNewContext(`${script}\n({ state, pipelineGroups, stageTone, render, renderChart })`, {
    document: { getElementById }, URLSearchParams, fetch: () => new Promise(() => {}),
  });
  const to = getElementById('to').value;
  assert.equal(getElementById('from').value, new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
  const names = ['Smoke Alarms', 'Aircons', 'HWS Pipeline', 'NSW HWS Pipeline'];
  page.state.rows = names.map((pipeline, index) => ({
    pipeline, stage: index === 0 ? 'New Lead' : index === 1 ? 'Follow-Up' : index === 2 ? 'Quote Sent' : 'Quote Accepted',
    name: `Customer ${index}`, phone: '0412345678', source: 'Meta', leadAt: '2026-10-05T01:00:00Z',
    callsMade: index, smsSent: 0, contactStatus: 'No attempt recorded', link: 'https://example.com', contactId: `contact${index}`,
  }));
  page.renderChart();
  page.render();
  assert.equal((getElementById('pipelineSections').innerHTML.match(/class="card pipeline-panel"/g) || []).length, 4);
  assert.equal((getElementById('pipelineSections').innerHTML.match(/<table class="report">/g) || []).length, 4);
  assert.equal((getElementById('chart').innerHTML.match(/class="chart-row"/g) || []).length, 4);
  assert.match(getElementById('pipelineSections').innerHTML, /stage-pill stage-accepted">Quote Accepted/);
  assert.equal(page.stageTone('New Lead'), 'new');
  assert.equal(page.stageTone('Follow-Up'), 'follow');
  assert.equal(page.stageTone('Quote Sent'), 'quote');
});
