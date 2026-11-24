// Only use received=true after verifying the Stripe event or stored payment.
export function hasReceivedBookingFee(quote) {
  return Boolean(quote?.booking_fee_paid_at &&
    Number.isFinite(Date.parse(quote.booking_fee_paid_at)) &&
    Number(quote.booking_fee_amount) === 33);
}

export function bookingFeeNotice({ received = false, payingOnline = false } = {}) {
  const title = received ? '$33 RECEIVED' : payingOnline ? 'PAYMENT PENDING' : 'BOOKING FEE NOT RECEIVED';
  const detail = received
    ? '$33.00 AUD booking fee confirmed by Stripe. Call the customer to arrange installation. Do not collect the booking fee again.'
    : payingOnline
      ? 'Online payment has not yet been confirmed at the time of this email. The customer may still be completing payment. Check the latest payment status in GoHighLevel or Stripe before collecting any booking fee.'
      : 'Call requested. Collect the $33.00 booking fee before confirming the booking.';
  const background = received ? '#dcfce7' : '#fff7ed';
  const color = received ? '#14532d' : '#9a3412';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:2px solid ${color};border-radius:8px;background:${background}"><tr><td style="padding:20px;background:${background};color:${color}"><p style="margin:0 0 8px;font-size:28px;line-height:1.2;font-weight:800;color:${color}">${title}</p><p style="margin:0;font-size:14px;line-height:1.6;color:${color}">${detail}</p></td></tr></table>`;
}
