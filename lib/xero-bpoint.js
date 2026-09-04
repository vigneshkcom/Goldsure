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
    division: 'QLD Smoke Alarms',
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
  invoiceTotal: ['Final Invoice Amount', 'Invoice Total'],
  accountCode: ['Account', 'Account Code'],
  division: ['Division'],
  taxRate: ['Tax Rate'],
  productDescription: ['Product / Service Description', 'Product Description', 'Line Item Description'],
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

function parseOptionalAmount(value) {
  if (!cleanText(value, 40)) return null;
  return parseAmount(value);
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
  return `JOB ${row.jobNo} - BPOINT ${row.bpointRef}`.slice(0, 255);
}

function serviceDescription(row) {
  const fallback = row.category === 'Aircon'
    ? 'Supply and installation of Air Conditioning System'
    : 'Supply and installation of Heat Pump Hot Water System';
  let service = cleanText(row.productDescription || fallback, 1200);
  if (row.jobNo) {
    const escapedJob = row.jobNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    service = service.replace(new RegExp(`\\s*-\\s*Job\\s+${escapedJob}\\s*$`, 'i'), '').trim();
  }
  return service;
}

function paymentLabelService(row) {
  const service = serviceDescription(row);
  return service ? `${service.charAt(0).toLowerCase()}${service.slice(1)}` : service;
}

export function makeInvoiceDescription(row) {
  if (row.category === 'Smoke Alarm' && !row.jobNo) {
    const [year, month, day] = row.settlementDate.split('-');
    const service = row.productDescription || 'Supply and installation of smoke alarms';
    return `${service} - batch ${day}/${month}/${year}`.slice(0, 4000);
  }
  const service = serviceDescription(row);
  return `${service} - Job ${row.jobNo}`.slice(0, 4000);
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
      invoiceTotal: parseOptionalAmount(rowValue(source, FIELD_ALIASES.invoiceTotal)),
      accountCode: rule.accountCode,
      division: rule.division,
      taxType: rule.taxType,
      taxRate: rule.taxRate,
      productDescription: cleanText(rowValue(source, FIELD_ALIASES.productDescription), 1200),
      pdfFilename: cleanText(rowValue(source, FIELD_ALIASES.pdfFilename), 180),
    };

    if (!row.customerName) throw new Error('Customer Name is required');
    if (!validEmail(row.customerEmail)) throw new Error('Customer Email is invalid');
    if (!row.bpointRef) throw new Error('BPOINT Ref is required');
    if (!row.transactionNumber && !row.receiptNumber) throw new Error('Transaction Number or Receipt Number is required');
    if (row.transactionNumber && row.bpointRef === row.transactionNumber) {
      throw new Error('BPOINT Ref must be the CRN1/reference from tracker column D, not the transaction number');
    }
    if (category !== 'Smoke Alarm' && !row.jobNo) throw new Error('Job No is required for HWS and Aircon');

    const suppliedAccount = cleanText(rowValue(source, FIELD_ALIASES.accountCode), 80).match(/^\d+/)?.[0] || '';
    const suppliedDivision = cleanText(rowValue(source, FIELD_ALIASES.division), 100);
    const suppliedTax = cleanText(rowValue(source, FIELD_ALIASES.taxRate), 100);
    if (suppliedAccount && suppliedAccount !== row.accountCode) throw new Error(`Account must be ${row.accountCode} for ${category}`);
    if (suppliedDivision && suppliedDivision.toLowerCase() !== row.division.toLowerCase()) throw new Error(`Division must be ${row.division} for ${category}`);
    if (suppliedTax && suppliedTax.toLowerCase() !== row.taxRate.toLowerCase()) throw new Error(`Tax Rate must be ${row.taxRate}`);

    row.invoiceReference = makeInvoiceReference(row);
    row.description = makeInvoiceDescription(row);
    row.invoiceLines = buildInvoiceLineItems(row);
    row.contactKey = sha256Hex(`${row.customerEmail}|${row.customerName.toLowerCase()}|${row.customerMobile.replace(/\D/g, '')}`);
    row.rowKey = sha256Hex(`${row.invoiceReference}|${row.bpointRef}|${row.amount}|${row.paymentDate}|${row.invoiceTotal || ''}`);
    return row;
  } catch (error) {
    throw new Error(`Row ${rowNumber}: ${error.message}`);
  }
}

