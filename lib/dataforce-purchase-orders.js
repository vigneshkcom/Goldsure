import { calculateDataforceRevenue } from './dataforce-ghl-sync.js';

const RATE_CARD = Object.freeze({
  '3429': { key: 'booking', label: 'Booking fee', rateExGst: 30 },
  '3430': { key: 'hardwired', label: 'Hardwired smoke alarm', rateExGst: 13 },
  '3431': { key: 'battery', label: 'Battery-operated smoke alarm', rateExGst: 10 },
  '3434': { key: 'remote', label: 'Remote / controller', rateExGst: 10 },
});

// Products outside the four rate-card columns that the electrician is paid a
// fixed rate for, rather than "as invoiced". The customer is charged $131 for an
// inspection, but the electrician receives $60 ex GST ($66 inc GST) — listed on
// the PO as an additional payment, like the as-invoiced products.
const FIXED_RATE_EXTRAS = Object.freeze({
  '3437': { label: 'Inspection fee', rateExGst: 60 },
});

// Purchase orders are payable only after the electrician marks the appointment
// completed in the field. A generic Completed code/status is not sufficient.
export function isFieldCompletedAppointment(appointment) {
  return /^completed\s*-\s*field$/i.test(String(appointment?.completionStatusDescription || '').trim());
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '';
}

// Dataforce sometimes returns names as "Surname, First Middle" (e.g. company/trading
// name fields). Flip that to "First Middle Surname" for display; leave anything
// without a single comma (already "First Last", or a real trading name) untouched.
function personNameOrder(value) {
  const trimmed = String(value || '').trim();
  const match = trimmed.match(/^([^,]+),\s*(.+)$/);
  return match ? `${match[2]} ${match[1]}`.replace(/\s+/g, ' ').trim() : trimmed;
}

export function dataforceProductCode(line = {}) {
  const direct = firstValue(
    line.productId,
    line.productCode,
    line.code,
    line.itemCode,
    line.product?.productId,
    line.product?.id,
    line.product?.code,
  );
  const directMatch = String(direct || '').match(/\d+/);
  if (directMatch) return directMatch[0];
  const description = String(firstValue(
    line.productName,
    line.description,
    line.lineDescription,
    line.name,
    line.product?.name,
  ) || '');
  const descriptionMatch = description.match(/\[(\d+)\]/);
  return descriptionMatch ? descriptionMatch[1] : '';
}

export function dataforceProductName(line = {}) {
  const code = dataforceProductCode(line);
  const configured = RATE_CARD[code];
  return String(firstValue(
    line.productName,
    line.description,
    line.lineDescription,
    line.name,
    line.product?.name,
    configured?.label,
    code ? `Product ${code}` : 'Unmapped product',
  )).trim();
}

export function normalisePurchaseOrderLine(line = {}, gstRegistered = true) {
  const code = dataforceProductCode(line);
  const configured = RATE_CARD[code];
  const quantityValue = Number(firstValue(line.lineQty, line.quantity, line.qty, 1));
  const quantity = Number.isFinite(quantityValue) && quantityValue !== 0 ? quantityValue : 1;
  const fixedExtra = FIXED_RATE_EXTRAS[code];
  if (!configured && fixedExtra) {
    const subtotalExGst = Math.round(quantity * fixedExtra.rateExGst * 100) / 100;
    const gst = gstRegistered ? Math.round(subtotalExGst * 10) / 100 : 0;
    const payIncGst = Math.round((subtotalExGst + gst) * 100) / 100;
    return {
      code,
      name: fixedExtra.label,
      sourceName: dataforceProductName(line),
      quantity,
      // Listed on the PO as an additional payment, not in a rate-card column.
      payable: false,
      invoicePay: true,
      fixedRate: true,
      issue: '',
      invoiceTotalIncGst: payIncGst,
      payIncGst,
      rateExGst: fixedExtra.rateExGst,
      subtotalExGst,
      gst,
      totalIncGst: payIncGst,
    };
  }
  if (!configured) {
    // Products outside the rate card are paid to the electrician as invoiced:
    // the invoice line total (rate inc GST x quantity) is the amount, with GST
    // paid on top only when the electrician is GST registered — the same
    // treatment as the rate-card items.
    const rawInvoiceRate = firstValue(line.lineRateIncTax, line.rateIncTax);
    const invoiceRate = rawInvoiceRate === '' ? NaN : Number(rawInvoiceRate);
    const invoiceTotalIncGst = Number.isFinite(invoiceRate) ? Math.round(invoiceRate * quantity * 100) / 100 : null;
    if (invoiceTotalIncGst === null || invoiceTotalIncGst < 0) {
      return {
        code,
        name: dataforceProductName(line),
        quantity,
        payable: false,
        invoicePay: false,
        issue: 'This product has no rate-card price and no usable invoice amount.',
        rateExGst: 0,
        subtotalExGst: 0,
        gst: 0,
        totalIncGst: 0,
      };
    }
    const invoiceExGst = Math.round((invoiceTotalIncGst / 1.1) * 100) / 100;
    const payIncGst = gstRegistered ? invoiceTotalIncGst : invoiceExGst;
    return {
      code,
      name: dataforceProductName(line),
      quantity,
      // Not a rate-card item: it is listed on the PO as an additional payment
      // rather than in a job's rate-card columns.
      payable: false,
      invoicePay: true,
      issue: '',
      invoiceTotalIncGst,
      payIncGst,
      rateExGst: 0,
      subtotalExGst: 0,
      gst: 0,
      totalIncGst: 0,
    };
  }
  const subtotalExGst = Math.round(quantity * configured.rateExGst * 100) / 100;
  const gst = gstRegistered ? Math.round(subtotalExGst * 10) / 100 : 0;
  return {
    code,
    key: configured.key,
    name: configured.label,
    sourceName: dataforceProductName(line),
    quantity,
    payable: true,
    issue: '',
    rateExGst: configured.rateExGst,
    subtotalExGst,
    gst,
    totalIncGst: Math.round((subtotalExGst + gst) * 100) / 100,
  };
}

function moneyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function dataforceTransactionBalance(document = {}) {
  const containers = [
    document,
    document.summary,
    document.totals,
    document.invoice,
    document.transactionSummary,
  ].filter(value => value && typeof value === 'object');
  const keys = [
    'transactionBalance',
    'balance',
    'balanceDue',
    'invoiceBalance',
    'amountOutstanding',
    'outstandingBalance',
    'totalOutstanding',
    'remainingBalance',
    'amountDue',
  ];
  for (const container of containers) {
    for (const key of keys) {
      const parsed = moneyNumber(container[key]);
      if (parsed !== null) return Math.round(parsed * 100) / 100;
    }
  }
  return null;
}

// Dataforce does not always return an outstanding balance for an invoice. For
// a cash-tagged job the customer pays the electrician on the day, so fall back
// to the amount the customer owes on the invoice or quote (product lines less
// discounts and rebates). It is only an estimate: any deposit already taken is
// unknown here, which is why the PO page marks it and leaves it editable.
export function dataforceEstimatedBalance(document = {}) {
  const revenue = calculateDataforceRevenue(document);
  if (!revenue.confident) return null;
  const owed = revenue.customerAmountAfterRebates ?? revenue.revenue;
  return Number.isFinite(owed) && owed > 0 ? Math.round(owed * 100) / 100 : null;
}

export function dataforcePaymentFlag(tags = []) {
  const names = (Array.isArray(tags) ? tags : [])
    .map(tag => String(tag?.tagName || tag?.name || tag || '').trim())
    .filter(Boolean);
  const cashTag = names.find(name => /\bcash\b/i.test(name));
  if (cashTag) return { type: 'cash', label: cashTag };
  const bankTag = names.find(name => /\bbank\s*transfer\b|\beft\b/i.test(name));
  if (bankTag) return { type: 'bank-transfer', label: bankTag };
  return { type: '', label: '' };
}

// Jobs are paid by week (Monday to Sunday); any date snaps to the Sunday that ends its week.
export function purchaseOrderWeekEnding(date) {
  const match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const sunday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(sunday.getTime())) return '';
  sunday.setUTCDate(sunday.getUTCDate() + (7 - sunday.getUTCDay()) % 7);
  return sunday.toISOString().slice(0, 10);
}

// Payable on the Friday twelve days after the week-ending Sunday.
export function purchaseOrderPayableDate(date) {
  const weekEnding = purchaseOrderWeekEnding(date);
  if (!weekEnding) return '';
  const payable = new Date(`${weekEnding}T00:00:00Z`);
  payable.setUTCDate(payable.getUTCDate() + 12);
  return `${String(payable.getUTCDate()).padStart(2, '0')}/${String(payable.getUTCMonth() + 1).padStart(2, '0')}/${payable.getUTCFullYear()}`;
}

export function normaliseFieldworker(worker = {}) {
  const id = Number(firstValue(worker.fieldworkerId, worker.id, worker.workerId));
  const personalName = [worker.firstname || worker.firstName, worker.surname || worker.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const companyName = personNameOrder(firstValue(worker.companyName, worker.businessName, worker.tradingName, ''));
  const name = personNameOrder(String(firstValue(
    worker.displayName,
    worker.fieldworkerName,
    worker.name,
    personalName,
    companyName,
    Number.isFinite(id) ? `Electrician ${id}` : 'Electrician',
  )).trim());
  const gstValue = firstValue(worker.gstRegistered, worker.isGstRegistered, worker.GSTRegistered);
  return {
    id: Number.isFinite(id) ? id : null,
    name,
    firstName: String(firstValue(worker.firstname, worker.firstName, '')).trim(),
    companyName: companyName || name,
    email: String(firstValue(worker.email, worker.emailAddress, worker.workEmail, '')).trim().toLowerCase(),
    phone: String(firstValue(worker.mobilePhone, worker.mobile, worker.phone, worker.homePhone, '')).trim(),
    taxId: String(firstValue(worker.taxId, worker.abn, worker.ABN, '')).trim(),
    gstRegistered: gstValue === true || String(gstValue).toLowerCase() === 'true' || String(gstValue) === '1',
  };
}

export function purchaseOrderRateCard() {
  return Object.entries(RATE_CARD).map(([code, rate]) => ({ code, ...rate }));
}
