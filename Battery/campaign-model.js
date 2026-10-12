export function parseAudience(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('The CSV has an unclosed quote. Please export it again.');
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV has no customer rows.');
  const headers = rows.shift().map(v => v.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const column = names => headers.findIndex(h => names.includes(h));
  const emailAt = column(['email', 'emailaddress', 'customeremail']);
  const firstAt = column(['firstname', 'first']);
  const lastAt = column(['lastname', 'last']);
  const phoneAt = column(['phone', 'mobile', 'phonenumber', 'mobilenumber']);
  const jobAt = column(['jobid', 'job']);
  if (emailAt < 0 || firstAt < 0) throw new Error('The CSV needs Email and First Name columns.');
  const recipients = new Map(); let duplicates = 0, invalid = 0;
  for (const values of rows) {
    const value = at => at < 0 ? '' : String(values[at] || '').trim();
    const email = value(emailAt).toLowerCase(), firstName = value(firstAt);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName) { invalid++; continue; }
    if (recipients.has(email)) { duplicates++; continue; }
    recipients.set(email, { email, firstName, lastName: value(lastAt), phone: value(phoneAt), jobId: value(jobAt) });
  }
  if (!recipients.size) throw new Error('No valid customers found. Check Email and First Name.');
  if (recipients.size > 500) throw new Error('Please split the file into uploads of up to 500 customers.');
  return { recipients: [...recipients.values()], duplicates, invalid };
}

export function delivery(row, now = Date.now()) {
  if (row.unsubscribed_at || row.delivery_status === 'unsubscribed') return { label: 'Unsubscribed', tone: 'neutral' };
  const states = { pending: ['Queued', 'neutral'], sending: ['Sending', 'blue'], sent: ['Sent', 'green'], failed: ['Failed', 'red'], bounced: ['Bounced', 'red'], unknown: ['Unconfirmed', 'amber'] };
  if (row.delivery_status === 'sending' && now - Date.parse(row.updated_at) > 120000) return { label: 'Unconfirmed', tone: 'amber' };
  const [label, tone] = states[row.delivery_status] || ['Unknown', 'amber'];
  return { label, tone };
}

export function matchesRecipient(row, search, filter) {
  const haystack = [row.first_name, row.last_name, row.email, row.phone, row.job_id].join(' ').toLowerCase();
  if (search.trim() && !haystack.includes(search.trim().toLowerCase())) return false;
  if (filter === 'all') return true;
  if (filter === 'sent') return Boolean(row.sent_at || row.delivery_status === 'sent');
  if (filter === 'opened') return Boolean(row.opened_at);
  if (filter === 'clicked') return Boolean(row.clicked_at);
  if (filter === 'callback') return Boolean(row.callback_requested_at);
  if (filter === 'unsubscribed') return Boolean(row.unsubscribed_at || row.delivery_status === 'unsubscribed');
  if (filter === 'attention') return ['Failed', 'Bounced', 'Unconfirmed', 'Unknown'].includes(delivery(row).label);
  return row.delivery_status === filter;
}

export function localDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}
