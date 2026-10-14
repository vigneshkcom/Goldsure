import { CertificateError, requestFields, signatureFields, signingToken, constantEqual, hash, OFFICE_EMAIL, CHECKS, DECLARATIONS } from './qld-certificate-model.js';
import { CertificateStore } from './qld-certificate-store.js';
import { certificatePdf } from './qld-certificate-pdf.js';
import { sendHostingerMail } from './hostinger-mail.js';
import { listCertificateElectricians } from './qld-certificate-electricians.js';

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
  const recipients = [record.customerEmail];
  const jobReference = record.jobNumber || record.id;
  const customerFirstName = record.customerName.split(/\s+/)[0] || 'there';
  const inspectionNotice = signed.smokeOutcome === 'not-compliant'
    ? '<tr><td style="padding:16px 20px;background:#fff5f1;border:1px solid #e2a38d;color:#86351e;font:14px/21px Arial,sans-serif;"><strong>Inspection outcome: action required.</strong><br>Please review the observations in the attached certificate and contact the issuing contractor.</td></tr>'
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;color:#1e2937;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:32px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;"><tr><td style="padding:26px 32px;background:#101820;border-bottom:4px solid #b79243;"><div style="font:700 24px/30px Arial,sans-serif;color:#ffffff;letter-spacing:.2px;">Goldsure</div><div style="margin-top:4px;font:12px/18px Arial,sans-serif;color:#dcc78e;letter-spacing:1px;text-transform:uppercase;">Compliance certificate</div></td></tr><tr><td style="padding:32px 32px 24px;"><h1 style="margin:0 0 14px;font:700 24px/32px Arial,sans-serif;color:#172033;">Your signed certificate is ready</h1><p style="margin:0;font:15px/23px Arial,sans-serif;color:#435168;">Hi ${esc(customerFirstName)},</p><p style="margin:14px 0 0;font:15px/23px Arial,sans-serif;color:#435168;">Your signed Queensland electrical compliance certificate is attached for your records.</p></td></tr><tr><td style="padding:0 32px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #dce1e8;border-radius:7px;"><tr><td style="padding:16px 20px;background:#f8fafc;font:700 12px/18px Arial,sans-serif;color:#68758a;text-transform:uppercase;letter-spacing:.7px;">Certificate summary</td></tr><tr><td style="padding:16px 20px 6px;font:14px/21px Arial,sans-serif;color:#263448;"><strong>Job reference</strong><br>${esc(jobReference)}</td></tr><tr><td style="padding:10px 20px 6px;font:14px/21px Arial,sans-serif;color:#263448;"><strong>Installation address</strong><br>${esc(record.siteAddress)}</td></tr><tr><td style="padding:10px 20px 16px;font:14px/21px Arial,sans-serif;color:#263448;"><strong>Issued by</strong><br>${esc(signed.contractorName)}<br>Electrical contractor licence: ${esc(signed.contractorLicence)}</td></tr></table></td></tr>${inspectionNotice}<tr><td style="padding:0 32px 28px;"><p style="margin:0;font:14px/21px Arial,sans-serif;color:#58667a;">Please keep the attached PDF with your property records. For questions about the certified work, contact the issuing electrical contractor.</p></td></tr><tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e6ec;font:12px/18px Arial,sans-serif;color:#738095;">Goldsure Pty Ltd<br><a href="mailto:info@goldsure.com.au" style="color:#866e32;text-decoration:none;">info@goldsure.com.au</a> &nbsp;|&nbsp; 03 7050 2846</td></tr></table></td></tr></table></body></html>`;
  const delivery = await sendOnce(store, record.id, 'completed-email', {
    to: recipients,
    cc: [OFFICE_EMAIL],
    displayName: 'Goldsure Compliance',
    subject: `Your signed Queensland compliance certificate | Job ${jobReference}`,
    text: `Hi ${customerFirstName},\n\nYour signed Queensland electrical compliance certificate is attached for your records.\n\nJob reference: ${jobReference}\nInstallation address: ${record.siteAddress}\nIssued by: ${signed.contractorName}\nElectrical contractor licence: ${signed.contractorLicence}\nContractor phone: ${signed.contractorPhone}\n${signed.smokeOutcome === 'not-compliant' ? '\nInspection outcome: action required. Please review the observations in the attached certificate and contact the issuing contractor.\n' : ''}\nPlease keep the attached PDF with your property records. For questions about the certified work, contact the issuing electrical contractor.\n\nGoldsure Pty Ltd\ninfo@goldsure.com.au | 03 7050 2846`,
    html,
    attachments: [{ filename: `QLD-Contractor-Certificate-${record.jobNumber.replace(/[^a-zA-Z0-9-]/g, '') || record.id}.pdf`, content: pdf.toString('base64'), contentType: 'application/pdf' }],
  }, mailer);
  return { signed: true, pdfReady: true, delivery };
}

