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
  if (connectedCalls.length || inboundSms.length) return { status: 'Reached', counts };
  if (!complete || uncertainCalls.length || !leadAt) return { status: 'Needs review', counts };
  return { status: outboundCalls.length || outboundSms.length ? 'Attempted, no confirmed response' : 'No attempt recorded', counts };
}

export function reportTotals(rows) {
  const totals = { customers: rows.length, reached: 0, attempted: 0, noAttempt: 0, needsReview: 0 };
  for (const row of rows) {
    if (row.contactStatus === 'Reached') totals.reached++;
    else if (row.contactStatus === 'Attempted, no confirmed response') totals.attempted++;
    else if (row.contactStatus === 'No attempt recorded') totals.noAttempt++;
    else totals.needsReview++;
  }
  return totals;
}
