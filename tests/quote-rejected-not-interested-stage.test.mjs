import test from 'node:test';
import assert from 'node:assert/strict';

import { syncRejectedQuoteStageForTable } from '../lib/ghl-smoke-alarm-stage.js';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  GHL_API_KEY: 'ghl-key',
  GHL_LOCATION_ID: 'location-1',
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function ghlFetch({ table, quoteStatus = 'rejected', oppStatus = 'open', oppStage = 'quote-sent-stage', pipeline, stages }) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options });
    if (u.includes(`/rest/v1/${table}`)) return jsonResponse([{ customer_email: 'c@example.com', customer_phone: '0412 345 678', status: quoteStatus, accepted: false }]);
    if (u.includes('/contacts/?')) return jsonResponse({ contacts: [{ id: 'contact-1', email: 'c@example.com' }] });
    if (u.includes('/opportunities/pipelines')) return jsonResponse({ pipelines: [{ id: 'pipe-1', name: pipeline, stages }] });
    if (u.includes('/opportunities/search')) return jsonResponse({ opportunities: [{ id: 'opp-1', pipelineId: 'pipe-1', pipelineStageId: oppStage, status: oppStatus }] });
    if (u.endsWith('/opportunities/opp-1')) return jsonResponse({ success: true });
    throw new Error(`Unexpected request: ${u}`);
  };
  return { calls, fetchImpl };
}

const STAGES = [
  { id: 'quote-sent-stage', name: 'Quote Sent' },
  { id: 'accepted-stage', name: 'Quote Accepted' },
  { id: 'not-accepted-stage', name: 'Quote Not Accepted' },
  { id: 'not-interested-stage', name: 'Not Interested/Spam' },
];

for (const { table, pipeline } of [
  { table: 'quote_emails', pipeline: 'Smoke Alarms' },
  { table: 'hotwater_quotes', pipeline: 'HWS Pipeline' },
  { table: 'aircon_quotes', pipeline: 'Aircons' },
  { table: 'nsw_hws_quotes', pipeline: 'NSW HWS Pipeline' },
]) {
  test(`rejected ${table} quote moves the ${pipeline} opportunity to Not Interested`, async () => {
    const { calls, fetchImpl } = ghlFetch({ table, pipeline, stages: STAGES });
    const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: table, fetchImpl, env });
    assert.equal(result.moved, true);
    assert.equal(result.stageId, 'not-interested-stage');
    const put = calls.find(c => c.options.method === 'PUT');
    assert.deepEqual(JSON.parse(put.options.body), { pipelineStageId: 'not-interested-stage' });
  });
}

test('does not touch GHL unless the quote row is actually rejected', async () => {
  const { calls, fetchImpl } = ghlFetch({ table: 'quote_emails', quoteStatus: 'sent', pipeline: 'Smoke Alarms', stages: STAGES });
  const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: 'quote_emails', fetchImpl, env });
  assert.deepEqual(result, { moved: false, reason: 'quote-not-rejected' });
  assert.equal(calls.length, 1);
});

test('leaves an already Not Interested opportunity alone', async () => {
  const { calls, fetchImpl } = ghlFetch({ table: 'quote_emails', pipeline: 'Smoke Alarms', stages: STAGES, oppStage: 'not-interested-stage' });
  const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: 'quote_emails', fetchImpl, env });
  assert.equal(result.reason, 'already-in-not-interested');
  assert.equal(calls.filter(c => c.options.method === 'PUT').length, 0);
});

test('never moves a won opportunity to Not Interested', async () => {
  const { calls, fetchImpl } = ghlFetch({ table: 'quote_emails', pipeline: 'Smoke Alarms', stages: STAGES, oppStatus: 'won' });
  const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: 'quote_emails', fetchImpl, env });
  assert.equal(result.reason, 'opportunity-already-won');
  assert.equal(calls.filter(c => c.options.method === 'PUT').length, 0);
});

test('reports a missing Not Interested stage instead of guessing another stage', async () => {
  const { calls, fetchImpl } = ghlFetch({ table: 'quote_emails', pipeline: 'Smoke Alarms', stages: STAGES.slice(0, 3) });
  const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: 'quote_emails', fetchImpl, env });
  assert.equal(result.reason, 'not-interested-stage-not-found');
  assert.equal(calls.filter(c => c.options.method === 'PUT').length, 0);
});

test('honours a configured stage id override', async () => {
  const { calls, fetchImpl } = ghlFetch({ table: 'hotwater_quotes', pipeline: 'HWS Pipeline', stages: STAGES });
  const result = await syncRejectedQuoteStageForTable({
    quoteToken: 'tok', quoteTable: 'hotwater_quotes', fetchImpl,
    env: { ...env, HWS_QUOTE_NOT_INTERESTED_STAGE_ID: 'not-accepted-stage' },
  });
  assert.equal(result.stageId, 'not-accepted-stage');
  assert.deepEqual(JSON.parse(calls.find(c => c.options.method === 'PUT').options.body), { pipelineStageId: 'not-accepted-stage' });
});

test('unsupported table is a no-op', async () => {
  const result = await syncRejectedQuoteStageForTable({ quoteToken: 'tok', quoteTable: 'sms_messages', fetchImpl: async () => { throw new Error('no'); }, env });
  assert.deepEqual(result, { moved: false, reason: 'unsupported-quote-table' });
});
