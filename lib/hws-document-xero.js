import { createHash } from 'node:crypto';
import { calculateDocument, cents } from '../assets/hws-document-model.js';
import { createXeroClient } from './xero-recharge.js';
import { ensureXeroSetup, CATEGORY_RULES, DIVISION_TRACKING_CATEGORY } from './xero-bpoint.js';

const normal = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const key = value => createHash('sha256').update(value).digest('hex');
const rule = CATEGORY_RULES.HWS;
export class HwsInvoiceError extends Error {}
export function hwsInvoicePlan(data) {
  if (data.type !== 'quote' || !data.deposit) return null;
  const job = String(data.number || '').trim();
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(job)) throw new HwsInvoiceError('Use the job number as the quote number (letters, numbers, dots, hyphens or underscores only).');
  const total = calculateDocument(data).grandTotal;
  const deposit = cents(data.deposit);
  if (deposit <= 0 || deposit > total) throw new HwsInvoiceError('Enter a deposit greater than zero and no more than the final quote total.');
  const dueDate = data.invoiceDueDate || data.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < data.date) throw new HwsInvoiceError('The invoice due date must be on or after the quote date.');
  const line = (label, amount) => ({ description: `${label} - Job ${job} - Hot water system installation`, quantity: 1, unitAmount: amount / 100, accountCode: rule.accountCode, taxType: rule.taxType, tracking: [{ name: DIVISION_TRACKING_CATEGORY, option: rule.division }] });
  return {
    type: 'ACCREC', invoiceNumber: job, reference: `JOB ${job}`, date: data.date, dueDate,
    status: 'AUTHORISED', lineAmountTypes: 'Inclusive', currencyCode: 'AUD', sentToContact: false,
    lineItems: [line('Deposit', deposit), line('Pending balance', total - deposit)]
  };
}

async function contacts(client, term) {
  const response = await client.accountingApi.getContacts('', undefined, undefined, 'Name', undefined, 1, false, false, term, 100);
  return (response.body.contacts || []).filter(contact => String(contact.contactStatus).toUpperCase() !== 'ARCHIVED');
}
async function resolveContact(client, data) {
  const email = normal(data.email);
  const name = normal(data.customer);
  const emailMatches = (await contacts(client, email)).filter(contact => normal(contact.emailAddress) === email);
  const exact = emailMatches.filter(contact => normal(contact.name) === name);
  if (exact.length === 1) return exact[0];
  if (emailMatches.length) throw new HwsInvoiceError('The customer email matches a different or ambiguous Xero contact. Review the contact in Xero before sending.');
  const names = (await contacts(client, data.customer)).filter(contact => normal(contact.name) === name);
  if (names.length) throw new HwsInvoiceError('A Xero contact with this name already exists, but its email does not match. Review the contact before sending.');
  const response = await client.accountingApi.createContacts('', { contacts: [{
    name: data.customer.trim(), emailAddress: email,
    addresses: [{ addressType: 'POBOX', addressLine1: data.address.slice(0, 500), ...(data.address.length > 500 ? { addressLine2: data.address.slice(500) } : {}), country: 'Australia' }]
  }] }, false, `goldsure-hws-contact-${key(`${name}|${email}`)}`);
  const contact = response.body.contacts?.[0];
  if (!contact?.contactID || contact.hasValidationErrors) throw new HwsInvoiceError('Xero could not create the customer contact. Review Xero before trying again.');
  return contact;
}

