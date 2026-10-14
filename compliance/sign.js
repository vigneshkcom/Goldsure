import { $, escapeHtml as e, status, api, date, saveBlob } from './common.js';
const [id, token] = location.hash.slice(1).split('.');
const credentials = { id, token };
// No third-party scripts, analytics, storage or query-string tokens on this page.
let record, strokes = [], active = null, submitting = false;
const canvas = $('signatureCanvas'), ctx = canvas.getContext('2d');
function paint() { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#18253a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; for (const stroke of strokes) { ctx.beginPath(); stroke.forEach(([x, y], i) => i ? ctx.lineTo(x * canvas.width, y * canvas.height) : ctx.moveTo(x * canvas.width, y * canvas.height)); ctx.stroke(); } }
function point(event) { const box = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))]; }
canvas.onpointerdown = event => { if (submitting) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); active = [point(event)]; strokes.push(active); };
canvas.onpointermove = event => { if (!active || submitting) return; if (strokes.reduce((n, s) => n + s.length, 0) >= 6000) return; active.push(point(event)); paint(); };
function endStroke() { if (active?.length < 2) strokes.pop(); active = null; }
canvas.onpointerup = endStroke; canvas.onpointercancel = endStroke;
$('clearSignature').onclick = () => { if (!submitting) { strokes = []; active = null; paint(); } };
function completed(at, delivery) { $('signForm').hidden = true; $('completed').hidden = false; status('pageStatus', `Signed ${date(at)}. Your signature is saved.`); $('deliveryStatus').textContent = delivery?.message || 'The final PDF or automatic email is still being processed. Goldsure can recover completion from the tracker. Do not create another certificate.'; }
async function load() {
  if (!id || !token) throw new Error('Open the private link from your Goldsure email or SMS. This page cannot be opened without it.');
  const result = await api('view', credentials); record = result.record;
  const pairs = [['Job number', record.jobNumber || 'Manual entry'], ['Customer', `${record.customerName}\n${record.customerEmail}\n${record.customerAddress}`], ['Work performed for', `${record.workForName}\n${record.workForAddress}\n${record.workForEmail}`], ['Installation address', record.siteAddress], ['Certificate', 'Smoke alarm inspection - testing and compliance (electrical installation)'], ['Electrician', `${record.electricianName}\n${record.electricianEmail}`]];
  $('details').innerHTML = pairs.map(([label, value]) => `<dt>${e(label)}</dt><dd>${e(value)}</dd>`).join('');
  $('declaration').textContent = result.declaration; $('signerName').value = record.electricianName;
  $('testDate').max = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const replacementYear = $('replacementDate'), firstYear = Number($('testDate').max.slice(0, 4));
  replacementYear.innerHTML = '<option value="">Select year (if known)</option><option value="not-applicable">Not applicable - installation date unknown; compliant at time of testing</option>' + Array.from({ length: 21 }, (_, index) => `<option value="${firstYear + index}">${firstYear + index}</option>`).join('');
  $('smokeSection').hidden = false; $('smokeOutcome').required = true;
  $('checks').innerHTML = result.checks.map((label, i) => `<label for="check${i}">${e(label)}</label><select id="check${i}" class="inspection-check" required><option value="">Choose…</option><option>Yes</option><option>No</option><option>Not applicable</option></select>`).join('');
  for (const key of ['testDate', 'contractorName', 'contractorLicence', 'contractorPhone', 'notes', 'smokeOutcome']) if (record.prefill?.[key]) $(key).value = record.prefill[key];
  if (record.prefill?.replacementDate) { const savedReplacement = String(record.prefill.replacementDate); replacementYear.value = savedReplacement === 'not-applicable' ? savedReplacement : savedReplacement.slice(0, 4); }
  [...document.querySelectorAll('.inspection-check')].forEach((input, i) => { input.value = record.prefill?.checks?.[i] || ''; });
  // Prefilled values remain editable; safety, authority and consent stay unchecked.
  $('content').hidden = false; status('pageStatus', 'Please review every detail before signing.');
  if (result.signedAt) completed(result.signedAt, result.delivery);
}
$('signForm').onsubmit = async event => {
  event.preventDefault(); if (submitting) return;
  if (strokes.reduce((n, s) => n + s.length, 0) < 8) return status('signStatus', 'Please draw a clear signature.', true);
  if (!confirm('Sign this certificate and email the completed PDF only to Vignesh for this test? You cannot change the signed record.')) return;
  submitting = true; $('submitSignature').disabled = true; $('clearSignature').disabled = true;
  status('signStatus', 'Saving your signed certificate and preparing the emails. Please keep this page open…');
  const signature = { ...Object.fromEntries(new FormData($('signForm'))), checks: [...document.querySelectorAll('.inspection-check')].map(input => input.value), strokes, certifySafe: $('certifySafe').checked, confirmDetails: $('confirmDetails').checked, consent: $('consent').checked };
  try { const result = await api('sign', { ...credentials, signature }); completed(new Date(), result.delivery); }
  catch (error) { status('signStatus', `${error.message} Your signature may already be saved. You can retry this same submission safely.`, true); }
  finally { submitting = false; $('submitSignature').disabled = false; $('clearSignature').disabled = false; }
};
$('download').onclick = async () => { $('download').disabled = true; try { saveBlob(await api('download', credentials, '', true), `QLD-Contractor-Certificate-${record.jobNumber || id}.pdf`); } catch (error) { status('pageStatus', error.message, true); } finally { $('download').disabled = false; } };
load().catch(error => status('pageStatus', error.message, true));
