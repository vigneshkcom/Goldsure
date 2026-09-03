import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_CODE,
  ACCOUNT_NAME,
  CONTACT_NAME,
  attachReceipt,
  batchShare,
  buildDraftInvoice,
  createOrFindDraft,
  makeReference,
  parseReceiptText,
  requestCustomConnectionToken,
  sha256Hex,
  signReceipt,
  verifyReceiptProof,
} from '../lib/xero-recharge.js';

function sampleText({ invoice = 'FBADS-438-100', date = '23 Aug 2026, 14:55', sydney = ['124.32', '133.62'] } = {}) {
  const campaigns = sydney.map((amount) => `Heatpumps Sydney | Leads\nFrom 18 Aug 2026, 00:00 to 23 Aug 2026, 14:55\nAU$${amount}\nAd detail AU$${amount}`).join('\n');
  return `Receipt for Goldsure Heat Pumps
Invoice/payment date
${date}
Transaction ID
TX-123
Paid
AU$933.00
Campaigns
Heatpumps Melbourne | Leads
AU$675.06
${campaigns}
Invoice no. ${invoice}`;
}

function receipt(overrides = {}) {
  const invoice = overrides.invoice || 'FBADS-438-100';
  return parseReceiptText(sampleText(overrides), { filename: `${invoice}.pdf`, fileHash: sha256Hex(invoice) });
}

test('extracts only the Heatpumps Sydney campaign totals', () => {
  const parsed = receipt();
  assert.equal(parsed.receiptTotal, 933);
  assert.equal(parsed.nswSpend, 257.94);
  assert.deepEqual(parsed.campaignAmounts, [124.32, 133.62]);
});

test('rejects a receipt without a Sydney campaign', () => {
  assert.throws(() => receipt({ sydney: [] }), /Sydney/);
});

test('calculates the 50 percent share after summing all receipts', () => {
  const receipts = [
    receipt({ invoice: 'FBADS-1', sydney: ['147.19', '0.01', '0.02'] }),
    receipt({ invoice: 'FBADS-2', date: '3 Sep 2026, 06:38', sydney: ['149.14'] }),
  ];
  assert.equal(batchShare(receipts), 148.18);
});

test('creates a stable duplicate-protection reference', () => {
  const first = receipt({ invoice: 'FBADS-1' });
  const second = receipt({ invoice: 'FBADS-2', date: '3 Sep 2026, 06:38' });
  assert.equal(makeReference([first, second]), makeReference([second, first]));
  assert.match(makeReference([first, second]), /^EA-META-20260823-20260903-[A-F0-9]{10}$/);
});

test('builds a draft sales invoice for Eco Alliance account 421', () => {
  const draft = buildDraftInvoice([receipt()], '00000000-0000-0000-0000-000000000001', 'Inclusive', 14, '2026-09-03');
  assert.equal(draft.type, 'ACCREC');
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.currencyCode, 'AUD');
  assert.equal(draft.contact.contactID, '00000000-0000-0000-0000-000000000001');
  assert.equal(draft.lineAmountTypes, 'Inclusive');
  assert.equal(draft.dueDate, '2026-09-17');
  assert.equal(draft.lineItems[0].accountCode, ACCOUNT_CODE);
  assert.equal(draft.lineItems[0].unitAmount, 128.97);
  assert.match(draft.lineItems[0].description, /NSW Meta Ads cost share \(50%\)/);
});

test('receipt proof detects edited amounts', () => {
  const parsed = receipt();
  const proof = signReceipt(parsed, 'test-secret');
  assert.equal(verifyReceiptProof(parsed, proof, 'test-secret'), true);
  assert.equal(verifyReceiptProof({ ...parsed, nswSpend: 999 }, proof, 'test-secret'), false);
});

test('requests a Custom Connection token with Xero granular scopes', async () => {
  let request;
  const token = await requestCustomConnectionToken('client-id', 'client-secret', async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ access_token: 'token', expires_in: 1800, token_type: 'Bearer' }) };
  });
  assert.equal(token.access_token, 'token');
  assert.equal(request.url, 'https://identity.xero.com/connect/token');
  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('scope'), 'accounting.invoices accounting.contacts.read accounting.settings.read accounting.attachments');
  assert.equal(form.has('scopes'), false);
});

test('recovers an existing invoice instead of creating a duplicate', async () => {
  const parsed = receipt();
  let createCalls = 0;
  const existing = { invoiceID: '00000000-0000-0000-0000-000000000002', invoiceNumber: 'INV-100', reference: makeReference([parsed]), total: 128.97 };
  const client = {
    accountingApi: {
      getContacts: async () => ({ body: { contacts: [{ contactID: 'contact-1', name: CONTACT_NAME, contactStatus: 'ACTIVE' }] } }),
      getAccounts: async () => ({ body: { accounts: [{ code: ACCOUNT_CODE, name: ACCOUNT_NAME, status: 'ACTIVE', taxType: 'OUTPUT' }] } }),
      getInvoices: async () => ({ body: { invoices: [existing] } }),
      createInvoices: async () => { createCalls += 1; return { body: { invoices: [] } }; },
    },
  };
  const result = await createOrFindDraft(client, [parsed], 'Inclusive', 14);
  assert.equal(result.recoveredExisting, true);
  assert.equal(result.invoiceId, existing.invoiceID);
  assert.equal(createCalls, 0);
});

test('attachment upload is idempotent and tied to the parsed PDF hash', async () => {
  const pdf = Buffer.from('%PDF-1.4 test');
  const parsed = { ...receipt(), fileHash: sha256Hex(pdf) };
  let args;
  const client = { accountingApi: { createInvoiceAttachmentByFileName: async (...values) => { args = values; } } };
  await attachReceipt(client, '00000000-0000-0000-0000-000000000003', 'Meta Invoice.pdf', pdf, parsed);
  assert.equal(args[0], '');
  assert.equal(args[1], '00000000-0000-0000-0000-000000000003');
  assert.equal(args[2], 'Meta Invoice.pdf');
  assert.equal(args[4], false);
  assert.match(args[5], /^[a-f0-9]{64}$/);
  assert.equal(args[6].headers['Content-Type'], 'application/pdf');
});
