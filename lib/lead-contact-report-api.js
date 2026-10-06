import { contactEvidence, dedupeCustomerCalls, leadCreatedAt, reportPhone, reportTotals } from './lead-contact-report.js';

const GHL = 'https://services.leadconnectorhq.com';
const MAX_LEADS = 150;
const REQUEST_LIMIT = 100;

function authorised(req) {
  const expected = String(process.env.LEAD_REPORT_PIN || process.env.DASHBOARD_PASSWORD || '').trim();
  return Boolean(expected && String(req.headers['x-lead-report-pin'] || '').trim() === expected);
}

export function sydneyMidnight(day) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const formatter = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', timeZoneName: 'shortOffset' });
  let candidate = utc;
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = formatter.formatToParts(new Date(candidate)).find(part => part.type === 'timeZoneName')?.value || '';
    const offset = name.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
    if (!offset) throw new Error('Could not determine the Sydney date boundary.');
    const minutes = (Number(offset[2]) * 60 + Number(offset[3] || 0)) * (offset[1] === '-' ? -1 : 1);
    const next = utc - minutes * 60000;
    if (next === candidate) return candidate;
    candidate = next;
  }
  return candidate;
}

function dateRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Select valid dates.');
  const startDay = Date.parse(`${from}T00:00:00Z`), endDay = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || new Date(startDay).toISOString().slice(0, 10) !== from || new Date(endDay).toISOString().slice(0, 10) !== to) throw new Error('Select valid calendar dates.');
  const days = Math.round((endDay - startDay) / 86400000) + 1;
  if (!Number.isFinite(days) || days < 1 || days > 7) throw new Error('Select 1 to 7 days.');
  const start = sydneyMidnight(from);
  if (sydneyMidnight(to) > Date.now()) throw new Error('Select an end date that is not in the future.');
  const nextDay = new Date(endDay + 86400000).toISOString().slice(0, 10);
  return { start, end: sydneyMidnight(nextDay), days };
}

async function requestJson(url, options = {}) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
    if (response.status !== 429 && response.status < 500) break;
    if (attempt < 2) await new Promise(done => setTimeout(done, 500 * (attempt + 1)));
  }
  if (!response.ok) throw new Error(`Read failed (${response.status}) for ${new URL(url).pathname}.`);
  return response.json();
}

function ghlHeaders() {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) throw new Error('GHL read access is not configured.');
  return { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28', Accept: 'application/json' };
}

async function ghlRead(path, version = '2021-07-28') {
  return requestJson(`${GHL}${path}`, { headers: { ...ghlHeaders(), Version: version } });
}

async function opportunitiesInRange(start, end) {
  const location = encodeURIComponent(process.env.GHL_LOCATION_ID);
  const all = [];
  let previousOldest = Infinity;
  for (let page = 1; page <= 20; page++) {
    const result = await ghlRead(`/opportunities/search?location_id=${location}&status=all&order=added_desc&limit=${REQUEST_LIMIT}&page=${page}`);
    const items = result.opportunities;
    if (!Array.isArray(items)) throw new Error('GHL opportunity response was incomplete.');
    if (items.some(item => !leadCreatedAt(item))) throw new Error('GHL did not provide lead creation dates. The report cannot safely count these leads.');
    const newest = Date.parse(leadCreatedAt(items[0]));
    const oldest = Date.parse(leadCreatedAt(items.at(-1)));
    if (items.length && (newest > previousOldest || newest < oldest)) throw new Error('GHL did not return leads in creation order. The report was stopped to avoid a wrong count.');
    previousOldest = oldest;
    all.push(...items.filter(item => { const date = Date.parse(leadCreatedAt(item)); return date >= start && date < end; }));
    if (all.length > MAX_LEADS) throw new Error('More than 150 leads were found. Choose a shorter date range for an accurate report.');
    if (items.length < REQUEST_LIMIT || oldest < start) return all;
  }
  throw new Error('GHL has more pages than this report can verify. Choose a shorter date range.');
}

async function ringcentralCalls(start, token, server) {
  const end = new Date();
  const base = `${server}/restapi/v1.0/account/~/call-log`;
  let next = `${base}?view=Simple&type=Voice&perPage=1000&dateFrom=${encodeURIComponent(new Date(start).toISOString())}&dateTo=${encodeURIComponent(end.toISOString())}`;
  const calls = [];
  for (let page = 0; page < 20 && next; page++) {
    const result = await requestJson(next, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!Array.isArray(result.records)) throw new Error('RingCentral call logs were incomplete.');
    calls.push(...result.records);
    const uri = result.navigation?.nextPage?.uri || '';
    if (result.records.length === 1000 && !uri) throw new Error('RingCentral call-log pagination could not be verified.');
    next = uri && uri.startsWith(base) ? uri : '';
    if (uri && !next) throw new Error('RingCentral returned an unexpected call-log page.');
    if (page === 19 && next) throw new Error('RingCentral call logs exceeded the report limit. Choose a shorter date range.');
  }
  return calls;
}

