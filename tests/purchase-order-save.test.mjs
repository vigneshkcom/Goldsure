import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../smoke-alarms/purchase-orders.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function page(fetch) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: id === 'savePo', textContent: '', style: {},
      classList: { contains: () => false, remove() {}, add() {} },
      listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: element }, fetch, Intl, Date, console });
  vm.runInContext(script, context);
  return { element, context, run: code => vm.runInContext(code, context) };
}

const reviewed = {
  poNumber: 'PO for Test Electrician - Week ending 25 Oct 2026',
  electrician: { id: 1, name: 'Test Electrician', gstRegistered: true },
  jobs: [{ jobId: '37077', items: [{ key: 'battery', quantity: 2 }], cashOffset: 30 }],
  additionalLines: [{ description: 'Additional $150 for 3 no-show jobs', amountIncGst: 150 }],
};

test('Save PO sends the reviewed record once and confirms only after storage succeeds', async () => {
  const calls = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const p = page(async (url, init) => { calls.push({ url, ...init }); return pending; });
  assert.equal(p.element('savePo').disabled, true);
  p.context.reviewed = reviewed;
  p.run('state.po=reviewed');
  p.element('pin').value = '4321';
  p.element('savePo').disabled = false;
  const saving = p.element('savePo').listeners.click();
  await p.element('savePo').listeners.click();
  assert.equal(calls.length, 1);
  assert.equal(p.element('savePo').disabled, true);
  assert.equal(p.element('notice').textContent, '');
  assert.deepEqual(JSON.parse(calls[0].body), { purchaseOrderHistory: { action: 'save', purchaseOrder: reviewed } });
  assert.equal(calls[0].headers['x-purchase-order-pin'], '4321');
  complete(new Response(JSON.stringify({ success: true })));
  await saving;
  assert.match(p.element('notice').textContent, /saved to PO history/);
  assert.equal(p.element('notice').className, 'notice success');
  assert.equal(p.element('savePo').disabled, false);
});

test('a failed save leaves a visible error and allows retry', async () => {
  const p = page(async () => new Response(JSON.stringify({ error: 'Could not store this record' }), { status: 500 }));
  p.context.reviewed = reviewed;
  p.run('state.po=reviewed');
  p.element('savePo').disabled = false;
  await p.element('savePo').listeners.click();
  assert.equal(p.element('notice').textContent, 'Could not store this record');
  assert.equal(p.element('notice').className, 'notice error');
  assert.equal(p.element('notice').style.display, 'block');
  assert.equal(p.element('savePo').disabled, false);
});

test('Excel export does not save a PO history record', async () => {
  const calls = [];
  const p = page(async (...args) => { calls.push(args); throw new Error('Unexpected server call'); });
  p.context.reviewed = { ...reviewed, totals: {} };
  let downloads = 0;
  p.context.window = { XLSX: { utils: { aoa_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet() {} }, writeFile() { downloads++; } } };
  p.run('state.po=reviewed');
  await p.element('exportExcel').listeners.click();
  assert.equal(downloads, 1);
  assert.equal(calls.length, 0);
});
