import { CertificateError, requestFields, signatureFields, signingToken, constantEqual, hash, OFFICE_EMAIL, CHECKS, DECLARATIONS } from './qld-certificate-model.js';
import { CertificateStore } from './qld-certificate-store.js';
import { certificatePdf } from './qld-certificate-pdf.js';
import { sendHostingerMail } from './hostinger-mail.js';

const ORIGIN = 'https://portal.goldsure.com.au';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const secretFor = env => {
  const secret = env.QLD_CERTIFICATE_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new CertificateError('Private signing links are not configured. Add a dedicated certificate signing secret of at least 32 random characters.', 503);
  return secret;
};
const pathFor = (id, kind) => `records/${id}/${kind}.json`;
const stamp = () => new Date().toISOString();
const safeRequest = record => { const { draftHash, ...safe } = record; return safe; };
function smsDraft(record, env) {
  const link = `${ORIGIN}/compliance/sign.html#${record.id}.${signingToken(record.id, secretFor(env))}`;
  const expiry = new Date(record.expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane', dateStyle: 'medium', timeStyle: 'short' });
  return { id: record.id, phone: record.electricianPhone || '', name: record.electricianName, message: `Hi ${record.electricianName}, please review and sign the Queensland compliance certificate for job ${record.jobNumber || record.id}: ${link}\nPlease check all prefilled details before signing. Link expires ${expiry} (QLD time). Do not forward it. Goldsure` };
}

export async function lookupJob(jobNumber, env = process.env, fetchImpl = fetch) {
  if (!/^\d{1,12}$/.test(String(jobNumber))) throw new CertificateError('Enter a numeric Dataforce job number.');
  if (!env.DATAFORCE_CLIENT_ID || !env.DATAFORCE_CLIENT_SECRET) throw new CertificateError('Dataforce is not configured.', 503);
  const auth = await fetchImpl('https://asap-api.dataforce.com.au/authorization/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${env.DATAFORCE_CLIENT_ID}:${env.DATAFORCE_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'appointment customer fieldworker job' }), signal: AbortSignal.timeout(10000) });
  const token = await auth.json();
  if (!auth.ok || !token.access_token) throw new CertificateError('Dataforce authentication failed.', 502);
  const get = async (path, init = {}) => {
    const response = await fetchImpl(`https://asap-api.dataforce.com.au/GOLDSURE_ASAP${path}`, { ...init, headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new CertificateError(response.status === 404 ? 'Dataforce job or customer was not found. You can enter details manually.' : 'Dataforce lookup failed. Please retry.', 502);
    return response.json();
  };
  const matches = await get('/jobs/search', { method: 'POST', body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'jobId', value: String(jobNumber), operator: 'EQ' }] }], limit: 2, after: 0 }) });
  const job = matches.records?.find(item => String(item.jobId) === String(jobNumber));
  if (!job) throw new CertificateError('No matching Dataforce job found. Check the number or enter details manually.', 404);
  if (!job.customerId) throw new CertificateError('The job has no customer reference. Enter the details manually.');
  const customer = await get(`/customers/id/${encodeURIComponent(job.customerId)}`);
  const state = String(customer.state || '').toUpperCase();
  if (state && state !== 'QLD' && state !== 'QUEENSLAND') throw new CertificateError(`This job is in ${state}, not Queensland.`);
  const address = [customer.unitNo ? `${customer.unitNo}/` : '', customer.streetNo, customer.streetName, customer.streetType, customer.suburb, customer.state, customer.postCode].filter(Boolean).join(' ').replace('/ ', '/');
  return { jobNumber: String(job.jobId || jobNumber), customerName: [customer.firstname, customer.surname].filter(Boolean).join(' '), customerEmail: customer.email || '', customerPhone: customer.mobilePhone || customer.mobile || customer.phone || '', customerAddress: address, siteAddress: address, state: 'QLD', source: 'Dataforce customer record. Confirm the installation address and commissioning party before sending.' };
}

