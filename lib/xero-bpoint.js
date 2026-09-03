import { createHmac, timingSafeEqual } from 'node:crypto';
import { createXeroClient, sha256Hex, XERO_SCOPES } from './xero-recharge.js';

export const BPOINT_SCOPES = XERO_SCOPES;
export const MAX_BATCH_ROWS = 50;
export const DIVISION_TRACKING_CATEGORY = String(process.env.XERO_DIVISION_TRACKING_CATEGORY || 'Division').trim();

export const CATEGORY_RULES = Object.freeze({
  HWS: Object.freeze({
    accountCode: '405',
    division: 'VIC Hot Water',
    taxType: 'OUTPUT',
    taxRate: 'GST on Income',
  }),
  Aircon: Object.freeze({
    accountCode: '430',
    division: 'VIC Aircons',
    taxType: 'OUTPUT',
    taxRate: 'GST on Income',
  }),
  'Smoke Alarm': Object.freeze({
    accountCode: '166',
    division: 'QLD Smoke Alarm',
    taxType: 'OUTPUT',
    taxRate: 'GST on Income',
  }),
});

const FIELD_ALIASES = Object.freeze({
  jobNo: ['Job No.', 'Job No', 'Job Number', 'Job Id'],
  customerName: ['Customer Name', 'Customer'],
  customerEmail: ['Customer Email', 'Email'],
  customerMobile: ['Customer Mobile', 'Customer Mobile Number', 'Mobile', 'Phone'],
  address: ['Property Address', 'Address'],
  suburb: ['Property Suburb', 'Suburb', 'City'],
  postcode: ['Property Postcode', 'Postcode', 'Postal Code'],
  category: ['Category'],
  bpointRef: ['BPOINT Ref', 'Bpoint Ref', 'CRN1', 'Reference 1'],
  receiptNumber: ['Receipt Number'],
  transactionNumber: ['Transaction Number'],
  paymentDate: ['Payment Date'],
  settlementDate: ['Settlement Date'],
  amount: ['Amount', 'Unit Price'],
  accountCode: ['Account', 'Account Code'],
  division: ['Division'],
  taxRate: ['Tax Rate'],
  pdfFilename: ['PDF Filename', 'Receipt Filename'],
});

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function cleanText(value, maxLength = 255) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function rowValue(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  const wanted = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(row || {})) {
    const normalised = String(key).replace(/^\uFEFF/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (wanted.has(normalised)) return value;
  }
  return '';
}

