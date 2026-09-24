const RATE_CARD = Object.freeze({
  '3429': { key: 'booking', label: 'Booking fee', rateExGst: 30 },
  '3430': { key: 'hardwired', label: 'Hardwired smoke alarm', rateExGst: 13 },
  '3431': { key: 'battery', label: 'Battery-operated smoke alarm', rateExGst: 10 },
  '3434': { key: 'remote', label: 'Remote / controller', rateExGst: 10 },
});

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== '') ?? '';
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
  if (!configured) {
    return {
      code,
      name: dataforceProductName(line),
      quantity,
      payable: false,
      issue: 'No electrician purchase-order rate is configured for this product.',
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

export function purchaseOrderPayableDate(endDate) {
  const match = String(endDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(date.getTime())) return '';
  let daysToNextFriday = (5 - date.getDay() + 7) % 7;
  if (daysToNextFriday === 0) daysToNextFriday = 7;
  date.setDate(date.getDate() + daysToNextFriday + 7);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

export function normaliseFieldworker(worker = {}) {
  const id = Number(firstValue(worker.fieldworkerId, worker.id, worker.workerId));
  const personalName = [worker.firstname || worker.firstName, worker.surname || worker.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const companyName = String(firstValue(worker.companyName, worker.businessName, worker.tradingName, '')).trim();
  const name = String(firstValue(
    worker.displayName,
    worker.fieldworkerName,
    worker.name,
    personalName,
    companyName,
    Number.isFinite(id) ? `Electrician ${id}` : 'Electrician',
  )).trim();
  const gstValue = firstValue(worker.gstRegistered, worker.isGstRegistered, worker.GSTRegistered);
  return {
    id: Number.isFinite(id) ? id : null,
    name,
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