// An immutable claim is written BEFORE a network send. Ambiguous outcomes are never
// retried automatically. This favours avoiding duplicate customer mail over guessing.
async function sendOnce(store, id, kind, mail, mailer) {
  const claimPath = pathFor(id, `${kind}-claim`), resultPath = pathFor(id, `${kind}-result`);
  if (!await store.put(claimPath, { at: stamp(), recipients: mail.to })) return await store.get(resultPath) || { status: 'unknown', message: 'Send was already attempted. Check the mailbox before retrying elsewhere.' };
  let outcome;
  try {
    await mailer({ ...mail, displayName: mail.displayName || 'Goldsure', signal: AbortSignal.timeout(15000) });
    outcome = { status: 'accepted', at: stamp(), message: 'Accepted by email service. Inbox delivery is not confirmed.' };
  } catch (error) {
    const rejected = Number(error.status) >= 400 && Number(error.status) < 500;
    outcome = { status: rejected ? 'rejected' : 'unknown', at: stamp(), message: rejected ? 'Email service rejected this message. Contact Goldsure to arrange delivery.' : 'Email outcome is unknown. Check the sent mailbox before any manual resend.' };
  }
  await store.put(resultPath, outcome);
  return outcome;
}

export async function finishCertificate(store, record, mailer = sendHostingerMail) {
  const signed = await store.get(pathFor(record.id, 'signed'));
  if (!signed) throw new CertificateError('This certificate has not been signed.', 409);
  const pdfPath = `records/${record.id}/certificate.pdf`;
  let pdf = await store.get(pdfPath, true);
  if (!pdf) {
    const generated = await certificatePdf(safeRequest(record), signed);
    if (await store.put(pdfPath, generated, true)) pdf = generated;
    else pdf = await store.get(pdfPath, true);
  }
  if (!pdf) throw new CertificateError('Signature saved. PDF is still being prepared. Refresh to recover it.', 503);
  await store.put(pathFor(record.id, 'pdf-integrity'), { sha256: hash(pdf), at: stamp() });
  const recipients = [...new Set([record.customerEmail, record.workForEmail, OFFICE_EMAIL])];
  const delivery = await sendOnce(store, record.id, 'completed-email', {
    to: recipients,
    displayName: 'Certificate delivery',
    subject: `Signed Queensland certificate | Job ${record.jobNumber || record.id}`,
    text: `The signed certificate for ${record.customerName}, ${record.siteAddress}, is attached.\n\nIssuing electrical contractor: ${signed.contractorName}\nContractor licence: ${signed.contractorLicence}\nContractor phone: ${signed.contractorPhone}\nSigned by: ${signed.signerName}\nCertificate reference: ${record.id}\n${signed.smokeOutcome === 'not-compliant' ? '\nSmoke alarm inspection: NOT COMPLIANT. Please review the observations in the certificate.\n' : ''}\nThis is an automated delivery of the contractor-signed certificate. Please contact the issuing contractor about the certified work and retain this certificate.`,
    attachments: [{ filename: `QLD-Contractor-Certificate-${record.jobNumber.replace(/[^a-zA-Z0-9-]/g, '') || record.id}.pdf`, content: pdf.toString('base64'), contentType: 'application/pdf' }],
  }, mailer);
  return { signed: true, pdfReady: true, delivery };
}

