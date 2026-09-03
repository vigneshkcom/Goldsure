(() => {
  const API_URL = '/api/xero-recharge';
  const MAX_FILES = 10;
  const MAX_FILE_BYTES = Math.floor(2.5 * 1024 * 1024);
  const state = { password: '', xeroReady: false, files: [], working: false };

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
  const chooseFilesButton = el('chooseFilesButton');
  const dropZone = el('dropZone');
  const tableWrap = el('receiptTableWrap');
  const receiptRows = el('receiptRows');
  const selectAll = el('selectAll');
  const shareTotal = el('shareTotal');
  const selectedCount = el('selectedCount');
  const createButton = el('createButton');
  const amountType = el('amountType');
  const dueDays = el('dueDays');
  const progress = el('progress');
  const progressBar = el('progressBar');
  const progressText = el('progressText');
  const result = el('result');
  const resultTitle = el('resultTitle');
  const resultText = el('resultText');

  function money(value) {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value || 0);
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

  function fileKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  function setConnection(kind, text) {
    connectionBadge.className = `connection ${kind}`;
    connectionText.textContent = text;
  }

  function selectedReady() {
    return state.files.filter((item) => item.selected && item.status === 'ready');
  }

  function refreshSummary() {
    const selected = selectedReady();
    const spend = selected.reduce((sum, item) => sum + Number(item.receipt.nswSpend), 0);
    const share = Math.round((spend * .5 + Number.EPSILON) * 100) / 100;
    shareTotal.textContent = money(share);
    selectedCount.textContent = selected.length;
    const ready = state.files.filter((item) => item.status === 'ready');
    selectAll.checked = ready.length > 0 && selected.length === ready.length;
    selectAll.indeterminate = selected.length > 0 && selected.length < ready.length;
    createButton.disabled = state.working || !state.xeroReady || selected.length === 0;
  }

  function renderRows() {
    receiptRows.textContent = '';
    tableWrap.hidden = state.files.length === 0;
    state.files.forEach((item) => {
      const row = document.createElement('tr');

      const checkCell = document.createElement('td');
      checkCell.className = 'check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.selected;
      checkbox.disabled = item.status !== 'ready' || state.working;
      checkbox.setAttribute('aria-label', `Select ${item.file.name}`);
      checkbox.addEventListener('change', () => { item.selected = checkbox.checked; refreshSummary(); });
      checkCell.appendChild(checkbox);

      const dateCell = document.createElement('td');
      dateCell.textContent = item.receipt?.invoiceDate
        ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.receipt.invoiceDate}T00:00:00Z`))
        : '—';

      const invoiceCell = document.createElement('td');
      const invoiceStrong = document.createElement('strong');
      invoiceStrong.textContent = item.receipt?.invoiceNumber || item.file.name;
      const invoiceSmall = document.createElement('small');
      invoiceSmall.textContent = item.error || item.file.name;
      if (item.error) invoiceSmall.className = 'receipt-error';
      invoiceCell.append(invoiceStrong, invoiceSmall);

      const spendCell = document.createElement('td');
      spendCell.className = 'money';
      spendCell.textContent = item.receipt ? money(item.receipt.nswSpend) : '—';

      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.className = `status ${item.status}`;
      status.textContent = item.status === 'loading' ? 'Reading' : item.status === 'ready' ? 'Ready' : 'Check PDF';
      statusCell.appendChild(status);

      const removeCell = document.createElement('td');
      removeCell.className = 'remove-heading';
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'remove-button';
      removeButton.textContent = '×';
      removeButton.title = `Remove ${item.file.name}`;
      removeButton.disabled = state.working;
      removeButton.addEventListener('click', () => {
        state.files = state.files.filter((candidate) => candidate.key !== item.key);
        renderRows();
        refreshSummary();
      });
      removeCell.appendChild(removeButton);

      row.append(checkCell, dateCell, invoiceCell, spendCell, statusCell, removeCell);
      receiptRows.appendChild(row);
    });
    refreshSummary();
  }

  async function addFiles(fileList) {
    const incoming = [...fileList];
    result.hidden = true;
    if (state.files.length + incoming.length > MAX_FILES) {
      showResult('Too many PDFs', `Select no more than ${MAX_FILES} receipts for one Xero invoice.`, true);
      return;
    }

    const added = [];
    for (const file of incoming) {
      const key = fileKey(file);
      if (state.files.some((item) => item.key === key)) continue;
      const item = { key, file, selected: false, status: 'loading', receipt: null, error: '' };
      state.files.push(item);
      added.push(item);
    }
    renderRows();

    await Promise.all(added.map(async (item) => {
      try {
        const { file } = item;
        if (!file.name.toLowerCase().endsWith('.pdf') || file.type && file.type !== 'application/pdf') throw new Error('Only PDF files are supported');
        if (file.size > MAX_FILE_BYTES) throw new Error('Each PDF must be smaller than 2.5 MB');
        const fileBase64 = await toBase64(file);
        const response = await api('parse', { filename: file.name, fileBase64 });
        item.receipt = response.receipt;
        item.status = 'ready';
        item.selected = true;
      } catch (error) {
        item.status = 'error';
        item.error = error.message;
      }
      renderRows();
    }));
    fileInput.value = '';
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

  async function createDraft() {
    const selected = selectedReady();
    if (!selected.length || state.working) return;
    const total = Math.round((selected.reduce((sum, item) => sum + Number(item.receipt.nswSpend), 0) * .5 + Number.EPSILON) * 100) / 100;
    if (!window.confirm(`Create one DRAFT Xero invoice for ${money(total)} from ${selected.length} receipt(s)?`)) return;

    state.working = true;
    result.hidden = true;
    renderRows();
    setProgress(8, 'Creating the draft invoice in Xero…');
    try {
      const receipts = selected.map((item) => item.receipt);
      const response = await api('create', { receipts, amountType: amountType.value, dueDays: Number(dueDays.value) });
      const invoice = response.invoice;
      const baseProgress = 28;
      setProgress(baseProgress, invoice.recoveredExisting ? 'Existing matching draft found. Checking attachments…' : 'Draft created. Attaching PDFs…');

      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        setProgress(baseProgress + Math.round((index / selected.length) * 68), `Attaching ${index + 1} of ${selected.length}: ${item.file.name}`);
        await api('attach', {
          invoiceId: invoice.invoiceId,
          filename: item.file.name,
          fileBase64: await toBase64(item.file),
          receipt: item.receipt,
        });
      }

      setProgress(100, 'Complete');
      const invoiceLabel = invoice.invoiceNumber || invoice.reference;
      showResult(invoice.recoveredExisting ? 'Matching draft confirmed' : 'Draft created in Xero', `${invoiceLabel} · ${money(total)} · ${selected.length} PDF${selected.length === 1 ? '' : 's'} attached.`);
      createButton.textContent = 'Draft created';
    } catch (error) {
      setProgress(100, 'Action stopped');
      showResult('Could not finish the Xero draft', `${error.message} You can safely retry; duplicate protection is enabled.`, true);
      createButton.textContent = 'Retry draft and attachments';
    } finally {
      state.working = false;
      renderRows();
    }
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
      if (response.configured) {
        setConnection('ready', 'Xero connected');
        setupNotice.hidden = true;
      } else {
        setConnection('waiting', 'Xero setup required');
        setupNotice.hidden = false;
      }
      refreshSummary();
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

  chooseFilesButton.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => addFiles(fileInput.files));
  dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
    addFiles([...event.dataTransfer.files].filter((file) => file.name.toLowerCase().endsWith('.pdf')));
  });

  selectAll.addEventListener('change', () => {
    state.files.forEach((item) => { if (item.status === 'ready') item.selected = selectAll.checked; });
    renderRows();
  });
  createButton.addEventListener('click', createDraft);
  el('lockButton').addEventListener('click', () => {
    state.password = '';
    state.files = [];
    state.xeroReady = false;
    app.hidden = true;
    loginScreen.hidden = false;
    passwordInput.value = '';
    passwordInput.focus();
  });
})();
