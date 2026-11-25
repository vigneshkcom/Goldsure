/* Shared booking-fee actions for the smoke alarm tracker and SMS inbox. */
window.GoldsureBookingFee = (() => {
  const received = q => Boolean(q.booking_fee_paid_at && Number.isFinite(Date.parse(q.booking_fee_paid_at)) && Number(q.booking_fee_amount) === 33);
  const eligible = q => Boolean(q.accepted_at && q.quote_token && !q.booking_fee_paid_at && !['rejected', 'expired', 'installed'].includes(String(q.status || '').toLowerCase()));
  const url = q => 'https://portal.goldsure.com.au/accept-quote.html?token=' + encodeURIComponent(q.quote_token);
  const sms = q => `Hi ${q.customer_name || 'there'}, thank you for accepting your Goldsure smoke alarm quote. Your $33 booking fee is pending. Please pay securely online so we can secure your booking: ${url(q)} Or call (07) 2145 5155 for assistance. Goldsure Pty Ltd`;
  async function copy(q) {
    try { await navigator.clipboard.writeText(url(q)); }
    catch { window.prompt('Copy this booking fee payment link:', url(q)); }
  }
  async function email(q) {
    const response = await fetch('/api/smoke-alarms/quotes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send-booking-reminder', token: q.quote_token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not send the booking fee reminder.');
    return data;
  }
  return { received, eligible, url, sms, copy, email };
})();
