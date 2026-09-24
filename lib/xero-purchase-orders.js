import { createHmac, timingSafeEqual } from 'node:crypto';
import { createXeroClient, sha256Hex } from './xero-recharge.js';

export const CONTRACTOR_ACCOUNT_CODE = process.env.XERO_CONTRACTOR_ACCOUNT_CODE || '101';
export const CONTRACTOR_ACCOUNT_NAME = process.env.XERO_CONTRACTOR_ACCOUNT_NAME || 'Contractor Expenses – Non Salary';
export const DIVISION_TRACKING_CATEGORY = process.env.XERO_DIVISION_TRACKING_CATEGORY || 'Division';
export const SMOKE_ALARMS_DIVISION = process.env.XERO_SMOKE_ALARMS_DIVISION || 'QLD Smoke Alarms';

const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const cleanText = (value, max = 255) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const normalise = value => cleanText(value).toLowerCase();
const normaliseAccountName = value => normalise(value).replace(/[‐‑‒–—−]/g, '-');
const normaliseEmail = value => cleanText(value).toLowerCase();

function isoFromAustralianDate(value) {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error('The purchase order payable date is invalid');
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function shortInstalledDate(value) {
  const iso = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}`;
  const australian = String(value || '').match(/^(\d{1,2})[\/-](\d{1,2})/);
  if (australian) return `${String(australian[1]).padStart(2, '0')}/${String(australian[2]).padStart(2, '0')}`;
  return cleanText(value, 10);
}

function numericJobNumber(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 40);
}

function jobDescription(job) {
  return `${shortInstalledDate(job.installedDate)} | ${numericJobNumber(job.jobId)}`;
}

export function supplierDetails(po) {
  const electrician = po?.electrician || {};
  const contactName = cleanText(electrician.name || electrician.companyName, 255);
  const email = normaliseEmail(electrician.email);
  const taxNumber = cleanText(electrician.taxId, 50);
  if (!contactName) throw new Error('The electrician name is missing');
  return {
    contactName,
    email,
    taxNumber,
    portalId: cleanText(electrician.id, 40),
  };
}

async function searchContacts(client, searchTerm) {
  const response = await client.accountingApi.getContacts('', undefined, undefined, 'Name', undefined, 1, false, false, searchTerm, 100);
  return (response.body.contacts || []).filter(contact => String(contact.contactStatus || '').toUpperCase() !== 'ARCHIVED');
}

export async function findSupplierPlan(client, supplier) {
  if (supplier.email) {
    const matches = (await searchContacts(client, supplier.email))
      .filter(contact => normaliseEmail(contact.emailAddress) === supplier.email);
    if (matches.length > 1) throw new Error(`More than one active Xero contact uses ${supplier.email}`);
    if (matches.length === 1) return { action: 'match', matchedBy: 'email', contact: matches[0] };
  }

  const matches = (await searchContacts(client, supplier.contactName))
    .filter(contact => normalise(contact.name) === normalise(supplier.contactName));
  if (matches.length > 1) throw new Error(`More than one active Xero contact is named ${supplier.contactName}`);
  if (matches.length === 1) {
    const existingEmail = normaliseEmail(matches[0].emailAddress);
    if (supplier.email && existingEmail && existingEmail !== supplier.email) {
      throw new Error(`Xero already has ${supplier.contactName}, but its email address does not match Portal`);
    }
    return { action: 'match', matchedBy: 'name', contact: matches[0] };
  }
  return { action: 'create', matchedBy: null, contact: null };
}

export function buildSupplierContact(supplier) {
  const contact = { name: supplier.contactName };
  if (supplier.email) contact.emailAddress = supplier.email;
  if (supplier.taxNumber) contact.taxNumber = supplier.taxNumber;
  if (supplier.portalId) contact.contactNumber = `GS-ELECTRICIAN-${supplier.portalId}`.slice(0, 50);
  return contact;
}

export async function ensurePurchaseOrderSetup(client, po) {
  const accountsResponse = await client.accountingApi.getAccounts('', undefined, `Code==\"${CONTRACTOR_ACCOUNT_CODE.replace(/[\\\"]/g, '')}\"`);
  const accounts = (accountsResponse.body.accounts || []).filter(account =>
    String(account.status || '').toUpperCase() === 'ACTIVE' && String(account.code || '') === CONTRACTOR_ACCOUNT_CODE);
  if (accounts.length !== 1) throw new Error(`Active Xero account ${CONTRACTOR_ACCOUNT_CODE} was not found uniquely`);
  const account = accounts[0];
  if (normaliseAccountName(account.name) !== normaliseAccountName(CONTRACTOR_ACCOUNT_NAME)) {
    throw new Error(`Xero account ${CONTRACTOR_ACCOUNT_CODE} is named "${account.name}", not "${CONTRACTOR_ACCOUNT_NAME}"`);
  }

  const trackingResponse = await client.accountingApi.getTrackingCategories('', undefined, 'Name', false);
  const tracking = (trackingResponse.body.trackingCategories || []).find(category =>
    String(category.status || '').toUpperCase() === 'ACTIVE'
      && normalise(category.name) === normalise(DIVISION_TRACKING_CATEGORY));
  if (!tracking) throw new Error(`Active Xero tracking category ${DIVISION_TRACKING_CATEGORY} was not found`);
  const division = (tracking.options || []).find(option =>
    String(option.status || '').toUpperCase() === 'ACTIVE'
      && normalise(option.name) === normalise(SMOKE_ALARMS_DIVISION));
  if (!division) throw new Error(`Xero division ${SMOKE_ALARMS_DIVISION} was not found`);

  return {
    accountCode: String(account.code),
    accountName: account.name,
    accountTaxType: account.taxType || 'INPUT',
    serviceTaxType: po.electrician.gstRegistered === true ? (account.taxType || 'INPUT') : 'NONE',
    serviceTaxName: po.electrician.gstRegistered === true ? 'GST on Expenses' : 'BAS Excluded',
    trackingCategory: tracking.name,
    division: division.name,
  };
}

