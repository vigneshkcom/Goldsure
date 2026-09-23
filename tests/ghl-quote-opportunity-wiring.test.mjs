import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('HWS and Aircon quote sends create or reuse the correct Quote Sent opportunity', async () => {
  const vic = await read('api/battery/request-callback.js');
  const nsw = await read('api/hotwater-nsw/send.js');

  assert.match(vic, /findOrCreateGhlContact\(\{[\s\S]*?phone: customer_phone,[\s\S]*?email: customer_email/);
  assert.match(vic, /opportunityName: `\$\{customer_name \|\| 'Customer'\} - Direct Call`[\s\S]*?nameHints: \['hws pipeline', 'vic hws pipeline', 'vic hot water'\][\s\S]*?source: 'Direct Call'/);
  assert.match(vic, /opportunityName: `\$\{customer_name \|\| 'Customer'\} - Direct Call`[\s\S]*?nameHints: \['aircons', 'aircon', 'air conditioning'\][\s\S]*?source: 'Direct Call'/);
  assert.match(nsw, /opportunityName: `\$\{customer_name \|\| 'Customer'\} - Direct Call`[\s\S]*?source: 'Direct Call'/);
  assert.doesNotMatch(vic, /opportunityName:[^\n]*—/);
  assert.doesNotMatch(nsw, /opportunityName:[^\n]*—/);
});

test('Smoke Alarm quote sends create or reuse a Quote Sent opportunity', async () => {
  const smoke = await read('api/smoke-alarms/send.js');

  assert.match(smoke, /findOrCreateGhlContact\(\{[\s\S]*?phone: customer_phone,[\s\S]*?email: to_email/);
  assert.match(smoke, /opportunityName: `\$\{customer_name \|\| 'Customer'\} - Direct Call`/);
  assert.match(smoke, /pipelineIdEnv: process\.env\.SMOKE_ALARMS_PIPELINE_ID/);
  assert.match(smoke, /nameHints: \['smoke alarms', 'smoke alarm'\]/);
  assert.match(smoke, /stageNames: \[process\.env\.SMOKE_ALARMS_QUOTE_SENT_STAGE_NAME \|\| 'Quote Sent'/);
  assert.match(smoke, /source: 'Direct Call'/);
  assert.doesNotMatch(smoke, /opportunityName:[^\n]*—/);
});