function parseAmount(value) {
  const amount = Number(String(value ?? '').replace(/[,$\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    throw new Error('Amount must be greater than $0 and no more than $1,000,000');
  }
  return money(amount);
}

function isoDate(value, label) {
  const raw = cleanText(value, 30);
  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) [, day, month, year] = match.map(Number);
  else {
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) [, year, month, day] = match.map(Number);
  }
  if (!match) throw new Error(`${label} must use DD/MM/YYYY or YYYY-MM-DD`);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} is not a valid date`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normaliseCategory(value) {
  const raw = cleanText(value, 40).toLowerCase().replace(/[^a-z]/g, '');
  if (raw === 'hws' || raw === 'hotwater' || raw === 'hotwatersystem') return 'HWS';
  if (raw === 'aircon' || raw === 'airconditioning' || raw === 'ac') return 'Aircon';
  if (raw === 'smokealarm' || raw === 'smokealarms') return 'Smoke Alarm';
  if (raw === 'battery') throw new Error('Battery is held until its Xero account and division are confirmed');
  throw new Error('Category must be HWS, Aircon, or Smoke Alarm');
}

function validEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function makeInvoiceReference(row) {
  if (row.category === 'Smoke Alarm' && !row.jobNo) {
    return `BPOINT-SMOKE-${row.settlementDate.replaceAll('-', '')}`;
  }
  const identifier = row.transactionNumber || row.receiptNumber;
  return `BPOINT-${identifier}`.slice(0, 255);
}

export function makeInvoiceDescription(row) {
  if (row.category === 'Smoke Alarm' && !row.jobNo) {
    const [year, month, day] = row.settlementDate.split('-');
    return `BPOINT smoke alarm batch - ${day}/${month}/${year}`;
  }
  const job = row.jobNo || 'No job number';
  return `${job} - ${row.customerName} - BPOINT Ref ${row.bpointRef}`.slice(0, 4000);
}

export function normaliseBatchRow(source, rowNumber = 1) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`Row ${rowNumber}: invalid row`);
  try {
    const category = normaliseCategory(rowValue(source, FIELD_ALIASES.category));
    const rule = CATEGORY_RULES[category];
    const row = {
      rowNumber,
      jobNo: cleanText(rowValue(source, FIELD_ALIASES.jobNo), 50),
      customerName: cleanText(rowValue(source, FIELD_ALIASES.customerName), 255),
      customerEmail: cleanText(rowValue(source, FIELD_ALIASES.customerEmail), 255).toLowerCase(),
      customerMobile: cleanText(rowValue(source, FIELD_ALIASES.customerMobile), 50),
      address: cleanText(rowValue(source, FIELD_ALIASES.address), 255),
      suburb: cleanText(rowValue(source, FIELD_ALIASES.suburb), 100),
      postcode: cleanText(rowValue(source, FIELD_ALIASES.postcode), 20),
      category,
      bpointRef: cleanText(rowValue(source, FIELD_ALIASES.bpointRef), 100),
      receiptNumber: cleanText(rowValue(source, FIELD_ALIASES.receiptNumber), 100),
      transactionNumber: cleanText(rowValue(source, FIELD_ALIASES.transactionNumber), 100),
      paymentDate: isoDate(rowValue(source, FIELD_ALIASES.paymentDate), 'Payment Date'),
      settlementDate: isoDate(rowValue(source, FIELD_ALIASES.settlementDate), 'Settlement Date'),
      amount: parseAmount(rowValue(source, FIELD_ALIASES.amount)),
      accountCode: rule.accountCode,
      division: rule.division,
      taxType: rule.taxType,
      taxRate: rule.taxRate,
      pdfFilename: cleanText(rowValue(source, FIELD_ALIASES.pdfFilename), 180),
    };

    if (!row.customerName) throw new Error('Customer Name is required');
    if (!validEmail(row.customerEmail)) throw new Error('Customer Email is invalid');
    if (!row.bpointRef) throw new Error('BPOINT Ref is required');
    if (!row.transactionNumber && !row.receiptNumber) throw new Error('Transaction Number or Receipt Number is required');
    if (category !== 'Smoke Alarm' && !row.jobNo) throw new Error('Job No is required for HWS and Aircon');

    const suppliedAccount = cleanText(rowValue(source, FIELD_ALIASES.accountCode), 80).match(/^\d+/)?.[0] || '';
    const suppliedDivision = cleanText(rowValue(source, FIELD_ALIASES.division), 100);
    const suppliedTax = cleanText(rowValue(source, FIELD_ALIASES.taxRate), 100);
    if (suppliedAccount && suppliedAccount !== row.accountCode) throw new Error(`Account must be ${row.accountCode} for ${category}`);
    if (suppliedDivision && suppliedDivision.toLowerCase() !== row.division.toLowerCase()) throw new Error(`Division must be ${row.division} for ${category}`);
    if (suppliedTax && suppliedTax.toLowerCase() !== row.taxRate.toLowerCase()) throw new Error(`Tax Rate must be ${row.taxRate}`);

    row.invoiceReference = makeInvoiceReference(row);
    row.description = makeInvoiceDescription(row);
    row.contactKey = sha256Hex(`${row.customerEmail}|${row.customerName.toLowerCase()}|${row.customerMobile.replace(/\D/g, '')}`);
    row.rowKey = sha256Hex(`${row.invoiceReference}|${row.bpointRef}|${row.amount}|${row.paymentDate}`);
    return row;
  } catch (error) {
    throw new Error(`Row ${rowNumber}: ${error.message}`);
  }
}

export function validateBatchRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The invoice batch is empty');
  if (rows.length > MAX_BATCH_ROWS) throw new Error(`A batch can contain no more than ${MAX_BATCH_ROWS} invoices`);
  const normalised = rows.map((row, index) => normaliseBatchRow(row, index + 2));
  const references = new Set();
  for (const row of normalised) {
    if (references.has(row.invoiceReference)) throw new Error(`Row ${row.rowNumber}: duplicate invoice reference ${row.invoiceReference}`);
    references.add(row.invoiceReference);
  }
  return normalised;
}

function proofPayload(row) {
  return JSON.stringify([
    row.rowKey, row.jobNo, row.customerName, row.customerEmail, row.customerMobile,
    row.address, row.suburb, row.postcode, row.category, row.bpointRef,
    row.receiptNumber, row.transactionNumber, row.paymentDate, row.settlementDate,
    money(row.amount), row.accountCode, row.division, row.taxType, row.invoiceReference,
  ]);
}

export function signBatchRow(row, secret) {
  return createHmac('sha256', secret).update(proofPayload(row)).digest('hex');
}

export function verifyBatchRow(row, proof, secret) {
  if (!/^[a-f0-9]{64}$/i.test(String(proof || ''))) return false;
  const expected = Buffer.from(signBatchRow(row, secret), 'hex');
  const supplied = Buffer.from(proof, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function normaliseEmail(value) {
  return cleanText(value, 255).toLowerCase();
}

function normaliseName(value) {
  return cleanText(value, 255).toLowerCase();
}

function normalisePhone(value) {
  return cleanText(value, 50).replace(/\D/g, '');
}

function activeContacts(contacts) {
  return (contacts || []).filter((contact) => String(contact.contactStatus || '').toUpperCase() !== 'ARCHIVED');
}

async function searchContacts(client, searchTerm) {
  const response = await client.accountingApi.getContacts('', undefined, undefined, 'Name', undefined, 1, false, false, searchTerm, 100);
  return activeContacts(response.body.contacts);
}

export async function findContactPlan(client, row) {
  if (row.customerEmail) {
    const emailResults = await searchContacts(client, row.customerEmail);
    const exactEmail = emailResults.filter((contact) => normaliseEmail(contact.emailAddress) === row.customerEmail);
    if (exactEmail.length > 1) throw new Error(`More than one active Xero contact uses ${row.customerEmail}`);
    if (exactEmail.length === 1) return { action: 'match', contact: exactEmail[0], matchedBy: 'email' };
  }

  const nameResults = await searchContacts(client, row.customerName);
  const exactName = nameResults.filter((contact) => normaliseName(contact.name) === normaliseName(row.customerName));
  if (exactName.length > 1) throw new Error(`More than one active Xero contact is named ${row.customerName}`);
  if (exactName.length === 1) {
    const contact = exactName[0];
    const existingEmail = normaliseEmail(contact.emailAddress);
    const suppliedPhone = normalisePhone(row.customerMobile);
    const existingPhones = (contact.phones || []).map((phone) => normalisePhone(phone.phoneNumber)).filter(Boolean);
    const sameEmail = row.customerEmail && existingEmail === row.customerEmail;
    const samePhone = suppliedPhone && existingPhones.includes(suppliedPhone);
    const bothWithoutEmail = !row.customerEmail && !existingEmail;
    if (sameEmail || samePhone || bothWithoutEmail) return { action: 'match', contact, matchedBy: sameEmail ? 'email' : samePhone ? 'phone' : 'name' };
    throw new Error(`Xero already has ${row.customerName}, but the email or phone does not match`);
  }
  return { action: 'create', contact: null, matchedBy: null };
}

function buildContact(row) {
  const contact = {
    name: row.customerName,
    contactNumber: `GS-${row.contactKey.slice(0, 16).toUpperCase()}`,
  };
  if (row.customerEmail) contact.emailAddress = row.customerEmail;
  if (row.customerMobile) contact.phones = [{ phoneType: 'MOBILE', phoneNumber: row.customerMobile }];
  if (row.address || row.suburb || row.postcode) {
    contact.addresses = [{
      addressType: 'STREET',
      addressLine1: row.address || undefined,
      city: row.suburb || undefined,
      postalCode: row.postcode || undefined,
      country: 'Australia',
    }];
  }
  return contact;
}

export async function findOrCreateContact(client, row, plannedContact = null) {
  const plan = plannedContact || await findContactPlan(client, row);
  if (plan.action === 'match') return { contact: plan.contact, created: false, matchedBy: plan.matchedBy };
  const idempotencyKey = `goldsure-bpoint-contact-${row.contactKey}`.slice(0, 128);
  const response = await client.accountingApi.createContacts('', { contacts: [buildContact(row)] }, false, idempotencyKey);
  const created = response.body.contacts?.[0];
  if (!created?.contactID) {
    const detail = (created?.validationErrors || []).map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(detail || `Xero did not create contact ${row.customerName}`);
  }
  return { contact: created, created: true, matchedBy: null };
}

function cleanWhereValue(value) {
  return String(value).replace(/[\\\"]/g, '');
}

export async function findInvoiceByReference(client, reference) {
  const where = `Reference==\"${cleanWhereValue(reference)}\"`;
  const response = await client.accountingApi.getInvoices('', undefined, where, undefined, undefined, undefined, undefined, undefined, 1, false, undefined, 4, true, 100, reference);
  const matches = (response.body.invoices || []).filter((invoice) => cleanText(invoice.reference) === reference);
  if (matches.length > 1) throw new Error(`More than one Xero invoice uses reference ${reference}`);
  return matches[0] || null;
}

