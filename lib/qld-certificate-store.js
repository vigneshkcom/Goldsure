import { CertificateError } from './qld-certificate-model.js';

export const BUCKET = 'qld-compliance-certificates';
const ID = '[0-9a-f-]{36}';
const EVENTS = ['viewed', 'invitation-claim', 'invitation-result', 'completed-email-claim', 'completed-email-result', 'pdf-integrity'];

// All structured data lives in PostgreSQL; ONLY PDF bytes go into Storage.
export function certificateRecordLocation(path) {
  let match = new RegExp(`^requests/(${ID})\\.json$`, 'i').exec(path);
  if (match) return { table: 'qld_certificate_requests', column: 'request_data', filter: `id=eq.${match[1]}`, id: match[1], kind: 'request' };
  match = new RegExp(`^records/(${ID})/([a-z-]+)\\.json$`, 'i').exec(path);
  if (!match) throw new CertificateError('Invalid certificate record key.');
  if (match[2] === 'signed') return { table: 'qld_certificate_signatures', column: 'signature_data', filter: `certificate_id=eq.${match[1]}`, id: match[1], kind: 'signed' };
  if (!EVENTS.includes(match[2])) throw new CertificateError('Invalid certificate event.');
  return { table: 'qld_certificate_events', column: 'event_data', filter: `certificate_id=eq.${match[1]}&event_type=eq.${match[2]}`, id: match[1], kind: match[2] };
}
export class CertificateStore {
  constructor(env = process.env, fetchImpl = fetch) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new CertificateError('Private certificate database is not configured.', 503);
    this.origin = env.SUPABASE_URL.replace(/\/$/, '');
    this.headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    this.fetch = fetchImpl;
  }
  async call(path, init = {}) {
    return this.fetch(`${this.origin}${path}`, { ...init, headers: { ...this.headers, ...init.headers }, signal: AbortSignal.timeout(12000) });
  }
  async setup() {
    for (const table of ['qld_certificate_requests', 'qld_certificate_signatures', 'qld_certificate_events']) {
      const check = await this.call(`/rest/v1/${table}?select=*&limit=0`);
      if (!check.ok) throw new CertificateError('Apply the certificate PostgreSQL migration in Supabase before initialising PDF storage.', 503);
    }
    const existing = await this.call(`/storage/v1/bucket/${BUCKET}`);
    if (existing.ok) {
      if ((await existing.json()).public !== false) throw new CertificateError('Certificate PDF storage must be private. Setup stopped.', 503);
      return;
    }
    const created = await this.call('/storage/v1/bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 5242880, allowed_mime_types: ['application/pdf'] }) });
    if (!created.ok) throw new CertificateError('Could not initialise private certificate PDF storage.', 503);
  }
  async get(path, binary = false) {
    if (!binary) {
      const loc = certificateRecordLocation(path);
      const response = await this.call(`/rest/v1/${loc.table}?${loc.filter}&select=${loc.column}&limit=1`);
      if (!response.ok) throw new CertificateError('Certificate database could not be read. Verify the PostgreSQL migration and retry.', 503);
      return (await response.json())[0]?.[loc.column] || null;
    }
    this.validatePdfPath(path);
    const response = await this.call(`/storage/v1/object/authenticated/${BUCKET}/${path}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 404 || String(body.statusCode) === '404' || ['not_found', 'NoSuchKey'].includes(body.code) || body.error === 'not_found') return null;
      throw new CertificateError('Certificate PDF could not be read. Please retry.', 503);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  validatePdfPath(path) {
    if (!new RegExp(`^records/${ID}/certificate\\.pdf$`, 'i').test(path)) throw new CertificateError('Invalid certificate PDF path.');
  }
  async put(path, value, binary = false) {
    let response;
    if (!binary) {
      const loc = certificateRecordLocation(path);
      const row = loc.kind === 'request' ? { id: loc.id, request_data: value, created_at: value.createdAt, expires_at: value.expiresAt }
        : loc.kind === 'signed' ? { certificate_id: loc.id, signature_data: value, signed_at: value.signedAt, test_date: value.testDate }
          : { certificate_id: loc.id, event_type: loc.kind, event_data: value };
      response = await this.call(`/rest/v1/${loc.table}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (response.status === 409 && body.code === '23505') return false;
        throw new CertificateError('Certificate database write failed. Refresh the tracker to check what was saved before retrying.', 503);
      }
      return true;
    }
    this.validatePdfPath(path);
    response = await this.call(`/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: value });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 || String(body.statusCode) === '409' || ['already_exists', 'KeyAlreadyExists', 'ResourceAlreadyExists'].includes(body.code) || body.error === 'Duplicate') return false;
      throw new CertificateError('Certificate PDF could not be saved. Refresh the tracker before retrying.', 503);
    }
    return true;
  }
  async list(offset = 0) {
    const response = await this.call(`/rest/v1/qld_certificate_requests?select=id&order=created_at.desc,id.desc&limit=25&offset=${Math.max(0, Math.floor(Number(offset) || 0))}`);
    if (!response.ok) throw new CertificateError('Certificate tracker database is unavailable. Verify the PostgreSQL migration.', 503);
    return (await response.json()).map(row => ({ name: `${row.id}.json` }));
  }
}
