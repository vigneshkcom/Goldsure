// One-time, same-tab handoff. The signing token never enters a query string.
// Opening this dialog or preparing a conversation NEVER calls the SMS send API.
(() => {
  const match = /^#certificate-draft=([0-9a-f-]{36})$/i.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  let draft;
  try {
    const key = `qld-certificate-sms:${match[1]}`;
    const raw = sessionStorage.getItem(key); sessionStorage.removeItem(key);
    draft = JSON.parse(raw);
    if (!draft || !Number.isFinite(draft.createdAt) || Date.now() - draft.createdAt > 600000 || draft.createdAt > Date.now() + 30000 || typeof draft.message !== 'string' || draft.message.length > 3000) throw new Error('Invalid draft');
  } catch { alert('This certificate SMS draft has expired or is unavailable. Open it again from the certificate tracker. Nothing was sent.'); return; }
  const dialog = document.createElement('dialog');
  dialog.id = 'certificateSmsDraft';
  dialog.style.cssText = 'width:min(560px,94vw);max-height:90vh;overflow:auto;inset:0;margin:auto;box-sizing:border-box;padding:28px;border:1px solid #dde1eb;border-radius:14px;color:#18253a;box-shadow:0 20px 70px #0005';
  dialog.innerHTML = `<h2 style="margin:0 0 12px">Certificate signing link</h2><p id="certSmsName" style="margin-bottom:16px"></p><label for="certSmsPhone">Electrician's mobile number</label><input id="certSmsPhone" type="tel" maxlength="40" placeholder="04xx xxx xxx" style="width:100%;padding:12px;margin:8px 0 18px;border:1px solid #ccd5e3;border-radius:6px"><label for="certSmsMessage">Message (editable)</label><textarea id="certSmsMessage" rows="8" maxlength="3000" style="width:100%;padding:12px;margin:8px 0;border:1px solid #ccd5e3;border-radius:6px;font:inherit"></textarea><p style="font-size:13px">Check the number carefully. This is a private link. Nothing is sent until you press <strong>Send</strong> in the conversation.</p><p id="certSmsError" role="status" style="color:#b22"></p><div style="display:flex;gap:12px;margin-top:18px"><button id="certSmsUse" style="padding:12px;background:#ad8d32;color:white;border:0;border-radius:6px">Review in SMS conversation</button><button id="certSmsCancel" style="padding:12px;border:1px solid #ccd5e3;border-radius:6px">Cancel</button></div>`;
  document.body.append(dialog);
  const find = id => dialog.querySelector(`#${id}`);
  find('certSmsName').textContent = `For ${draft.name || 'the electrician'}. You can change the number below.`;
  find('certSmsPhone').value = draft.phone || '';
  find('certSmsMessage').value = draft.message;
  find('certSmsCancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  find('certSmsUse').onclick = async () => {
    const raw = find('certSmsPhone').value.replace(/[\s()-]/g, '');
    const phone = /^04\d{8}$/.test(raw) ? `+61${raw.slice(1)}` : /^614\d{8}$/.test(raw) ? `+${raw}` : raw;
    const message = find('certSmsMessage').value.trim();
    if (!/^\+614\d{8}$/.test(phone)) { find('certSmsError').textContent = 'Enter a valid Australian mobile number.'; return; }
    if (!message) { find('certSmsError').textContent = 'Enter a message.'; return; }
    const button = find('certSmsUse'); button.disabled = true;
    try {
      await window.selectChat(phone);
      const input = document.getElementById('msgInput');
      input.value = message; window.onInputChange(input);
      dialog.close(); input.focus();
    } catch { find('certSmsError').textContent = 'Could not prepare the conversation. Nothing was sent. Please retry.'; button.disabled = false; }
  };
  dialog.showModal();
})();