export function buildApprovedInvoice(row, contactId) {
  if (!contactId) throw new Error('Xero contact ID is missing');
  return {
    type: 'ACCREC',
    contact: { contactID: contactId },
    date: row.paymentDate,
    dueDate: row.paymentDate,
    lineAmountTypes: 'Inclusive',
    reference: row.invoiceReference,
    status: 'AUTHORISED',
    sentToContact: false,
    currencyCode: 'AUD',
    lineItems: [{
      description: row.description,
      quantity: 1,
      unitAmount: row.amount,
      accountCode: row.accountCode,
      taxType: row.taxType,
      tracking: [{ name: DIVISION_TRACKING_CATEGORY, option: row.division }],
    }],
  };
}

export async function ensureXeroSetup(client, rows) {
  const required = new Map(rows.map((row) => [row.accountCode, row]));
  const accountsResponse = await client.accountingApi.getAccounts('');
  const activeAccounts = new Map((accountsResponse.body.accounts || [])
    .filter((account) => String(account.status || '').toUpperCase() === 'ACTIVE')
    .map((account) => [String(account.code), account]));
  const accounts = {};
  for (const [code, row] of required) {
    const account = activeAccounts.get(code);
    if (!account) throw new Error(`Active Xero account ${code} was not found`);
    if (String(account.taxType || '').toUpperCase() !== row.taxType) {
      throw new Error(`Xero account ${code} must use ${row.taxRate}`);
    }
    accounts[code] = { code, name: account.name || '', taxType: account.taxType || '' };
  }

  const trackingResponse = await client.accountingApi.getTrackingCategories('', undefined, 'Name', false);
  const tracking = (trackingResponse.body.trackingCategories || []).find((category) =>
    String(category.status || '').toUpperCase() === 'ACTIVE'
      && normaliseName(category.name) === normaliseName(DIVISION_TRACKING_CATEGORY));
  if (!tracking) throw new Error(`Active Xero tracking category ${DIVISION_TRACKING_CATEGORY} was not found`);
  const activeOptions = new Map((tracking.options || [])
    .filter((option) => String(option.status || '').toUpperCase() === 'ACTIVE')
    .map((option) => [normaliseName(option.name), option]));
  for (const row of rows) {
    if (!activeOptions.has(normaliseName(row.division))) throw new Error(`Xero division ${row.division} was not found`);
  }
  return { accounts, trackingCategory: tracking.name, divisions: [...new Set(rows.map((row) => row.division))] };
}

