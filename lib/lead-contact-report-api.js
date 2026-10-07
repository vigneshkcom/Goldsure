import { contactEvidence, dailyCalls, dedupeCustomerCalls, isDirectCallOpportunity, isNotReachableTemplate, leadCreatedAt, lastOutboundContact, leadReachability, noteText, reportPhone, reportTotals, respondedAfter, smsTemplateFromNote, stageProgress } from './lead-contact-report.js';

const GHL = 'https://services.leadconnectorhq.com';
const MAX_LEADS = 150;
const REQUEST_LIMIT = 100;
// GHL allows 100 requests per 10 seconds per location. Stay under it, leaving room for other portal tools.
const GHL_WINDOW_MS = 10000;
const GHL_WINDOW_LIMIT = 90;
// Vercel stops the function at 60 seconds. No GHL read starts after this budget, and
// each read is cut off at most 7 seconds past it.
const REPORT_TIME_MS = 48000;
const ghlStarted = [];
const sleep = ms => new Promise(done => setTimeout(done, ms));

class ReportTimeout extends Error {}
function checkTime(deadline, wait = 0) {
  if (deadline && Date.now() + wait > deadline) throw new ReportTimeout('GHL is busy, so the report could not finish in time. Try again in a minute or choose fewer days.');
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

async function ghlTurn(deadline) {
  for (;;) {
    const now = Date.now();
    while (ghlStarted.length && ghlStarted[0] <= now - GHL_WINDOW_MS) ghlStarted.shift();
    if (ghlStarted.length < GHL_WINDOW_LIMIT) { ghlStarted.push(now); return; }
    const wait = ghlStarted[0] + GHL_WINDOW_MS - now + 5;
    checkTime(deadline, wait);
    await sleep(wait);
  }
}

async function ghlRead(path, { version = '2021-07-28', deadline = 0 } = {}) {
  const url = `${GHL}${path}`;
  for (let attempt = 0; ; attempt++) {
    checkTime(deadline);
    await ghlTurn(deadline);
    const timeout = deadline ? Math.min(12000, deadline + 7000 - Date.now()) : 12000;
    const response = await fetch(url, { headers: { ...ghlHeaders(), Version: version }, signal: AbortSignal.timeout(timeout) });
    if (response.ok) return response.json();
    if ((response.status !== 429 && response.status < 500) || attempt === 3) throw new Error(`Read failed (${response.status}) for ${new URL(url).pathname}.`);
    // 429 means GHL's 10-second window is full (other tools share it), so wait for it to clear.
    const retryAfter = Number(response.headers.get('retry-after')) * 1000;
    const wait = response.status === 429 ? Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, 2000 * 2 ** attempt) : 500 * (attempt + 1);
    checkTime(deadline, wait);
    await sleep(wait);
  }
}

