import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { XeroClient } from 'xero-node';

export const CONTACT_NAME = 'Eco Alliance';
export const ACCOUNT_CODE = '421';
export const ACCOUNT_NAME = 'Advertising Recharge Income';
export const SHARE_RATE = 0.5;
export const MAX_ATTACHMENTS = 10;
export const MAX_PDF_BYTES = Math.floor(2.5 * 1024 * 1024);
export const XERO_SCOPES = [
  'accounting.invoices',
  'accounting.contacts',
  'accounting.settings.read',
  'accounting.attachments',
];

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

let cachedXeroClient = null;
let cachedXeroClientUntil = 0;
let cachedCredentialKey = '';

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalisePdfText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();
}

function requiredMatch(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Missing ${label}`);
  return match[1].trim();
}

function parseMoney(raw, label) {
  const value = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return money(value);
}

function parseMetaDate(raw) {
  const match = String(raw).match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!match) throw new Error(`Unrecognised invoice date: ${raw}`);
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!month) throw new Error(`Unrecognised invoice month: ${match[2]}`);
  const day = Number(match[1]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Unrecognised invoice date: ${raw}`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseReceiptText(text, { filename = 'invoice.pdf', fileHash = 'test' } = {}) {
  const normalised = normalisePdfText(text);
  const flat = normalised.replace(/\n/g, ' ');
  const invoiceNumber = requiredMatch(flat, /Invoice no\.\s*([^\s]+)/i, 'Meta invoice number');
  const rawDate = requiredMatch(
    flat,
    /Invoice\/payment date\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}(?:,\s*\d{1,2}:\d{2})?)/i,
    'invoice/payment date',
  );
  const transactionId = requiredMatch(flat, /Transaction ID\s*([^\s]+)/i, 'transaction ID');
  const receiptTotal = parseMoney(requiredMatch(flat, /\bPaid\s*AU\$\s*([\d,]+(?:\.\d{2})?)/i, 'paid total'), 'paid total');

  const campaignAmounts = [];
  const campaignPattern = /Heatpumps Sydney\b[\s\S]{0,260}?AU\$\s*([\d,]+(?:\.\d{2})?)/gi;
  let campaignMatch;
  while ((campaignMatch = campaignPattern.exec(normalised)) !== null) {
    campaignAmounts.push(parseMoney(campaignMatch[1], 'Sydney campaign amount'));
  }
  if (!campaignAmounts.length) throw new Error('No Heatpumps Sydney campaign totals found');

  const nswSpend = money(campaignAmounts.reduce((sum, value) => sum + value, 0));
  if (nswSpend > receiptTotal) throw new Error('Sydney campaign spend exceeds the receipt total');

  return {
    filename,
    invoiceNumber,
    invoiceDate: parseMetaDate(rawDate),
    transactionId,
    receiptTotal,
    nswSpend,
    campaignAmounts,
    fileHash,
  };
}

export async function parseReceiptPdf(pdfBuffer, filename = 'invoice.pdf') {
  if (!Buffer.isBuffer(pdfBuffer)) pdfBuffer = Buffer.from(pdfBuffer);
  if (!pdfBuffer.length) throw new Error('The PDF is empty');
  if (pdfBuffer.length > MAX_PDF_BYTES) throw new Error('Each PDF must be smaller than 2.5 MB');
  if (pdfBuffer.subarray(0, 4).toString() !== '%PDF') throw new Error('The selected file is not a PDF');

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
  });
  const document = await loadingTask.promise;
  if (!document.numPages) throw new Error('The PDF has no pages');

  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      pageText += item.str;
      pageText += item.hasEOL ? '\n' : ' ';
    }
    pages.push(pageText);
  }
  await loadingTask.destroy();

  const text = pages.join('\n');
  if (!text.trim()) throw new Error('The PDF contains no readable text');
  return parseReceiptText(text, { filename, fileHash: sha256Hex(pdfBuffer) });
}

export function receiptProofPayload(receipt) {
  return JSON.stringify([
    receipt.invoiceNumber,
    receipt.invoiceDate,
    receipt.transactionId,
    money(receipt.receiptTotal),
    money(receipt.nswSpend),
    receipt.fileHash,
  ]);
}

export function signReceipt(receipt, secret) {
  return createHmac('sha256', secret).update(receiptProofPayload(receipt)).digest('hex');
}

