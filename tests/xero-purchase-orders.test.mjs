import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftBill,
  createOrFindDraftPurchaseOrderBill,
  preparePurchaseOrderBill,
  signPurchaseOrderPlan,
  verifyPurchaseOrderPlan,
} from '../lib/xero-purchase-orders.js';

const purchaseOrder = {
  poNumber: 'PO for Alex Symonds - Week ending 20 Sep 2026',
  weekEnding: '2026-09-20',
  payableDate: '02/10/2026',
  electrician: {
    id: '1009',
    name: 'Alex Symonds',
    companyName: 'Alex Electrical',
    email: 'alex@example.com',
    taxId: '12345678901',
    gstRegistered: true,
  },
  jobs: [{
    jobId: '7001',
    installedDate: '2026-09-20',
    grossIncGst: 94.6,
    cashOffset: 30,
    items: [
      { key: 'booking', quantity: 1 },
      { key: 'hardwired', quantity: 2 },
      { key: 'battery', quantity: 3 },
    ],
  }],
  additionalLines: [{ description: 'Warranty job 36341', amountIncGst: 110 }],
  totals: { jobs: 1, grossIncGst: 204.6, cashOffset: 30, totalIncGst: 174.6 },
};

const setup = {
  accountCode: '101',
  accountName: 'Contractor Expenses – Non Salary',
  accountTaxType: 'INPUT',
  serviceTaxType: 'INPUT',
  serviceTaxName: 'GST on Expenses',
  trackingCategory: 'Division',
  division: 'QLD Smoke Alarms',
};

function xeroClient({ existingBill = null, existingContact = null } = {}) {
  const calls = { createContacts: 0, createInvoices: 0, invoice: null };
  const client = {
    calls,
    accountingApi: {
      async getAccounts() {
        return { body: { accounts: [{ code: '101', name: 'Contractor Expenses – Non Salary', status: 'ACTIVE', taxType: 'INPUT' }] } };
      },
      async getTrackingCategories() {
        return { body: { trackingCategories: [{ name: 'Division', status: 'ACTIVE', options: [{ name: 'QLD Smoke Alarms', status: 'ACTIVE' }] }] } };
      },
      async getContacts(...args) {
        const term = args[8];
        if (!existingContact) return { body: { contacts: [] } };
        if (term === 'alex@example.com' || term === 'Alex Symonds') return { body: { contacts: [existingContact] } };
        return { body: { contacts: [] } };
      },
      async getInvoices() {
        return { body: { invoices: existingBill ? [existingBill] : [] } };
      },
      async createContacts(_tenant, payload) {
        calls.createContacts += 1;
        return { body: { contacts: [{ ...payload.contacts[0], contactID: 'new-contact-id' }] } };
      },
      async createInvoices(_tenant, payload) {
        calls.createInvoices += 1;
        calls.invoice = payload.invoices[0];
        return { body: { invoices: [{ invoiceID: 'bill-id', invoiceNumber: 'BILL-1001', status: 'DRAFT', total: 174.6 }] } };
      },
    },
  };
  return client;
}

test('builds a GST-inclusive draft supplier bill with the cash offset and due date', () => {
  const bill = buildDraftBill(purchaseOrder, 'contact-id', setup);
  assert.equal(bill.type, 'ACCPAY');
  assert.equal(bill.status, 'DRAFT');
  assert.equal(bill.lineAmountTypes, 'Inclusive');
  assert.equal(bill.reference, purchaseOrder.poNumber);
  assert.equal(bill.date, '2026-09-20');
  assert.equal(bill.dueDate, '2026-10-02');
  assert.equal(bill.lineItems.length, 3);
  assert.match(bill.lineItems[0].description, /Job 7001.*Booking 1.*Hardwired 2.*Battery 3/);
  assert.equal(bill.lineItems[1].unitAmount, -30);
  assert.equal(bill.lineItems[1].taxType, 'NONE');
  assert.deepEqual(bill.lineItems[2].tracking, [{ name: 'Division', option: 'QLD Smoke Alarms' }]);
  assert.equal(bill.lineItems.reduce((sum, line) => sum + line.unitAmount, 0), 174.6);
});

test('previews the live Xero setup and requires an untampered signed review', async () => {
  const client = xeroClient({ existingContact: { contactID: 'contact-id', name: 'Alex Symonds', emailAddress: 'alex@example.com', contactStatus: 'ACTIVE' } });
  const prepared = await preparePurchaseOrderBill(client, purchaseOrder);
  assert.equal(prepared.plan.supplierAction, 'match');
  assert.equal(prepared.plan.supplierMatchedBy, 'email');
  assert.equal(prepared.plan.accountCode, '101');
  assert.equal(prepared.plan.totalIncGst, 174.6);
  const proof = signPurchaseOrderPlan(prepared.plan, 'review-secret');
  assert.equal(verifyPurchaseOrderPlan(prepared.plan, proof, 'review-secret'), true);
  assert.equal(verifyPurchaseOrderPlan({ ...prepared.plan, totalIncGst: 999 }, proof, 'review-secret'), false);
});

test('creates one draft bill and creates the supplier only after confirmation workflow calls create', async () => {
  const client = xeroClient();
  const prepared = await preparePurchaseOrderBill(client, purchaseOrder);
  assert.equal(client.calls.createContacts, 0);
  assert.equal(client.calls.createInvoices, 0);
  const result = await createOrFindDraftPurchaseOrderBill(client, purchaseOrder, prepared);
  assert.equal(result.invoiceNumber, 'BILL-1001');
  assert.equal(result.status, 'DRAFT');
  assert.equal(result.supplierCreated, true);
  assert.equal(client.calls.createContacts, 1);
  assert.equal(client.calls.createInvoices, 1);
  assert.equal(client.calls.invoice.status, 'DRAFT');
});

test('returns the matching existing bill instead of creating a duplicate', async () => {
  const existingBill = {
    invoiceID: 'existing-bill-id',
    invoiceNumber: 'BILL-900',
    reference: purchaseOrder.poNumber,
    type: 'ACCPAY',
    status: 'DRAFT',
    total: 174.6,
  };
  const client = xeroClient({ existingBill });
  const prepared = await preparePurchaseOrderBill(client, purchaseOrder);
  assert.equal(prepared.plan.existingBillNumber, 'BILL-900');
  const result = await createOrFindDraftPurchaseOrderBill(client, purchaseOrder, prepared);
  assert.equal(result.recoveredExisting, true);
  assert.equal(result.invoiceId, 'existing-bill-id');
  assert.equal(client.calls.createContacts, 0);
  assert.equal(client.calls.createInvoices, 0);
});
