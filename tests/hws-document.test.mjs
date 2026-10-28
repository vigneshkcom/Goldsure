import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDocument, validateDraft } from '../assets/hws-document-model.js';

const example = { version: 1, type: 'invoice', number: 'VIC-001', date: '2026-10-28', customer: 'Example', address: 'VIC', reference: '', notes: '', email: '', deposit: 0, items: [{ description: 'ECONOVA - ECON-300RVW', quantity: 1, rate: 2417.73 }], stcDiscount: 348.5, veecDiscount: 315, solar: 998, payments: 0 };
test('reproduces supplied Dataforce screenshot exactly', () => {
  assert.deepEqual(calculateDocument(example), { lines: [241773], subtotal: 241773, gst: 24177, total: 265950, stc: 34850, veec: 31500, solar: 99800, grandTotal: 99800, payments: 0, due: 99800 });
});
test('payments reduce invoice balance but do not change a quote', () => {
  assert.equal(calculateDocument({ ...example, payments: 200 }).due, 79800);
  assert.equal(calculateDocument({ ...example, type: 'quote', payments: 200 }).due, 99800);
});
test('rounds each extended line and GST to cents', () => {
  const result = calculateDocument({ ...example, items: [{ quantity: 3, rate: 0.1 }, { quantity: 1.5, rate: 10.01 }] });
  assert.deepEqual(result.lines, [30, 1502]);
  assert.equal(result.subtotal, 1532);
  assert.equal(result.gst, 153);
});
test('drafts round trip with literal text and reject invalid amounts', () => {
  assert.deepEqual(validateDraft(JSON.parse(JSON.stringify(example))), example);
  assert.equal(validateDraft({ ...example, customer: '<script>literal text</script>' }).customer, '<script>literal text</script>');
  for (const data of [{ ...example, solar: -1 }, { ...example, payments: Infinity }, { ...example, type: 'other' }, { ...example, items: [] }, { ...example, items: [{ description: 'x', quantity: 1, rate: '20' }] }]) assert.throws(() => validateDraft(data));
});

test('legacy quantity drafts reopen as final discount amounts', () => {
  const { stcDiscount, veecDiscount, ...old } = example;
  const migrated = validateDraft({ ...old, stcQuantity: 17, stcRate: 20.5, veecQuantity: 9, veecRate: 35 });
  assert.equal(migrated.stcDiscount, 348.5);
  assert.equal(migrated.veecDiscount, 315);
  assert.equal(calculateDocument(migrated).due, 99800);
});
