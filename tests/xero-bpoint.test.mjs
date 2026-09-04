import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovedInvoice,
  buildInvoiceLineItems,
  buildContactUpdate,
  createOrFindApprovedInvoice,
  findContactPlan,
  findInvoiceForRow,
  makeInvoiceDescription,
  normaliseBatchRow,
  setInvoiceTotal,
  setInvoiceLineDescriptions,
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
    'Final Invoice Amount': '$1,320.00',
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
      updateContact: async () => ({ body: { contacts: [{ contactID: 'contact-1', name: 'Penelope F Worrall' }] } }),
      createInvoices: async () => ({ body: { invoices: [{ invoiceID: 'invoice-1', invoiceNumber: 'INV-100', status: 'AUTHORISED', total: 1120 }] } }),
      ...overrides,
    },
  };
}

test('normalises a reconciled HWS invoice row using BPOINT values', () => {
  const row = normaliseBatchRow(source(), 2);
  assert.equal(row.jobNo, '152713');
  assert.equal(row.amount, 1120);
  assert.equal(row.invoiceTotal, 1320);
  assert.equal(row.paymentDate, '2026-09-03');
  assert.equal(row.settlementDate, '2026-09-03');
  assert.equal(row.accountCode, '405');
  assert.equal(row.division, 'VIC Hot Water');
  assert.equal(row.invoiceReference, 'JOB 152713 - BPOINT 874609');
  assert.equal(row.description, 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713');
});

test('maps Aircon to account 430 and blocks an incorrect supplied account', () => {
  const row = normaliseBatchRow(source({ Category: 'Aircon', Account: '430', Division: 'VIC Aircons', 'Product / Service Description': '' }), 2);
  assert.equal(row.accountCode, '430');
  assert.equal(row.description, 'Supply and installation of Air Conditioning System - Job 152713');
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
    'Final Invoice Amount': '',
    Amount: '743',
  }), 2);
  assert.equal(makeInvoiceDescription(row), 'Supply and installation of smoke alarms - batch 03/09/2026');
  assert.equal(row.invoiceReference, 'BPOINT-SMOKE-20260903');
  assert.equal(row.transactionNumber, '1854065160, 1854110894, 1854209099, 1854218653');
});

test('does not duplicate the date when a Smoke Alarm description already has a batch suffix', () => {
  const row = normaliseBatchRow(source({
    'Job No.': '',
    'Customer Name': 'BPOINT / CBA Credit Card MIS',
    'Customer Email': '',
    'Customer Mobile': '',
    Category: 'Smoke Alarm',
    Account: '166',
    Division: 'QLD Smoke Alarms',
    'Product / Service Description': 'Supply and installation of smoke alarms - batch 03/09/2026 - batch 03/09/2026',
    'Final Invoice Amount': '',
    Amount: '295',
  }), 2);
  assert.equal(row.description, 'Supply and installation of smoke alarms - batch 03/09/2026');
  assert.equal(row.invoiceLines[0].description, 'Supply and installation of smoke alarms - batch 03/09/2026');
});

test('rejects duplicate transaction references inside one batch', () => {
  assert.throws(() => validateBatchRows([source(), source({ Amount: '200' })]), /duplicate BPOINT payment/);
});

test('rejects a transaction number incorrectly supplied as the BPOINT reference', () => {
  assert.throws(
    () => normaliseBatchRow(source({ 'BPOINT Ref': '1855000001' }), 2),
    /tracker column D, not the transaction number/,
  );
});

test('groups two BPOINT instalments into one job invoice', () => {
  const [row] = validateBatchRows([
    source({ 'BPOINT Ref': '874441', 'Receipt Number': '66588092657', 'Transaction Number': '1854072657', 'Payment Date': '02/09/2026', 'Settlement Date': '02/09/2026', Amount: '200' }),
    source(),
  ]);
  assert.equal(row.invoiceReference, 'JOB 152713 - BPOINT 874441, 874609');
  assert.equal(row.amount, 1320);
  assert.equal(row.invoiceTotal, 1320);
  assert.equal(row.payments.length, 2);
  assert.equal(row.bpointRef, '874441, 874609');
});