export async function previewRowsInXero(client, rows) {
  const setup = await ensureXeroSetup(client, rows);
  const contacts = new Map();
  const plans = [];
  for (const row of rows) {
    let contactPlan = contacts.get(row.contactKey);
    if (!contactPlan) {
      contactPlan = await findContactPlan(client, row);
      contacts.set(row.contactKey, contactPlan);
    }
    const invoice = await findInvoiceByReference(client, row.invoiceReference);
    if (invoice && Math.abs(Number(invoice.total) - row.amount) > 0.005) {
      throw new Error(`${row.invoiceReference} already exists in Xero with a different total`);
    }
    plans.push({
      ...row,
      contactAction: contactPlan.action,
      contactMatchedBy: contactPlan.matchedBy,
      contactId: contactPlan.contact?.contactID || null,
      existingInvoiceId: invoice?.invoiceID || null,
      existingInvoiceNumber: invoice?.invoiceNumber || null,
      existingInvoiceStatus: invoice?.status || null,
    });
  }
  return { rows: plans, setup };
}

export async function createOrFindApprovedInvoice(client, row) {
  await ensureXeroSetup(client, [row]);
  const existing = await findInvoiceByReference(client, row.invoiceReference);
  if (existing) {
    if (Math.abs(Number(existing.total) - row.amount) > 0.005) throw new Error(`${row.invoiceReference} already exists with a different total`);
    return {
      invoiceId: existing.invoiceID,
      invoiceNumber: existing.invoiceNumber || null,
      invoiceStatus: existing.status || null,
      reference: row.invoiceReference,
      total: existing.total,
      recoveredExisting: true,
      contactCreated: false,
    };
  }

  const contactResult = await findOrCreateContact(client, row);
  const invoice = buildApprovedInvoice(row, contactResult.contact.contactID);
  const idempotencyKey = `goldsure-bpoint-invoice-${row.rowKey}`.slice(0, 128);
  const response = await client.accountingApi.createInvoices('', { invoices: [invoice] }, false, 4, idempotencyKey);
  const created = response.body.invoices?.[0];
  if (!created?.invoiceID) {
    const detail = (created?.validationErrors || []).map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(detail || `Xero did not create ${row.invoiceReference}`);
  }
  return {
    invoiceId: created.invoiceID,
    invoiceNumber: created.invoiceNumber || null,
    invoiceStatus: created.status || 'AUTHORISED',
    reference: row.invoiceReference,
    total: created.total ?? row.amount,
    recoveredExisting: false,
    contactCreated: contactResult.created,
    contactName: contactResult.contact.name || row.customerName,
  };
}

export { createXeroClient };
