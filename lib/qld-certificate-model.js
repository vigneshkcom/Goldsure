import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const OFFICE_EMAIL = 'vignesh@goldsure.com.au';
export const CHECKS = [
  'Alarms are photoelectric', 'Alarms are interconnected', 'Alarms comply with AS 3786:2014',
  'Power supply and backup are suitable for the installation', 'An alarm is installed on each required storey',
  'An alarm is installed in each required bedroom', 'Hallway and exit-path placement meets applicable requirements',
];
export const DECLARATIONS = {
  installation: 'I certify that the electrical installation, to the extent affected by the electrical work described, has been tested to ensure it is electrically safe and complies with the wiring rules and other standards applying under the Electrical Safety Regulation 2026.',
  equipment: 'I certify that the electrical equipment, to the extent affected by the electrical work described, has been tested to ensure it is electrically safe.',
};
export class CertificateError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function constantEqual(a, b) {
  return timingSafeEqual(Buffer.from(hash(String(a || ''))), Buffer.from(hash(String(b || ''))));
}
export function signingToken(id, secret) {
  if (!secret) throw new CertificateError('Certificate access is not configured.', 503);
  return createHmac('sha256', secret).update(`qld-certificate-v1:${id}`).digest('base64url');
}
export function textField(value, label, max = 180, required = true) {
  const valueText = String(value ?? '').trim();
  if ((required && !valueText) || valueText.length > max || /[\x00-\x08\x0b-\x1f]/.test(valueText)) throw new CertificateError(`Check ${label} (maximum ${max} characters).`);
  return valueText;
}
export function emailField(value, label) {
  const result = textField(value, label, 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result)) throw new CertificateError(`Enter a valid ${label}.`);
  return result;
}
export function requestFields(input = {}) {
  const out = {};
  for (const key of ['customerName', 'customerAddress', 'siteAddress', 'electricianName', 'workForName', 'workForAddress']) out[key] = textField(input[key], key, key.includes('Address') ? 250 : 120);
  out.customerEmail = emailField(input.customerEmail, 'customer email');
  out.deliveryMethod = input.deliveryMethod || 'email';
  if (!['email', 'sms'].includes(out.deliveryMethod)) throw new CertificateError('Choose email or SMS for the signing request.');
  out.electricianEmail = out.deliveryMethod === 'sms' && !input.electricianEmail ? '' : emailField(input.electricianEmail, 'electrician email');
  out.electricianPhone = phoneField(input.electricianPhone);
  out.workForEmail = emailField(input.workForEmail, 'work commissioning party email');
  out.customerPhone = textField(input.customerPhone, 'customer phone', 40, false);
  out.jobNumber = textField(input.jobNumber, 'job number', 40, false);
  out.workDescription = textField(input.workDescription, 'work / equipment details', 1400);
  if (!['installation', 'equipment'].includes(input.certificateType)) throw new CertificateError('Select the certificate type.');
  out.certificateType = input.certificateType;
  out.smokeInspection = input.smokeInspection === true;
  if (input.state !== 'QLD') throw new CertificateError('This certificate workflow is for Queensland only.');
  out.state = 'QLD';
  out.prefill = prefillFields(input.prefill, out.smokeInspection);
  return out;
}
export function phoneField(value) {
  let phone = textField(value, 'electrician mobile', 40, false).replace(/[\s()-]/g, '');
  if (!phone) return '';
  if (/^04\d{8}$/.test(phone)) phone = `+61${phone.slice(1)}`;
  if (/^614\d{8}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+614\d{8}$/.test(phone)) throw new CertificateError('Enter an Australian mobile number, such as 04xxxxxxxx or +614xxxxxxxx.');
  return phone;
}
export function prefillFields(input = {}, smokeInspection = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CertificateError('Invalid prefilled certificate details.');
  const out = {};
  for (const [key, max] of [['contractorName',150],['contractorLicence',40],['contractorPhone',40],['notes',1400]]) out[key] = textField(input[key], key, max, false);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  out.testDate = input.testDate ? dateField(input.testDate, 'prefilled test date', today) : '';
  if (smokeInspection) {
    out.replacementDate = input.replacementDate ? dateField(input.replacementDate, 'replacement date') : '';
    out.smokeOutcome = input.smokeOutcome || '';
    if (!['', 'compliant', 'not-compliant'].includes(out.smokeOutcome)) throw new CertificateError('Invalid prefilled inspection outcome.');
    out.checks = input.checks || CHECKS.map(() => '');
    if (!Array.isArray(out.checks) || out.checks.length !== CHECKS.length || out.checks.some(x => !['', 'Yes', 'No', 'Not applicable'].includes(x))) throw new CertificateError('Check the prefilled inspection items.');
  }
  // Never accept an administrator's signature, safety declaration or consent.
  return out;
}
export function dateField(value, label, latest) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || (latest && date > latest)) throw new CertificateError(`Enter a valid ${label}${latest ? ', not in the future' : ''}.`);
  return date;
}
export function signatureFields(input, request, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (input.confirmDetails !== true || input.consent !== true || input.certifySafe !== true) throw new CertificateError('Confirm the details, electrical safety declaration and electronic signing consent. Do not sign if the declaration is not true.');
  const out = {
    signerName: textField(input.signerName, 'signer name', 120),
    contractorName: textField(input.contractorName, 'name on contractor licence', 150),
    contractorLicence: textField(input.contractorLicence, 'electrical contractor licence', 40),
    contractorPhone: textField(input.contractorPhone, 'contractor phone', 40),
    testDate: dateField(input.testDate, 'test date', today),
    notes: textField(input.notes, 'observations', 1400, false),
    declaration: DECLARATIONS[request.certificateType],
    confirmDetails: true, consent: true, certifySafe: true,
  };
  if (out.signerName.toLowerCase() !== request.electricianName.toLowerCase()) throw new CertificateError('The signer name must match the named electrician. Ask Goldsure to correct the request if necessary.');
  if (request.smokeInspection) {
    if (!['compliant', 'not-compliant'].includes(input.smokeOutcome)) throw new CertificateError('Select the smoke alarm inspection outcome.');
    if (!Array.isArray(input.checks) || input.checks.length !== CHECKS.length || input.checks.some(x => !['Yes', 'No', 'Not applicable'].includes(x))) throw new CertificateError('Complete every smoke alarm inspection item.');
    if (input.smokeOutcome === 'compliant' && input.checks.includes('No')) throw new CertificateError('A compliant smoke alarm outcome cannot include a failed check.');
    if ((input.smokeOutcome === 'not-compliant' || input.checks.includes('Not applicable')) && !out.notes) throw new CertificateError('Explain defects or items marked not applicable in observations.');
    out.smokeOutcome = input.smokeOutcome;
    out.checks = input.checks;
    out.replacementDate = input.replacementDate ? dateField(input.replacementDate, 'replacement date') : '';
  }
  const strokes = input.strokes;
  if (!Array.isArray(strokes) || strokes.length < 1 || strokes.length > 100) throw new CertificateError('Draw your signature.');
  let count = 0, distance = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) throw new CertificateError('Draw a complete signature.');
    for (let i = 0; i < stroke.length; i++) {
      const point = stroke[i]; count++;
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new CertificateError('Invalid signature coordinates.');
      if (i) distance += Math.hypot(point[0] - stroke[i - 1][0], point[1] - stroke[i - 1][1]);
    }
  }
  if (count < 8 || count > 6000 || distance < 0.15) throw new CertificateError('Please draw a clear signature.');
  out.strokes = strokes;
  return out;
}
