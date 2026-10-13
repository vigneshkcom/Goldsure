import { CertificateError } from './qld-certificate-model.js';
import { normaliseFieldworker } from './dataforce-purchase-orders.js';

export function certificateElectrician(worker, now = new Date()) {
  const base = normaliseFieldworker(worker);
  if (!Number.isInteger(base.id) || base.id < 1) return null;
  const ability = worker.abilities?.find(item => item.name === 'QLD Smoke + LED');
  if (ability && ability.setting !== true) return null;
  const attributes = Array.isArray(worker.attributes) ? worker.attributes : [];
  const find = names => attributes.find(item => names.includes(String(item.name).trim().toLowerCase()));
  const contractor = find(['electrical contractor licence number', 'electrical contractor license number', 'contractor licence number', 'contractor license number']);
  const electrical = find(['electrical license number', 'electrical licence number']);
  const expiry = find(['electrical license expiry', 'electrical licence expiry']);
  const text = value => String(value || '').trim();
  const expiryDate = /^\d{4}-\d{2}-\d{2}/.test(text(expiry?.value)) ? text(expiry.value).slice(0, 10) : '';
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Australia/Brisbane',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  // Explicit allowlist: the Dataforce payload also contains apiPassword and tax IDs.
  return { id: base.id, name: base.name, companyName: base.companyName, email: base.email, phone: base.phone,
    contractorLicence: text(contractor?.value), recordedElectricalLicence: text(electrical?.value),
    licenceSource: text(contractor?.name || electrical?.name), electricalLicenceExpiry: expiryDate,
    electricalLicenceExpired: Boolean(expiryDate && expiryDate < today) };
}

export async function listCertificateElectricians(env = process.env, fetchImpl = fetch) {
  if (!env.DATAFORCE_CLIENT_ID || !env.DATAFORCE_CLIENT_SECRET) throw new CertificateError('Dataforce is not configured.', 503);
  const auth = await fetchImpl('https://asap-api.dataforce.com.au/authorization/token', {method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${env.DATAFORCE_CLIENT_ID}:${env.DATAFORCE_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'appointment customer fieldworker job'}),signal:AbortSignal.timeout(10000)});
  const token = await auth.json();
  if (!auth.ok || !token.access_token) throw new CertificateError('Dataforce authentication failed. You can enter electrician details manually.',502);
  const response = await fetchImpl('https://asap-api.dataforce.com.au/GOLDSURE_ASAP/fieldworkers', {headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new CertificateError('Could not load Dataforce electricians. Retry or enter their details manually.',502);
  const body = await response.json();
  if (!Array.isArray(body.records) || Number(body.totalCount || 0) > body.records.length) throw new CertificateError('Dataforce returned an incomplete electrician list. Please enter details manually.',502);
  return {electricians:body.records.map(worker => certificateElectrician(worker)).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name))};
}