async function portalSms(start) {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Portal SMS read access is not configured.');
  const rows = [];
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  for (let page = 0; page < 20; page++) {
    const query = `${url}/rest/v1/sms_messages?select=id,phone_number,direction,status,created_at,message&created_at=gte.${encodeURIComponent(new Date(start).toISOString())}&status=not.in.(deleted,cancelled)&order=created_at.asc&limit=1000&offset=${page * 1000}`;
    const batch = await requestJson(query, { headers });
    if (!Array.isArray(batch)) throw new Error('Portal SMS response was incomplete.');
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
  throw new Error('Portal SMS history exceeded the report limit. Choose a shorter date range.');
}

async function ghlSms(contactId, leadAt) {
  const location = encodeURIComponent(process.env.GHL_LOCATION_ID);
  const found = await ghlRead(`/conversations/search?locationId=${location}&contactId=${encodeURIComponent(contactId)}&limit=100`, 'v3');
  const conversations = found.conversations || [];
  if (!Array.isArray(conversations) || !Number.isFinite(Number(found.total)) || Number(found.total) !== conversations.length) throw new Error('GHL conversations were only partially returned.');
  const messages = [];
  for (const conversation of conversations) {
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const data = await ghlRead(`/conversations/${encodeURIComponent(conversation.id)}/messages?limit=100${cursor ? `&lastMessageId=${encodeURIComponent(cursor)}` : ''}`, 'v3');
      const result = data.messages;
      const items = result?.messages;
      if (!Array.isArray(items)) throw new Error('GHL message history was incomplete.');
      if (items.some(item => !Number.isFinite(Date.parse(item.dateAdded || '')) || !item.messageType)) throw new Error('GHL message details were incomplete.');
      if (items.some((item, index) => index > 0 && Date.parse(item.dateAdded || '') > Date.parse(items[index - 1].dateAdded || ''))) throw new Error('GHL message order could not be verified.');
      messages.push(...items.filter(item => /sms/i.test(String(item.messageType || ''))));
      if (!result.nextPage || items.some(item => Date.parse(item.dateAdded || '') < Date.parse(leadAt))) break;
      if (!result.lastMessageId || result.lastMessageId === cursor || page === 9) throw new Error('GHL message history exceeded the report limit.');
      cursor = result.lastMessageId;
    }
  }
  return messages;
}

async function mapLimited(items, limit, mapper) {
  const result = new Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const at = index++; result[at] = await mapper(items[at]); }
  }));
  return result;
}

