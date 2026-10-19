import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getQuoteCustomerSource } from '../lib/ghl-smoke-alarm-stage.js';
const env = { GHL_API_KEY: 'test', GHL_LOCATION_ID: 'location' };
const quote = { customer_email: 'customer@example.com' };
test('acceptance reads the exact matched GHL contact source', async () => {
  for (const source of ['Facebook Meta', 'Direct Call', '']) {
    const fetchImpl = async () => Response.json({ contacts: [
      { id: 'other', email: 'other@example.com', source: 'Wrong source' },
      { id: 'right', email: quote.customer_email, source },
    ] });
    assert.equal(await getQuoteCustomerSource({ quote, env, fetchImpl }), source || 'Not recorded in GHL');
  }
});
test('GHL outages are distinguished from a missing source', async () => {
  assert.equal(await getQuoteCustomerSource({ quote, env, fetchImpl: async () => new Response('', { status: 503 }) }), 'GHL unavailable');
});
test('sales selection fills source and lead type without retaining a previous customer', async () => {
  const html = await readFile(new URL('../smoke-alarms/smoke-alarm.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  for (const [, script] of scripts) assert.doesNotThrow(() => new Function(script));
  const helper = html.match(/function applyGhlCustomerSource\(contact\) \{[\s\S]*?\n\}/)[0];
  const nodes = { mainCustomerSource: {}, emailCustomerSource: {} };
  const radios = [{ value: 'digital' }, { value: 'letterbox' }];
  const apply = new Function('document', `${helper}; return applyGhlCustomerSource;`)({
    getElementById: id => nodes[id], querySelectorAll: () => radios,
  });
  apply({ source: 'Direct Call' });
  assert.equal(radios[1].checked, true);
  assert.equal(radios[0].checked, false);
  apply({ source: 'Facebook Meta' });
  assert.equal(radios[0].checked, true);
  assert.equal(nodes.mainCustomerSource.textContent, 'Customer source: Facebook Meta');
  apply({ source: '' });
  assert.ok(radios.every(radio => !radio.checked));
  assert.match(nodes.emailCustomerSource.textContent, /Not recorded/);
  apply(null);
  assert.equal(nodes.mainCustomerSource.textContent, '');
});
