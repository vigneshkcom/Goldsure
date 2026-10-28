import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareHwsQuoteEmail, createHwsDocumentEmailHandler } from '../lib/hws-document-email.js';
import { calculateDocument, validateDraft } from '../assets/hws-document-model.js';

const document = { version: 1, type: 'quote', number: '36598', date: '2026-10-28', customer: 'Example Customer', address: 'Example address VIC', email: 'example@example.com', deposit: 200, items: [{ description: 'Heat pump', quantity: 1, rate: 2417.73 }], stcDiscount: 348.5, veecDiscount: 315, solar: 998, payments: 0 };
function response() { return { code: 0, data: null, setHeader() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; }
function setup(mail = async () => {}) {
  let currentTime = 1000000;
  const handler = createHwsDocumentEmailHandler({ env: { DASHBOARD_PASSWORD: 'test-only-pin' }, configured: () => true, mail, now: () => currentTime });
  const request = async body => { const res = response(); await handler({ method: 'POST', headers: { 'x-portal-pin': 'test-only-pin' }, body }, res); return res; };
  return { handler, request, expire() { currentTime += 11 * 60 * 1000; } };
}
test('deposit is a request within the quote total, never a payment received', () => {
  const mail = prepareHwsQuoteEmail({ document });
  assert.match(mail.subject, /36598- Quote.*\$200.00 deposit request/);
  assert.match(mail.text, /Quoted total \(inc. GST\): \$998.00/);
  assert.match(mail.text, /Balance after deposit payment: \$798.00/);
  assert.match(mail.text, /not an additional charge/);
  assert.match(mail.text, /Payment reference: 36598/);
  assert.equal(calculateDocument(document).grandTotal, 99800);
  assert.equal(calculateDocument(document).payments, 0);
});
test('rejects excess deposits, invoices, invalid recipients and incomplete items', () => {
  for (const change of [{ deposit: 999 }, { deposit: -1 }, { type: 'invoice' }, { email: 'a@example.com,b@example.com' }, { email: 'a@example.com\nBcc: other@example.com' }, { items: [{ description: '', quantity: 1, rate: 100 }] }]) assert.throws(() => prepareHwsQuoteEmail({ document: { ...document, ...change } }));
});
test('escapes untrusted customer and item text in the email preview', () => {
  const mail = prepareHwsQuoteEmail({ document: { ...document, customer: '<script>alert(1)</script>', items: [{ description: '<img src=x>', quantity: 1, rate: 2417.73 }] } });
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(mail.html.includes('&lt;img src=x&gt;'));
});
test('legacy drafts open without adding a deposit or changing totals', () => {
  const { email, deposit, ...old } = document;
  const reopened = validateDraft(old);
  assert.equal(reopened.deposit, 0);
  assert.equal(reopened.email, '');
  assert.equal(calculateDocument(reopened).grandTotal, 99800);
});
test('preview sends nothing; reviewed send uses the existing Hostinger message contract', async () => {
  const sent = [];
  const { request } = setup(async message => { sent.push(message); });
  const preview = await request({ action: 'preview', document });
  assert.equal(preview.code, 200);
  assert.equal(sent.length, 0);
  const send = await request({ action: 'send', document, reviewToken: preview.data.reviewToken });
  assert.equal(send.code, 200);
  assert.equal(send.data.accepted, true);
  assert.deepEqual(sent[0].to, ['example@example.com']);
  const duplicate = await request({ action: 'send', document, reviewToken: preview.data.reviewToken });
  assert.equal(duplicate.code, 409);
  assert.equal(sent.length, 1);
});
test('rejects missing PIN and changed or expired previews before any send', async () => {
  let count = 0;
  const { handler, request, expire } = setup(async () => count++);
  const unauth = response();
  await handler({ method: 'POST', headers: {}, body: { action: 'preview', document } }, unauth);
  assert.equal(unauth.code, 401);
  const preview = await request({ action: 'preview', document });
  assert.equal((await request({ action: 'send', document: { ...document, deposit: 100 }, reviewToken: preview.data.reviewToken })).code, 409);
  expire();
  assert.equal((await request({ action: 'send', document, reviewToken: preview.data.reviewToken })).code, 409);
  assert.equal(count, 0);
});
test('PDF attachments are validated and bound to the reviewed send', async () => {
  const attachment = { content: Buffer.from('%PDF-1.7\nexample test bytes').toString('base64') };
  const mail = prepareHwsQuoteEmail({ document, attachment });
  assert.equal(mail.attachments[0].filename, '36598- Quote.pdf');
  assert.throws(() => prepareHwsQuoteEmail({ document, attachment: { content: Buffer.from('not a pdf').toString('base64') } }));
  const { request } = setup();
  const preview = await request({ action: 'preview', document, attachment });
  assert.equal((await request({ action: 'send', document, reviewToken: preview.data.reviewToken })).code, 409);
});
test('uncertain submission blocks immediate retry and does not claim success', async () => {
  let count = 0;
  const { request } = setup(async () => { count++; throw new Error('network timeout'); });
  const preview = await request({ action: 'preview', document });
  const sent = await request({ action: 'send', document, reviewToken: preview.data.reviewToken });
  assert.equal(sent.code, 502);
  assert.match(sent.data.error, /Check the Hostinger Sent folder/);
  assert.equal((await request({ action: 'send', document, reviewToken: preview.data.reviewToken })).code, 409);
  assert.equal(count, 1);
});
