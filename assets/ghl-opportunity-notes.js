(function () {
  const API = '/api/ghl/opportunity-notes';
  const STAFF = ['David', 'Vignesh', 'Amit', 'Shanira', 'Alda'];
  let dialog, current, canSave = false;
  const el = id => dialog.querySelector(`#${id}`);

  function setup() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'ghln-dialog';
    dialog.innerHTML = `<div class="ghln-shell">
      <div class="ghln-head"><div><div class="ghln-kicker">GHL notes</div><h2 id="ghln-title">Notes</h2><p id="ghln-subtitle">Contact notes shown with this customer's opportunities</p></div><button type="button" class="ghln-close" aria-label="Close notes">×</button></div>
      <div class="ghln-list" id="ghln-list" aria-live="polite"></div>
      <form class="ghln-form" id="ghln-form"><label for="ghln-body">Add a GHL note for this customer</label><textarea id="ghln-body" maxlength="3000" placeholder="Write an internal note…" required></textarea>
        <div class="ghln-actions"><div><label for="ghln-staff">Posting as</label><select id="ghln-staff" required><option value="">Select your name</option>${STAFF.map(name => `<option value="${name}">${name}</option>`).join('')}</select></div><button class="ghln-save" type="submit">Save to GHL</button></div><div class="ghln-status" id="ghln-status" role="status"></div></form>
    </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.ghln-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    el('ghln-staff').addEventListener('change', event => {
      if (STAFF.includes(event.target.value)) {
        localStorage.setItem('staffFirstName', event.target.value);
        if (location.pathname.startsWith('/sms')) {
          sessionStorage.setItem('smsStaffName', event.target.value);
          const switcher = document.getElementById('staffSwitch');
          if (switcher) switcher.textContent = `Working as ${event.target.value} · Change`;
          if (document.getElementById('tplPanel')?.classList.contains('open') && typeof renderTemplates === 'function') renderTemplates();
        }
      }
      refresh();
    });
    el('ghln-form').addEventListener('submit', save);
    el('ghln-list').addEventListener('click', event => {
      if (event.target.closest('[data-ghln-retry]')) refresh();
    });
  }

  function status(message, kind = '') {
    el('ghln-status').textContent = message;
    el('ghln-status').className = `ghln-status${kind ? ` ${kind}` : ''}`;
  }

  function readableNoteBody(value) {
    const raw = String(value || '');
    if (!/<\/?(?:p|br|div|span|ul|ol|li|strong|em|b|i|a|h[1-6])\b/i.test(raw)) return raw;
    const template = document.createElement('template');
    template.innerHTML = raw;
    const chunks = [];
    const blockTags = new Set(['P', 'DIV', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'SVG', 'IFRAME', 'OBJECT']);
    function walk(node) {
      if (node.nodeType === 3) { chunks.push(node.nodeValue); return; }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      const tag = node.nodeName;
      if (ignoredTags.has(tag)) return;
      if (tag === 'BR') { chunks.push('\n'); return; }
      if (tag === 'LI') chunks.push('• ');
      for (const child of node.childNodes) walk(child);
      if (blockTags.has(tag)) chunks.push('\n');
    }
    walk(template.content);
    return chunks.join('').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function renderNotes(notes) {
    const list = el('ghln-list');
    list.replaceChildren();
    if (!notes.length) { list.innerHTML = '<div class="ghln-empty">No GHL contact notes found for this customer.</div>'; return; }
    for (const note of notes) {
      const item = document.createElement('article'); item.className = 'ghln-note';
      const meta = document.createElement('div'); meta.className = 'ghln-note-meta';
      const source = document.createElement('span'); source.className = 'ghln-source contact'; source.textContent = 'Contact note';
      const date = document.createElement('time'); date.textContent = note.date ? new Date(note.date).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
      const body = document.createElement('div'); body.className = 'ghln-note-body'; body.textContent = readableNoteBody(note.body);
      meta.append(source, date); item.append(meta, body); list.appendChild(item);
    }
  }

  async function refresh() {
    const openedFor = current;
    const selectedStaff = el('ghln-staff').value;
    canSave = false;
    dialog.querySelector('.ghln-save').disabled = true;
    el('ghln-list').innerHTML = '<div class="ghln-empty">Loading GHL notes…</div>';
    try {
      const query = new URLSearchParams({ opportunityId: openedFor.opportunityId,
        expectedEmail: openedFor.expectedEmail || '', expectedPhone: openedFor.expectedPhone || '', staffName: selectedStaff });
      const response = await fetch(`${API}?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `GHL request failed (${response.status})`);
      if (current !== openedFor || el('ghln-staff').value !== selectedStaff) return;
      renderNotes(data.notes || []);
      el('ghln-subtitle').textContent = `${data.opportunityName || 'GHL opportunity'} · Contact notes appear across this customer's opportunities`;
      canSave = Boolean(selectedStaff && data.authorReady);
      dialog.querySelector('.ghln-save').disabled = !canSave;
      if (selectedStaff && !canSave) status(data.authorIssue || 'This staff member cannot be verified in GHL.', 'error');
      else if (!selectedStaff) status('Select your name to add a note.');
    } catch (error) {
      if (current === openedFor) {
        el('ghln-list').innerHTML = `<div class="ghln-empty">Could not load notes: ${String(error.message).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}<br><button type="button" class="ghln-retry" data-ghln-retry>Retry loading notes</button></div>`;
        status('Saving is unavailable until the GHL customer is verified.', 'error');
      }
    }
  }

  async function save(event) {
    event.preventDefault();
    const note = el('ghln-body').value.trim();
    const staffName = el('ghln-staff').value;
    const openedFor = current;
    if (!note || !STAFF.includes(staffName) || !canSave) { status('Choose a verified staff name and write a note.', 'error'); return; }
    const button = dialog.querySelector('.ghln-save'); button.disabled = true; status('Saving to GHL…');
    try {
      const response = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        opportunityId: openedFor.opportunityId, expectedEmail: openedFor.expectedEmail || '', expectedPhone: openedFor.expectedPhone || '', body: note, staffName,
      }) });
      const data = await response.json();
      if (!response.ok || !data.saved) throw new Error(data.error || `GHL save failed (${response.status})`);
      if (current !== openedFor) return;
      el('ghln-body').value = '';
      status('Saved to GHL.', 'success');
      await refresh();
    } catch (error) { status(error.message, 'error'); }
    finally { button.disabled = !canSave; }
  }

  window.GoldsureGhlNotes = {
    open(details) {
      setup();
      if (!details?.opportunityId) { window.alert('No matching GHL opportunity was found for this customer.'); return; }
      current = { ...details };
      el('ghln-title').textContent = `GHL notes · ${details.customerName || 'Customer'}`;
      el('ghln-subtitle').textContent = 'Contact notes shown with this customer’s opportunities';
      el('ghln-body').value = '';
      const selected = location.pathname.startsWith('/sms') ? sessionStorage.getItem('smsStaffName') : localStorage.getItem('staffFirstName');
      el('ghln-staff').value = STAFF.includes(selected) ? selected : '';
      status('');
      if (!dialog.open) dialog.showModal();
      refresh();
    },
  };
})();