test('numbers deposits and rewords the amount completing the invoice as final payment', () => {
  const [row] = validateBatchRows([
    source({
      'Job No.': '152749', Category: 'Aircon', Account: '430', Division: 'VIC Aircons',
      'BPOINT Ref': '152749', 'Receipt Number': '66616093709', 'Transaction Number': '1854683709',
      Amount: '300', 'Final Invoice Amount': '1300',
      'Product / Service Description': 'Supply and installation of Air Conditioning System - Job 152749',
    }),
    source({
      'Job No.': '152749', Category: 'Aircon', Account: '430', Division: 'VIC Aircons',
      'BPOINT Ref': '152749', 'Receipt Number': '66617658784', 'Transaction Number': '1854758784',
      Amount: '1000', 'Final Invoice Amount': '1300',
      'Product / Service Description': 'Supply and installation of Air Conditioning System - Job 152749',
    }),
  ]);
  const lines = buildInvoiceLineItems(row);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].unitAmount, 300);
  assert.equal(lines[0].description, 'Deposit 1 towards supply and installation of Air Conditioning System - Job 152749');
  assert.equal(lines[1].unitAmount, 1000);
  assert.equal(lines[1].description, 'Final payment towards supply and installation of Air Conditioning System - Job 152749');
});

test('keeps numbering deposits and adds the remaining amount as the final payment', () => {
  const [row] = validateBatchRows([
    source({
      'Job No.': '152749', Category: 'Aircon', Account: '430', Division: 'VIC Aircons',
      'BPOINT Ref': '152749', 'Receipt Number': '66616093709', 'Transaction Number': '1854683709',
      Amount: '300', 'Final Invoice Amount': '1600', 'Product / Service Description': '',
    }),
    source({
      'Job No.': '152749', Category: 'Aircon', Account: '430', Division: 'VIC Aircons',
      'BPOINT Ref': '152749', 'Receipt Number': '66617658784', 'Transaction Number': '1854758784',
      Amount: '1000', 'Final Invoice Amount': '1600', 'Product / Service Description': '',
    }),
  ]);
  const lines = buildInvoiceLineItems(row);
  assert.deepEqual(lines.map((line) => line.unitAmount), [300, 1000, 300]);
  assert.match(lines[0].description, /^Deposit 1 towards/);
  assert.match(lines[1].description, /^Deposit 2 towards/);
  assert.match(lines[2].description, /^Final payment towards/);
});

test('honours an explicitly numbered split-deposit job', () => {
  const row = normaliseBatchRow(source({
    'Job No.': '152713 (Deposit 2)', Amount: '1120', 'Final Invoice Amount': '1120',
    'Product / Service Description': 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713 (Deposit 2)',
  }), 2);
  const [line] = buildInvoiceLineItems(row);
  assert.equal(line.description, 'Deposit 2 towards supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713 (Deposit 2)');
});

test('accepts a manual final amount and rejects an amount below the uploaded payments', () => {
  const [row] = validateBatchRows([source({ Amount: '200', 'Final Invoice Amount': '' })]);
  assert.equal(row.invoiceTotal, null);
  assert.equal(setInvoiceTotal(row, '1320').invoiceTotal, 1320);
  assert.throws(() => setInvoiceTotal(row, '100'), /cannot be less than payments/);
});

test('signed previews cannot be edited before creation', () => {
  const row = normaliseBatchRow(source(), 2);
  const proof = signBatchRow(row, 'secret');
  assert.equal(verifyBatchRow(row, proof, 'secret'), true);
  assert.equal(verifyBatchRow({ ...row, amount: 1 }, proof, 'secret'), false);
  assert.equal(verifyBatchRow({ ...row, productDescription: 'Edited description' }, proof, 'secret'), false);
  const editedLines = { ...row, invoiceLines: row.invoiceLines.map((line) => ({ ...line, description: 'Changed' })) };
  assert.equal(verifyBatchRow(editedLines, proof, 'secret'), false);
});

test('accepts checked manual invoice-line wording without changing amounts', () => {
  const row = normaliseBatchRow(source(), 2);
  const edited = setInvoiceLineDescriptions(row, [
    'Custom deposit wording',
    'Custom final-payment wording',
  ]);
  assert.deepEqual(edited.invoiceLines.map((line) => line.description), [
    'Custom deposit wording',
    'Custom final-payment wording',
  ]);
  assert.deepEqual(edited.invoiceLines.map((line) => line.unitAmount), [1120, 200]);
  const invoice = buildApprovedInvoice(edited, 'contact-1');
  assert.deepEqual(invoice.lineItems.map((line) => line.description), [
    'Custom deposit wording',
    'Custom final-payment wording',
  ]);
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
  assert.deepEqual(invoice.lineItems.map((line) => line.unitAmount), [1120, 200]);
  assert.equal(invoice.lineItems[0].accountCode, '405');
  assert.equal(invoice.lineItems[0].taxType, 'OUTPUT');
  assert.equal(invoice.lineItems[0].description, 'Deposit 1 towards supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713');
  assert.equal(invoice.lineItems[1].description, 'Final payment towards supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System - Job 152713');
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
      status: 'AUTHORISED', total: 1320,
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
      return { body: { invoices: [{ invoiceID: 'invoice-new', invoiceNumber: 'INV-101', status: 'AUTHORISED', total: row.invoiceTotal }] } };
    },
  });
  const result = await createOrFindApprovedInvoice(client, row);
  assert.equal(result.contactCreated, true);
  assert.equal(result.contactUpdated, false);
  assert.equal(result.recoveredExisting, false);
  assert.match(contactArgs[3], /^goldsure-bpoint-contact-/);
  assert.match(invoiceArgs[4], /^goldsure-bpoint-invoice-/);
  const contact = contactArgs[1].contacts[0];
  assert.equal(contact.name, 'Penelope F Worrall');
  assert.equal(contact.emailAddress, 'penelope@example.com');
  assert.deepEqual(contact.phones, [{ phoneType: 'MOBILE', phoneNumber: '0400 000 001' }]);
  assert.deepEqual(contact.addresses, [
    { addressType: 'STREET', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' },
    { addressType: 'POBOX', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' },
  ]);
});