export function verifyReceiptProof(receipt, proof, secret) {
  if (!/^[a-f0-9]{64}$/i.test(String(proof || ''))) return false;
  const expected = Buffer.from(signReceipt(receipt, secret), 'hex');
  const supplied = Buffer.from(proof, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function validateReceipts(receipts) {
  if (!Array.isArray(receipts) || receipts.length === 0) throw new Error('Select at least one receipt');
  if (receipts.length > MAX_ATTACHMENTS) throw new Error('Xero allows a maximum of 10 attachments per invoice');
  const invoiceNumbers = new Set();
  for (const receipt of receipts) {
    if (!receipt || !/^[A-Za-z0-9._-]{2,80}$/.test(String(receipt.invoiceNumber || ''))) {
      throw new Error('A receipt has an invalid invoice number');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(receipt.invoiceDate || ''))) throw new Error('A receipt has an invalid date');
    if (!/^[a-f0-9]{64}$/i.test(String(receipt.fileHash || ''))) throw new Error('A receipt has an invalid file hash');
    if (!Number.isFinite(Number(receipt.nswSpend)) || Number(receipt.nswSpend) <= 0) throw new Error('A receipt has an invalid NSW spend');
    if (invoiceNumbers.has(receipt.invoiceNumber)) throw new Error(`Duplicate Meta invoice ${receipt.invoiceNumber}`);
    invoiceNumbers.add(receipt.invoiceNumber);
  }
  return receipts;
}

export function batchShare(receipts) {
  validateReceipts(receipts);
  return money(receipts.reduce((sum, receipt) => sum + Number(receipt.nswSpend), 0) * SHARE_RATE);
}

export function batchKey(receipts) {
  validateReceipts(receipts);
  return sha256Hex(receipts.map((receipt) => receipt.invoiceNumber).sort().join('\n'));
}

export function makeReference(receipts) {
  validateReceipts(receipts);
  const dates = receipts.map((receipt) => receipt.invoiceDate).sort();
  return `EA-META-${dates[0].replaceAll('-', '')}-${dates.at(-1).replaceAll('-', '')}-${batchKey(receipts).slice(0, 10).toUpperCase()}`;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

export function makeDescription(receipts) {
  validateReceipts(receipts);
  const ordered = [...receipts].sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  const first = formatDate(ordered[0].invoiceDate);
  const last = formatDate(ordered.at(-1).invoiceDate);
  const sourceNumbers = ordered.map((receipt) => receipt.invoiceNumber).join(', ');
  return `NSW Meta Ads cost share (50%) - ${first} to ${last}. Sydney campaign spend only. Source Meta invoices: ${sourceNumbers}`;
}

export function sydneyToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function buildDraftInvoice(receipts, contactId, amountType = 'Inclusive', dueDays = 14, invoiceDate = sydneyToday()) {
  validateReceipts(receipts);
  if (!['Inclusive', 'Exclusive'].includes(amountType)) throw new Error('Tax treatment must be Inclusive or Exclusive');
  if (![7, 14, 30].includes(Number(dueDays))) throw new Error('Payment due must be 7, 14 or 30 days');
  if (!contactId) throw new Error('Eco Alliance contact ID is missing');
  return {
    type: 'ACCREC',
    contact: { contactID: contactId },
    date: invoiceDate,
    dueDate: addDays(invoiceDate, Number(dueDays)),
    lineAmountTypes: amountType,
    reference: makeReference(receipts),
    status: 'DRAFT',
    currencyCode: 'AUD',
    lineItems: [{
      description: makeDescription(receipts),
      quantity: 1,
      unitAmount: batchShare(receipts),
      accountCode: ACCOUNT_CODE,
    }],
  };
}

function requireCredentials() {
  const clientId = String(process.env.XERO_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.XERO_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('Xero credentials are not configured in Vercel yet');
  return { clientId, clientSecret };
}

export async function createXeroClient() {
  const { clientId, clientSecret } = requireCredentials();
  const credentialKey = sha256Hex(`${clientId}:${clientSecret}`);
  if (cachedXeroClient && cachedCredentialKey === credentialKey && Date.now() < cachedXeroClientUntil) {
    return cachedXeroClient;
  }
  const tokenSet = await requestCustomConnectionToken(clientId, clientSecret);
  const client = new XeroClient({
    clientId,
    clientSecret,
    grantType: 'client_credentials',
    scopes: XERO_SCOPES,
    httpTimeout: 20000,
  });
  client.setTokenSet(tokenSet);
  cachedXeroClient = client;
  cachedCredentialKey = credentialKey;
  cachedXeroClientUntil = Date.now() + Math.max(60, Number(tokenSet.expires_in || 1800) - 60) * 1000;
  return client;
}

export async function requestCustomConnectionToken(clientId, clientSecret, fetchImpl = fetch) {
  const response = await fetchImpl('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: XERO_SCOPES.join(' '),
    }).toString(),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || 'Xero did not return an access token');
  }
  return body;
}

