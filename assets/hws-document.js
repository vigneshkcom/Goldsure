import { calculateDocument, validateDraft } from './hws-document-model.js';

const $ = id => document.getElementById(id);
const money = cents => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const textFields = ['number', 'date', 'customer', 'address'];
const amounts = ['stcDiscount', 'veecDiscount', 'solar', 'payments'];
let dirty = false;
let draftUrl;


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
  $('heading').textContent = quote ? 'QUOTE' : 'TAX INVOICE';
  $('number-label').textContent = quote ? 'QUOTE NUMBER' : 'INVOICE NUMBER';
  $('date-label').textContent = quote ? 'QUOTE DATE' : 'INVOICE DATE';
  $('payment-row').hidden = quote;
  $('due-label').textContent = quote ? 'Quoted Amount' : totals.due < 0 ? 'Credit Balance' : 'Amount Due';
  $('due').textContent = money(Math.abs(totals.due));
  document.title = `Goldsure ${quote ? 'Quote' : 'Tax Invoice'}${data.number ? ` - ${data.number}` : ''}`;
  $('add').disabled = data.items.length >= 50;
}

function showStatus(message) { $('status').textContent = message; }

function newDocument() {
  $('document').reset();
  $('type').value = 'invoice';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  $('date').value = `${parts.year}-${parts.month}-${parts.day}`;

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
    link.download = `Goldsure-HWS-${data.type}-${(data.number || 'draft').replace(/[^a-zA-Z0-9_-]/g, '-')}.json`;
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
    $('type').value = data.type;
    for (const field of [...textFields, ...amounts]) $(field).value = data[field];
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
    if (input.type === 'date' && input.value) {
      const [year, month, day] = input.value.split('-');
      value.textContent = `${day}/${month}/${year}`;
    } else if (['stcDiscount', 'veecDiscount', 'solar', 'payments'].includes(input.id)) value.textContent = money(Math.round(Number(input.value || 0) * 100));
    else value.textContent = input.value;
    value.style.cssText = input.style.cssText;
    input.after(value);
  });
}
$('print').addEventListener('click', () => {
  if (!$('document').reportValidity()) return;
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
  preparePrint();
  window.print();
});
window.addEventListener('beforeprint', preparePrint);
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
newDocument();
