// Read-only evidence rules for the marketing lead contact report.
export function reportPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('61') ? `0${digits.slice(2)}` : digits;
  return /^0[23478]\d{8}$/.test(local) ? local.slice(1) : '';
}

export function leadCreatedAt(opportunity) {
  const value = opportunity?.dateAdded || opportunity?.createdAt || opportunity?.dateCreated;
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function isDirectCallOpportunity(opportunity) {
  const source = String(opportunity?.source || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return source === 'direct call' || source === 'direct calls' || /(?:^|[-–—])\s*direct calls?\s*$/i.test(String(opportunity?.name || ''));
}

export function callEvidence(record) {
  const result = String(record?.result || '').trim();
  if (/miss|voicemail|no.?answer|abandon|busy|cancel|failed|rejected/i.test(result)) return 'no-answer';
  if (/^(accepted|completed|call connected|connected)$/i.test(result) && Number(record?.duration) > 0) return 'connected';
  return 'unknown';
}

export function dedupeCustomerCalls(calls) {
  const sessions = new Map();
  calls.forEach((call, index) => {
    const key = String(call.sessionId || call.id || `record-${index}`);
    const previous = sessions.get(key);
    const rank = value => ({ connected: 3, 'no-answer': 2, unknown: 1 })[callEvidence(value)] || 0;
    if (!previous || rank(call) > rank(previous)) sessions.set(key, call);
  });
  return [...sessions.values()];
}

export function contactEvidence({ leadAt, calls = [], sms = [], ghlMessages = [], complete = true }) {
  const leadTime = Date.parse(leadAt);
  const sinceLead = value => Number.isFinite(leadTime) && Date.parse(value || '') >= leadTime;
  const relatedCalls = calls.filter(call => sinceLead(call.startTime));
  const relatedSms = [...sms, ...ghlMessages].filter(message => sinceLead(message.createdAt || message.dateAdded));
  const outboundCalls = relatedCalls.filter(call => call.direction === 'Outbound');
  const connectedCalls = relatedCalls.filter(call => callEvidence(call) === 'connected');
  const uncertainCalls = relatedCalls.filter(call => callEvidence(call) === 'unknown');
  const outboundSms = relatedSms.filter(message => String(message.direction).toLowerCase() === 'outbound' && !/scheduled|cancelled|deleted|failed/i.test(String(message.status || '')));
  const inboundSms = relatedSms.filter(message => String(message.direction).toLowerCase() === 'inbound' && !/optout|optin|deleted/i.test(String(message.status || '')));
  const counts = { callsMade: outboundCalls.length, connectedCalls: connectedCalls.length, smsSent: outboundSms.length, replies: inboundSms.length };
  if (connectedCalls.length || inboundSms.length) return { status: 'Connected call or SMS reply', counts };
  if (!complete || uncertainCalls.length || !leadAt) return { status: 'Needs review', counts };
  return { status: outboundCalls.length || outboundSms.length ? 'Attempted, no confirmed response' : 'No attempt recorded', counts };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—', hellip: '…' };

// GHL note bodies are often HTML. Reduce them to plain text for display and matching.
export function noteText(body) {
  return String(body || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The SMS portal logs a GHL note whenever a "Not Reachable" template is sent:
// 'Tried calling, no answer. Texted "Not Reachable – 1st Attempt" via SMS Portal.'
// The discount finals log their own note, which calls itself the final not-reachable lure.
export function smsTemplateFromNote(body) {
  const text = noteText(body);
  const named = text.match(/Texted ["“]([^"”]+)["”] via SMS Portal/i)?.[1];
  if (named) return named.trim();
  return /final not-reachable lure/i.test(text) ? 'Not Reachable – Final' : '';
}

export const isNotReachableTemplate = name => /not[\s-]*reachable/i.test(String(name || ''));

// True when the customer replied by SMS or called in (and connected) after `time`.
export function respondedAfter(time, { calls = [], sms = [], ghlMessages = [] } = {}) {
  const since = Date.parse(time || '');
  if (!Number.isFinite(since)) return false;
  const after = value => Date.parse(value || '') > since;
  return [...sms, ...ghlMessages].some(message => String(message.direction).toLowerCase() === 'inbound' && !/optout|optin|deleted/i.test(String(message.status || '')) && after(message.createdAt || message.dateAdded))
    || calls.some(call => call.direction === 'Inbound' && callEvidence(call) === 'connected' && after(call.startTime));
}

// Moving a lead past New Lead in GHL means staff spoke to the customer. "Today" and
// unknown stages are not assumed either way, so call and SMS records decide.
export function stageProgress(stage) {
  const name = String(stage || '').trim().toLowerCase();
  if (/not\s*reach/.test(name)) return 'not-reachable';
  if (!name || name === 'unknown stage' || name === 'today' || /new (lead|enquiry|inquiry)/.test(name)) return 'new';
  return 'moved-on';
}

// `notReachableSms`: a Not Reachable template was sent and the customer has not replied
// or called in since. Staff send it after a failed call, so it outranks a "connected"
// call record, which is often voicemail.
export function leadReachability({ stage, contactStatus, notReachableSms = false }) {
  const progress = stageProgress(stage);
  if (progress === 'moved-on') return 'reached';
  if (progress === 'not-reachable' || notReachableSms) return 'unreachable';
  if (contactStatus === 'Connected call or SMS reply') return 'reached';
  if (contactStatus === 'Attempted, no confirmed response') return 'unreachable';
  if (contactStatus === 'No attempt recorded') return 'untried';
  return 'review';
}

export function reportTotals(rows) {
  const totals = { customers: rows.length, reached: 0, attempted: 0, noAttempt: 0, needsReview: 0, notChecked: 0, calledNoConnection: 0, callsToUnconnected: 0 };
  for (const row of rows) {
    if (row.contactStatus === 'Connected call or SMS reply') totals.reached++;
    else if (row.contactStatus === 'Attempted, no confirmed response') totals.attempted++;
    else if (row.contactStatus === 'No attempt recorded') totals.noAttempt++;
    else if (row.contactStatus === 'Not checked') totals.notChecked++;
    else totals.needsReview++;
    if ((row.contactStatus === 'Attempted, no confirmed response' || row.contactStatus === 'No attempt recorded') && row.callsMade > 0) {
      totals.calledNoConnection++;
      totals.callsToUnconnected += row.callsMade;
    }
  }
  return totals;
}
