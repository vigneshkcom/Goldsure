import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { calculateDocument, validateDraft, cents } from '../assets/hws-document-model.js';
import { buildHwsDocumentPdf } from './hws-document-pdf.js';
import { hasHostingerMailConfig, sendHostingerMail } from './hostinger-mail.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value / 100);
const bad = message => { throw new Error(message); };
export async function prepareHwsQuoteEmail(body) {
  const data = validateDraft(structuredClone(body.document));
  if (data.type !== 'quote') bad('Choose Quote to email a quotation or request a deposit.');
  if (!data.number.trim() || data.number.length > 80 || !data.customer.trim() || !data.address.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) bad('Complete the quote number, date, customer and address.');
  if (data.customer.length > 200 || data.address.length > 1000) bad('The customer name or address is too long.');
  const recipient = data.email.trim().toLowerCase();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient) || /[\r\n]/.test(recipient)) bad('Enter one valid customer email address.');
  const totals = calculateDocument(data);
  const deposit = cents(data.deposit);
  if (totals.grandTotal <= 0 || deposit > totals.grandTotal) bad('The deposit must not exceed the quote total. The quote total must be greater than zero.');
  const rows = data.items.map((item, index) => ({ ...item, total: totals.lines[index] })).filter(item => item.description.trim() || item.quantity || item.rate);
  if (!rows.length || rows.some(item => !item.description.trim() || item.quantity <= 0)) bad('Complete each quoted item description and quantity.');
  if (body.attachment) bad('Quote PDFs are now generated automatically. Refresh the builder before continuing.');
  const pdf = await buildHwsDocumentPdf(data);
  const attachment = { filename: `${data.number.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')}- Quote.pdf`, content: pdf.toString('base64'), contentType: 'application/pdf' };
  const [year, month, day] = data.date.split('-');
  const subject = `${data.number.trim()}- Quote${deposit ? ` | ${money(deposit)} deposit request` : ''}`;
  if (/[\r\n]/.test(subject)) bad('The quote number must be on one line.');
  const summary = [
    ['Subtotal (ex. GST)', totals.subtotal], ['GST (10%)', totals.gst], ['Total (inc. GST)', totals.total],
    ['Small-Scale Technology Certificate Discount', -totals.stc], ['Victorian Energy Efficiency Certificate Discount', -totals.veec],
    ['Solar Victoria Rebate', -totals.solar], ['Quoted total (inc. GST)', totals.grandTotal],
    ...(deposit ? [['Deposit requested', deposit], ['Balance after deposit payment', totals.grandTotal - deposit]] : [])
  ];
  const introduction = deposit
    ? `Please find your hot water system quotation below${attachment ? ' and attached' : ''}. To proceed, please pay a deposit of ${money(deposit)} using the banking details below. The deposit forms part of your quoted total and is not an additional charge. After this deposit is paid, the remaining balance will be ${money(totals.grandTotal - deposit)}.`
    : `Please find your hot water system quotation below${attachment ? ' and attached' : ''}. Please reply if you would like to proceed or have any questions.`;
  const banking = `Account name: Goldsure Pty Ltd\nBSB: 063 147\nAccount number: 10928147\nPayment reference: ${data.number.trim()}\nPlease send your remittance advice to accounts@goldsure.com.au once payment has been made.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f4;font:14px Arial,sans-serif;color:#111"><div style="max-width:700px;margin:24px auto;padding:32px;background:white;border-top:6px solid #ffcb08"><img src="https://portal.goldsure.com.au/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg" alt="Goldsure" width="210"><h1 style="font-size:26px">Your Hot Water Quotation</h1><p>Hi ${esc(data.customer)},</p><p style="line-height:1.7">${esc(introduction)}</p><p><b>Quote:</b> ${esc(data.number)}<br><b>Date:</b> ${day}/${month}/${year}<br><b>Installation address:</b> ${esc(data.address)}</p><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#111;color:white"><th align="left" style="padding:10px">Item</th><th>Qty</th><th>Rate (ex. GST)</th><th>Total (ex. GST)</th></tr></thead><tbody>${rows.map(item => `<tr><td style="padding:10px;border-bottom:1px solid #ddd">${esc(item.description)}</td><td align="right">${item.quantity}</td><td align="right">${money(cents(item.rate))}</td><td align="right">${money(item.total)}</td></tr>`).join('')}</tbody></table><table style="width:100%;margin:16px 0">${summary.map(([label, amount]) => `<tr><td style="padding:6px 0">${label}</td><td align="right" style="white-space:nowrap">${money(amount)}</td></tr>`).join('')}</table>${deposit ? `<div style="padding:18px;background:#fff3bd;border-radius:8px"><b>BANKING DETAILS</b><p style="line-height:1.7">${esc(banking).replace(/\n/g, '<br>')}</p></div>` : ''}<p>Kind regards,<br><b>Goldsure Customer Service Team</b><br>Goldsure Pty Ltd<br>goldsure.com.au · ABN 66 683 305 106</p></div></body></html>`;
  const text = `Hi ${data.customer},\n\n${introduction}\n\nQuote: ${data.number}\nDate: ${day}/${month}/${year}\nInstallation address: ${data.address}\n\n${rows.map(item => `${item.description} | Qty ${item.quantity} | ${money(cents(item.rate))} ex. GST | ${money(item.total)} ex. GST`).join('\n')}\n\n${summary.map(([label, amount]) => `${label}: ${money(amount)}`).join('\n')}\n\n${deposit ? banking + '\n\n' : ''}Kind regards,\nGoldsure Customer Service Team\nGoldsure Pty Ltd\ngoldsure.com.au · ABN 66 683 305 106`;
  return { to: [recipient], displayName: 'Goldsure Pty Ltd', subject, html, text, attachments: attachment ? [attachment] : [] };
}