async function opportunitiesInRange(start, end, deadline, maxLeads = MAX_LEADS) {
  const location = encodeURIComponent(process.env.GHL_LOCATION_ID);
  const all = [];
  let previousOldest = Infinity;
  for (let page = 1; page <= 20; page++) {
    const result = await ghlRead(`/opportunities/search?location_id=${location}&status=all&order=added_desc&limit=${REQUEST_LIMIT}&page=${page}`, { deadline });
    const items = result.opportunities;
    if (!Array.isArray(items)) throw new Error('GHL opportunity response was incomplete.');
    if (items.some(item => !leadCreatedAt(item))) throw new Error('GHL did not provide lead creation dates. The report cannot safely count these leads.');
    const newest = Date.parse(leadCreatedAt(items[0]));
    const oldest = Date.parse(leadCreatedAt(items.at(-1)));
    if (items.length && (newest > previousOldest || newest < oldest)) throw new Error('GHL did not return leads in creation order. The report was stopped to avoid a wrong count.');
    previousOldest = oldest;
    all.push(...items.filter(item => { const date = Date.parse(leadCreatedAt(item)); return date >= start && date < end && !isDirectCallOpportunity(item); }));
    if (all.length > maxLeads) throw new Error(`More than ${maxLeads} leads were found. Choose a shorter date range for an accurate report.`);
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

async function ghlSms(contactId, leadAt, deadline) {
  const location = encodeURIComponent(process.env.GHL_LOCATION_ID);
  const found = await ghlRead(`/conversations/search?locationId=${location}&contactId=${encodeURIComponent(contactId)}&limit=100`, { version: 'v3', deadline });
  const conversations = found.conversations || [];
  if (!Array.isArray(conversations) || !Number.isFinite(Number(found.total)) || Number(found.total) !== conversations.length) throw new Error('GHL conversations were only partially returned.');
  const messages = [];
  for (const conversation of conversations) {
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const data = await ghlRead(`/conversations/${encodeURIComponent(conversation.id)}/messages?limit=100${cursor ? `&lastMessageId=${encodeURIComponent(cursor)}` : ''}`, { version: 'v3', deadline });
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
  const action = String(req.query?.leadReport || '');
  if (action === 'notes') {
    const contactId = String(req.query?.contactId || '');
    if (!/^[a-zA-Z0-9_-]{5,80}$/.test(contactId)) return res.status(400).json({ error: 'Invalid contact.' });
    try {
      const data = await ghlRead(`/contacts/${encodeURIComponent(contactId)}/notes`);
      if (!Array.isArray(data.notes)) throw new Error('GHL notes response was incomplete.');
      const notes = data.notes.map(note => ({ id: note.id, body: noteText(note.body), date: note.dateAdded || '' }));
      return res.status(200).json({ notes });
    } catch (error) { return res.status(502).json({ error: error.message }); }
  }
  if (action !== 'report') return res.status(400).json({ error: 'Unknown report action.' });
  try {
    const from = String(req.query?.from || ''), to = String(req.query?.to || '');
    return res.status(200).json(await buildLeadReport({ from, to, ringcentralToken, ringcentralServer }));
  } catch (error) {
    return res.status(error.message.startsWith('Select') ? 400 : 502).json({ error: error.message });
  }
}

// One row per customer with a new lead between `from` and `to` (Sydney dates, up to 7 days).
export async function buildLeadReport({ from, to, ringcentralToken, ringcentralServer }) {
  const deadline = Date.now() + REPORT_TIME_MS;
  const range = dateRange(from, to);
  // Calls and portal SMS do not depend on GHL, so read them while GHL is being read.
  const callsAndSms = (async () => {
    const token = await ringcentralToken();
    return Promise.all([ringcentralCalls(range.start, token, ringcentralServer()), portalSms(range.start)]);
  })();
  callsAndSms.catch(() => {});
  const [opportunities, pipelines] = await Promise.all([
    opportunitiesInRange(range.start, range.end, deadline, MAX_LEADS),
    ghlRead(`/opportunities/pipelines?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`, { deadline }),
  ]);
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
  const newestLead = entries => entries.reduce((latest, entry) => leadCreatedAt(entry) > leadCreatedAt(latest) ? entry : latest);
  const stageOf = lead => pipelineById.get(lead.pipelineId)?.stages?.find(item => item.id === lead.pipelineStageId)?.name || lead.pipelineStageName || 'Unknown stage';
  const contacts = [...byContact.entries()];
  if (contacts.length > MAX_LEADS) throw new Error(`More than ${MAX_LEADS} customers have leads in these dates. Choose a shorter date range.`);
  const phoneOwners = new Map();
  const contactData = await mapLimited(contacts, 8, async ([contactId, entries]) => {
    // Opportunity search already includes the contact's name and phone; only look up contacts it left without a phone.
    let contact = entries.map(entry => entry.contact).find(item => item && String(item.id || contactId) === contactId && item.phone) || null;
    let contactIssue = '';
    if (!contact) {
      try {
        const data = await ghlRead(`/contacts/${encodeURIComponent(contactId)}`, { deadline });
        if (!data.contact || data.contact.id !== contactId) throw new Error('GHL contact details were incomplete.');
        contact = data.contact;
      } catch (error) {
        if (error instanceof ReportTimeout) throw error;
        contact = entries.map(entry => entry.contact).find(Boolean) || {};
        contactIssue = `GHL contact details could not be read: ${error.message}`;
      }
    }
    const phone = reportPhone(contact.phone);
    if (phone) phoneOwners.set(phone, (phoneOwners.get(phone) || 0) + 1);
    return { contactId, entries, contact, phone, contactIssue };
  });
  const [calls, sms] = await callsAndSms;
  const rows = await mapLimited(contactData, 6, async ({ contactId, entries, contact, phone, contactIssue }) => {
    const currentLead = newestLead(entries);
    const leadAt = leadCreatedAt(currentLead);
    const pipe = pipelineById.get(currentLead.pipelineId);
    const pipeline = pipe?.name || 'Unknown pipeline';
    const stage = stageOf(currentLead);
    const progress = stageProgress(stage);
    const uniquePhone = Boolean(phone) && phoneOwners.get(phone) === 1;
    const relatedCalls = uniquePhone ? dedupeCustomerCalls(calls.filter(call => reportPhone(call.direction === 'Outbound' ? call.to?.phoneNumber : call.from?.phoneNumber) === phone)) : [];
    const relatedSms = uniquePhone ? sms.filter(message => reportPhone(message.phone_number) === phone).map(message => ({ direction: message.direction, status: message.status, createdAt: message.created_at, body: message.message })) : [];
    const base = {
      contactId, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || contact.name || currentLead.name || 'Unnamed contact',
      phone: contact.phone || '', email: contact.email || '', leadAt,
      pipeline, stage, source: currentLead.source || 'Not recorded', opportunityCount: entries.length, stageProgress: progress,
      lastCall: relatedCalls.filter(call => Date.parse(call.startTime) >= Date.parse(leadAt)).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0]?.result || '',
      link: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(process.env.GHL_LOCATION_ID)}/contacts/detail/${encodeURIComponent(contactId)}`,
    };
    if (progress === 'moved-on') {
      // Past New Lead means staff spoke to the customer, so skip the slow GHL message and note reads.
      const { counts } = contactEvidence({ leadAt, calls: relatedCalls, sms: relatedSms, complete: false });
      const lastContact = lastOutboundContact({ leadAt, calls: relatedCalls, sms: relatedSms });
      return { ...base, contactStatus: 'Not checked', ...counts, lastTemplate: 'Not checked', lastTemplateAt: '', notReachableSms: false, issue: '', reachability: 'reached', lastContactAt: lastContact?.at || '', lastContactType: lastContact?.type || '', callDays: [], callsChecked: uniquePhone };
    }
    let ghlMessages = [], complete = uniquePhone;
    let issue = contactIssue || (complete ? '' : 'Phone missing or shared by multiple GHL contacts.');
    try { ghlMessages = await ghlSms(contactId, leadAt, deadline); }
    catch (error) {
      if (error instanceof ReportTimeout) throw error;
      complete = false; issue = `GHL conversation check incomplete: ${error.message}`;
    }
    let lastTemplate = 'Not recorded', lastTemplateAt = '', notReachableAt = '';
    try {
      const notes = await ghlRead(`/contacts/${encodeURIComponent(contactId)}/notes`, { deadline });
      if (!Array.isArray(notes.notes)) throw new Error('GHL notes response was incomplete.');
      const templateNotes = notes.notes.filter(note => Date.parse(note.dateAdded || '') >= Date.parse(leadAt))
        .map(note => ({ date: note.dateAdded, name: smsTemplateFromNote(note.body) }))
        .filter(note => note.name).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      if (templateNotes.length) { lastTemplate = templateNotes[0].name; lastTemplateAt = templateNotes[0].date; }
      notReachableAt = templateNotes.find(note => isNotReachableTemplate(note.name))?.date || '';
    } catch (error) {
      if (error instanceof ReportTimeout) throw error;
      lastTemplate = 'Could not check';
    }
    const evidence = contactEvidence({ leadAt, calls: relatedCalls, sms: relatedSms, ghlMessages, complete });
    const notReachableSms = Boolean(notReachableAt) && !respondedAfter(notReachableAt, { calls: relatedCalls, sms: relatedSms, ghlMessages });
    const lastContact = lastOutboundContact({ leadAt, calls: relatedCalls, sms: relatedSms, ghlMessages });
    // The 3-calls-a-day check runs until the lead was moved to Not Reachable (or, if GHL
    // gives no stage change time, until the last call or SMS), otherwise until now.
    const stageChangedAt = leadCreatedAt({ dateAdded: currentLead.lastStageChangeAt });
    const stoppedAt = progress !== 'not-reachable' ? '' : stageChangedAt && stageChangedAt >= leadAt ? stageChangedAt : lastContact?.at || leadAt;
    return {
      ...base, contactStatus: evidence.status, ...evidence.counts, lastTemplate, lastTemplateAt, notReachableSms, issue,
      reachability: leadReachability({ stage, contactStatus: evidence.status, notReachableSms }),
      lastContactAt: lastContact?.at || '', lastContactType: lastContact?.type || '',
      callDays: dailyCalls({ leadAt, calls: relatedCalls, stoppedAt }), callsChecked: uniquePhone, stoppedAt,
    };
  });
  rows.sort((a, b) => b.leadAt.localeCompare(a.leadAt));
  return { from, to, generatedAt: new Date().toISOString(), definition: 'One row per contact, using their newest non-Direct Call GHL opportunity in the selected period. A lead past New Lead in GHL counts as reached. Otherwise a Not Reachable SMS template without a later customer reply counts as not reachable, and calls and SMS from that lead date to report time decide the rest.', totals: reportTotals(rows), rows };
}
