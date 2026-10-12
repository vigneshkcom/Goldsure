import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseAudience, delivery, matchesRecipient, localDate } from '../Battery/campaign-model.js';

const html = readFileSync(new URL('../Battery/email-campaign.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../Battery/email-campaign.js', import.meta.url), 'utf8').replace(/^import[^\n]+\n/, '');
test('dashboard loads all customers without login and never starts sending on page load', async () => {
  function element() { return { value: '', children: [], classList: { toggle() {}, add() {}, remove() {} }, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, addEventListener(event, fn) { this[event] = fn; } }; }
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], element()]));
  nodes.get('recipient-filter').value = 'all';
  const calls = [];
  const customers = Array.from({ length: 200 }, (_, i) => ({ first_name: 'Customer', last_name: String(i), email: `customer${i}@example.com`, job_id: String(i), delivery_status: 'pending' }));
  const document = { hidden: false, getElementById: id => nodes.get(id), createElement: element, createDocumentFragment: element, addEventListener() {} };
  const context = vm.createContext({ document, parseAudience, delivery, matchesRecipient, localDate, AbortSignal, setInterval() {}, setTimeout() {}, clearTimeout() {}, fetch: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push(body?.action || 'stats');
    assert.ok(!body || !('password' in body));
    if (body) assert.equal(body.action, 'battery-campaign-recipients');
    return { ok: true, json: async () => body ? { recipients: customers } : { campaign: { status: 'paused', name: 'Fixture' }, total: 200, pending: 200 } };
  }});
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.sort(), ['battery-campaign-recipients', 'stats']);
  assert.equal(nodes.get('row-count').textContent, '200 of 200 customers');
  assert.equal(nodes.get('recipient-body').children[0].children.length, 200);
  assert.equal(nodes.get('start-campaign').disabled, false);
  assert.equal(nodes.get('empty-state').hidden, true);
  assert.doesNotMatch(html + script, /portal-password|Portal password|unlocked|Enter your portal password/);
});
