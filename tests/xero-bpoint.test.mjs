import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovedInvoice,
  createOrFindApprovedInvoice,
  findContactPlan,
  makeInvoiceDescription,
  normaliseBatchRow,
  signBatchRow,
  validateBatchRows,
  verifyBatchRow,
} from '../lib/xero-bpoint.js';

function source(overrides = {}) {
  return {
    'Job No.': '152713',
    'Customer Name': 'Penelope F Worrall',
    'Customer Email': 'penelope@example.com',
    'Customer Mobile': '0400 000 001',
    'Property Address': '1 Test Street',
    'Property Suburb': 'Preston',
    'Property Postcode': '3072',
    Category: 'HWS',
    'BPOINT Ref': '874609',
    'Receipt Number': '66600000001',
    'Transaction Number': '1855000001',
    'Payment Date': '03/09/2026',
    'Settlement Date': '03/09/2026',
    Amount: '$1,120.00',
    Account: '405 - Ecoalliance Revenue',
    Division: 'VIC Hot Water',
    'Tax Rate': 'GST on Income',
    'Product / Service Description': 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System',
    ...overrides,
  };
}

function setupClient(overrides = {}) {
  return {
    accountingApi: {
      getAccounts: async () => ({ body: { accounts: [
        { code: '405', name: 'HWS Revenue', status: 'ACTIVE', taxType: 'OUTPUT' },
        { code: '430', name: 'Air Conditioning Installation Revenue', status: 'ACTIVE', taxType: 'OUTPUT' },
        { code: '166', name: 'Smoke Alarm Revenue', status: 'ACTIVE', taxType: 'OUTPUT' },
      ] } }),
      getTrackingCategories: async () => ({ body: { trackingCategories: [{
        name: 'Division', status: 'ACTIVE', options: [
          { name: 'VIC Hot Water', status: 'ACTIVE' },
          { name: 'VIC Aircons', status: 'ACTIVE' },
          { name: 'QLD Smoke Alarms', status: 'ACTIVE' },
        ],
      }] } }),
      getContacts: async () => ({ body: { contacts: [] } }),
      getInvoices: async () => ({ body: { invoices: [] } }),
      createContacts: async () => ({ body: { contacts: [{ contactID: 'contact-1', name: 'Penelope F Worrall' }] } }),
      createInvoices: async () => ({ body: { invoices: [{ invoiceID: 'invoice-1', invoiceNumber: 'INV-100', status: 'AUTHORISED', total: 1120 }] } }),
      ...overrides,
    },
  };
}