function billLine(description, amount, setup, taxType = setup.serviceTaxType) {
  return {
    description: cleanText(description, 4000),
    quantity: 1,
    unitAmount: roundMoney(amount),
    accountCode: setup.accountCode,
    taxType,
    tracking: [{ name: setup.trackingCategory, option: setup.division }],
  };
}

export function buildDraftBill(po, contactId, setup) {
  if (!contactId) throw new Error('The Xero supplier contact is missing');
  if (!(Number(po?.totals?.totalIncGst) > 0)) throw new Error('The final purchase order amount must be greater than zero');
  const lineItems = [];
  for (const job of po.jobs || []) {
    const description = jobDescription(job);
    lineItems.push(billLine(description, job.grossIncGst, setup));
    if (Number(job.cashOffset) > 0) {
      lineItems.push(billLine(`${description} | Cash offset`, -Number(job.cashOffset), setup, 'NONE'));
    }
  }
  for (const line of po.additionalLines || []) {
    lineItems.push(billLine(`Additional PO line | ${line.description}`, line.amountIncGst, setup));
  }
  const lineTotal = roundMoney(lineItems.reduce((sum, line) => sum + Number(line.unitAmount || 0), 0));
  if (Math.abs(lineTotal - Number(po.totals.totalIncGst)) > 0.005) {
    throw new Error('The Xero bill lines do not match the final purchase order amount');
  }
  return {
    type: 'ACCPAY',
    contact: { contactID: contactId },
    date: cleanText(po.weekEnding, 10),
    dueDate: isoFromAustralianDate(po.payableDate),
    lineAmountTypes: 'Inclusive',
    reference: cleanText(po.poNumber, 255),
    status: 'DRAFT',
    currencyCode: 'AUD',
    lineItems,
  };
}

