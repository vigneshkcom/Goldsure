import test from 'node:test';
import assert from 'node:assert/strict';

import { syncAcceptedSmokeAlarmStage } from '../lib/ghl-smoke-alarm-stage.js';

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

test('moves the matching Smoke Alarms opportunity to the exact Quote Accepted stage', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/quote_emails')) {
      return jsonResponse([{ customer_email: 'customer@example.com', customer_phone: '0412 345 678', status: 'accepted', accepted: true }]);
    }
    if (String(url).includes('/contacts/?')) {
      return jsonResponse({ contacts: [{ id: 'contact-1', email: 'customer@example.com', phone: '+61 412 345 678' }] });
    }
    if (String(url).includes('/opportunities/pipelines')) {
      return jsonResponse({ pipelines: [{
        id: 'smoke-pipeline',
        name: 'Smoke Alarms',
        stages: [
          { id: 'not-accepted-stage', name: 'Quote Not Accepted' },
          { id: 'accepted-stage', name: 'Quote Accepted' },
        ],
      }] });
    }
    if (String(url).includes('/opportunities/search')) {
      return jsonResponse({ opportunities: [{
        id: 'opportunity-1',
        pipelineId: 'smoke-pipeline',
        pipelineStageId: 'quote-sent-stage',
        status: 'open',
      }] });
    }
    if (String(url).endsWith('/opportunities/opportunity-1')) return jsonResponse({ success: true });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await syncAcceptedSmokeAlarmStage({ quoteToken: 'quote-token', fetchImpl, env });

  assert.equal(result.moved, true);
  assert.equal(result.stageId, 'accepted-stage');
  const update = calls.find(call => call.url.endsWith('/opportunities/opportunity-1'));
  assert.equal(update.options.method, 'PUT');
  assert.deepEqual(JSON.parse(update.options.body), { pipelineStageId: 'accepted-stage' });
});

test('does not call GHL unless the quote token resolves to an accepted quote', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse([{ customer_email: 'customer@example.com', status: 'sent', accepted: false }]);
  };

  const result = await syncAcceptedSmokeAlarmStage({ quoteToken: 'quote-token', fetchImpl, env });

  assert.deepEqual(result, { moved: false, reason: 'quote-not-accepted' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/quote_emails/);
});

test('treats an opportunity already in Quote Accepted as synchronized without updating it', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/rest/v1/quote_emails')) {
      return jsonResponse([{ customer_email: 'customer@example.com', customer_phone: '', status: 'accepted', accepted: true }]);
    }
    if (String(url).includes('/contacts/?')) {
      return jsonResponse({ contacts: [{ id: 'contact-1', email: 'customer@example.com' }] });
    }
    if (String(url).includes('/opportunities/pipelines')) {
      return jsonResponse({ pipelines: [{ id: 'smoke-pipeline', name: 'Smoke Alarms', stages: [{ id: 'accepted-stage', name: 'Quote Accepted' }] }] });
    }
    if (String(url).includes('/opportunities/search')) {
      return jsonResponse({ opportunities: [{ id: 'opportunity-1', pipelineId: 'smoke-pipeline', pipelineStageId: 'accepted-stage', status: 'open' }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await syncAcceptedSmokeAlarmStage({ quoteToken: 'quote-token', fetchImpl, env });

  assert.equal(result.moved, false);
  assert.equal(result.reason, 'already-in-quote-accepted');
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 0);
});