export function validateBatchRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('The invoice batch is empty');
  if (rows.length > MAX_BATCH_ROWS) throw new Error(`A batch can contain no more than ${MAX_BATCH_ROWS} payments`);
  const normalised = rows.map((row, index) => normaliseBatchRow(row, index + 2));
  const paymentKeys = new Set();
  for (const row of normalised) {
    const paymentKey = row.transactionNumber ? `TXN|${row.transactionNumber}` : `RECEIPT|${row.receiptNumber}`;
    if (paymentKeys.has(paymentKey)) throw new Error(`Row ${row.rowNumber}: duplicate BPOINT payment ${row.transactionNumber || row.receiptNumber}`);
    paymentKeys.add(paymentKey);
  }
  return groupInvoiceRows(normalised);
}

function mergeField(current, incoming, label, rowNumber) {
  if (!current) return incoming;
  if (!incoming) return current;
  if (normaliseName(current) !== normaliseName(incoming)) {
    throw new Error(`Row ${rowNumber}: ${label} conflicts with another payment for this job`);
  }
  return current;
}

function uniqueValues(values) {
  return [...new Set(values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => cleanText(value))
    .filter(Boolean))];
}

function paymentFromRow(row) {
  return {
    bpointRef: row.bpointRef,
    receiptNumber: row.receiptNumber,
    transactionNumber: row.transactionNumber,
    paymentDate: row.paymentDate,
    settlementDate: row.settlementDate,
    amount: row.amount,
    pdfFilename: row.pdfFilename,
  };
}

function orderedPayments(row) {
  return [...(row.payments || [paymentFromRow(row)])].sort((left, right) => {
    const byDate = String(left.paymentDate).localeCompare(String(right.paymentDate));
    if (byDate) return byDate;
    const byTransaction = String(left.transactionNumber || '').localeCompare(String(right.transactionNumber || ''), undefined, { numeric: true });
    if (byTransaction) return byTransaction;
    return String(left.receiptNumber || '').localeCompare(String(right.receiptNumber || ''), undefined, { numeric: true });
  });
}

function explicitDepositNumber(row) {
  const match = String(row.jobNo || '').match(/\(\s*Deposit\s+(\d+)\s*\)/i);
  return match ? Number(match[1]) : null;
}

