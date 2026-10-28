import { calculateDocument, validateDraft } from './hws-document-model.js';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const textFields = ['number', 'date', 'customer', 'address', 'email'];
const amounts = ['stcDiscount', 'veecDiscount', 'solar', 'payments', 'deposit'];
const documentName = data => `${data.number.trim() || 'Draft'}- ${data.type === 'quote' ? 'Quote' : 'Tax Invoice'}`;
let dirty = false;
let draftUrl;
let emailReview;
let quotePdfUrl;
let submittingEmail = false;


function grow(element) {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight + (element.classList.contains('description') ? 0 : 2)}px`;
}

function addItem(item = { description: '', quantity: 1, rate: 0 }) {
  if ($('items').children.length >= 50) return;
  const row = document.createElement('tr');
  row.innerHTML = '<td><button class="remove screen-only" type="button" aria-label="Remove item">×</button><textarea class="description" rows="1" maxlength="2000" aria-label="Item description"></textarea></td><td><input class="quantity" type="number" min="0" max="10000000" step="0.01" aria-label="Item quantity"></td><td><input class="rate" type="number" min="0" max="10000000" step="0.01" aria-label="Unit price excluding GST"></td><td><output class="line-total"></output></td>';
  row.querySelector('.description').value = item.description;
  row.querySelector('.quantity').value = !item.description && !item.quantity && !item.rate ? '' : item.quantity;
  row.querySelector('.rate').value = !item.description && !item.quantity && !item.rate ? '' : item.rate;
  row.querySelector('.remove').addEventListener('click', () => {
    row.remove();
    if (!$('items').children.length) addItem();
    dirty = true;
    update();
  });
  $('items').append(row);
  grow(row.querySelector('textarea'));
}

function read() {
  return {
    version: 1, type: $('type').value,
    invoiceDueDate: $('invoice-due-date').value || $('date').value,
    ...Object.fromEntries(textFields.map(field => [field, $(field).value])),
    ...Object.fromEntries(amounts.map(field => [field, Number($(field).value || 0)])),
    items: [...$('items').children].map(row => ({
      description: row.querySelector('.description').value,
      quantity: Number(row.querySelector('.quantity').value || 0),
      rate: Number(row.querySelector('.rate').value || 0)
    }))
  };
}

function update() {
  const data = read();
  const totals = calculateDocument(data);
  totals.lines.forEach((value, index) => $('items').children[index].querySelector('output').textContent = data.items[index].description || data.items[index].quantity || data.items[index].rate ? money(value) : '');
  for (const field of ['subtotal', 'gst', 'total', 'grandTotal', 'due']) $(field).textContent = money(totals[field]);
  $('reference').textContent = data.number;
  const quote = data.type === 'quote';
  const deposit = Math.round(data.deposit * 100);
  $('deposit-summary-row').hidden = $('deposit-balance-row').hidden = !quote || deposit <= 0;
  $('deposit').setCustomValidity(quote && deposit > totals.grandTotal ? 'The deposit cannot exceed the quoted total.' : '');
  $('deposit-summary').textContent = money(deposit);
  $('deposit-balance').textContent = money(totals.grandTotal - deposit);
  $('preview-email').disabled = !quote;
  $('deposit').disabled = !quote;
  $('invoice-due-date').disabled = !quote || deposit <= 0;
  $('deposit-explanation').textContent = !quote ? 'Choose Quote above to email a quotation or request a deposit.' : deposit > 0
    ? `Request ${money(deposit)} by bank transfer using reference ${data.number || '(enter quote number)'}. Balance after deposit payment: ${money(totals.grandTotal - deposit)}. This does not record a payment received.`
    : 'Leave the deposit at $0 to email the quote without requesting a deposit.';
  $('heading').textContent = quote ? 'QUOTE' : 'TAX INVOICE';
  $('number-label').textContent = quote ? 'QUOTE NUMBER' : 'INVOICE NUMBER';
  $('date-label').textContent = quote ? 'QUOTE DATE' : 'INVOICE DATE';
  $('payment-row').hidden = quote;
  $('due-label').textContent = quote ? 'Quoted Amount' : totals.due < 0 ? 'Credit Balance' : 'Amount Due';
  $('due').textContent = money(Math.abs(totals.due));
  document.title = documentName(data);
  $('add').disabled = data.items.length >= 50;
}

function showStatus(message) { $('status').textContent = message; }

function newDocument() {
  $('document').reset();
  $('email').value = '';
  $('deposit').value = '0';
  emailReview = undefined;
  $('email-status').textContent = '';
  $('type').value = 'invoice';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  $('date').value = `${parts.year}-${parts.month}-${parts.day}`;
  $('invoice-due-date').value = $('date').value;

  $('items').replaceChildren();
  for (let index = 0; index < 8; index++) addItem({ description: '', quantity: 0, rate: 0 });
  $('document').querySelectorAll('textarea').forEach(grow);
  dirty = false;
  showStatus('');
  update();
}

$('document').addEventListener('submit', event => event.preventDefault());
$('document').addEventListener('input', event => {
  dirty = true;
  if (event.target.tagName === 'TEXTAREA') grow(event.target);
  update();
});
$('type').addEventListener('change', () => { dirty = true; update(); });
for (const field of ['email', 'deposit', 'invoice-due-date']) $(field).addEventListener('input', () => { dirty = true; update(); });
$('add').addEventListener('click', () => { addItem(); dirty = true; update(); });
$('new').addEventListener('click', () => {
  if (dirty && !confirm('Start a new document? Save your current draft first if you need to keep it.')) return;
  newDocument();
});
$('save').addEventListener('click', () => {
  try {
    const data = validateDraft(read());
    if (draftUrl) URL.revokeObjectURL(draftUrl);
    draftUrl = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = draftUrl;
    link.download = `${documentName(data).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')}.json`;
    link.click();
    dirty = false;
    showStatus('Draft download requested. Keep this file to reopen and edit the document.');
  } catch (error) { showStatus(error.message); }
});
$('load').addEventListener('click', () => {
  if (dirty && !confirm('Open another draft and replace this document? Save your current draft first if needed.')) return;
  $('file').click();
});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  try {
    if (file.size > 1000000) throw new Error('This draft is too large. Choose a Goldsure HWS draft under 1 MB.');
    const data = validateDraft(JSON.parse(await file.text()));
    emailReview = undefined;
    $('email-status').textContent = '';
    $('type').value = data.type;
    for (const field of [...textFields, ...amounts]) $(field).value = data[field];
    $('invoice-due-date').value = data.invoiceDueDate || data.date;
    $('items').replaceChildren();
    data.items.forEach(addItem);
    $('document').querySelectorAll('textarea').forEach(grow);
    dirty = false;
    update();
    showStatus('Draft opened.');
  } catch (error) { showStatus(`Could not open draft: ${error.message}`); }
  $('file').value = '';
});

