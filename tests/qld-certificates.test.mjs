import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { certificateAction, finishCertificate, lookupJob } from '../lib/qld-certificates.js';
import { requestFields, signatureFields, signingToken, CHECKS, prefillFields, phoneField } from '../lib/qld-certificate-model.js';
import { certificatePdf } from '../lib/qld-certificate-pdf.js';
import { CertificateStore } from '../lib/qld-certificate-store.js';

export const draft = { customerName: 'Example Customer', customerEmail: 'customer@example.test', customerAddress: '10 Example Street, Brisbane QLD 4000', customerPhone: '0400 000 000', siteAddress: '10 Example Street, Brisbane QLD 4000', workForName: 'Example Customer', workForEmail: 'customer@example.test', workForAddress: '10 Example Street, Brisbane QLD 4000', jobNumber: '123456', workDescription: 'Installed and tested six interconnected photoelectric smoke alarms at the locations listed in the installation record. Testing covers the electrical work performed.', electricianName: 'Example Electrician', electricianEmail: 'electrician@example.test', certificateType: 'installation', smokeInspection: true, state: 'QLD' };
export const signature = { signerName: 'Example Electrician', workDescription: 'Installed and tested six interconnected photoelectric smoke alarms throughout the residence.', contractorName: 'Example Electrical Pty Ltd', contractorLicence: 'EXAMPLE-12345', contractorPhone: '0400 000 001', testDate: '2026-10-12', notes: '', certifySafe: true, confirmDetails: true, consent: true, smokeOutcome: 'compliant', checks: CHECKS.map(() => 'Yes'), replacementDate: '2036', strokes: [[[.1,.7],[.15,.3],[.2,.5],[.25,.8],[.3,.25],[.4,.6],[.5,.4],[.65,.6],[.8,.3]]] };
export class MemoryStore {
  data = new Map();
  async setup() {}
  async put(path, value) { if (this.data.has(path)) return false; this.data.set(path, Buffer.isBuffer(value) ? Buffer.from(value) : structuredClone(value)); return true; }
  async get(path) { return this.data.get(path) || null; }
  async list(offset) { return [...this.data.keys()].filter(x => x.startsWith('requests/')).slice(offset, offset + 25).map(x => ({ name: x.split('/')[1] })); }
}
test('staff page has no storage setup control or stale setup event handler', async () => {
  const html = await readFile(new URL('../compliance/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../compliance/staff.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="setup"|Initialise private storage|id="password"|Staff portal password|id="useRecordedLicence"|id="certificateType"|value="equipment"/);
  assert.doesNotMatch(js, /\$\('setup'\)/);
  assert.doesNotMatch(js, /x-certificate-password|password\(\)/);
});
function fixture() {
  const store = new MemoryStore(), mails = [], env = { QLD_CERTIFICATE_SIGNING_SECRET: 'test-only-secret-not-for-production-123456789' };
  const deps = { store, env, mailer: async mail => { mails.push(mail); } };
  const admin = { headers: {} };
  return { store, mails, deps, admin, env };
}
async function create(f) { const id = randomUUID(); await certificateAction({ action: 'qld-certificate-send', id, draft, confirmSend: true }, f.admin, f.deps); return { id, token: signingToken(id, f.env.QLD_CERTIFICATE_SIGNING_SECRET) }; }

test('required recipient, job details and Queensland scope validated', () => {
  assert.equal(requestFields(draft).customerName, draft.customerName);
  for (const bad of [{ customerEmail: 'bad' }, { state: 'NSW' }, { workForName: '' }, { electricianEmail: 'x\ny@z.com' }]) assert.throws(() => requestFields({ ...draft, ...bad }));
  assert.equal(requestFields({ ...draft, workDescription: '' }).workDescription, '');
  assert.equal(requestFields({ ...draft, certificateType: 'equipment', smokeInspection: false }).certificateType, 'installation');
  assert.equal(requestFields({ ...draft, certificateType: 'equipment', smokeInspection: false }).smokeInspection, true);
});
test('signing requires deliberate safety, authority and consent confirmations', () => {
  for (const key of ['certifySafe', 'confirmDetails', 'consent']) assert.throws(() => signatureFields({ ...signature, [key]: false }, draft));
  assert.throws(() => signatureFields({ ...signature, workDescription: '' }, draft));
  assert.throws(() => signatureFields({ ...signature, signerName: 'Someone else' }, draft));
});
test('test date must be a real non-future date', () => {
  for (const value of ['2026-02-30', '2099-01-01', 'no-date']) assert.throws(() => signatureFields({ ...signature, testDate: value }, draft));
});
test('replacement field accepts a year or an unknown-installation-date status', () => {
  assert.equal(signatureFields({ ...signature, replacementDate: 'not-applicable' }, draft).replacementDate, 'not-applicable');
  assert.throws(() => signatureFields({ ...signature, replacementDate: 'next year' }, draft));
});
test('no conflicting compliant checklist or unexplained exclusions', () => {
  assert.throws(() => signatureFields({ ...signature, checks: ['No', ...signature.checks.slice(1)] }, draft));
  assert.throws(() => signatureFields({ ...signature, smokeOutcome: 'not-compliant' }, draft));
  assert.throws(() => signatureFields({ ...signature, checks: ['Not applicable', ...signature.checks.slice(1)] }, draft));
  assert.equal(signatureFields({ ...signature, smokeOutcome: 'not-compliant', notes: 'Bedroom alarm missing.' }, draft).smokeOutcome, 'not-compliant');
});
test('signature points have finite bounded coordinates and real strokes', () => {
  for (const strokes of [[], [[[.1,.1]]], [[[NaN,1],[1,1]]], Array.from({ length: 101 }, () => [[0,0],[1,1]])]) assert.throws(() => signatureFields({ ...signature, strokes }, draft));
});
test('staff actions do not require a password', async () => {
  const f = fixture();
  const listed = await certificateAction({ action: 'qld-certificate-list' }, { headers: {} }, f.deps);
  assert.deepEqual(listed.rows, []);
  const preview = await certificateAction({ action: 'qld-certificate-preview', draft }, { headers: {} }, f.deps);
  assert.equal(preview.pdf.subarray(0, 4).toString(), '%PDF');
  assert.equal(f.mails.length, 0);
});
test('cross-origin action remains rejected', async () => {
  const f = fixture(); await assert.rejects(certificateAction({ action: 'qld-certificate-list' }, { headers: { ...f.admin.headers, origin: 'https://evil.example' } }, f.deps), /Goldsure portal/);
});
test('preview returns a PDF and never saves or emails', async () => {
  const f = fixture(), result = await certificateAction({ action: 'qld-certificate-preview', draft }, f.admin, f.deps);
  assert.equal(result.pdf.subarray(0, 4).toString(), '%PDF'); assert.equal(f.mails.length, 0); assert.equal(f.store.data.size, 0);
});
test('invitation is create-only, safe on concurrent double click', async () => {
  const f = fixture(), id = randomUUID(), input = { action: 'qld-certificate-send', id, draft, confirmSend: true };
  await Promise.all([certificateAction(input, f.admin, f.deps), certificateAction(input, f.admin, f.deps)]);
  assert.equal(f.mails.length, 1); assert.deepEqual(f.mails[0].to, ['vignesh@goldsure.com.au']);
  assert.ok(f.mails[0].text.includes(`/compliance/sign.html#${id}.`));
  await assert.rejects(certificateAction({ ...input, draft: { ...draft, customerName: 'Changed' } }, f.admin, f.deps), /different details/);
});
test('signature and PDF survive concurrent submissions and mail is sent once', async () => {
  const f = fixture(), credentials = await create(f);
  const input = { action: 'qld-certificate-sign', ...credentials, signature };
  await Promise.all([certificateAction(input, { headers: {} }, f.deps), certificateAction(input, { headers: {} }, f.deps)]);
  assert.equal(f.mails.length, 2);
  assert.deepEqual(f.mails[1].to, ['vignesh@goldsure.com.au']);
  assert.ok(f.mails[1].attachments[0].content);
  const original = f.store.data.get(`records/${credentials.id}/signed.json`);
  await certificateAction({ ...input, signature: { ...signature, notes: 'Changed after signing' } }, { headers: {} }, f.deps);
  assert.equal(f.store.data.get(`records/${credentials.id}/signed.json`), original);
  assert.equal(f.mails.length, 2);
});
test('the private signing token is always required to sign', async () => {
  const f = fixture(), { id } = await create(f);
  await assert.rejects(certificateAction({ action: 'qld-certificate-sign', id, signature }, f.admin, f.deps), /invalid/);
});
test('invalid and expired tokens reject signing-link operations', async () => {
  const f = fixture(), credentials = await create(f);
  for (const action of ['view', 'sign']) await assert.rejects(certificateAction({ action: `qld-certificate-${action}`, ...credentials, token: 'bad' }, { headers: {} }, f.deps), /invalid/);
  await assert.rejects(certificateAction({ action: 'qld-certificate-download', ...credentials }, { headers: {} }, f.deps), /not ready/);
  f.store.data.get(`requests/${credentials.id}.json`).expiresAt = '2000-01-01';
  await assert.rejects(certificateAction({ action: 'qld-certificate-view', ...credentials }, { headers: {} }, f.deps), /expired/);
});
test('view marks opened without sending email and omits audit data', async () => {
  const f = fixture(), credentials = await create(f);
  const result = await certificateAction({ action: 'qld-certificate-view', ...credentials }, { headers: {} }, f.deps);
  assert.equal(f.mails.length, 1); assert.equal(result.record.draftHash, undefined);
  assert.ok(await f.store.get(`records/${credentials.id}/viewed.json`));
});
test('unknown mail outcomes remain unknown and are not retried', async () => {
  const f = fixture(), credentials = await create(f); let attempts = 0;
  f.deps.mailer = async () => { attempts++; throw new Error('timeout'); };
  const result = await certificateAction({ action: 'qld-certificate-sign', ...credentials, signature }, { headers: {} }, f.deps);
  assert.equal(result.delivery.status, 'unknown');
  await certificateAction({ action: 'qld-certificate-finish', id: credentials.id }, f.admin, f.deps);
  assert.equal(attempts, 1); assert.ok(f.store.data.get(`records/${credentials.id}/certificate.pdf`));
});
test('provider rejection is explicit and never silently called delivered', async () => {
  const f = fixture(), credentials = await create(f);
  f.deps.mailer = async () => { throw Object.assign(new Error('rejected'), { status: 422 }); };
  const result = await certificateAction({ action: 'qld-certificate-sign', ...credentials, signature }, { headers: {} }, f.deps);
  assert.equal(result.delivery.status, 'rejected'); assert.equal(result.pdfReady, true);
});
test('interrupted completion recovers from signed record without changing it', async () => {
  const f = fixture(), credentials = await create(f), record = await f.store.get(`requests/${credentials.id}.json`);
  const signed = { ...signatureFields(signature, draft), signedAt: new Date().toISOString() };
  await f.store.put(`records/${credentials.id}/signed.json`, signed);
  const result = await finishCertificate(f.store, record, f.deps.mailer);
  assert.equal(result.pdfReady, true); assert.equal(f.mails.length, 2);
});
test('missing storage and signing secrets fail closed', async () => {
  assert.throws(() => new CertificateStore({}), /not configured/);
  const f = fixture(); delete f.env.QLD_CERTIFICATE_SIGNING_SECRET;
  await assert.rejects(create(f), /signing links are not configured/); assert.equal(f.mails.length, 0);
});
test('storage handles legacy duplicate and missing object results', async () => {
  const env = { SUPABASE_URL: 'https://storage.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  const path = `records/${randomUUID()}/certificate.pdf`;
  const store = new CertificateStore(env, async () => new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate' }), { status: 400 }));
  assert.equal(await store.put(path, Buffer.from('pdf'), true), false);
  store.fetch = async () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400 });
  assert.equal(await store.get(path, true), null);
  store.fetch = async () => new Response('{}', { status: 403 });
  await assert.rejects(store.get(path, true), /could not be read/);
});
test('Dataforce lookup only reads jobs/customers and does not write records', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(url.includes('authorization') ? { access_token: 'fake' } : url.includes('/jobs/search') ? { records: [{ jobId: 123456, customerId: 111 }] } : { firstname: 'Example', surname: 'Customer', state: 'QLD', email: 'customer@example.test', streetNo: '10', streetName: 'Example', streetType: 'Street', suburb: 'Brisbane', postCode: '4000', mobilePhone: '0400 000 000' })); };
  const result = await lookupJob('123456', { DATAFORCE_CLIENT_ID: 'test', DATAFORCE_CLIENT_SECRET: 'test' }, fetchImpl);
  assert.equal(result.customerName, draft.customerName);
  assert.equal(calls[1].init.method, 'POST'); assert.ok(calls[1].url.endsWith('/jobs/search'));
  assert.ok(!calls[2].init.method); assert.equal(result.customerPhone, '0400 000 000');
  assert.equal(calls.length, 3);
});
test('PDF renders signed content with enough space for maximum-length fields', async () => {
  const pdf = await certificatePdf({ ...draft, id: randomUUID(), workDescription: 'Specific work and installation details. '.repeat(35) }, { ...signatureFields(signature, draft), notes: 'Detailed observations and exclusions. '.repeat(35), signedAt: '2026-10-13T02:00:00Z' });
  assert.ok(pdf.length > 3000);
});
test('SMS-only request creates a reusable signing link without any invitation email', async () => {
  const f = fixture(), id = randomUUID();
  const input = { action: 'qld-certificate-prepare-sms', id, confirmSend: true, draft: { ...draft, deliveryMethod: 'sms', electricianEmail: '', electricianPhone: '0400 000 001' } };
  const result = await certificateAction(input, f.admin, f.deps);
  assert.equal(result.sms.phone, '+61400000001'); assert.ok(result.sms.message.includes(`${id}.${signingToken(id, f.env.QLD_CERTIFICATE_SIGNING_SECRET)}`));
  assert.equal(f.mails.length, 0); assert.equal(result.invitation.status, 'prepared');
  await certificateAction(input, f.admin, f.deps); assert.equal(f.mails.length, 0);
  await assert.rejects(certificateAction({ ...input, action: 'qld-certificate-send' }, f.admin, f.deps), /delivery method changed/);
  const token = signingToken(id, f.env.QLD_CERTIFICATE_SIGNING_SECRET);
  await certificateAction({ action: 'qld-certificate-sign', id, token, signature }, { headers: {} }, f.deps);
  assert.equal(f.mails.length, 1); assert.deepEqual(f.mails[0].to, ['vignesh@goldsure.com.au']);
});
test('SMS links for saved requests need no password and cannot reopen signed or expired requests', async () => {
  const f = fixture(), credentials = await create(f);
  const body = { action: 'qld-certificate-sms-link', id: credentials.id };
  const result = await certificateAction(body, { headers: {} }, f.deps); assert.ok(result.message.includes(credentials.token)); assert.equal(f.mails.length, 1);
  f.store.data.get(`requests/${credentials.id}.json`).expiresAt = '2000-01-01';
  await assert.rejects(certificateAction(body, f.admin, f.deps), /expired/);
});
test('prefills allow partial details but never carry signature or consent', () => {
  const result = prefillFields({ ...signature, contractorName: 'Example Electrical' }, true);
  assert.equal(result.contractorName, 'Example Electrical'); assert.equal(result.testDate, signature.testDate);
  for (const key of ['strokes', 'consent', 'certifySafe', 'confirmDetails', 'signedAt']) assert.equal(result[key], undefined);
  assert.throws(() => prefillFields({ testDate: '2099-01-01' }));
  assert.throws(() => prefillFields({ checks: ['garbage'] }, true));
});
test('prefilled details survive view and are replaced by the electrician confirmed values when signed', async () => {
  const f = fixture(), id = randomUUID();
  await certificateAction({ action: 'qld-certificate-send', id, confirmSend: true, draft: { ...draft, prefill: { contractorName: 'Draft contractor', testDate: '2026-10-11', notes: 'Check this on site' } } }, f.admin, f.deps);
  const token = signingToken(id, f.env.QLD_CERTIFICATE_SIGNING_SECRET);
  const view = await certificateAction({ action: 'qld-certificate-view', id, token }, { headers: {} }, f.deps);
  assert.equal(view.record.prefill.contractorName, 'Draft contractor'); assert.equal(view.signedAt, null);
  await assert.rejects(certificateAction({ action: 'qld-certificate-sign', id, token, signature: {} }, { headers: {} }, f.deps), /Confirm the details/);
  await certificateAction({ action: 'qld-certificate-sign', id, token, signature }, { headers: {} }, f.deps);
  assert.equal((await f.store.get(`records/${id}/signed.json`)).contractorName, signature.contractorName);
  await assert.rejects(certificateAction({ action: 'qld-certificate-sms-link', id }, f.admin, f.deps), /already been signed/);
});
test('SMS mobile number formats are normalised and invalid numbers rejected', () => {
  for (const phone of ['0400 000 001', '61400000001', '+61 400 000 001']) assert.equal(phoneField(phone), '+61400000001');
  assert.equal(phoneField(''), '');
  for (const phone of ['555', 'not a phone', '+12125551234']) assert.throws(() => phoneField(phone));
});
test('structured records go to PostgreSQL, never object storage', async () => {
  const calls = [], id = randomUUID();
  const store = new CertificateStore({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 201 }); });
  const request = { ...draft, id, createdAt: '2026-10-13T00:00:00Z', expiresAt: '2026-10-27T00:00:00Z' };
  await store.put(`requests/${id}.json`, request);
  await store.put(`records/${id}/signed.json`, { ...signature, signedAt: '2026-10-13T01:00:00Z' });
  await store.put(`records/${id}/completed-email-claim.json`, { at: '2026-10-13T01:00:00Z' });
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), ['/rest/v1/qld_certificate_requests', '/rest/v1/qld_certificate_signatures', '/rest/v1/qld_certificate_events']);
  assert.deepEqual(JSON.parse(calls[0].init.body).request_data, request);
  assert.equal(JSON.parse(calls[1].init.body).test_date, signature.testDate);
  assert.equal(JSON.parse(calls[2].init.body).event_type, 'completed-email-claim');
  assert.ok(calls.every(call => call.init.method === 'POST' && !call.init.headers.Prefer.includes('resolution=merge')));
});
test('Postgres duplicate writes return existing outcome, other conflicts fail closed', async () => {
  const id = randomUUID(), path = `records/${id}/signed.json`;
  const store = new CertificateStore({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, async () => new Response(JSON.stringify({ code: '23505' }), { status: 409 }));
  assert.equal(await store.put(path, signature), false);
  store.fetch = async () => new Response(JSON.stringify({ code: '23503' }), { status: 409 });
  await assert.rejects(store.put(path, signature), /database write failed/);
});
test('Postgres reads/list use exact private tables and deterministic pagination', async () => {
  const id = randomUUID(), calls = [];
  const store = new CertificateStore({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, async url => { calls.push(url); return new Response(JSON.stringify(url.includes('order=') ? [{ id }] : [{ request_data: draft }])); });
  assert.deepEqual(await store.get(`requests/${id}.json`), draft);
  assert.deepEqual(await store.list(25), [{ name: `${id}.json` }]);
  assert.ok(calls[0].includes(`id=eq.${id}`)); assert.ok(calls[1].includes('order=created_at.desc,id.desc&limit=25&offset=25'));
  store.fetch = async () => new Response('[]'); assert.equal(await store.get(`requests/${id}.json`), null);
  store.fetch = async () => new Response('{}', { status: 404 }); await assert.rejects(store.get(`requests/${id}.json`), /PostgreSQL migration/);
});
test('storage setup refuses missing PostgreSQL tables without creating a bucket', async () => {
  const calls = [];
  const store = new CertificateStore({ SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 404 }); });
  await assert.rejects(store.setup(), /PostgreSQL migration/);
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, undefined);
});
test('completed email identifies the contractor and has an unbranded attachment name', async () => {
  const f = fixture(), credentials = await create(f);
  await certificateAction({ action: 'qld-certificate-sign', ...credentials, signature }, { headers: {} }, f.deps);
  const mail = f.mails[1];
  assert.equal(mail.displayName, 'Certificate delivery');
  assert.match(mail.text, /Issuing electrical contractor: Example Electrical Pty Ltd/);
  assert.ok(!mail.text.includes('Goldsure'));
  assert.ok(!mail.attachments[0].filename.includes('Goldsure'));
});
