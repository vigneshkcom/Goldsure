import { parseAudience, delivery, matchesRecipient, localDate } from './campaign-model.js';

const $ = id => document.getElementById(id);
let selected = [], recipients = [], campaign = null, unlocked = false, busy = false;
let sending = false, sendTimer = null, generation = 0, refreshing = false;
const endpoint = '/api/battery/request-callback';
const campaignNames = { draft: 'Draft', ready: 'Ready to send', sending: 'Sending', paused: 'Paused', completed: 'Completed' };

function message(text, error = false) { $('sender-status').textContent = text; $('sender-status').classList.toggle('error', error); }
function textElement(tag, text, className) { const element = document.createElement(tag); element.textContent = text; if (className) element.className = className; return element; }
function badge(label, tone) { return textElement('span', label, `badge ${tone}`); }
function controls() {
  const status = campaign?.campaign.status;
  $('stage-audience').disabled = busy || sending || status === 'sending' || !selected.length;
  $('start-campaign').disabled = busy || sending || !campaign?.pending || !unlocked;
  $('start-campaign').textContent = status === 'sending' || status === 'paused' ? 'Resume sending' : 'Start sending';
  $('pause-campaign').disabled = busy || (!sending && status !== 'sending');
  $('retry-stuck').disabled = busy || sending || !unlocked;
}
async function request(action, extra = {}) {
  const response = await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, password: $('portal-password').value, ...extra }), signal: AbortSignal.timeout(45000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { unlocked = false; recipients = []; renderRecipients(); controls(); }
    throw new Error(data.error || 'The server did not return a result. Refresh the customer list before retrying.');
  }
  return data;
}
async function loadStats() {
  const response = await fetch(`${endpoint}?action=battery-campaign-stats`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Campaign summary unavailable.');
  campaign = data;
  const status = data.campaign.status, label = campaignNames[status] || status;
  $('campaign-status').textContent = label;
  $('campaign-status').className = `badge ${status === 'sending' ? 'blue' : status === 'completed' ? 'green' : 'neutral'}`;
  $('stats-note').textContent = data.campaign.name;
  $('audience-count').textContent = `${data.total} customer${data.total === 1 ? '' : 's'}`;
  $('send-state').textContent = status === 'sending' && !sending ? 'Awaiting resume in this browser' : label;
  const fields = [['Customers', data.total], ['Sent', data.sent], ['Opened / viewed', data.opened], ['Clicked', data.clicked], ['Failed / bounced', data.failed], ['Unsubscribed', data.unsubscribed], ['Callbacks', data.callbacks]];
  $('stats').replaceChildren(...fields.map(([title, count]) => {
    const card = textElement('div', '', 'stat'); card.append(textElement('strong', count ?? 0), textElement('span', title)); return card;
  }));
  controls();
}
function eventCell(row, timestamp, yes, no, tone = 'green') {
  const td = textElement('td', '', 'event-cell');
  td.append(timestamp ? badge(yes, tone) : textElement('span', no, 'muted'));
  if (timestamp) td.append(textElement('time', localDate(timestamp), 'event-date'));
  row.append(td);
}
function renderRecipients() {
  const search = $('recipient-search').value, filter = $('recipient-filter').value;
  const visible = recipients.filter(row => matchesRecipient(row, search, filter));
  const fragment = document.createDocumentFragment();
  visible.forEach(customer => {
    const row = document.createElement('tr');
    const name = textElement('td', '', 'customer-col');
    name.append(textElement('div', [customer.first_name, customer.last_name].filter(Boolean).join(' ') || 'Customer', 'customer-name'), textElement('span', customer.email, 'secondary-text'));
    const contact = textElement('td', customer.phone || 'No phone');
    contact.append(textElement('span', customer.job_id ? `Job ${customer.job_id}` : 'No job ID', 'secondary-text'));
    const state = delivery(customer), status = document.createElement('td'); status.append(badge(state.label, state.tone));
    row.append(name, contact, status);
    eventCell(row, customer.sent_at, 'Sent', customer.delivery_status === 'sent' ? 'Sent · time unavailable' : 'Not confirmed');
    eventCell(row, customer.opened_at, 'Opened', 'No open recorded', 'blue');
    eventCell(row, customer.clicked_at, 'Clicked', 'No click recorded', 'blue');
    eventCell(row, customer.callback_requested_at, 'Requested', 'No request');
    eventCell(row, customer.unsubscribed_at, 'Opted out', '—', 'neutral');
    const issue = textElement('td', '', 'issue-col');
    issue.append(textElement('span', localDate(customer.updated_at) || '—', 'secondary-text'));
    let detail = customer.send_error || '';
    if (!detail && state.label === 'Unconfirmed') detail = 'No confirmed result. Check the sent mailbox before retrying.';
    if (detail) issue.append(textElement('div', detail, 'issue-text'));
    else issue.append(textElement('span', customer.sent_at ? 'Accepted by Hostinger' : customer.delivery_status === 'pending' ? 'Waiting in queue' : '—', 'secondary-text'));
    row.append(issue); fragment.append(row);
  });
  // Replacing only the body keeps the scroll position and sticky headings stable.
  $('recipient-body').replaceChildren(fragment);
  $('row-count').textContent = `${visible.length} of ${recipients.length} customers`;
  $('empty-state').hidden = visible.length > 0;
  $('empty-state').textContent = !unlocked ? 'Unlock the customer list using the portal password above.' : recipients.length ? 'No customers match this search or filter.' : 'No customers uploaded yet.';
}
async function loadRecipients() {
  const data = await request('battery-campaign-recipients');
  recipients = data.recipients; unlocked = true;
  $('access-status').textContent = 'Customer details unlocked. Automatic refresh is on.';
  $('table-message').textContent = 'Delivery history is retained, including sent emails and unsubscribes. Opens / viewed means a tracking pixel was loaded.';
  $('table-message').classList.remove('error');
  $('refresh-note').textContent = `Updated ${new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  renderRecipients(); controls();
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try { await Promise.all([loadStats(), ...(unlocked ? [loadRecipients()] : [])]); }
  catch (error) { $('table-message').textContent = `Refresh unavailable: ${error.message} Displayed details may be out of date.`; $('table-message').classList.add('error'); }
  finally { refreshing = false; }
}
async function connect() {
  if (!$('portal-password').value) { $('access-status').textContent = 'Enter your portal password first.'; return; }
  try { await loadRecipients(); await loadStats(); }
  catch (error) { $('access-status').textContent = error.message; }
}
function stopLoop() { sending = false; generation++; clearTimeout(sendTimer); sendTimer = null; controls(); }
async function sendNext(run) {
  if (!sending || run !== generation) return;
  try {
    const result = await request('battery-campaign-send-next');
    if (run !== generation) return;
    await refresh();
    if (result.state !== 'sending') { stopLoop(); message(result.state === 'completed' ? 'Campaign finished. Review each customer’s result below.' : 'Sending paused. Review the customer table below.'); await refresh(); return; }
    message(result.failed ? 'The last email failed. Its error is shown in the customer table. Next attempt in one minute.' : result.sent ? 'Email accepted by Hostinger. The customer table has updated. Next email in one minute.' : 'Waiting for the next available customer.');
    sendTimer = setTimeout(() => sendNext(run), 60000);
  } catch (error) { stopLoop(); message(`Sending stopped: ${error.message}`, true); await refresh(); }
}
$('audience-file').addEventListener('change', async event => {
  selected = []; $('audience-ready').hidden = true; controls(); const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Please choose a CSV smaller than 2 MB.');
    const parsed = parseAudience(await file.text()); selected = parsed.recipients;
    $('audience-ready').textContent = `${selected.length} valid customers ready to upload. ${parsed.duplicates} duplicate rows skipped. ${parsed.invalid} rows missing a valid email or first name skipped.`;
  } catch (error) { $('audience-ready').textContent = error.message; }
  $('audience-ready').hidden = false; controls();
});
$('stage-audience').addEventListener('click', async () => {
  busy = true; controls();
  try {
    const data = await request('battery-campaign-import', { recipients: selected });
    await loadRecipients(); await loadStats();
    message(`${data.imported} new customers uploaded; ${data.skipped} existing customers kept with their original history. Review the table, then click Start sending.`);
  } catch (error) { message(error.message, true); } finally { busy = false; controls(); }
});
$('start-campaign').addEventListener('click', async () => {
  if (sending || busy) return; busy = true; controls();
  try { await request('battery-campaign-start'); sending = true; generation++; const run = generation; message('Sending started. Customer results will update below.'); await refresh(); void sendNext(run); }
  catch (error) { stopLoop(); message(error.message, true); } finally { busy = false; controls(); }
});
$('pause-campaign').addEventListener('click', async () => {
  stopLoop(); busy = true; controls();
  try { await request('battery-campaign-pause'); message('Campaign paused. An email already in progress may still finish.'); await refresh(); }
  catch (error) { message(error.message, true); } finally { busy = false; controls(); }
});
$('retry-stuck').addEventListener('click', async () => {
  if (!confirm('Only use this after checking Hostinger’s sent mailbox. An unconfirmed email may already have been sent, so retrying may create a duplicate. Reset interrupted sends?')) return;
  busy = true; controls();
  try { const result = await request('battery-campaign-retry-stuck'); message(result.reset ? `${result.reset} interrupted sends queued again. Press Start sending when ready.` : 'No eligible interrupted sends found.'); await refresh(); }
  catch (error) { message(error.message, true); } finally { busy = false; controls(); }
});
$('connect').addEventListener('click', connect);
$('portal-password').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void connect(); } });
$('portal-password').addEventListener('input', () => { unlocked = false; recipients = []; renderRecipients(); controls(); });
$('refresh-recipients').addEventListener('click', connect);
$('recipient-search').addEventListener('input', renderRecipients);
$('recipient-filter').addEventListener('change', renderRecipients);
setInterval(() => { if (!document.hidden) void refresh(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
renderRecipients(); void refresh();