test('normalises a reconciled HWS invoice row using BPOINT values', () => {
  const row = normaliseBatchRow(source(), 2);
  assert.equal(row.jobNo, '152713');
  assert.equal(row.amount, 1120);
  assert.equal(row.paymentDate, '2026-09-03');
  assert.equal(row.settlementDate, '2026-09-03');
  assert.equal(row.accountCode, '405');
  assert.equal(row.division, 'VIC Hot Water');
  assert.equal(row.invoiceReference, 'JOB 152713 - BPOINT 1855000001');
  assert.equal(row.description, 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713 - BPOINT Ref 874609');
});

test('maps Aircon to account 430 and blocks an incorrect supplied account', () => {
  const row = normaliseBatchRow(source({ Category: 'Aircon', Account: '430', Division: 'VIC Aircons', 'Product / Service Description': '' }), 2);
  assert.equal(row.accountCode, '430');
  assert.equal(row.description, 'Supply and installation of Air Conditioning System - Job 152713 - BPOINT Ref 874609');
  assert.throws(() => normaliseBatchRow(source({ Category: 'Aircon', Account: '405', Division: 'VIC Aircons' }), 2), /Account must be 430/);
});

test('holds Battery until its accounting mapping is confirmed', () => {
  assert.throws(() => normaliseBatchRow(source({ Category: 'Battery' }), 2), /Battery is held/);
});

test('builds a grouped Smoke Alarm description', () => {
  const row = normaliseBatchRow(source({
    'Job No.': '',
    'Customer Name': 'BPOINT / CBA Credit Card MIS',
    'Customer Email': '',
    'Customer Mobile': '',
    Category: 'Smoke Alarm',
    Account: '166',
    Division: 'QLD Smoke Alarms',
    'BPOINT Ref': '52746, 52749, 52751, 52755',
    'Receipt Number': '66587975160, 66589390894, 66592569099, 66592878653',
    'Transaction Number': '1854065160, 1854110894, 1854209099, 1854218653',
    'Product / Service Description': 'Supply and installation of smoke alarms',
    Amount: '743',
  }), 2);
  assert.equal(makeInvoiceDescription(row), 'Supply and installation of smoke alarms - batch 03/09/2026');
  assert.equal(row.invoiceReference, 'BPOINT-SMOKE-20260903');
  assert.equal(row.transactionNumber, '1854065160, 1854110894, 1854209099, 1854218653');
});

test('rejects duplicate transaction references inside one batch', () => {
  assert.throws(() => validateBatchRows([source(), source({ Amount: '200' })]), /duplicate invoice reference/);
});

test('signed previews cannot be edited before creation', () => {
  const row = normaliseBatchRow(source(), 2);
  const proof = signBatchRow(row, 'secret');
  assert.equal(verifyBatchRow(row, proof, 'secret'), true);
  assert.equal(verifyBatchRow({ ...row, amount: 1 }, proof, 'secret'), false);
  assert.equal(verifyBatchRow({ ...row, productDescription: 'Edited description' }, proof, 'secret'), false);
});

test('a browser preview row can be normalised again without invalidating its proof', () => {
  const previewRow = normaliseBatchRow(source(), 2);
  const proof = signBatchRow(previewRow, 'secret');
  const publicRow = { ...previewRow, proof };
  delete publicRow.contactKey;
  const createRow = normaliseBatchRow(publicRow, publicRow.rowNumber);
  assert.equal(verifyBatchRow(createRow, publicRow.proof, 'secret'), true);
});

test('creates an approved, tax-inclusive invoice without marking it sent', () => {
  const row = normaliseBatchRow(source(), 2);
  const invoice = buildApprovedInvoice(row, 'contact-1');
  assert.equal(invoice.type, 'ACCREC');
  assert.equal(invoice.status, 'AUTHORISED');
  assert.equal(invoice.sentToContact, false);
  assert.equal(invoice.lineAmountTypes, 'Inclusive');
  assert.equal(invoice.date, '2026-09-03');
  assert.equal(invoice.dueDate, '2026-09-03');
  assert.equal(invoice.lineItems[0].unitAmount, 1120);
  assert.equal(invoice.lineItems[0].accountCode, '405');
  assert.equal(invoice.lineItems[0].taxType, 'OUTPUT');
  assert.equal(invoice.lineItems[0].description, 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713 - BPOINT Ref 874609');
  assert.deepEqual(invoice.lineItems[0].tracking, [{ name: 'Division', option: 'VIC Hot Water' }]);
});

test('matches a contact by exact email before considering its name', async () => {
  const row = normaliseBatchRow(source(), 2);
  const client = setupClient({
    getContacts: async () => ({ body: { contacts: [{
      contactID: 'contact-1', name: 'Penelope Worrall', emailAddress: 'penelope@example.com', contactStatus: 'ACTIVE',
    }] } }),
  });
  const plan = await findContactPlan(client, row);
  assert.equal(plan.action, 'match');
  assert.equal(plan.matchedBy, 'email');
});

test('recovers an existing invoice and does not create a duplicate contact or invoice', async () => {
  const row = normaliseBatchRow(source(), 2);
  let contactCreates = 0;
  let invoiceCreates = 0;
  const client = setupClient({
    getInvoices: async () => ({ body: { invoices: [{
      invoiceID: 'invoice-existing', invoiceNumber: 'INV-099', reference: row.invoiceReference,
      status: 'AUTHORISED', total: 1120,
    }] } }),
    createContacts: async () => { contactCreates += 1; return { body: { contacts: [] } }; },
    createInvoices: async () => { invoiceCreates += 1; return { body: { invoices: [] } }; },
  });
  const result = await createOrFindApprovedInvoice(client, row);
  assert.equal(result.recoveredExisting, true);
  assert.equal(result.invoiceId, 'invoice-existing');
  assert.equal(contactCreates, 0);
  assert.equal(invoiceCreates, 0);
});

test('creates a missing contact and invoice with idempotency keys', async () => {
  const row = normaliseBatchRow(source(), 2);
  let contactArgs;
  let invoiceArgs;
  const client = setupClient({
    createContacts: async (...args) => {
      contactArgs = args;
      return { body: { contacts: [{ contactID: 'contact-new', name: row.customerName }] } };
    },
    createInvoices: async (...args) => {
      invoiceArgs = args;
      return { body: { invoices: [{ invoiceID: 'invoice-new', invoiceNumber: 'INV-101', status: 'AUTHORISED', total: row.amount }] } };
    },
  });
  const result = await createOrFindApprovedInvoice(client, row);
  assert.equal(result.contactCreated, true);
  assert.equal(result.recoveredExisting, false);
  assert.match(contactArgs[3], /^goldsure-bpoint-contact-/);
  assert.match(invoiceArgs[4], /^goldsure-bpoint-invoice-/);
});