test('finds the same job invoice when a later instalment has a different BPOINT reference', async () => {
  const row = normaliseBatchRow(source(), 2);
  const client = setupClient({
    getInvoices: async () => ({ body: { invoices: [{
      invoiceID: 'invoice-existing', invoiceNumber: 'INV-099',
      reference: 'JOB 152713 - BPOINT 874441', status: 'AUTHORISED', total: 1320,
    }] } }),
  });
  const invoice = await findInvoiceForRow(client, row);
  assert.equal(invoice.invoiceID, 'invoice-existing');
});

test('blocks a new job invoice when multiple legacy instalment invoices already exist', async () => {
  const row = normaliseBatchRow(source(), 2);
  const client = setupClient({
    getInvoices: async () => ({ body: { invoices: [
      { invoiceID: 'invoice-1', reference: 'JOB 152713 - BPOINT 1854072657', total: 200 },
      { invoiceID: 'invoice-2', reference: 'JOB 152713 - BPOINT 1854678621', total: 1120 },
    ] } }),
  });
  await assert.rejects(() => findInvoiceForRow(client, row), /multiple Xero invoices/);
});

test('fills missing details on a matched Xero contact before creating its invoice', async () => {
  const row = normaliseBatchRow(source(), 2);
  let updateArgs;
  const existing = {
    contactID: 'contact-existing', name: row.customerName, emailAddress: row.customerEmail,
    contactStatus: 'ACTIVE', phones: [], addresses: [],
  };
  const client = setupClient({
    getContacts: async () => ({ body: { contacts: [existing] } }),
    updateContact: async (...args) => {
      updateArgs = args;
      return { body: { contacts: [{ ...existing, ...args[2].contacts[0] }] } };
    },
  });
  const result = await createOrFindApprovedInvoice(client, row);
  assert.equal(result.contactCreated, false);
  assert.equal(result.contactUpdated, true);
  assert.equal(updateArgs[1], 'contact-existing');
  assert.match(updateArgs[3], /^goldsure-bpoint-contact-update-v2-/);
  assert.deepEqual(updateArgs[2].contacts[0].phones, [{ phoneType: 'MOBILE', phoneNumber: '0400 000 001' }]);
  assert.deepEqual(updateArgs[2].contacts[0].addresses, [
    { addressType: 'STREET', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' },
    { addressType: 'POBOX', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' },
  ]);
});

test('adds a postal address when a matched contact only has a delivery address', () => {
  const row = normaliseBatchRow(source(), 2);
  const update = buildContactUpdate({
    contactID: 'contact-existing',
    name: row.customerName,
    emailAddress: row.customerEmail,
    phones: [{ phoneType: 'MOBILE', phoneNumber: row.customerMobile }],
    addresses: [{ addressType: 'STREET', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' }],
  }, row);
  assert.deepEqual(update.addresses, [
    { addressType: 'STREET', addressLine1: '1 Test Street', addressLine2: undefined, addressLine3: undefined, addressLine4: undefined, city: 'Preston', region: undefined, postalCode: '3072', country: 'Australia', attentionTo: undefined },
    { addressType: 'POBOX', addressLine1: '1 Test Street', city: 'Preston', postalCode: '3072', country: 'Australia' },
  ]);
});

test('does not overwrite populated details on a matched contact', () => {
  const row = normaliseBatchRow(source(), 2);
  const update = buildContactUpdate({
    contactID: 'contact-existing',
    name: row.customerName,
    emailAddress: row.customerEmail,
    phones: [{ phoneType: 'MOBILE', phoneNumber: '0499 999 999' }],
    addresses: [
      { addressType: 'STREET', addressLine1: '99 Existing Road', city: 'Carlton', postalCode: '3053', country: 'Australia' },
      { addressType: 'POBOX', addressLine1: '99 Existing Road', city: 'Carlton', postalCode: '3053', country: 'Australia' },
    ],
  }, row);
  assert.deepEqual(update, {});
});
