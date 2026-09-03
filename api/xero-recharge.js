import { timingSafeEqual } from 'node:crypto';
import {
  MAX_PDF_BYTES,
  XERO_SCOPES,
  attachReceipt,
  createOrFindDraft,
  createXeroClient,
  getConnectionDetails,
  parseReceiptPdf,
  signReceipt,
  validateReceipts,
  verifyReceiptProof,
} from '../lib/xero-recharge.mjs';

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

function portalPassword() {
  return String(process.env.XERO_PORTAL_PASSWORD || process.env.DASHBOARD_PASSWORD || '').trim();
}

function signingSecret() {
  return String(process.env.XERO_RECEIPT_SIGNING_SECRET || process.env.XERO_CLIENT_SECRET || portalPassword()).trim();
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

function passwordMatches(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function decodePdf(fileBase64) {
  if (typeof fileBase64 !== 'string' || !fileBase64.length) throw new Error('PDF data is missing');
  const buffer = Buffer.from(fileBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_PDF_BYTES) throw new Error('Each PDF must be smaller than 2.5 MB');
  return buffer;
}

function assertProofs(receipts, secret) {
  validateReceipts(receipts);
  for (const receipt of receipts) {
    if (!verifyReceiptProof(receipt, receipt.proof, secret)) throw new Error(`Receipt verification failed for ${receipt.invoiceNumber}`);
  }
}

function publicError(error) {
  const xeroData = error?.response?.data || error?.body;
  const first = xeroData?.Elements?.[0]?.ValidationErrors?.[0]?.Message
    || xeroData?.elements?.[0]?.validationErrors?.[0]?.message
    || xeroData?.Message
    || xeroData?.message;
  return String(first || error?.message || 'The request could not be completed').slice(0, 500);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin requests are not allowed' });

  const expectedPassword = portalPassword();
  if (!expectedPassword) return res.status(503).json({ error: 'Xero portal password is not configured in Vercel' });
  if (!passwordMatches(req.body?.password, expectedPassword)) return res.status(401).json({ error: 'Incorrect password' });

  const action = String(req.body?.action || '');
  const secret = signingSecret();

  try {
    if (action === 'status') {
      const configured = Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
      if (!configured) return res.status(200).json({ ok: true, configured: false, scopes: XERO_SCOPES });
      const client = await createXeroClient();
      const details = await getConnectionDetails(client);
      return res.status(200).json({ ok: true, configured: true, details, scopes: XERO_SCOPES });
    }

    if (action === 'parse') {
      const pdf = decodePdf(req.body?.fileBase64);
      const receipt = await parseReceiptPdf(pdf, String(req.body?.filename || 'invoice.pdf'));
      return res.status(200).json({ ok: true, receipt: { ...receipt, proof: signReceipt(receipt, secret) } });
    }

    if (action === 'create') {
      const receipts = req.body?.receipts;
      assertProofs(receipts, secret);
      const client = await createXeroClient();
      const invoice = await createOrFindDraft(client, receipts, String(req.body?.amountType || 'Inclusive'), Number(req.body?.dueDays || 14));
      return res.status(200).json({ ok: true, invoice });
    }

    if (action === 'attach') {
      const receipt = req.body?.receipt;
      assertProofs([receipt], secret);
      const pdf = decodePdf(req.body?.fileBase64);
      const client = await createXeroClient();
      const attachment = await attachReceipt(client, String(req.body?.invoiceId || ''), String(req.body?.filename || ''), pdf, receipt);
      return res.status(200).json({ ok: true, attachment });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('[xero-recharge]', action, publicError(error));
    return res.status(400).json({ error: publicError(error) });
  }
}
