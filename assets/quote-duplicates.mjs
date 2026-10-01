const text = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : text(value);
};

function customerIdentity(quote) {
  const email = text(quote.customer_email);
  const digits = String(quote.customer_phone || '').replace(/\D/g, '');
  const phone = digits.length >= 9 ? digits.slice(-9) : '';
  if (!email && !phone) return '';
  return `${email || '-'}|${phone || '-'}`;
}

function sentDay(quote) {
  const raw = String(quote.sent_at || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function lineItems(quote) {
  const items = Array.isArray(quote.line_items) ? quote.line_items : [];
  return items.map(item => [
    text(item.description || item.name || item.model),
    number(item.qty || item.quantity),
    number(item.unit_price || item.price || item.total),
  ].join(':')).sort().join(',');
}

export function duplicateSignature(quote) {
  const identity = customerIdentity(quote);
  const day = sentDay(quote);
  if (!identity || !day) return '';
  const address = text(quote.property_address || quote.customer_address);
  const details = [
    text(quote.service_type),
    number(quote.alarm_qty),
    number(quote.grand_total_numeric ?? quote.grand_total),
    text(quote.ceiling_type),
    text(quote.tank_model),
    text(quote.heat_pump_model),
    number(quote.final_price),
    number(quote.total_inc_gst),
    number(quote.total_out_of_pocket),
    number(quote.deposit_amount),
    text(quote.finance_requested),
    address,
    lineItems(quote),
  ].join('|');
  return `${day}|${identity}|${details}`;
}

function possibleDuplicateSignature(quote) {
  const identity = customerIdentity(quote);
  const day = sentDay(quote);
  return identity && day ? `${day}|${identity}` : '';
}

const protectedQuote = quote => Boolean(quote.accepted_at)
  || ['accepted', 'installed'].includes(text(quote.status));

const quoteTime = quote => {
  const time = new Date(quote.sent_at || 0).getTime();
  return Number.isFinite(time) ? time : 0;
};

export function analyseDuplicates(quotes) {
  const possibleGroups = new Map();
  for (const quote of quotes || []) {
    const signature = possibleDuplicateSignature(quote);
    if (!signature) continue;
    if (!possibleGroups.has(signature)) possibleGroups.set(signature, []);
    possibleGroups.get(signature).push(quote);
  }

  const groupIds = new Set();
  const deleteIds = new Set();
  const roles = new Map();
  let groupCount = 0;

  for (const group of possibleGroups.values()) {
    if (group.length < 2) continue;
    groupCount += 1;
    group.forEach(quote => {
      const id = String(quote.id);
      groupIds.add(id);
      roles.set(id, 'Review');
    });

    const exactGroups = new Map();
    for (const quote of group) {
      const signature = duplicateSignature(quote);
      if (!exactGroups.has(signature)) exactGroups.set(signature, []);
      exactGroups.get(signature).push(quote);
    }
    for (const exactGroup of exactGroups.values()) {
      if (exactGroup.length < 2) continue;
      const ordered = [...exactGroup].sort((a, b) => quoteTime(b) - quoteTime(a));
      const protectedRows = ordered.filter(protectedQuote);
      const keepers = protectedRows.length ? new Set(protectedRows) : new Set([ordered[0]]);
      for (const quote of ordered) {
        const id = String(quote.id);
        if (keepers.has(quote)) roles.set(id, protectedQuote(quote) ? 'Keep: accepted' : 'Keep: newest');
        else {
          deleteIds.add(id);
          roles.set(id, 'Copy to delete');
        }
      }
    }
  }

  return { groupIds, deleteIds, roles, groupCount };
}

if (typeof window !== 'undefined') window.QuoteDuplicates = { analyseDuplicates, duplicateSignature };