export async function certificateAction(body, req, deps = {}) {
  const env = deps.env || process.env;
  const action = String(body.action || '').replace(/^qld-certificate-/, '');
  const publicAction = ['view', 'sign', 'download'].includes(action);
  const admin = Boolean(env.DASHBOARD_PASSWORD && constantEqual(req.headers?.['x-certificate-password'], env.DASHBOARD_PASSWORD));
  if (!publicAction && !admin) throw new CertificateError('Enter the staff portal password to continue.', 401);
  if (req.headers?.origin && req.headers.origin !== ORIGIN && req.headers.origin !== deps.allowedOrigin) throw new CertificateError('This request must come from the Goldsure portal.', 403);
  const store = deps.store || new CertificateStore(env);
  const mailer = deps.mailer || sendHostingerMail;
  if (action === 'setup') { await store.setup(); return { ready: true }; }
  if (action === 'lookup') return lookupJob(body.jobNumber, env, deps.fetch || fetch);
  if (action === 'preview') return { pdf: await certificatePdf({ ...requestFields(body.draft), id: 'PREVIEW', createdAt: stamp() }), filename: 'QLD-Contractor-Certificate-PREVIEW.pdf' };
  if (action === 'list') {
    const offset = Math.max(0, Math.min(100000, Number(body.offset) || 0));
    const files = await store.list(offset);
    const rows = [];
    // Bounded batches avoid flooding Storage for a tracker page.
    for (let i = 0; i < files.length; i += 5) {
      rows.push(...await Promise.all(files.slice(i, i + 5).map(async file => {
        const record = await store.get(`requests/${file.name}`);
        if (!record) return null;
        const [signed, viewed, invitation, delivery] = await Promise.all(['signed', 'viewed', 'invitation-result', 'completed-email-result'].map(kind => store.get(pathFor(record.id, kind))));
        return { id: record.id, jobNumber: record.jobNumber, customerName: record.customerName, customerEmail: record.customerEmail, electricianName: record.electricianName, electricianEmail: record.electricianEmail, electricianPhone: record.electricianPhone, createdAt: record.createdAt, expiresAt: record.expiresAt, signedAt: signed?.signedAt, viewedAt: viewed?.at, invitation: invitation?.status || (record.deliveryMethod === 'sms' ? 'SMS prepared (check SMS portal)' : 'not confirmed'), delivery: delivery?.status || (signed ? 'pending / check' : '-'), expired: Date.now() > Date.parse(record.expiresAt) };
      })));
    }
    return { rows: rows.filter(Boolean), offset, hasMore: files.length === 25 };
  }
  if (action === 'send' || action === 'prepare-sms') {
    if (body.confirmSend !== true) throw new CertificateError('Review the certificate and confirm sending first.');
    const draft = requestFields(body.draft);
    if ((action === 'prepare-sms') !== (draft.deliveryMethod === 'sms')) throw new CertificateError('The delivery method changed. Preview the request again.');
    if (!uuid.test(body.id || '')) throw new CertificateError('Invalid request reference. Refresh the draft.');
    // Fail before creating a request when email cannot be configured.
    if (!deps.mailer && (!env.HOSTINGER_MAILBOX_RESOURCE_ID || !env.HOSTINGER_MAIL_API_TOKEN)) throw new CertificateError('Email sending is not configured.', 503);
    const secret = signingToken(body.id, secretFor(env));
    let record = { ...draft, id: body.id, draftHash: hash(draft), createdAt: stamp(), expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(), version: 1 };
    if (!await store.put(`requests/${record.id}.json`, record)) {
      record = await store.get(`requests/${record.id}.json`);
      if (!record || record.draftHash !== hash(draft)) throw new CertificateError('This draft was already submitted with different details. Start a new request.', 409);
    }
    if (Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('This request has expired. Start a new request.', 410);
    if (await store.get(pathFor(record.id, 'signed'))) throw new CertificateError('This certificate has already been signed.', 409);
    if (action === 'prepare-sms') return { id: record.id, sms: smsDraft(record, env), invitation: { status: 'prepared', message: 'Request saved. No SMS or invitation email sent. Review the number and press Send in the SMS portal.' } };
    const link = `${ORIGIN}/compliance/sign.html#${record.id}.${secret}`;
    const invitation = await sendOnce(store, record.id, 'invitation', {
      to: [record.electricianEmail], subject: `Please sign: Queensland certificate | Job ${record.jobNumber || record.id}`,
      text: `Hi ${record.electricianName},\n\nPlease review the certificate for ${record.customerName} at ${record.siteAddress}. Confirm the actual test date, contractor licence and testing declaration, then sign using this private link:\n${link}\n\nThe link expires in 14 days. Do not forward it. If anything is incorrect, contact Goldsure before signing. Signing automatically emails the final certificate to the customer, the commissioning party and ${OFFICE_EMAIL}.\n\nGoldsure`,
      html: `<div style="font:15px Arial;max-width:600px;margin:auto"><img width="150" alt="Goldsure" src="${ORIGIN}/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"><h2>Certificate ready for your review</h2><p>Hi ${esc(record.electricianName)},</p><p>Job ${esc(record.jobNumber || record.id)}<br>${esc(record.customerName)}<br>${esc(record.siteAddress)}</p><p>Confirm the test details and contractor licence, review the declaration, then sign.</p><p><a style="display:inline-block;padding:16px;background:#ad8d32;color:#fff;text-decoration:none" href="${link}">Review and sign certificate</a></p><p>This private link expires in 14 days. Do not forward it. Contact Goldsure if any details need correcting.</p><p>The signed PDF is automatically emailed to the customer, the commissioning party and ${OFFICE_EMAIL}.</p></div>`,
    }, mailer);
    return { id: record.id, invitation };
  }
  const id = String(body.id || '');
  if (!uuid.test(id)) throw new CertificateError('Invalid certificate link.', 404);
  if (!admin && !constantEqual(body.token, signingToken(id, secretFor(env)))) throw new CertificateError('This private certificate link is invalid.', 403);
  const record = await store.get(`requests/${id}.json`);
  if (!record) throw new CertificateError('Certificate not found.', 404);
  if (action === 'sms-link') {
    if (Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('This signing link has expired. Create a new request.', 410);
    if (await store.get(pathFor(id, 'signed'))) throw new CertificateError('This certificate has already been signed.', 409);
    return smsDraft(record, env);
  }
  if (!admin && Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('This signing link has expired. Please contact Goldsure.', 410);
  if (action === 'view') {
    if (!admin) await store.put(pathFor(id, 'viewed'), { at: stamp() });
    const signed = await store.get(pathFor(id, 'signed'));
    return { record: safeRequest(record), checks: CHECKS, declaration: DECLARATIONS[record.certificateType], signedAt: signed?.signedAt || null, delivery: await store.get(pathFor(id, 'completed-email-result')) };
  }
  if (action === 'sign') {
    // Staff access is deliberately insufficient to impersonate the electrician.
    if (!constantEqual(body.token, signingToken(id, secretFor(env)))) throw new CertificateError('Use the electrician signing link.', 403);
    if (Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('Signing link expired.', 410);
    if (!await store.get(pathFor(id, 'signed'))) {
      const fields = signatureFields(body.signature || {}, record);
      const signed = { ...fields, signedAt: stamp(), requestHash: hash(safeRequest(record)), consentVersion: 'qld-v1', userAgent: String(req.headers?.['user-agent'] || '').slice(0, 400), ip: String(req.headers?.['x-forwarded-for'] || '').split(',')[0].slice(0, 80) };
      await store.put(pathFor(id, 'signed'), signed); // create-only: concurrent losers use the winner
    }
    return finishCertificate(store, record, mailer);
  }
  if (action === 'finish') return finishCertificate(store, record, mailer);
  if (action === 'download') {
    const pdf = await store.get(`records/${id}/certificate.pdf`, true);
    if (!pdf) throw new CertificateError('The signed PDF is not ready. Staff can use Recover completion in the tracker.', 409);
    return { pdf, filename: `QLD-Contractor-Certificate-${record.jobNumber.replace(/[^a-zA-Z0-9-]/g, '') || id}.pdf` };
  }
  throw new CertificateError('Unknown certificate action.');
}

export async function handleCertificates(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const result = await certificateAction(req.body || {}, req);
    if (result.pdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.status(200).send(result.pdf);
    }
    return res.status(200).json(result);
  } catch (error) {
    // Do not leak tokens, provider responses, mail bodies or customer data in logs.
    return res.status(error instanceof CertificateError ? error.status : 503).json({ error: error instanceof CertificateError ? error.message : 'Certificate service interrupted. Refresh the tracker before trying again. No successful delivery is assumed.' });
  }
}