function preparePrint() {
  document.querySelectorAll('.print-value').forEach(element => element.remove());
  $('document').querySelectorAll('input, textarea').forEach(input => {
    const value = document.createElement('span');
    value.className = 'print-value';
    value.dataset.field = input.id || input.className;
    if (input.type === 'date' && input.value) {
      const [year, month, day] = input.value.split('-');
      value.textContent = `${day}/${month}/${year}`;
    } else if (['stcDiscount', 'veecDiscount', 'solar', 'payments'].includes(input.id)) value.textContent = money(Math.round(Number(input.value || 0) * 100));
    else value.textContent = input.value;
    input.after(value);
  });
}
$('print').addEventListener('click', async () => {
  if (!$('document').reportValidity() || !$('deposit').reportValidity()) return;
  const data = read();
  if (!data.items.some(item => item.description.trim() && item.quantity > 0)) {
    showStatus('Enter at least one item description and quantity before printing.');
    return;
  }
  if (data.items.some(item => (item.quantity > 0 || item.rate > 0) && !item.description.trim())) {
    showStatus('Add a description to every priced item before printing.');
    return;
  }
  if (calculateDocument(data).grandTotal < 0) {
    showStatus('Rebates exceed the total. Check the amounts before printing.');
    return;
  }
  await document.fonts.ready;
  await Promise.all([...document.querySelectorAll('.document-logo img')].map(img => img.decode().catch(() => {})));
  preparePrint();
  window.print();
});
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
newDocument();

