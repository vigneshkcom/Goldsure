export const cents = value => Math.round((Number(value) + Number.EPSILON) * 100);
export function calculateDocument(data) {
  const lines = data.items.map(item => Math.round(Number(item.quantity || 0) * cents(item.rate || 0)));
  const subtotal = lines.reduce((sum, value) => sum + value, 0);
  const gst = Math.round(subtotal / 10);
  const stc = cents(data.stcDiscount || 0);
  const veec = cents(data.veecDiscount || 0);
  const solar = cents(data.solar || 0);
  const grandTotal = subtotal + gst - stc - veec - solar;
  const payments = data.type === 'quote' ? 0 : cents(data.payments || 0);
  return { lines, subtotal, gst, total: subtotal + gst, stc, veec, solar, grandTotal, payments, due: grandTotal - payments };
}
export function validateDraft(data) {
  if (!data || data.version !== 1 || !['invoice', 'quote'].includes(data.type) || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50) throw new Error('Choose a Goldsure HWS document saved by this generator.');
  for (const field of ['number', 'date', 'customer', 'address']) {
    if (typeof data[field] !== 'string' || data[field].length > 10000) throw new Error('Invalid document details.');
  }
  const check = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000000;
  data.deposit ??= 0;
  data.email ??= '';
  if (!check(data.deposit) || typeof data.email !== 'string' || data.email.length > 254) throw new Error('Invalid deposit or customer email.');
  // Reopen drafts made by the initial quantity/rate version as final amounts.
  for (const [field, quantity, rate] of [['stcDiscount', 'stcQuantity', 'stcRate'], ['veecDiscount', 'veecQuantity', 'veecRate']]) {
    if (data[field] === undefined && check(data[quantity]) && check(data[rate])) data[field] = Math.round(data[quantity] * cents(data[rate])) / 100;
  }
  for (const field of ['stcDiscount', 'veecDiscount', 'solar', 'payments']) if (!check(data[field])) throw new Error('Invalid amount in document.');
  for (const item of data.items) if (!item || typeof item.description !== 'string' || item.description.length > 2000 || !check(item.quantity) || !check(item.rate)) throw new Error('Invalid item in document.');
  return data;
}