export async function certificateAction(body, req, deps = {}) {
  const env = deps.env || process.env;
  const action = String(body.action || '').replace(/^qld-certificate-/, '');
  if (req.headers?.origin && req.headers.origin !== ORIGIN && req.headers.origin !== deps.allowedOrigin) throw new CertificateError('This request must come from the Goldsure portal.', 403);
  const store = deps.store || new CertificateStore(env);
  const mailer = deps.mailer || sendHostingerMail;
  if (action === 'setup') { await store.setup(); return { ready: true }; }
  if (action === 'lookup') return lookupJob(body.jobNumber, env, deps.fetch || fetch);
  if (action === 'electricians') return listCertificateElectricians(env, deps.fetch || fetch);
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
      to: [record.electricianEmail], subject: `Action required: sign Queensland certificate | Job ${record.jobNumber || record.id}`,
      text: `Hi ${record.electricianName},\n\nPlease review and sign the Queensland certificate for ${record.customerName} at ${record.siteAddress}:\n${link}\n\nThe link expires in 14 days. Do not forward it. Once signed, the completed certificate is emailed to the customer, with Goldsure copied.\n\nGoldsure`,
      html: `<div style="font:15px Arial;max-width:600px;margin:auto"><img width="150" alt="Goldsure" src="${ORIGIN}/assets/Goldsure-Horizontal-Logo-RGB-600px-w-72ppi.jpg"><h2>Queensland certificate ready to sign</h2><p>Hi ${esc(record.electricianName)},</p><p>Please review and sign the certificate for:</p><p>Job ${esc(record.jobNumber || record.id)}<br>${esc(record.customerName)}<br>${esc(record.siteAddress)}</p><p><a style="display:inline-block;padding:16px;background:#ad8d32;color:#fff;text-decoration:none" href="${link}">Review and sign certificate</a></p><p>This private link expires in 14 days. Do not forward it. Once signed, the completed certificate is emailed to the customer, with Goldsure copied.</p></div>`,
    }, mailer);
    return { id: record.id, invitation };
  }
  const id = String(body.id || '');
  if (!uuid.test(id)) throw new CertificateError('Invalid certificate link.', 404);
  if (['view', 'sign'].includes(action) && !constantEqual(body.token, signingToken(id, secretFor(env)))) throw new CertificateError('This private certificate link is invalid.', 403);
  const record = await store.get(`requests/${id}.json`);
  if (!record) throw new CertificateError('Certificate not found.', 404);
  if (action === 'sms-link') {
    if (Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('This signing link has expired. Create a new request.', 410);
    if (await store.get(pathFor(id, 'signed'))) throw new CertificateError('This certificate has already been signed.', 409);
    return smsDraft(record, env);
  }
  if (['view', 'sign'].includes(action) && Date.now() > Date.parse(record.expiresAt)) throw new CertificateError('This signing link has expired. Please contact Goldsure.', 410);
  if (action === 'view') {
    await store.put(pathFor(id, 'viewed'), { at: stamp() });
    const signed = await store.get(pathFor(id, 'signed'));
    return { record: safeRequest(record), checks: CHECKS, declaration: DECLARATIONS.installation, signedAt: signed?.signedAt || null, delivery: await store.get(pathFor(id, 'completed-email-result')) };
  }
  if (action === 'sign') {
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
    if (!pdf) throw new CertificateError('The signed PDF is not ready. Use Recover completion in the tracker.', 409);
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