export function buildInvoiceLineItems(row) {
  const baseLine = (description, unitAmount) => ({
    description: description.slice(0, 4000),
    quantity: 1,
    unitAmount: money(unitAmount),
    accountCode: row.accountCode,
    taxType: row.taxType,
    tracking: [{ name: DIVISION_TRACKING_CATEGORY, option: row.division }],
  });

  if (row.category === 'Smoke Alarm' && !row.jobNo) {
    return [baseLine(row.description || makeInvoiceDescription(row), row.invoiceTotal || row.amount)];
  }

  const payments = orderedPayments(row);
  const paymentTotal = money(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
  const finalTotal = row.invoiceTotal ? money(row.invoiceTotal) : null;
  const balance = finalTotal === null ? 0 : money(finalTotal - paymentTotal);
  const startingDeposit = explicitDepositNumber(row) || 1;
  const explicitDeposit = explicitDepositNumber(row) !== null;
  const service = paymentLabelService(row);
  const lines = payments.map((payment, index) => {
    const isFinalPaidLine = !explicitDeposit && finalTotal !== null && balance === 0 && index === payments.length - 1;
    const label = isFinalPaidLine ? 'Final payment' : `Deposit ${startingDeposit + index}`;
    return baseLine(`${label} towards ${service} - Job ${row.jobNo}`, payment.amount);
  });

  if (balance > 0) {
    lines.push(baseLine(`Final payment towards ${service} - Job ${row.jobNo}`, balance));
  }
  return lines;
}

export function setInvoiceLineDescriptions(row, descriptions = []) {
  const generated = buildInvoiceLineItems(row);
  const supplied = Array.isArray(descriptions) ? descriptions : [];
  return {
    ...row,
    invoiceLines: generated.map((line, index) => {
      const description = cleanText(supplied[index] || line.description, 4000);
      if (!description) throw new Error(`Invoice line ${index + 1} description is required`);
      return { ...line, description };
    }),
  };
}

function finaliseInvoiceRow(row) {
  const payments = row.payments || [paymentFromRow(row)];
  const totalPayments = money(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
  const invoiceTotal = row.category === 'Smoke Alarm' && !row.jobNo ? totalPayments : row.invoiceTotal;
  const result = {
    ...row,
    payments,
    amount: totalPayments,
    invoiceTotal,
    bpointRef: uniqueValues(payments.map((payment) => payment.bpointRef)).join(', '),
    receiptNumber: uniqueValues(payments.map((payment) => payment.receiptNumber)).join(', '),
    transactionNumber: uniqueValues(payments.map((payment) => payment.transactionNumber)).join(', '),
    paymentDate: payments.map((payment) => payment.paymentDate).sort()[0],
    settlementDate: payments.map((payment) => payment.settlementDate).sort()[0],
    pdfFilename: uniqueValues(payments.map((payment) => payment.pdfFilename)).join(', '),
  };
  result.invoiceReference = makeInvoiceReference(result);
  result.description = makeInvoiceDescription(result);
  result.invoiceLines = buildInvoiceLineItems(result);
  result.contactKey = sha256Hex(`${result.customerEmail}|${result.customerName.toLowerCase()}|${result.customerMobile.replace(/\D/g, '')}`);
  result.rowKey = sha256Hex(`${result.invoiceReference}|${result.transactionNumber}|${result.amount}|${result.invoiceTotal || ''}`);
  return result;
}

export function groupInvoiceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.category === 'Smoke Alarm' && !row.jobNo
      ? `SMOKE|${row.settlementDate}`
      : `JOB|${row.jobNo}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...row, payments: [paymentFromRow(row)], sourceRowNumbers: [row.rowNumber] });
      continue;
    }
    if (current.category !== row.category) throw new Error(`Row ${row.rowNumber}: Category conflicts with another payment for job ${row.jobNo}`);
    if (current.accountCode !== row.accountCode || current.division !== row.division) {
      throw new Error(`Row ${row.rowNumber}: Xero allocation conflicts with another payment for job ${row.jobNo}`);
    }
    current.customerName = mergeField(current.customerName, row.customerName, 'Customer Name', row.rowNumber);
    current.customerEmail = mergeField(current.customerEmail, row.customerEmail, 'Customer Email', row.rowNumber);
    current.customerMobile = mergeField(current.customerMobile, row.customerMobile, 'Customer Mobile', row.rowNumber);
    current.address = mergeField(current.address, row.address, 'Property Address', row.rowNumber);
    current.suburb = mergeField(current.suburb, row.suburb, 'Property Suburb', row.rowNumber);
    current.postcode = mergeField(current.postcode, row.postcode, 'Property Postcode', row.rowNumber);
    current.productDescription = mergeField(current.productDescription, row.productDescription, 'Product / Service Description', row.rowNumber);
    if (current.invoiceTotal && row.invoiceTotal && current.invoiceTotal !== row.invoiceTotal) {
      throw new Error(`Row ${row.rowNumber}: Final Invoice Amount conflicts with another payment for job ${row.jobNo}`);
    }
    current.invoiceTotal ||= row.invoiceTotal;
    current.payments.push(paymentFromRow(row));
    current.sourceRowNumbers.push(row.rowNumber);
  }
  return [...groups.values()].map(finaliseInvoiceRow);
}

export function setInvoiceTotal(row, value) {
  if (row.category === 'Smoke Alarm' && !row.jobNo) return finaliseInvoiceRow(row);
  const invoiceTotal = parseAmount(value);
  if (invoiceTotal < row.amount) {
    throw new Error(`Final invoice amount for Job ${row.jobNo} cannot be less than payments in this upload ($${money(row.amount).toFixed(2)})`);
  }
  return finaliseInvoiceRow({ ...row, invoiceTotal });
}

function proofPayload(row) {
  return JSON.stringify([
    row.rowKey, row.jobNo, row.customerName, row.customerEmail, row.customerMobile,
    row.address, row.suburb, row.postcode, row.category, row.bpointRef,
    row.receiptNumber, row.transactionNumber, row.paymentDate, row.settlementDate,
    row.productDescription, row.description, money(row.amount), row.invoiceTotal === null ? null : money(row.invoiceTotal), row.accountCode,
    row.division, row.taxType, row.invoiceReference,
    (row.payments || []).map((payment) => [payment.bpointRef, payment.receiptNumber, payment.transactionNumber, payment.paymentDate, payment.settlementDate, money(payment.amount)]),
    (row.invoiceLines || []).map((line) => [line.description, money(line.unitAmount)]),
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
    if (exactEmail.length === 1) {
      const contact = exactEmail[0];
      return {
        action: 'match',
        contact,
        matchedBy: 'email',
        updateRequired: Object.keys(buildContactUpdate(contact, row)).length > 0,
      };
    }
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
    if (sameEmail || samePhone || bothWithoutEmail) {
      return {
        action: 'match',
        contact,
        matchedBy: sameEmail ? 'email' : samePhone ? 'phone' : 'name',
        updateRequired: Object.keys(buildContactUpdate(contact, row)).length > 0,
      };
    }
    throw new Error(`Xero already has ${row.customerName}, but the email or phone does not match`);
  }
  return { action: 'create', contact: null, matchedBy: null, updateRequired: false };
}

function buildStreetAddress(row) {
  return {
    addressType: 'STREET',
    addressLine1: row.address || undefined,
    city: row.suburb || undefined,
    postalCode: row.postcode || undefined,
    country: 'Australia',
  };
}

function writablePhone(phone) {
  return {
    phoneType: phone.phoneType,
    phoneNumber: phone.phoneNumber,
    phoneAreaCode: phone.phoneAreaCode,
    phoneCountryCode: phone.phoneCountryCode,
  };
}

function writableAddress(address) {
  return {
    addressType: address.addressType,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    addressLine3: address.addressLine3,
    addressLine4: address.addressLine4,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
    attentionTo: address.attentionTo,
  };
}

export function buildContact(row) {
  const contact = {
    name: row.customerName,
    contactNumber: `GS-${row.contactKey.slice(0, 16).toUpperCase()}`,
  };
  if (row.customerEmail) contact.emailAddress = row.customerEmail;
  if (row.customerMobile) contact.phones = [{ phoneType: 'MOBILE', phoneNumber: row.customerMobile }];
  if (row.address || row.suburb || row.postcode) {
    contact.addresses = [buildStreetAddress(row)];
  }
  return contact;
}

export function buildContactUpdate(contact, row) {
  const update = {};
  if (row.customerEmail && !normaliseEmail(contact.emailAddress)) update.emailAddress = row.customerEmail;

  const existingPhones = (contact.phones || []).map(writablePhone);
  const hasMobile = existingPhones.some((phone) =>
    String(phone.phoneType || '').toUpperCase() === 'MOBILE' && normalisePhone(phone.phoneNumber));
  if (row.customerMobile && !hasMobile) {
    update.phones = [...existingPhones, { phoneType: 'MOBILE', phoneNumber: row.customerMobile }];
  }

  if (row.address || row.suburb || row.postcode) {
    const existingAddresses = (contact.addresses || []).map(writableAddress);
    const streetIndex = existingAddresses.findIndex((address) => String(address.addressType || '').toUpperCase() === 'STREET');
    if (streetIndex === -1) {
      update.addresses = [...existingAddresses, buildStreetAddress(row)];
    } else {
      const current = existingAddresses[streetIndex];
      const completed = {
        ...current,
        addressLine1: current.addressLine1 || row.address || undefined,
        city: current.city || row.suburb || undefined,
        postalCode: current.postalCode || row.postcode || undefined,
        country: current.country || 'Australia',
      };
      if (JSON.stringify(completed) !== JSON.stringify(current)) {
        update.addresses = existingAddresses.map((address, index) => index === streetIndex ? completed : address);
      }
    }
  }
  return update;
}

export async function findOrCreateContact(client, row, plannedContact = null) {
  const plan = plannedContact || await findContactPlan(client, row);
  if (plan.action === 'match') {
    const update = buildContactUpdate(plan.contact, row);
    if (!Object.keys(update).length) {
      return { contact: plan.contact, created: false, updated: false, matchedBy: plan.matchedBy };
    }
    const idempotencyKey = `goldsure-bpoint-contact-update-${row.contactKey}`.slice(0, 128);
    const response = await client.accountingApi.updateContact(
      '',
      plan.contact.contactID,
      { contacts: [{ contactID: plan.contact.contactID, ...update }] },
      idempotencyKey,
    );
    const updated = response.body.contacts?.[0];
    if (!updated?.contactID) {
      const detail = (updated?.validationErrors || []).map((error) => error.message).filter(Boolean).join('; ');
      throw new Error(detail || `Xero did not update contact ${row.customerName}`);
    }
    return { contact: updated, created: false, updated: true, matchedBy: plan.matchedBy };
  }
  const idempotencyKey = `goldsure-bpoint-contact-${row.contactKey}`.slice(0, 128);
  const response = await client.accountingApi.createContacts('', { contacts: [buildContact(row)] }, false, idempotencyKey);
  const created = response.body.contacts?.[0];
  if (!created?.contactID) {
    const detail = (created?.validationErrors || []).map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(detail || `Xero did not create contact ${row.customerName}`);
  }
  return { contact: created, created: true, updated: false, matchedBy: null };
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

export async function findInvoiceForRow(client, row) {
  if (row.category === 'Smoke Alarm' && !row.jobNo) return findInvoiceByReference(client, row.invoiceReference);
  const jobReference = `JOB ${row.jobNo}`;
  const response = await client.accountingApi.getInvoices(
    '', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    1, false, undefined, 4, true, 100, jobReference,
  );
  const bpointPrefix = `${jobReference} - BPOINT `;
  const matches = (response.body.invoices || []).filter((invoice) => {
    const reference = cleanText(invoice.reference);
    return reference === jobReference || reference.startsWith(bpointPrefix);
  });
  if (matches.length > 1) {
    throw new Error(`Job ${row.jobNo} already has multiple Xero invoices; review them before creating another invoice`);
  }
  return matches[0] || null;
}

export function buildApprovedInvoice(row, contactId) {
  if (!contactId) throw new Error('Xero contact ID is missing');
  if (!row.invoiceTotal) throw new Error(`Enter the final invoice amount for Job ${row.jobNo}`);
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
    lineItems: setInvoiceLineDescriptions(row, row.invoiceLines?.map((line) => line.description)).invoiceLines,
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
    const invoice = await findInvoiceForRow(client, row);
    const preparedRow = invoice && !row.invoiceTotal ? setInvoiceTotal(row, Number(invoice.total)) : row;
    if (invoice && preparedRow.invoiceTotal && Math.abs(Number(invoice.total) - preparedRow.invoiceTotal) > 0.005) {
      throw new Error(`${row.invoiceReference} already exists in Xero with a different total`);
    }
    plans.push({
      ...preparedRow,
      contactAction: contactPlan.action,
      contactMatchedBy: contactPlan.matchedBy,
      contactUpdateRequired: contactPlan.updateRequired,
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
  if (!row.invoiceTotal) throw new Error(`Enter the final invoice amount for Job ${row.jobNo}`);
  const existing = await findInvoiceForRow(client, row);
  if (existing) {
    if (Math.abs(Number(existing.total) - row.invoiceTotal) > 0.005) throw new Error(`${row.invoiceReference} already exists with a different total`);
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
    total: created.total ?? row.invoiceTotal,
    recoveredExisting: false,
    contactCreated: contactResult.created,
    contactUpdated: contactResult.updated,
    contactName: contactResult.contact.name || row.customerName,
  };
}

export { createXeroClient };
