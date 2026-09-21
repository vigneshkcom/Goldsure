import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureOpportunityInStage } from '../lib/ghl-opportunity.js';

const originalFetch = global.fetch;
const originalApiKey = process.env.GHL_API_KEY;
const originalLocationId = process.env.GHL_LOCATION_ID;

test.afterEach(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.GHL_API_KEY;
  else process.env.GHL_API_KEY = originalApiKey;
  if (originalLocationId === undefined) delete process.env.GHL_LOCATION_ID;
  else process.env.GHL_LOCATION_ID = originalLocationId;
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('reuses and moves an existing NSW opportunity instead of creating a duplicate', async () => {
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location-1';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/opportunities/pipelines')) {
      return jsonResponse({ pipelines: [
        { id: 'vic-pipe', name: 'HWS Pipeline', stages: [{ id: 'vic-photos', name: 'Photos Received', position: 1 }] },
        { id: 'nsw-pipe', name: 'NSW HWS Pipeline', stages: [
          { id: 'nsw-follow-up', name: 'Follow-Up', position: 1 },
          { id: 'nsw-photos', name: 'Photos Received', position: 2 },
        ] },
      ] });
    }
    if (String(url).includes('/opportunities/search')) {
      return jsonResponse({ opportunities: [{
        id: 'existing-nsw-opportunity',
        pipelineId: 'nsw-pipe',
        pipelineStageId: 'nsw-follow-up',
        status: 'open',
        updatedAt: '2026-09-20T00:00:00.000Z',
      }] });
    }
    if (String(url).endsWith('/opportunities/existing-nsw-opportunity')) return jsonResponse({ succeeded: true });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await ensureOpportunityInStage({
    contactId: 'contact-1',
    opportunityName: 'NSW Hot Water - Customer',
    nameHints: ['nsw hws pipeline', 'nsw hot water', 'nsw hws'],
    stageNames: ['Photos Received'],
  });

  assert.deepEqual(result, {
    opportunityId: 'existing-nsw-opportunity',
    pipelineId: 'nsw-pipe',
    created: false,
    moved: true,
  });
  assert.match(calls.find(call => call.url.includes('/opportunities/search')).url, /limit=100/);
  const update = calls.find(call => call.options.method === 'PUT');
  assert.deepEqual(JSON.parse(update.options.body), { pipelineId: 'nsw-pipe', pipelineStageId: 'nsw-photos' });
  assert.equal(calls.some(call => call.options.method === 'POST'), false);
});

test('uses an exact pipeline name before substring fallback', async () => {
  process.env.GHL_API_KEY = 'test-key';
  process.env.GHL_LOCATION_ID = 'location-1';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/opportunities/pipelines')) {
      return jsonResponse({ pipelines: [
        { id: 'nsw-pipe', name: 'NSW HWS Pipeline', stages: [{ id: 'nsw-photos', name: 'Photos Received', position: 1 }] },
        { id: 'vic-pipe', name: 'HWS Pipeline', stages: [{ id: 'vic-photos', name: 'Photos Received', position: 1 }] },
      ] });
    }
    if (String(url).includes('/opportunities/search')) return jsonResponse({ opportunities: [] });
    if (String(url).endsWith('/opportunities/')) return jsonResponse({ opportunity: { id: 'new-vic-opportunity' } }, 201);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await ensureOpportunityInStage({
    contactId: 'contact-2',
    opportunityName: 'Hot Water - Customer',
    nameHints: ['hws pipeline', 'vic hws pipeline'],
    stageNames: ['Photos Received'],
  });

  assert.equal(result.pipelineId, 'vic-pipe');
  const create = calls.find(call => call.options.method === 'POST');
  const body = JSON.parse(create.options.body);
  assert.equal(body.pipelineId, 'vic-pipe');
  assert.equal(body.pipelineStageId, 'vic-photos');
  assert.equal(body.source, 'Direct Phone Call');
});