async function findExistingBill(client, reference) {
  const safeReference = String(reference).replace(/[\\\"]/g, '');
  const where = `Reference==\"${safeReference}\"`;
  const response = await client.accountingApi.getInvoices('', undefined, where, undefined, undefined, undefined, undefined, undefined, 1, false, undefined, 4, true, 100, reference);
  const matches = (response.body.invoices || []).filter(invoice =>
    cleanText(invoice.reference) === reference && String(invoice.type || '').toUpperCase() === 'ACCPAY');
  if (matches.length > 1) throw new Error(`More than one Xero bill uses reference ${reference}`);
  return matches[0] || null;
}

function publicPlan(po, supplier, supplierPlan, setup, existingBill) {
  return {
    reference: cleanText(po.poNumber, 255),
    supplierName: supplier.contactName,
    supplierEmail: supplier.email,
    supplierAction: supplierPlan.action,
    supplierMatchedBy: supplierPlan.matchedBy,
    existingBillId: existingBill?.invoiceID || null,
    existingBillNumber: existingBill?.invoiceNumber || null,
    existingBillStatus: existingBill?.status || null,
    billDate: cleanText(po.weekEnding, 10),
    dueDate: isoFromAustralianDate(po.payableDate),
    payableDate: po.payableDate,
    jobs: Number(po.totals.jobs || 0),
    grossIncGst: roundMoney(po.totals.grossIncGst),
    cashOffset: roundMoney(po.totals.cashOffset),
    totalIncGst: roundMoney(po.totals.totalIncGst),
    accountCode: setup.accountCode,
    accountName: setup.accountName,
    taxName: setup.serviceTaxName,
    trackingCategory: setup.trackingCategory,
    division: setup.division,
  };
}

function proofPayload(plan) {
  return JSON.stringify(plan);
}

export function signPurchaseOrderPlan(plan, secret) {
  if (!secret) throw new Error('Xero purchase order signing is not configured');
  return createHmac('sha256', secret).update(proofPayload(plan)).digest('hex');
}

export function verifyPurchaseOrderPlan(plan, proof, secret) {
  if (!/^[a-f0-9]{64}$/i.test(String(proof || ''))) return false;
  const expected = Buffer.from(signPurchaseOrderPlan(plan, secret), 'hex');
  const supplied = Buffer.from(proof, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function preparePurchaseOrderBill(client, po) {
  const supplier = supplierDetails(po);
  const [setup, supplierPlan, existingBill] = await Promise.all([
    ensurePurchaseOrderSetup(client, po),
    findSupplierPlan(client, supplier),
    findExistingBill(client, cleanText(po.poNumber, 255)),
  ]);
  if (existingBill && Math.abs(Number(existingBill.total) - Number(po.totals.totalIncGst)) > 0.005) {
    throw new Error(`${po.poNumber} already exists in Xero with a different total`);
  }
  return {
    plan: publicPlan(po, supplier, supplierPlan, setup, existingBill),
    supplier,
    supplierPlan,
    setup,
    existingBill,
  };
}

async function createSupplier(client, supplier) {
  const idempotencyKey = `goldsure-electrician-${sha256Hex(JSON.stringify(supplier))}`.slice(0, 128);
  const response = await client.accountingApi.createContacts('', { contacts: [buildSupplierContact(supplier)] }, false, idempotencyKey);
  const contact = response.body.contacts?.[0];
  if (!contact?.contactID) {
    const detail = (contact?.validationErrors || []).map(error => error.message).filter(Boolean).join('; ');
    throw new Error(detail || `Xero did not create supplier ${supplier.contactName}`);
  }
  return contact;
}

export async function createOrFindDraftPurchaseOrderBill(client, po, prepared) {
  if (prepared.existingBill) {
    return {
      invoiceId: prepared.existingBill.invoiceID,
      invoiceNumber: prepared.existingBill.invoiceNumber || null,
      status: prepared.existingBill.status || null,
      reference: prepared.plan.reference,
      total: prepared.existingBill.total,
      recoveredExisting: true,
      supplierCreated: false,
    };
  }
  const contact = prepared.supplierPlan.action === 'match'
    ? prepared.supplierPlan.contact
    : await createSupplier(client, prepared.supplier);
  const bill = buildDraftBill(po, contact.contactID, prepared.setup);
  const idempotencyKey = `goldsure-po-${sha256Hex(JSON.stringify({ reference: bill.reference, total: po.totals.totalIncGst, lines: bill.lineItems }))}`.slice(0, 128);
  const response = await client.accountingApi.createInvoices('', { invoices: [bill] }, false, 4, idempotencyKey);
  const created = response.body.invoices?.[0];
  if (!created?.invoiceID) {
    const detail = (created?.validationErrors || []).map(error => error.message).filter(Boolean).join('; ');
    throw new Error(detail || 'Xero did not create the draft supplier bill');
  }
  return {
    invoiceId: created.invoiceID,
    invoiceNumber: created.invoiceNumber || null,
    status: created.status || 'DRAFT',
    reference: bill.reference,
    total: created.total ?? po.totals.totalIncGst,
    recoveredExisting: false,
    supplierCreated: prepared.supplierPlan.action === 'create',
  };
}

export { createXeroClient };
