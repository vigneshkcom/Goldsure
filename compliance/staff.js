import { $, escapeHtml as e, status, api, date, saveBlob } from './common.js';
let offset = 0, requestId = crypto.randomUUID(), pendingDraft = null, previewUrl = null, busy = false;
const password = () => $('password').value;
$('rows').closest('table').querySelector('thead th:nth-child(3)').textContent = 'Signing request';
const prefillKeys = ['testDate', 'contractorName', 'contractorLicence', 'contractorPhone', 'smokeOutcome', 'replacementDate', 'notes'];
const prefillId = key => `prefill${key[0].toUpperCase()}${key.slice(1)}`;
const draft = () => ({ ...Object.fromEntries(new FormData($('draftForm'))), smokeInspection: $('smokeInspection').checked, prefill: { ...Object.fromEntries(prefillKeys.map(key => [key, $(prefillId(key)).value])), checks: [...document.querySelectorAll('.prefill-check')].map(input => input.value) } });
const checkLabels = ['Alarms are photoelectric', 'Alarms are interconnected', 'Alarms comply with AS 3786:2014', 'Power supply and backup are suitable for the installation', 'An alarm is installed on each required storey', 'An alarm is installed in each required bedroom', 'Hallway and exit-path placement meets applicable requirements'];
$('prefillChecks').innerHTML = checkLabels.map((label, i) => `<label for="prefillCheck${i}">${e(label)}</label><select id="prefillCheck${i}" class="prefill-check"><option value="">Leave for electrician</option><option>Yes</option><option>No</option><option>Not applicable</option></select>`).join('');
function deliveryChanged() { $('electricianEmail').required = $('deliveryMethod').value === 'email'; $('electricianEmail').previousElementSibling.textContent = $('deliveryMethod').value === 'email' ? "Electrician's email" : "Electrician's email (optional for SMS)"; }
$('deliveryMethod').onchange = deliveryChanged;
$('smokeInspection').onchange = () => { $('prefillSmoke').hidden = !$('smokeInspection').checked; };
function openSms(sms) {
  const key = crypto.randomUUID();
  sessionStorage.setItem(`qld-certificate-sms:${key}`, JSON.stringify({ ...sms, createdAt: Date.now() }));
  location.assign(`/sms/#certificate-draft=${key}`);
}
async function run(button, target, work) {
  button.disabled = true; status(target, 'Working…');
  try { await work(); } catch (error) { status(target, error.message, true); } finally { if (!['prev', 'next'].includes(button.id)) button.disabled = false; }
}
async function load() {
  const result = await api('list', { offset }, password());
  $('rows').innerHTML = result.rows.length ? result.rows.map(row => `<tr><td><strong>${e(row.customerName)}</strong><small>${e(row.customerEmail)}</small><small>Job ${e(row.jobNumber || 'Manual')} • ${e(date(row.createdAt))}</small></td><td>${e(row.electricianName)}<small>${e(row.electricianEmail)}</small><small>${e(row.electricianPhone)}</small></td><td><span class="pill ${row.invitation === 'accepted' ? 'good' : 'warn'}">${e(row.invitation)}</span>${row.expired && !row.signedAt ? '<small>Link expired</small>' : ''}</td><td>${e(date(row.viewedAt))}</td><td>${e(date(row.signedAt))}</td><td><span class="pill ${row.delivery === 'accepted' ? 'good' : ''}">${e(row.delivery)}</span></td><td>${row.signedAt ? `<button data-download="${row.id}" data-job="${e(row.jobNumber)}">Download PDF</button>${row.delivery === 'pending / check' ? `<button data-finish="${row.id}">Recover completion</button>` : ''}` : row.expired ? 'Link expired' : `<button data-sms="${row.id}">Open signing link in SMS</button>`}</td></tr>`).join('') : '<tr><td colspan="7">No certificate requests on this page. Prepare your first request above.</td></tr>';
  $('prev').disabled = offset === 0; $('next').disabled = !result.hasMore; $('pageLabel').textContent = `Page ${offset / 25 + 1}`;
  status('trackerStatus', `Updated ${date(new Date())}. No emails are sent by refreshing.`);
}
for (const id of ['unlock', 'refresh']) $(id).addEventListener('click', () => run($(id), id === 'unlock' ? 'accessStatus' : 'trackerStatus', async () => { await load(); status('accessStatus', 'Staff access unlocked for this page only.'); }));
$('lookup').onclick = () => run($('lookup'), 'lookupStatus', async () => {
  const result = await api('lookup', { jobNumber: $('lookupNumber').value.trim() }, password());
  for (const key of ['jobNumber', 'customerName', 'customerEmail', 'customerPhone', 'customerAddress', 'siteAddress', 'state']) $(key).value = result[key] || '';
  status('lookupStatus', result.source);
});
$('copyCustomer').onclick = () => { for (const suffix of ['Name', 'Address', 'Email']) $(`workFor${suffix}`).value = $(`customer${suffix}`).value; };
$('draftForm').onsubmit = event => {
  event.preventDefault();
  run(event.submitter, 'draftStatus', async () => {
    pendingDraft = draft();
    const pdf = await api('preview', { draft: pendingDraft }, password(), true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(pdf); $('preview').src = previewUrl;
    $('reviewRecipients').textContent = `Signing request: ${pendingDraft.electricianName}, ${pendingDraft.deliveryMethod === 'sms' ? `SMS to ${pendingDraft.electricianPhone || 'a number you will enter'} (editable in the SMS portal; nothing sent automatically)` : `email to ${pendingDraft.electricianEmail}`}. After signing: ${[...new Set([pendingDraft.customerEmail, pendingDraft.workForEmail, 'vignesh@goldsure.com.au'])].join(', ')}.`;
    $('confirmSend').textContent = pendingDraft.deliveryMethod === 'sms' ? 'Save & open SMS portal' : 'Send to electrician';
    $('reviewConfirmed').checked = false; $('confirmSend').disabled = true; status('sendStatus', ''); $('review').showModal(); status('draftStatus', 'Preview ready. No email has been sent.');
  });
};
$('reviewConfirmed').onchange = () => { $('confirmSend').disabled = !$('reviewConfirmed').checked || busy; };
$('closeReview').onclick = () => { if (!busy) $('review').close(); };
$('review').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
$('confirmSend').onclick = async () => {
  if (busy || !$('reviewConfirmed').checked) return;
  busy = true; $('confirmSend').disabled = true; $('closeReview').disabled = true;
  status('sendStatus', pendingDraft.deliveryMethod === 'sms' ? 'Saving request and preparing the SMS draft. Nothing will be sent yet…' : 'Saving request and sending the private link…');
  try {
    const result = await api(pendingDraft.deliveryMethod === 'sms' ? 'prepare-sms' : 'send', { id: requestId, draft: pendingDraft, confirmSend: true }, password());
    if (result.sms) { openSms(result.sms); return; }
    status('sendStatus', `Request ${result.id}: ${result.invitation.message}`, result.invitation.status !== 'accepted');
    status('draftStatus', `Request saved. Invitation: ${result.invitation.status}. Use New request for another certificate.`);
    await load();
  } catch (error) { status('sendStatus', error.message, true); }
  finally { busy = false; $('closeReview').disabled = false; /* Same request ID makes retries safe. */ $('confirmSend').disabled = false; }
};
$('newDraft').onclick = () => { if (!confirm('Start a new certificate request? Unsaved form entries will be cleared.')) return; $('draftForm').reset(); deliveryChanged(); $('prefillSmoke').hidden = false; requestId = crypto.randomUUID(); pendingDraft = null; status('draftStatus', 'New draft. Nothing sent.'); };
$('prev').onclick = () => run($('prev'), 'trackerStatus', async () => { offset = Math.max(0, offset - 25); await load(); $('prev').disabled = offset === 0; });
$('next').onclick = () => run($('next'), 'trackerStatus', async () => { offset += 25; await load(); });
$('rows').onclick = event => {
  const button = event.target.closest('button'); if (!button) return;
  run(button, 'trackerStatus', async () => {
    if (button.dataset.sms) openSms(await api('sms-link', { id: button.dataset.sms }, password()));
    if (button.dataset.download) { const pdf = await api('download', { id: button.dataset.download }, password(), true); saveBlob(pdf, `QLD-Contractor-Certificate-${button.dataset.job || button.dataset.download}.pdf`); status('trackerStatus', 'Signed PDF downloaded.'); }
    if (button.dataset.finish) { const result = await api('finish', { id: button.dataset.finish }, password()); await load(); status('trackerStatus', result.delivery.message, result.delivery.status !== 'accepted'); }
  });
};
