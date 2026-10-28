import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hwsInvoicePlan, createHwsCustomerInvoice } from '../lib/hws-document-xero.js';
import { createHwsDocumentEmailHandler } from '../lib/hws-document-email.js';

const data = { version: 1, type: 'quote', number: '153388', date: '2026-10-28', invoiceDueDate: '2026-11-04', customer: 'Example Customer', address: 'Example VIC address', email: 'example@example.com', deposit: 200, items: [{ description: 'ECONOVA', quantity: 1, rate: 2417.73 }], stcDiscount: 348.5, veecDiscount: 315, solar: 998, payments: 0 };
const contact = { contactID: 'contact-1', name: data.customer, emailAddress: data.email, contactStatus: 'ACTIVE' };
function fakeXero({ invoices = [], customers = [contact], failAfterCreate = false } = {}) {
  const written = [], keys = [];
  const client = { accountingApi: {
    async getOrganisations() { return { body: { organisations: [{ name: 'Goldsure Pty Ltd' }] } }; },
    async getContacts() { return { body: { contacts: customers } }; },
    async getContact(tenant, id) { return { body: { contacts: customers.filter(c => c.contactID === id) } }; },
    async createContacts(tenant, body) { const c = { ...body.contacts[0], contactID: 'new-contact' }; customers.push(c); return { body: { contacts: [c] } }; },
    async getInvoices() { return { body: { invoices } }; },
    async createInvoices(tenant, body, summarise, precision, idempotencyKey) {
      keys.push(idempotencyKey);
      const input = body.invoices[0];
      written.push(input);
      const invoice = { ...input, invoiceID: 'invoice-1', total: 998, amountPaid: 0, contact: customers.find(c => c.contactID === input.contact.contactID) };
      invoices.push(invoice);
      if (failAfterCreate) throw new Error('timeout after Xero accepted');
      return { body: { invoices: [invoice] } };
    }
  } };
  return { client, written, keys, invoices, customers, deps: { clientFactory: async () => client, checkSetup: async () => ({}) } };
}
test('final invoice has exactly deposit and pending balance, inclusive GST and no discounts', () => {
  const plan = hwsInvoicePlan(data);
  assert.equal(plan.type, 'ACCREC');
  assert.equal(plan.invoiceNumber, '153388');
  assert.equal(plan.reference, 'JOB 153388');
  assert.equal(plan.status, 'AUTHORISED');
  assert.equal(plan.lineAmountTypes, 'Inclusive');
  assert.equal(plan.lineItems.length, 2);
  assert.deepEqual(plan.lineItems.map(line => line.unitAmount), [200, 798]);
  assert.equal(plan.lineItems.reduce((sum, line) => sum + line.unitAmount, 0), 998);
  assert.ok(!/discount|rebate|certificate/i.test(JSON.stringify(plan)));
  assert.ok(plan.lineItems.every(line => line.accountCode === '405' && line.taxType === 'OUTPUT' && line.tracking[0].option === 'VIC Hot Water'));
  assert.equal(hwsInvoicePlan({ ...data, deposit: 0 }), null);
});
test('creates once and reuses the matching invoice on subsequent send attempts', async () => {
  const fake = fakeXero();
  const first = await createHwsCustomerInvoice(data, fake.deps);
  const again = await createHwsCustomerInvoice(data, fake.deps);
  assert.equal(first.recoveredExisting, false);
  assert.equal(again.recoveredExisting, true);
  assert.equal(fake.written.length, 1);
  assert.match(fake.keys[0], /^goldsure-hws-invoice-/);
  assert.ok(fake.keys[0].length <= 128);
});
test('recovers an invoice accepted by Xero when the create response times out', async () => {
  const fake = fakeXero({ failAfterCreate: true });
  const result = await createHwsCustomerInvoice(data, fake.deps);
  assert.equal(result.recoveredExisting, true);
  assert.equal(fake.written.length, 1);
});
test('blocks conflicting invoice totals, splits, dates, customers and recorded payments', async () => {
  for (const change of [{ total: 1200 }, { amountPaid: 200 }, { status: 'PAID' }, { dueDate: '2026-12-01' }, { lineItems: [{ description: 'Discount', quantity: 1, unitAmount: 998 }] }]) {
    const existing = { ...hwsInvoicePlan(data), invoiceID: 'existing', contact, total: 998, amountPaid: 0, ...change };
    const fake = fakeXero({ invoices: [existing] });
    await assert.rejects(() => createHwsCustomerInvoice(data, fake.deps));
    assert.equal(fake.written.length, 0);
  }
  const fake = fakeXero({ customers: [{ ...contact, name: 'Someone Else' }] });
  await assert.rejects(() => createHwsCustomerInvoice(data, fake.deps), /different or ambiguous/);
  assert.equal(fake.written.length, 0);
});
test('creates a new customer when no matching contact exists', async () => {
  const fake = fakeXero({ customers: [] });
  await createHwsCustomerInvoice(data, fake.deps);
  assert.equal(fake.customers[0].name, data.customer);
  assert.equal(fake.customers[0].emailAddress, data.email);
  assert.equal(fake.written[0].contact.contactID, 'new-contact');
});
function res() { return { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } }; }
test('preview creates nothing; send creates the invoice before sending the email', async () => {
  const effects = [];
  const handler = createHwsDocumentEmailHandler({ env: { DASHBOARD_PASSWORD: 'test' }, configured: () => true,
    invoice: async () => { effects.push('invoice'); return { invoiceNumber: '153388', total: 998 }; }, mail: async () => effects.push('mail') });
  const request = async body => { const response = res(); await handler({ method: 'POST', headers: { origin: 'https://portal.goldsure.com.au', host: 'portal.goldsure.com.au' }, body }, response); return response; };
  const preview = await request({ action: 'preview', document: data });
  assert.deepEqual(effects, []);
  assert.deepEqual(preview.body.xeroInvoice.lineItems.map(line => line.unitAmount), [200, 798]);
  const sent = await request({ action: 'send', document: data, reviewToken: preview.body.reviewToken });
  assert.equal(sent.code, 200);
  assert.deepEqual(effects, ['invoice', 'mail']);
});
test('invoice failure prevents email; email failure reports the invoice already created', async () => {
  for (const failInvoice of [true, false]) {
    let mailed = false;
    const handler = createHwsDocumentEmailHandler({ env: { DASHBOARD_PASSWORD: 'test' }, configured: () => true,
      invoice: async () => { if (failInvoice) throw new Error('Xero unavailable'); return { invoiceNumber: '153388', total: 998 }; },
      mail: async () => { mailed = true; throw new Error('Hostinger timeout'); } });
    const request = async body => { const response = res(); await handler({ method: 'POST', headers: { origin: 'https://portal.goldsure.com.au', host: 'portal.goldsure.com.au' }, body }, response); return response; };
    const preview = await request({ action: 'preview', document: data });
    const send = await request({ action: 'send', document: data, reviewToken: preview.body.reviewToken });
    assert.equal(send.code, 502);
    assert.equal(mailed, !failInvoice);
    assert.match(send.body.error, failInvoice ? /email was not sent/ : /Xero invoice 153388 is created/);
  }
});