async function findExisting(client, plan) {
  const response = await client.accountingApi.getInvoices('', undefined, 'Type=="ACCREC"', undefined, undefined, undefined, undefined, undefined, 1, false, undefined, 4, false, 100, plan.invoiceNumber);
  const matches = (response.body.invoices || []).filter(invoice =>
    invoice.invoiceNumber === plan.invoiceNumber || invoice.reference === plan.reference || String(invoice.reference || '').startsWith(`${plan.reference} - BPOINT `));
  if (matches.length > 1) throw new HwsInvoiceError(`Job ${plan.invoiceNumber} already has multiple Xero invoices. Review them before sending.`);
  const existing = matches[0] || null;
  if (existing?.contact?.contactID) existing.contact = (await client.accountingApi.getContact('', existing.contact.contactID)).body.contacts?.[0] || existing.contact;
  return existing;
}
function assertMatches(invoice, plan, data) {
  const lines = invoice.lineItems || [];
  const total = plan.lineItems.reduce((sum, line) => sum + cents(line.unitAmount), 0);
  if (!invoice.invoiceID || !['AUTHORISED'].includes(String(invoice.status).toUpperCase()) || Number(invoice.amountPaid || 0) > 0) throw new HwsInvoiceError('This job already has a Xero invoice with a different status or recorded payments. Review it before requesting another deposit.');
  if (normal(invoice.contact?.emailAddress) !== normal(data.email) || normal(invoice.contact?.name) !== normal(data.customer)) throw new HwsInvoiceError('The existing job invoice belongs to a different Xero customer. Review it before sending.');
  const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : /^\/Date\((\d+)/.test(String(value)) ? new Date(Number(String(value).match(/^\/Date\((\d+)/)[1])).toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  if (iso(invoice.date) !== plan.date || iso(invoice.dueDate) !== plan.dueDate || invoice.currencyCode !== 'AUD') throw new HwsInvoiceError('The existing Xero invoice has different dates or currency. Review it before sending.');
  if (cents(invoice.total) !== total || invoice.lineAmountTypes !== 'Inclusive' || lines.length !== 2 || lines.some((line, i) =>
    cents(line.unitAmount) !== cents(plan.lineItems[i].unitAmount) || Number(line.quantity) !== 1 || line.description !== plan.lineItems[i].description || String(line.accountCode) !== rule.accountCode || line.taxType !== rule.taxType || Number(line.discountRate || 0) !== 0 || Number(line.discountAmount || 0) !== 0 || !(line.tracking || []).some(track => track.name === DIVISION_TRACKING_CATEGORY && track.option === rule.division)
  )) throw new HwsInvoiceError('The existing Xero invoice does not match this deposit and balance split. No duplicate was created; review the existing invoice before sending.');
}
const resultOf = (invoice, recoveredExisting) => ({ invoiceId: invoice.invoiceID, invoiceNumber: invoice.invoiceNumber, total: invoice.total, status: invoice.status, recoveredExisting, url: `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${encodeURIComponent(invoice.invoiceID)}` });

export async function createHwsCustomerInvoice(data, { clientFactory = createXeroClient, checkSetup = ensureXeroSetup } = {}) {
  const plan = hwsInvoicePlan(data);
  if (!plan) return null;
  const client = await clientFactory();
  const organisations = (await client.accountingApi.getOrganisations('')).body.organisations || [];
  if (organisations.length !== 1 || normal(organisations[0].name) !== 'goldsure pty ltd') throw new HwsInvoiceError('The portal Xero connection must be Goldsure Pty Ltd.');
  await checkSetup(client, [{ ...rule, category: 'HWS' }]);
  const existing = await findExisting(client, plan);
  if (existing) { assertMatches(existing, plan, data); return resultOf(existing, true); }
  const contact = await resolveContact(client, data);
  let created;
  try {
    const response = await client.accountingApi.createInvoices('', { invoices: [{ ...plan, contact: { contactID: contact.contactID } }] }, false, 4, `goldsure-hws-invoice-${key(plan.invoiceNumber)}`);
    created = response.body.invoices?.[0];
    if (!created?.invoiceID || created.hasValidationErrors) throw new HwsInvoiceError('Xero did not confirm the customer invoice. Check Xero before trying again.');
  } catch (error) {
    const recovered = await findExisting(client, plan);
    if (!recovered) throw error;
    assertMatches(recovered, plan, data);
    return resultOf(recovered, true);
  }
  if (cents(created.total) !== calculateDocument(data).grandTotal) throw new HwsInvoiceError('Xero returned an unexpected invoice total. The email was not sent; review Xero before continuing.');
  created.contact = contact;
  assertMatches(created, plan, data);
  return resultOf(created, false);
}
