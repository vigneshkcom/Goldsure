import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../Battery/request-callback.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
async function load(search, contextResponse = { ok: true, data: { firstName: 'Pat' } }) {
  const nodes = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    nodes.set(match[1], { value: '', textContent: '', disabled: /\bdisabled\b/.test(match[0]), hidden: /\bhidden\b/.test(match[0]), classList: { add() {}, remove() {} }, addEventListener(type, fn) { this[type] = fn; } });
  }
  const calls = [];
  const window = { location: { search, href: '' } };
  const context = vm.createContext({ URLSearchParams, window, document: { getElementById: id => nodes.get(id) }, fetch: async (url, options = {}) => {
    calls.push({ url, options });
    return options.method === 'POST' ? { ok: true, json: async () => ({ success: true }) } : { ok: contextResponse.ok, json: async () => contextResponse.data };
  }});
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, calls, window };
}
test('personalised callback shows only time and confirmation, submitting only token and preference', async () => {
  const { nodes, calls, window } = await load('?recipient=fixture-token');
  assert.equal(nodes.get('contactFields').hidden, true);
  assert.equal(nodes.get('contactFields').disabled, true);
  assert.equal(nodes.get('submitBtn').disabled, false);
  assert.match(nodes.get('callbackStatus').textContent, /Hi Pat, we already have your details/);
  assert.equal(calls.length, 1); // Opening a link never submits a callback.
  nodes.get('preferredCallbackTime').value = 'Evening';
  await nodes.get('callbackForm').submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'battery-callback-request', campaignRecipientToken: 'fixture-token', preferredCallbackTime: 'Evening' });
  assert.equal(window.location.href, '/Battery/thank-you.html');
});
test('no preference can be submitted without entering any personal details', async () => {
  const { nodes, calls } = await load('?recipient=fixture-token');
  await nodes.get('callbackForm').submit({ preventDefault() {} });
  assert.equal(JSON.parse(calls[1].options.body).preferredCallbackTime, '');
});
test('invalid link remains disabled, while a direct visitor gets basic contact fields', async () => {
  const invalid = await load('?recipient=bad', { ok: false, data: { error: 'Link unavailable' } });
  assert.equal(invalid.nodes.get('submitBtn').disabled, true);
  assert.equal(invalid.nodes.get('callbackStatus').textContent, 'Link unavailable');
  const direct = await load('');
  assert.equal(direct.nodes.get('contactFields').hidden, false);
  assert.equal(direct.calls.length, 0);
});
test('solar and photo questions have been removed', () => {
  assert.doesNotMatch(html, /sendPhotos|inverterBrand|solarSize|hasSolar|Everything is optional|create-photo-request/);
});