export async function leadContactReport(req, res, { ringcentralToken, ringcentralServer }) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorised(req)) return res.status(401).json({ error: 'Enter the Portal access PIN.' });
  const action = String(req.query?.leadReport || '');
  if (action === 'notes') {
    const contactId = String(req.query?.contactId || '');
    if (!/^[a-zA-Z0-9_-]{5,80}$/.test(contactId)) return res.status(400).json({ error: 'Invalid contact.' });
    try {
      const data = await ghlRead(`/contacts/${encodeURIComponent(contactId)}/notes`);
      if (!Array.isArray(data.notes)) throw new Error('GHL notes response was incomplete.');
      const notes = data.notes.map(note => ({ id: note.id, body: note.body || '', date: note.dateAdded || '' }));
      return res.status(200).json({ notes });
    } catch (error) { return res.status(502).json({ error: error.message }); }
  }
  if (action !== 'report') return res.status(400).json({ error: 'Unknown report action.' });
  try {
    const from = String(req.query?.from || ''), to = String(req.query?.to || '');
    const range = dateRange(from, to);
    const [opportunities, pipelines, token] = await Promise.all([
      opportunitiesInRange(range.start, range.end),
      ghlRead(`/opportunities/pipelines?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`),
      ringcentralToken(),
    ]);
    const [calls, sms] = await Promise.all([ringcentralCalls(range.start, token, ringcentralServer()), portalSms(range.start)]);
    if (!Array.isArray(pipelines.pipelines)) throw new Error('GHL pipeline response was incomplete.');
    const pipelineById = new Map((pipelines.pipelines || []).map(pipe => [pipe.id, pipe]));
    const byContact = new Map();
    for (const opportunity of opportunities) {
      const contactId = String(opportunity.contactId || opportunity.contact?.id || '');
      if (!contactId) throw new Error('A GHL lead has no contact ID. The report cannot safely count it.');
      const prior = byContact.get(contactId) || [];
      prior.push(opportunity);
      byContact.set(contactId, prior);
    }
    const contacts = [...byContact.entries()];
    const phoneOwners = new Map();
    const contactData = await mapLimited(contacts, 8, async ([contactId, entries]) => {
      const data = await ghlRead(`/contacts/${encodeURIComponent(contactId)}`);
      if (!data.contact || data.contact.id !== contactId) throw new Error('GHL contact details were incomplete.');
      const contact = data.contact;
      const phone = reportPhone(contact.phone || entries[0].contact?.phone);
      if (phone) phoneOwners.set(phone, (phoneOwners.get(phone) || 0) + 1);
      return { contactId, entries, contact, phone };
    });
    const rows = await mapLimited(contactData, 5, async ({ contactId, entries, contact, phone }) => {
      const leadAt = entries.map(leadCreatedAt).sort()[0];
      const uniquePhone = Boolean(phone) && phoneOwners.get(phone) === 1;
      const relatedCalls = uniquePhone ? dedupeCustomerCalls(calls.filter(call => reportPhone(call.direction === 'Outbound' ? call.to?.phoneNumber : call.from?.phoneNumber) === phone)) : [];
      const relatedSms = uniquePhone ? sms.filter(message => reportPhone(message.phone_number) === phone).map(message => ({ direction: message.direction, status: message.status, createdAt: message.created_at, body: message.message })) : [];
      let ghlMessages = [], complete = uniquePhone;
      let issue = complete ? '' : 'Phone missing or shared by multiple GHL contacts.';
      try { ghlMessages = await ghlSms(contactId, leadAt); }
      catch (error) { complete = false; issue = `GHL conversation check incomplete: ${error.message}`; }
      let lastTemplate = 'Not recorded';
      try {
        const notes = await ghlRead(`/contacts/${encodeURIComponent(contactId)}/notes`);
        if (!Array.isArray(notes.notes)) throw new Error('GHL notes response was incomplete.');
        const templateNotes = notes.notes.filter(note => Date.parse(note.dateAdded || '') >= Date.parse(leadAt))
          .map(note => ({ date: note.dateAdded, name: String(note.body || '').match(/Texted ["“]([^"”]+)["”] via SMS Portal/i)?.[1] || '' }))
          .filter(note => note.name).sort((a, b) => b.date.localeCompare(a.date));
        if (templateNotes.length) lastTemplate = templateNotes[0].name;
      } catch { lastTemplate = 'Could not check'; }
      const evidence = contactEvidence({ leadAt, calls: relatedCalls, sms: relatedSms, ghlMessages, complete });
      const pipelines = [...new Set(entries.map(lead => pipelineById.get(lead.pipelineId)?.name || 'Unknown pipeline'))];
      const stages = [...new Set(entries.map(lead => {
        const pipe = pipelineById.get(lead.pipelineId);
        return pipe?.stages?.find(stage => stage.id === lead.pipelineStageId)?.name || lead.pipelineStageName || 'Unknown stage';
      }))];
      const sources = [...new Set(entries.map(lead => lead.source || '').filter(Boolean))];
      return {
        contactId, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || contact.name || 'Unnamed contact',
        phone: contact.phone || '', email: contact.email || '', leadAt,
        pipeline: pipelines.join(', '), stage: stages.join(', '), source: sources.length === 1 ? sources[0] : sources.length ? 'Multiple sources' : 'Not recorded',
        opportunityCount: entries.length, contactStatus: evidence.status, ...evidence.counts, lastTemplate, issue,
        lastCall: relatedCalls.filter(call => Date.parse(call.startTime) >= Date.parse(leadAt)).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]?.result || '',
        link: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(process.env.GHL_LOCATION_ID)}/contacts/detail/${encodeURIComponent(contactId)}`,
      };
    });
    rows.sort((a, b) => b.leadAt.localeCompare(a.leadAt));
    return res.status(200).json({ from, to, generatedAt: new Date().toISOString(), definition: 'One row per GHL contact with an opportunity created in the selected period. Calls and SMS are checked from that lead date to report time.', totals: reportTotals(rows), rows });
  } catch (error) {
    return res.status(error.message.startsWith('Select') ? 400 : 502).json({ error: error.message });
  }
}