export async function getConnectionDetails(client) {
  const contactsResponse = await client.accountingApi.getContacts('', undefined, undefined, 'Name', undefined, 1, false, true, CONTACT_NAME, 100);
  const contacts = (contactsResponse.body.contacts || []).filter((contact) =>
    String(contact.name || '').trim().toLowerCase() === CONTACT_NAME.toLowerCase()
      && String(contact.contactStatus || '').toUpperCase() !== 'ARCHIVED');
  if (contacts.length !== 1) {
    throw new Error(contacts.length ? `More than one active Xero contact is named ${CONTACT_NAME}` : `No active Xero contact named ${CONTACT_NAME} was found`);
  }

  const accountsResponse = await client.accountingApi.getAccounts('', undefined, `Code==\"${ACCOUNT_CODE}\"`);
  const accounts = (accountsResponse.body.accounts || []).filter((account) => String(account.status || '').toUpperCase() === 'ACTIVE');
  if (!accounts.length) throw new Error(`Active Xero account ${ACCOUNT_CODE} was not found`);
  const account = accounts[0];
  if (String(account.name || '').trim().toLowerCase() !== ACCOUNT_NAME.toLowerCase()) {
    throw new Error(`Xero account ${ACCOUNT_CODE} is named \"${account.name}\", not \"${ACCOUNT_NAME}\"`);
  }

  return {
    contactId: contacts[0].contactID,
    contactName: contacts[0].name,
    accountCode: account.code,
    accountName: account.name,
    accountTaxType: account.taxType || null,
  };
}

export async function findInvoiceByReference(client, reference) {
  const where = `Reference==\"${String(reference).replace(/[\\\"]/g, '')}\"`;
  const response = await client.accountingApi.getInvoices('', undefined, where, undefined, undefined, undefined, undefined, undefined, 1, false, undefined, 4, true, 100, reference);
  const matches = (response.body.invoices || []).filter((invoice) => String(invoice.reference || '').trim() === reference);
  if (matches.length > 1) throw new Error(`Xero contains more than one invoice with reference ${reference}`);
  return matches[0] || null;
}

export async function createOrFindDraft(client, receipts, amountType, dueDays) {
  const details = await getConnectionDetails(client);
  const reference = makeReference(receipts);
  const existing = await findInvoiceByReference(client, reference);
  if (existing) {
    return {
      invoiceId: existing.invoiceID,
      invoiceNumber: existing.invoiceNumber || null,
      reference,
      total: existing.total ?? null,
      recoveredExisting: true,
      details,
    };
  }

  const invoice = buildDraftInvoice(receipts, details.contactId, amountType, dueDays);
  const idempotencyKey = `ecoalliance-meta-${batchKey(receipts)}`.slice(0, 128);
  const response = await client.accountingApi.createInvoices('', { invoices: [invoice] }, false, 4, idempotencyKey);
  const created = response.body.invoices?.[0];
  if (!created?.invoiceID) {
    const validationMessage = (created?.validationErrors || []).map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(validationMessage || 'Xero did not return the created invoice');
  }
  return {
    invoiceId: created.invoiceID,
    invoiceNumber: created.invoiceNumber || null,
    reference,
    total: created.total ?? null,
    recoveredExisting: false,
    details,
  };
}

export async function attachReceipt(client, invoiceId, filename, pdfBuffer, receipt) {
  if (!/^[0-9a-f-]{36}$/i.test(String(invoiceId || ''))) throw new Error('The Xero invoice ID is invalid');
  const safeName = String(filename || '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180);
  if (!safeName.toLowerCase().endsWith('.pdf')) throw new Error('Only PDF attachments are supported');
  const fileHash = sha256Hex(pdfBuffer);
  if (fileHash !== receipt.fileHash) throw new Error(`The attachment no longer matches ${receipt.invoiceNumber}`);
  const idempotencyKey = sha256Hex(`${invoiceId}:${fileHash}`);
  await client.accountingApi.createInvoiceAttachmentByFileName('', invoiceId, safeName, pdfBuffer, false, idempotencyKey, {
    headers: { 'Content-Type': 'application/pdf' },
  });
  return { filename: safeName };
}
