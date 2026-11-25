import { sendHostingerMail } from './hostinger-mail.js';
import { sendResendMail } from './resend-mail.js';
import { isValidQuoteToken } from './smoke-stripe.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildBookingFeeReminder(quote) {
  const url = 'https://portal.goldsure.com.au/accept-quote.html?token=' + encodeURIComponent(quote.quote_token);
  const subject = 'Your Goldsure quote is accepted | $33 booking fee pending';
  const text = `Hi ${quote.customer_name || 'there'},

Thank you for accepting your Goldsure smoke alarm quote.

Your $33 booking fee is still pending. Please complete payment so we can secure your booking and arrange your installation.

Pay $33 Booking Fee: ${url}

If you would prefer to pay over the phone, please call us on (07) 2145 5155 and our team will assist.

Kind regards,
Goldsure Team`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#141c2e"><table role="presentation" style="max-width:560px;margin:32px auto;background:#fff;width:100%;border-collapse:collapse"><tr><td style="background:#111;color:#b08d2e;padding:24px;font-size:24px;font-weight:bold">Goldsure</td></tr><tr><td style="padding:28px;line-height:1.7"><h2 style="margin-top:0">Your booking fee is pending</h2><p>Hi ${esc(quote.customer_name || 'there')},</p><p>Thank you for accepting your Goldsure smoke alarm quote.</p><p>Your <strong>$33 booking fee is still pending</strong>. Please complete payment so we can secure your booking and arrange your installation.</p><p style="margin:26px 0"><a href="${esc(url)}" style="display:inline-block;padding:14px 24px;border-radius:8px;background:#b08d2e;color:#111;text-decoration:none;font-weight:bold">Pay $33 Booking Fee</a></p><p>You can pay securely online, or call <a href="tel:0721455155">(07) 2145 5155</a> if you would prefer to pay over the phone.</p><p>Kind regards,<br>Goldsure Team</p></td></tr></table></body></html>`;
  return { subject, text, html };
}

export async function sendBookingFeeReminder(req, res) {
  const token = req.body?.token;
  if (!isValidQuoteToken(token)) return res.status(400).json({ error: 'Invalid quote link.' });
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!base || !key) return res.status(503).json({ error: 'Quote service is unavailable.' });
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const url = `${base}/rest/v1/quote_emails?quote_token=eq.${encodeURIComponent(token)}`;
  try {
    const response = await fetch(url + '&select=*&limit=1', { headers, cache: 'no-store' });
    if (!response.ok) throw new Error('Quote lookup failed');
    const [quote] = await response.json();
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (!quote.accepted_at || ['rejected', 'expired', 'installed'].includes(String(quote.status || '').toLowerCase())) {
      return res.status(409).json({ error: 'Only an accepted, unpaid quote can receive a booking fee reminder.' });
    }
    if (quote.booking_fee_paid_at) return res.status(409).json({ error: 'The booking fee is already recorded as paid. No reminder was sent.', already_paid: true });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(quote.customer_email || '')) return res.status(400).json({ error: 'This quote has no valid customer email.' });
    if (Date.now() - Date.parse(quote.last_reminder_sent_at) < 60000) return res.status(429).json({ error: 'A reminder was just sent. Please wait one minute before sending another.' });
    const mail = { to: [quote.customer_email], ...buildBookingFeeReminder(quote) };
    try { await sendHostingerMail({ ...mail, displayName: 'Goldsure Pty Ltd' }); }
    catch {
      await sendResendMail({ ...mail, from: 'Goldsure Pty Ltd <info@goldsure.com.au>', replyTo: 'info@goldsure.com.au' });
    }
    // Keep the existing tracker reminder history current. A logging failure
    // must not report a successful email as failed and encourage another send.
    let warning = null;
    try {
      const saved = await fetch(url, { method: 'PATCH', headers,
        body: JSON.stringify({ last_reminder_sent_at: new Date().toISOString(), reminder_count: (Number(quote.reminder_count) || 0) + 1 }) });
      if (!saved.ok) warning = 'Email sent, but reminder history could not be updated.';
    } catch { warning = 'Email sent, but reminder history could not be updated.'; }
    return res.status(200).json({ success: true, warning });
  } catch (error) {
    console.error('[Booking fee reminder]', error.message);
    return res.status(502).json({ error: 'We could not send the booking fee reminder. Please try again.' });
  }
}