async function emailApi(payload) {
  const response = await fetch('/api/hotwater/document-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Email request could not be confirmed. Check Xero and the Hostinger Sent folder before trying again.');
  return result;
}

$('preview-email').addEventListener('click', async () => {
  if (!$('document').reportValidity() || !$('email').reportValidity() || !$('deposit').reportValidity() || !$('invoice-due-date').reportValidity()) return;
  $('preview-email').disabled = true;
  $('email-status').textContent = 'Preparing email preview…';
  try {
    const document = read();
    const payload = { action: 'preview', document };
    const preview = await emailApi(payload);
    emailReview = { document, reviewToken: preview.reviewToken };
    $('preview-to').textContent = `To: ${preview.to} · From: Goldsure’s connected Hostinger mailbox`;
    $('preview-subject').textContent = `Subject: ${preview.subject}`;
    $('preview-attachment').textContent = `Automatically attached: ${preview.attachment}`;
    if (quotePdfUrl) URL.revokeObjectURL(quotePdfUrl);
    quotePdfUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(preview.pdfContent), char => char.charCodeAt(0))], { type: 'application/pdf' }));
    $('preview-pdf').href = quotePdfUrl;

    $('email-frame').srcdoc = preview.html;
    $('xero-preview').hidden = !preview.xeroInvoice;
    $('xero-preview-lines').replaceChildren();
    $('send-email').textContent = preview.xeroInvoice ? 'Create Xero invoice & send email' : 'Send email via Hostinger';
    if (preview.xeroInvoice) {
      const plan = preview.xeroInvoice;
      const [year, month, day] = plan.dueDate.split('-');
      $('xero-preview-details').textContent = `Invoice ${plan.invoiceNumber} · Awaiting payment · Due ${day}/${month}/${year} · Amounts include GST. Total ${money(plan.lineItems.reduce((sum, item) => sum + Math.round(item.unitAmount * 100), 0))}.`;
      for (const item of plan.lineItems) {
        const row = window.document.createElement('tr');
        for (const value of [item.description, money(Math.round(item.unitAmount * 100))]) { const cell = window.document.createElement('td'); cell.textContent = value; row.append(cell); }
        $('xero-preview-lines').append(row);
      }
    }
    $('send-status').textContent = '';
    $('send-email').disabled = false;
    $('email-preview').showModal();
    $('email-status').textContent = 'Preview ready. Review the recipient, deposit and quote before sending.';
  } catch (error) { $('email-status').textContent = error.message; }
  finally { update(); }
});
$('close-email').addEventListener('click', () => { if (!submittingEmail) $('email-preview').close(); });
$('email-preview').addEventListener('cancel', event => { if (submittingEmail) event.preventDefault(); });
$('send-email').addEventListener('click', async () => {
  if (submittingEmail || !emailReview) return;
  if (JSON.stringify(emailReview.document) !== JSON.stringify(read())) {
    $('send-status').textContent = 'The quote changed. Close this preview and preview the current details again.';
    $('send-email').disabled = true;
    return;
  }
  submittingEmail = true;
  $('send-email').disabled = true;
  $('close-email').disabled = true;
  $('send-status').textContent = emailReview.document.deposit > 0 ? 'Creating the Xero customer invoice, then submitting email to Hostinger…' : 'Submitting email to Hostinger…';
  try {
    const result = await emailApi({ action: 'send', ...emailReview });
    $('send-status').textContent = `${result.invoice ? `Xero invoice ${result.invoice.invoiceNumber} ${result.invoice.recoveredExisting ? 'reused' : 'created'} for ${money(Math.round(result.invoice.total * 100))}. ` : ''}Hostinger accepted the email to ${result.recipient}. This does not record the deposit as paid.`;
    if (result.invoice?.url) { const link = document.createElement('a'); link.href = result.invoice.url; link.textContent = ' Open invoice in Xero'; link.target = '_blank'; link.rel = 'noopener'; $('send-status').append(link); }
    $('email-status').textContent = `Deposit/quote email accepted by Hostinger for ${result.recipient}.`;
  } catch (error) { $('send-status').textContent = error.message; }
  finally { emailReview = undefined; submittingEmail = false; $('close-email').disabled = false; }
});
