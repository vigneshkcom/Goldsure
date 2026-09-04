import { timingSafeEqual } from 'node:crypto';
import {
  BPOINT_SCOPES,
  createOrFindApprovedInvoice,
  createXeroClient,
  previewRowsInXero,
  setInvoiceLineDescriptions,
  setInvoiceTotal,
  signBatchRow,
  validateBatchRows,
  verifyBatchRow,
} from '../lib/xero-bpoint.js';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

function portalPassword() {
  return String(process.env.XERO_PORTAL_PASSWORD || process.env.DASHBOARD_PASSWORD || '').trim();
}

function signingSecret() {
  return String(process.env.XERO_BPOINT_SIGNING_SECRET || process.env.XERO_CLIENT_SECRET || portalPassword()).trim();
}

function xeroConfigured() {
  return Boolean(String(process.env.XERO_CLIENT_ID || '').trim() && String(process.env.XERO_CLIENT_SECRET || '').trim());
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

function publicError(error) {
  const xeroData = error?.response?.data || error?.body;
  const first = xeroData?.Elements?.[0]?.ValidationErrors?.[0]?.Message
    || xeroData?.elements?.[0]?.validationErrors?.[0]?.message
    || xeroData?.Message
    || xeroData?.message;
  return String(first || error?.message || 'The request could not be completed').slice(0, 500);
}

function safePreview(row, secret) {
  const publicRow = { ...row };
  delete publicRow.contactKey;
  return { ...publicRow, proof: signBatchRow(row, secret) };
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
      return res.status(200).json({ ok: true, configured: xeroConfigured(), scopes: BPOINT_SCOPES });
    }

    if (action === 'preview') {
      const rows = validateBatchRows(req.body?.rows);
      if (!xeroConfigured()) {
        return res.status(200).json({
          ok: true,
          configured: false,
          rows: rows.map((row) => safePreview({ ...row, contactAction: 'pending' }, secret)),
          setup: null,
        });
      }
      const client = await createXeroClient();
      const preview = await previewRowsInXero(client, rows);
      return res.status(200).json({
        ok: true,
        configured: true,
        setup: preview.setup,
        rows: preview.rows.map((row) => safePreview(row, secret)),
      });
    }

    if (action === 'confirm-totals') {
      if (!xeroConfigured()) throw new Error('Xero Custom Connection is not configured yet');
      const invoices = req.body?.invoices;
      if (!Array.isArray(invoices) || !invoices.length || invoices.length > 50) {
        throw new Error('No invoice totals were supplied');
      }
      const rows = invoices.map((invoice, index) => {
        const supplied = invoice?.row;
        if (!supplied || !verifyBatchRow(supplied, supplied.proof, secret)) {
          throw new Error(`Invoice ${index + 1}: upload verification expired; upload the batch again`);
        }
        return setInvoiceLineDescriptions(
          setInvoiceTotal(supplied, invoice.invoiceTotal),
          invoice.lineDescriptions,
        );
      });
      const client = await createXeroClient();
      const preview = await previewRowsInXero(client, rows);
      return res.status(200).json({
        ok: true,
        configured: true,
        setup: preview.setup,
        rows: preview.rows.map((row) => safePreview(row, secret)),
      });
    }

    if (action === 'create') {
      if (!xeroConfigured()) throw new Error('Xero Custom Connection is not configured yet');
      const supplied = req.body?.row;
      if (!supplied || !verifyBatchRow(supplied, supplied?.proof, secret)) {
        throw new Error('Preview verification expired; check the final amounts again');
      }
      const row = setInvoiceLineDescriptions(
        setInvoiceTotal(supplied, supplied.invoiceTotal),
        supplied.invoiceLines?.map((line) => line.description),
      );
      const client = await createXeroClient();
      const invoice = await createOrFindApprovedInvoice(client, row);
      return res.status(200).json({ ok: true, invoice });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('[xero-bpoint]', action, publicError(error));
    return res.status(400).json({ error: publicError(error) });
  }
}