export function createHwsDocumentEmailHandler({ env = process.env, mail = sendHostingerMail, configured = hasHostingerMailConfig, now = Date.now } = {}) {
  const attempted = new Map();
  const secret = () => env.HOSTINGER_MAIL_API_TOKEN || env.DASHBOARD_PASSWORD || '';
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const reviewHash = (message, body) => hash({ document: validateDraft(structuredClone(body.document)), message: { ...message, attachments: message.attachments.map(({ content, ...metadata }) => metadata) } });
  const sign = value => createHmac('sha256', secret()).update(value).digest('hex');
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return res.status(200).json({ configured: configured() && Boolean(secret()), sender: 'Goldsure’s connected Hostinger mailbox' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    if (!configured() || !secret()) return res.status(503).json({ error: 'Hostinger email is not configured.' });
    const origin = req.headers?.origin;
    if (!origin) return res.status(403).json({ error: 'Open this builder on the portal to preview and send email.' });
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
      if (host !== req.headers?.host) return res.status(403).json({ error: 'Open this builder on the portal to send email.' });
    }
    let message;
    try { message = await prepareHwsQuoteEmail(req.body || {}); } catch (error) { return res.status(400).json({ error: error.message }); }
    const body = req.body || {};
    if (body.action === 'preview') {
      const payload = `${now() + 10 * 60 * 1000}.${reviewHash(message, body)}`;
      return res.status(200).json({ to: message.to[0], subject: message.subject, html: message.html, attachment: message.attachments[0].filename, pdfContent: message.attachments[0].content, reviewToken: `${payload}.${sign(payload)}` });
    }
    if (body.action !== 'send') return res.status(400).json({ error: 'Choose preview or send.' });
    const parts = String(body.reviewToken || '').split('.');
    const payload = parts.slice(0, 2).join('.');
    const signature = Buffer.from(parts[2] || '');
    const expectedSignature = Buffer.from(sign(payload));
    if (parts.length !== 3 || Number(parts[0]) < now() || parts[1] !== reviewHash(message, body) || signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) return res.status(409).json({ error: 'Preview the current quote and deposit details again before sending.' });
    for (const [token, expires] of attempted) if (expires < now()) attempted.delete(token);
    if (attempted.has(body.reviewToken)) return res.status(409).json({ error: 'This email was already submitted. Check the Hostinger Sent folder before sending again.' });
    attempted.set(body.reviewToken, Number(parts[0]));
    try {
      await mail(message);
      return res.status(200).json({ accepted: true, recipient: message.to[0] });
    } catch {
      return res.status(502).json({ error: 'Email submission could not be confirmed. Check the Hostinger Sent folder before trying again.' });
    }
  };
}
