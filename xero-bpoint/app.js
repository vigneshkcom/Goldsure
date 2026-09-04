(() => {
  const API_URL = '/api/xero-bpoint';
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const TEMPLATE_HEADERS = [
    'Job No.', 'Customer Name', 'Customer Email', 'Customer Mobile', 'Property Address',
    'Property Suburb', 'Property Postcode', 'Category', 'BPOINT Ref', 'Receipt Number',
    'Transaction Number', 'Payment Date', 'Settlement Date', 'Amount', 'Account',
    'Division', 'Tax Rate', 'Product / Service Description', 'PDF Filename',
  ];
  const state = { password: '', xeroReady: false, rows: [], working: false, totalsVerified: false, results: [], sourceName: '' };
  const el = (id) => document.getElementById(id);

  const loginScreen = el('loginScreen');
  const loginForm = el('loginForm');
  const passwordInput = el('password');
  const loginButton = el('loginButton');
  const loginError = el('loginError');
  const app = el('app');
  const connectionBadge = el('connectionBadge');
  const connectionText = el('connectionText');
  const setupNotice = el('setupNotice');
  const fileInput = el('fileInput');
  const dropZone = el('dropZone');
  const fileName = el('fileName');
  const batchError = el('batchError');
  const reviewPanel = el('reviewPanel');
  const reviewTotalsButton = el('reviewTotalsButton');
  const totalsError = el('totalsError');
  const createPanel = el('createPanel');
  const invoiceRows = el('invoiceRows');
  const selectAll = el('selectAll');
  const confirmCheck = el('confirmCheck');
  const createButton = el('createButton');
  const progress = el('progress');
  const progressBar = el('progressBar');
  const progressText = el('progressText');
  const result = el('result');
  const resultTitle = el('resultTitle');
  const resultText = el('resultText');
  const downloadResultsButton = el('downloadResultsButton');

  function money(value) {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value) || 0);
  }

  function displayDate(isoDate) {
    if (!isoDate) return '—';
    return new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${isoDate}T00:00:00Z`));
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function api(action, data = {}) {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, password: state.password, ...data }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function setConnection(kind, text) {
    connectionBadge.className = `connection ${kind}`;
    connectionText.textContent = text;
  }

  function parseCsv(text) {
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { record.push(field); field = ''; }
      else if (character === '\n') { record.push(field.replace(/\r$/, '')); records.push(record); record = []; field = ''; }
      else field += character;
    }
    if (quoted) throw new Error('The CSV has an unclosed quoted value');
    if (field.length || record.length) { record.push(field.replace(/\r$/, '')); records.push(record); }
    const nonEmpty = records.filter((row) => row.some((value) => String(value).trim()));
    if (nonEmpty.length < 2) throw new Error('The CSV needs a header row and at least one invoice row');
    const headers = nonEmpty[0].map((header) => String(header).replace(/^\uFEFF/, '').trim());
    if (new Set(headers).size !== headers.length) throw new Error('The CSV contains duplicate column headings');
    return nonEmpty.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  function downloadCsv(filename, headers, rows) {
    const content = [headers.join(','), ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    const example = {
      'Job No.': '152713', 'Customer Name': 'PENELOPE F WORRALL', 'Customer Email': 'customer@example.com',
      'Customer Mobile': '0400 000 000', 'Property Address': '1 EXAMPLE STREET', 'Property Suburb': 'PRESTON',
      'Property Postcode': '3072', Category: 'HWS', 'BPOINT Ref': '874609', 'Receipt Number': '66600000001',
      'Transaction Number': '1855000001', 'Payment Date': '03/09/2026', 'Settlement Date': '03/09/2026',
      Amount: '1120.00', Account: '405', Division: 'VIC Hot Water', 'Tax Rate': 'GST on Income',
      'Product / Service Description': 'Supply and installation of ECONOVA ECON-300RVW Heat Pump Hot Water System',
      'PDF Filename': '152713 - 874609 - $1120 - PENELOPE F WORRALL.pdf',
    };
    downloadCsv('xero-bpoint-invoice-batch-template.csv', TEMPLATE_HEADERS, [example]);
  }

  function selectedRows() {
    return state.rows.filter((row) => row.selected && !row.existingInvoiceId && !row.result);
  }

  function settlementGroups() {
    const groups = new Map();
    state.rows.forEach((row) => {
      (row.payments || [row]).forEach((payment) => {
        const current = groups.get(payment.settlementDate) || { count: 0, total: 0 };
        current.count += 1;
        current.total = Math.round((current.total + Number(payment.amount) + Number.EPSILON) * 100) / 100;
        groups.set(payment.settlementDate, current);
      });
    });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  function refreshSummary() {
    const total = state.rows.reduce((sum, row) => sum + Number(row.amount), 0);
    el('batchTotal').textContent = money(total);
    el('invoiceCount').textContent = state.rows.length;
    el('settlementCount').textContent = settlementGroups().length;
    el('newContactCount').textContent = new Set(state.rows.filter((row) => row.contactAction === 'create').map((row) => row.contactKey || `${row.customerName}|${row.customerEmail}`)).size;
    el('updatedContactCount').textContent = new Set(state.rows.filter((row) => row.contactUpdateRequired).map((row) => row.contactId || `${row.customerName}|${row.customerEmail}`)).size;
    const selected = selectedRows();
    el('selectedCount').textContent = selected.length;
    const eligible = state.rows.filter((row) => !row.existingInvoiceId && !row.result);
    selectAll.checked = eligible.length > 0 && selected.length === eligible.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < eligible.length;
    reviewTotalsButton.disabled = state.working || !state.xeroReady || !state.rows.length;
    createButton.disabled = state.working || !state.xeroReady || !state.totalsVerified || !confirmCheck.checked || selected.length === 0;
  }

  function statusFor(row) {
    if (row.result?.error) return { kind: 'failed', label: 'Failed' };
    if (row.result?.invoice) return { kind: 'created', label: row.result.invoice.recoveredExisting ? 'Existing' : 'Created' };
    if (row.existingInvoiceId) return { kind: 'existing', label: row.existingInvoiceNumber || 'Existing' };
    if (!state.xeroReady) return { kind: 'loading', label: 'Setup required' };
    if (!row.invoiceTotal) return { kind: 'loading', label: 'Enter final amount' };
    if (!state.totalsVerified) return { kind: 'loading', label: 'Check amount' };
    if (row.contactAction === 'create') return { kind: 'ready', label: 'New contact' };
    return { kind: 'ready', label: row.contactUpdateRequired ? 'Contact will update' : 'Contact matched' };
  }

  function renderSettlements() {
    const container = el('settlementSummary');
    container.textContent = '';
    settlementGroups().forEach(([date, group]) => {
      const item = document.createElement('article');
      item.className = 'settlement-item';
      const label = document.createElement('span');
      label.textContent = displayDate(date);
      const total = document.createElement('strong');
      total.textContent = money(group.total);
      const count = document.createElement('small');
      count.textContent = `${group.count} payment${group.count === 1 ? '' : 's'}`;
      item.append(label, total, count);
      container.appendChild(item);
    });
  }

  function renderRows() {
    invoiceRows.textContent = '';
    state.rows.forEach((item) => {
      const row = document.createElement('tr');
      const checkCell = document.createElement('td');
      checkCell.className = 'check';
      checkCell.dataset.label = 'Select';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.selected;
      checkbox.disabled = Boolean(item.existingInvoiceId || item.result || state.working || !state.xeroReady);
      checkbox.setAttribute('aria-label', `Select ${item.invoiceReference}`);
      checkbox.addEventListener('change', () => { item.selected = checkbox.checked; refreshSummary(); });
      checkCell.appendChild(checkbox);

      const customer = document.createElement('td');
      customer.dataset.label = 'Customer / job';
      const customerName = document.createElement('strong');
      customerName.textContent = item.customerName;
      const customerDetail = document.createElement('small');
      customerDetail.textContent = `Job ${item.jobNo || 'grouped'} · ${item.customerEmail || 'No email'} · ${item.customerMobile || 'No mobile'}`;
      const addressDetail = document.createElement('small');
      addressDetail.textContent = [item.address, item.suburb, item.postcode].filter(Boolean).join(', ') || 'No street address';
      customer.append(customerName, customerDetail, addressDetail);

      const invoiceLine = document.createElement('td');
      invoiceLine.dataset.label = 'Invoice lines';
      const lines = item.invoiceLines?.length
        ? item.invoiceLines
        : [{ description: item.productDescription || item.description, unitAmount: item.invoiceTotal || item.amount }];
      lines.forEach((line) => {
        const lineIndex = item.invoiceLines?.indexOf(line) ?? 0;
        const entry = document.createElement('div');
        entry.className = 'invoice-line-entry';
        const description = document.createElement('textarea');
        description.className = 'invoice-line-description';
        description.rows = 3;
        description.value = item.pendingLineDescriptions?.[lineIndex] ?? line.description;
        description.disabled = Boolean(item.existingInvoiceId || item.result || state.working);
        description.setAttribute('aria-label', `Invoice line ${lineIndex + 1} description for ${item.customerName}`);
        description.addEventListener('input', () => {
          item.pendingLineDescriptions ||= lines.map((entryLine) => entryLine.description);
          item.pendingLineDescriptions[lineIndex] = description.value;
          state.totalsVerified = false;
          confirmCheck.checked = false;
          totalsError.textContent = '';
          refreshSummary();
        });
        const lineAmount = document.createElement('small');
        lineAmount.textContent = money(line.unitAmount);
        entry.append(description, lineAmount);
        invoiceLine.appendChild(entry);
      });
      const auditDetail = document.createElement('small');
      auditDetail.className = 'invoice-reference';
      auditDetail.textContent = item.jobNo
        ? `Reference: ${item.invoiceReference}`
        : `Reference: ${item.invoiceReference} · ${displayDate(item.settlementDate)}`;
      invoiceLine.appendChild(auditDetail);

      const bpoint = document.createElement('td');
      bpoint.dataset.label = 'BPOINT';
      bpoint.textContent = item.bpointRef;
      const transaction = document.createElement('small');
      transaction.textContent = `Txn ${item.transactionNumber || '—'} · Receipt ${item.receiptNumber || '—'}`;
      bpoint.appendChild(transaction);

      const settlement = document.createElement('td');
      settlement.dataset.label = 'Settlement';
      settlement.textContent = `${(item.payments || [item]).length} payment${(item.payments || [item]).length === 1 ? '' : 's'}`;
      const payment = document.createElement('small');
      payment.textContent = (item.payments || [item])
        .map((entry) => `${displayDate(entry.settlementDate)} ${money(entry.amount)}`)
        .join(' · ');
      settlement.appendChild(payment);

      const allocation = document.createElement('td');
      allocation.dataset.label = 'Allocation';
      allocation.textContent = `${item.accountCode} · ${item.category}`;
      const tracking = document.createElement('small');
      tracking.textContent = `${item.division} · ${item.taxRate}`;
      allocation.appendChild(tracking);

      const amount = document.createElement('td');
      amount.className = 'invoice-amount';
      amount.dataset.label = 'Paid / final invoice';
      const paidAmount = document.createElement('span');
      paidAmount.className = 'paid-amount';
      paidAmount.textContent = `BPOINT: ${money(item.amount)}`;
      const totalLabel = document.createElement('label');
      totalLabel.textContent = 'Final invoice';
      const totalInput = document.createElement('input');
      totalInput.type = 'number';
      totalInput.min = String(item.amount);
      totalInput.max = '1000000';
      totalInput.step = '0.01';
      totalInput.inputMode = 'decimal';
      totalInput.placeholder = '0.00';
      totalInput.value = item.pendingInvoiceTotal ?? item.invoiceTotal ?? '';
      totalInput.disabled = Boolean(item.existingInvoiceId || item.category === 'Smoke Alarm' || item.result || state.working);
      totalInput.setAttribute('aria-label', `Final invoice amount for ${item.customerName}`);
      totalInput.addEventListener('input', () => {
        item.pendingInvoiceTotal = totalInput.value;
        state.totalsVerified = false;
        confirmCheck.checked = false;
        totalsError.textContent = '';
        refreshSummary();
      });
      totalLabel.appendChild(totalInput);
      amount.append(paidAmount, totalLabel);

      const statusCell = document.createElement('td');
      statusCell.dataset.label = 'Status';
      const status = statusFor(item);
      const badge = document.createElement('span');
      badge.className = `status ${status.kind}`;
      badge.textContent = status.label;
      statusCell.appendChild(badge);
      if (item.existingInvoiceId && !item.result) {
        const existingDetail = document.createElement('small');
        existingDetail.textContent = 'Use Xero Find & Match for this payment';
        statusCell.appendChild(existingDetail);
      }
      if (item.result?.error) {
        const detail = document.createElement('small');
        detail.className = 'receipt-error';
        detail.textContent = item.result.error;
        statusCell.appendChild(detail);
      }

      row.append(checkCell, customer, invoiceLine, bpoint, settlement, allocation, amount, statusCell);
      invoiceRows.appendChild(row);
    });
    renderSettlements();
    refreshSummary();
  }

  function setProgress(percent, text) {
    progress.hidden = false;
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progressText.textContent = text;
  }

  function showResult(title, text, isError = false) {
    result.hidden = false;
    result.classList.toggle('error', isError);
    result.querySelector('.result-icon').textContent = isError ? '!' : '✓';
    resultTitle.textContent = title;
    resultText.textContent = text;
  }

  async function loadFile(file) {
    batchError.textContent = '';
    totalsError.textContent = '';
    result.hidden = true;
    state.results = [];
    state.totalsVerified = false;
    if (!file || !file.name.toLowerCase().endsWith('.csv')) throw new Error('Select a CSV file');
    if (file.size > MAX_FILE_BYTES) throw new Error('The CSV must be smaller than 2 MB');
    fileName.textContent = file.name;
    state.sourceName = file.name;
    setProgress(8, 'Reading and validating the batch…');
    const rows = parseCsv(await file.text());
    const response = await api('preview', { rows });
    state.xeroReady = response.configured;
    setupNotice.hidden = response.configured;
    setConnection(response.configured ? 'ready' : 'waiting', response.configured ? 'Xero connected' : 'Xero setup required');
    state.rows = response.rows.map((row) => ({
      ...row,
      pendingInvoiceTotal: row.invoiceTotal || '',
      pendingLineDescriptions: row.invoiceLines?.map((line) => line.description) || [],
      selected: false,
      result: null,
    }));
    confirmCheck.checked = false;
    reviewPanel.hidden = false;
    createPanel.hidden = false;
    progress.hidden = true;
    renderRows();
    reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function confirmInvoiceTotals() {
    if (state.working || !state.rows.length) return;
    totalsError.textContent = '';
    const invoices = state.rows.map((row) => {
      const invoiceTotal = row.existingInvoiceId
        ? row.invoiceTotal
        : row.category === 'Smoke Alarm'
          ? row.amount
          : Number(row.pendingInvoiceTotal);
      if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) {
        throw new Error(`Enter the final invoice amount for Job ${row.jobNo}`);
      }
      if (invoiceTotal < Number(row.amount)) {
        throw new Error(`Job ${row.jobNo}: final invoice amount cannot be less than BPOINT payments in this upload`);
      }
      return { row, invoiceTotal, lineDescriptions: row.pendingLineDescriptions };
    });

    state.working = true;
    reviewTotalsButton.textContent = 'Checking with Xero…';
    renderRows();
    try {
      const response = await api('confirm-totals', { invoices });
      state.rows = response.rows.map((row) => ({
        ...row,
        pendingInvoiceTotal: row.invoiceTotal,
        pendingLineDescriptions: row.invoiceLines?.map((line) => line.description) || [],
        selected: !row.existingInvoiceId,
        result: null,
      }));
      state.totalsVerified = true;
      confirmCheck.checked = false;
    } finally {
      state.working = false;
      reviewTotalsButton.textContent = 'Check final amounts with Xero';
      renderRows();
    }
  }

  function resultRows() {
    return state.rows.map((row) => ({
      'Job No.': row.jobNo,
      'Customer Name': row.customerName,
      Category: row.category,
      'BPOINT Ref': row.bpointRef,
      'Transaction Number': row.transactionNumber,
      'Payment Date': displayDate(row.paymentDate),
      'Settlement Date': displayDate(row.settlementDate),
      Amount: row.amount.toFixed(2),
      'Final Invoice Amount': row.invoiceTotal ? row.invoiceTotal.toFixed(2) : '',
      'Invoice Description': (row.invoiceLines || [{ description: row.description }])
        .map((line) => line.description)
        .join(' | '),
      'Invoice Reference': row.invoiceReference,
      'Xero Invoice Number': row.result?.invoice?.invoiceNumber || row.existingInvoiceNumber || '',
      'Xero Status': row.result?.invoice?.invoiceStatus || row.existingInvoiceStatus || (row.result?.error ? 'ERROR' : 'NOT CREATED'),
      'Contact Result': row.result?.invoice?.contactCreated ? 'Created' : row.result?.invoice?.contactUpdated ? 'Updated' : row.contactAction === 'match' ? 'Matched' : 'Not created',
      Result: row.result?.error || (row.result?.invoice?.recoveredExisting || row.existingInvoiceId ? 'Existing invoice' : row.result?.invoice ? 'Created' : 'Not selected'),
    }));
  }

  function downloadResults() {
    const headers = ['Job No.', 'Customer Name', 'Category', 'BPOINT Ref', 'Transaction Number', 'Payment Date', 'Settlement Date', 'Amount', 'Final Invoice Amount', 'Invoice Description', 'Invoice Reference', 'Xero Invoice Number', 'Xero Status', 'Contact Result', 'Result'];
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`xero-bpoint-results-${stamp}.csv`, headers, resultRows());
  }

  async function createInvoices() {
    const selected = selectedRows();
    if (!selected.length || state.working) return;
    const total = selected.reduce((sum, row) => sum + Number(row.invoiceTotal), 0);
    if (!window.confirm(`Create ${selected.length} APPROVED Xero invoice${selected.length === 1 ? '' : 's'} totalling ${money(total)}? Customers will not be emailed.`)) return;
    state.working = true;
    result.hidden = true;
    downloadResultsButton.hidden = true;
    renderRows();
    let successes = 0;
    let failures = 0;
    for (let index = 0; index < selected.length; index += 1) {
      const row = selected[index];
      setProgress(Math.round((index / selected.length) * 95), `Creating ${index + 1} of ${selected.length}: ${row.customerName}`);
      try {
        const response = await api('create', { row });
        row.result = { invoice: response.invoice };
        row.selected = false;
        successes += 1;
      } catch (error) {
        row.result = { error: error.message };
        row.selected = false;
        failures += 1;
      }
      renderRows();
    }
    setProgress(100, failures ? 'Finished with items requiring attention' : 'Complete');
    showResult(
      failures ? 'Batch completed with errors' : 'Invoices created in Xero',
      `${successes} succeeded and ${failures} failed. Duplicate protection makes retrying safe.`,
      failures > 0,
    );
    downloadResultsButton.hidden = false;
    state.working = false;
    renderRows();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';
    loginButton.disabled = true;
    loginButton.textContent = 'Checking…';
    state.password = passwordInput.value;
    try {
      const response = await api('status');
      state.xeroReady = response.configured;
      loginScreen.hidden = true;
      app.hidden = false;
      setupNotice.hidden = response.configured;
      setConnection(response.configured ? 'ready' : 'waiting', response.configured ? 'Xero connected' : 'Xero setup required');
    } catch (error) {
      state.password = '';
      passwordInput.value = '';
      loginError.textContent = error.message;
      passwordInput.focus();
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = 'Continue';
    }
  });

  el('chooseFileButton').addEventListener('click', () => fileInput.click());
  el('templateButton').addEventListener('click', downloadTemplate);
  fileInput.addEventListener('change', async () => {
    try { await loadFile(fileInput.files[0]); } catch (error) { batchError.textContent = error.message; progress.hidden = true; }
    fileInput.value = '';
  });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    try { await loadFile([...event.dataTransfer.files][0]); } catch (error) { batchError.textContent = error.message; progress.hidden = true; }
  });
  selectAll.addEventListener('change', () => {
    state.rows.forEach((row) => { if (!row.existingInvoiceId && !row.result) row.selected = selectAll.checked; });
    renderRows();
  });
  confirmCheck.addEventListener('change', refreshSummary);
  reviewTotalsButton.addEventListener('click', async () => {
    try { await confirmInvoiceTotals(); } catch (error) { totalsError.textContent = error.message; }
  });
  createButton.addEventListener('click', createInvoices);
  downloadResultsButton.addEventListener('click', downloadResults);
  el('lockButton').addEventListener('click', () => {
    state.password = '';
    state.rows = [];
    state.results = [];
    state.xeroReady = false;
    state.totalsVerified = false;
    app.hidden = true;
    reviewPanel.hidden = true;
    createPanel.hidden = true;
    loginScreen.hidden = false;
    passwordInput.value = '';
    passwordInput.focus();
  });
})();
