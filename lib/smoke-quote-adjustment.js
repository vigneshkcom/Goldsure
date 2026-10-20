// Prices for additional alarms come from the saved quote, never the browser.
export function adjustSmokeQuote(quote, requestedQty = quote.alarm_qty) {
  const originalQty = Number(quote.alarm_qty) || 0;
  const qty = Number(requestedQty);
  if (!Number.isInteger(qty) || qty < originalQty || qty > Math.max(100, originalQty)) {
    throw new Error('Choose a whole number of alarms between your original quantity and 100.');
  }
  if (quote.service_type !== 'Installation Quote' && qty !== originalQty) {
    throw new Error('Additional alarms are only available on installation quotes.');
  }
  const additional = qty - originalQty;
  const unitPrice = Number(quote.alarm_unit_price) > 98.005 ? 109 : 98;
  const originalTotal = Number(quote.grand_total_numeric ?? quote.grand_total);
  if (!Number.isFinite(originalTotal) || originalTotal < 0) throw new Error('This quote needs a pricing review. Please contact Goldsure.');
  const total = Math.round((originalTotal + additional * unitPrice) * 100) / 100;
  return {
    alarm_qty: qty,
    alarm_total: Math.round(((Number(quote.alarm_total) || originalQty * unitPrice) + additional * unitPrice) * 100) / 100,
    grand_total: total,
    grand_total_numeric: total,
  };
}
