const DATAFORCE_BASE_URL = 'https://asap-api.dataforce.com.au';
const DATAFORCE_INSTANCE = 'GOLDSURE_ASAP';
const GOLDSURE_AGENT_ID = 1;
const GOLDSURE_CLIENT_ID = 1;
const SMOKE_INSTALL_WORK_TYPE_ID = 62;
const WAITING_APPOINTMENT_DURATION = 60;

const compact = value => String(value || '').trim().replace(/\s+/g, ' ');
const normalizeEmail = value => compact(value).toLowerCase();
const normalizePhone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('61') && digits.length === 11) return `0${digits.slice(2)}`;
  return digits.slice(-10);
};
const normalizeAddress = value => compact(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const STREET_TYPES = new Map([
  ['st', 'STREET'], ['street', 'STREET'], ['rd', 'ROAD'], ['road', 'ROAD'],
  ['ave', 'AVENUE'], ['avenue', 'AVENUE'], ['dr', 'DRIVE'], ['drive', 'DRIVE'],
  ['ct', 'COURT'], ['court', 'COURT'], ['cres', 'CRESCENT'], ['crescent', 'CRESCENT'],
  ['pl', 'PLACE'], ['place', 'PLACE'], ['pde', 'PARADE'], ['parade', 'PARADE'],
  ['cct', 'CIRCUIT'], ['circuit', 'CIRCUIT'], ['hwy', 'HIGHWAY'], ['highway', 'HIGHWAY'],
  ['tce', 'TERRACE'], ['terrace', 'TERRACE'], ['way', 'WAY'], ['cl', 'CLOSE'], ['close', 'CLOSE'],
]);

export function parseAcceptedPropertyAddress(value) {
  const address = compact(value).replace(/,\s*Australia$/i, '');
  const match = address.match(/^(.+),\s*([^,]+?)\s+(QLD|Queensland)\s+(\d{4})$/i);
  if (!match) return null;
  return {
    street: compact(match[1]),
    suburb: compact(match[2]),
    state: 'QLD',
    postcode: match[4],
    formatted: `${compact(match[1])}, ${compact(match[2])} QLD ${match[4]}`,
  };
}

export function splitDataforceStreet(value) {
  let street = compact(value);
  let unitNo = '';
  const unitMatch = street.match(/^(?:unit\s*)?([A-Za-z0-9-]+)\s*[/,]\s*(.+)$/i);
  if (unitMatch) {
    unitNo = unitMatch[1];
    street = unitMatch[2];
  }
  const streetMatch = street.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  const streetNo = streetMatch ? streetMatch[1] : '';
  let streetName = streetMatch ? streetMatch[2] : street;
  let streetType = '';
  const words = streetName.split(' ');
  const possibleType = words.at(-1).toLowerCase().replace(/\./g, '');
  if (STREET_TYPES.has(possibleType)) {
    streetType = STREET_TYPES.get(possibleType);
    streetName = words.slice(0, -1).join(' ');
  }
  return { unitNo, streetNo, streetName: compact(streetName), streetType };
}

function customerAddress(customer = {}) {
  const unit = customer.unitNo ? `${customer.unitType || 'Unit'} ${customer.unitNo}, ` : '';
  const street = compact([customer.streetNo, customer.streetName, customer.streetType].filter(Boolean).join(' '));
  return `${unit}${street}, ${compact(customer.suburb)} ${compact(customer.state)} ${customer.postCode || ''}`;
}

function quoteReference(quoteToken) {
  return `GSQ-${String(quoteToken || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`;
}

function splitName(value) {
  const parts = compact(value).split(' ').filter(Boolean);
  return {
    firstname: parts[0] || 'Customer',
    surname: parts.slice(1).join(' ') || 'Customer',
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function dataforceToken(fetchImpl, env) {
  const clientId = compact(env.DATAFORCE_CLIENT_ID);
  const clientSecret = compact(env.DATAFORCE_CLIENT_SECRET);
  if (!clientId || !clientSecret) throw new Error('dataforce-not-configured');
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetchImpl(`${DATAFORCE_BASE_URL}/authorization/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'appointment customer fieldworker job',
    }),
  });
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) throw new Error(`dataforce-auth-failed-${response.status}`);
  return payload.access_token;
}

async function dataforceRequest(fetchImpl, token, path, init = {}) {
  const response = await fetchImpl(`${DATAFORCE_BASE_URL}/${DATAFORCE_INSTANCE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`dataforce-request-failed-${response.status}`);
  return payload;
}

async function loadAcceptedQuote(quoteToken, fetchImpl, env) {
  const supabaseUrl = compact(env.SUPABASE_URL);
  const supabaseKey = compact(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY);
  if (!quoteToken) return { reason: 'missing-quote-token' };
  if (!supabaseUrl || !supabaseKey) return { reason: 'supabase-not-configured' };
  const fields = [
    'customer_name', 'customer_email', 'customer_phone', 'customer_address', 'customer_type',
    'service_type', 'alarm_qty', 'alarm_unit_price', 'ctrl_qty', 'grand_total', 'status', 'accepted',
  ].join(',');
  const response = await fetchImpl(
    `${supabaseUrl}/rest/v1/quote_emails?quote_token=eq.${encodeURIComponent(quoteToken)}&select=${fields}&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!response.ok) return { reason: `quote-lookup-failed-${response.status}` };
  const rows = await readJson(response);
  const quote = Array.isArray(rows) ? rows[0] : null;
  if (!quote) return { reason: 'quote-not-found' };
  if (quote.accepted !== true && compact(quote.status).toLowerCase() !== 'accepted') {
    return { reason: 'quote-not-accepted' };
  }
  const address = parseAcceptedPropertyAddress(quote.customer_address);
  if (!address) return { reason: 'invalid-property-address' };
  return { quote, address };
}

async function search(fetchImpl, token, path, propertyName, value) {
  return dataforceRequest(fetchImpl, token, path, {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName, value: String(value), operator: 'EQ' }] }],
      limit: 20,
      after: 0,
    }),
  });
}

async function findOrCreateCustomer({ quote, address, quoteToken, fetchImpl, token }) {
  const email = normalizeEmail(quote.customer_email);
  const matches = email
    ? await search(fetchImpl, token, '/customers/search', 'email', email)
    : { records: [] };
  for (const candidate of matches.records || []) {
    const detail = candidate.customerId
      ? await dataforceRequest(fetchImpl, token, `/customers/id/${encodeURIComponent(candidate.customerId)}`)
      : candidate;
    if (normalizeEmail(detail.email) === email && normalizeAddress(customerAddress(detail)) === normalizeAddress(address.formatted)) {
      return { customerId: detail.customerId, customerCreated: false };
    }
  }

  const ref = quoteReference(quoteToken);
  try {
    const byReference = await dataforceRequest(fetchImpl, token, `/customers/ref/${encodeURIComponent(ref)}`);
    if (byReference?.customerId) return { customerId: byReference.customerId, customerCreated: false };
  } catch (error) {
    if (error.message !== 'dataforce-request-failed-404') throw error;
  }

  const name = splitName(quote.customer_name);
  const street = splitDataforceStreet(address.street);
  const payload = {
    firstname: name.firstname,
    surname: name.surname,
    mobilePhone: normalizePhone(quote.customer_phone) || undefined,
    email: email || undefined,
    customerRef: ref,
    customerType: 'R',
    unitNo: street.unitNo || undefined,
    unitType: street.unitNo ? 'UNIT' : undefined,
    streetNo: street.streetNo || undefined,
    streetName: street.streetName,
    streetType: street.streetType || undefined,
    suburb: address.suburb,
    postCode: Number(address.postcode),
    state: 'QLD',
    allowDuplicateAddress: true,
  };
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
  const created = await dataforceRequest(fetchImpl, token, '/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!created.customerId) throw new Error('dataforce-customer-id-missing');
  return { customerId: created.customerId, customerCreated: true };
}

function waitingInstruction(quote) {
  const alarms = Math.max(0, Number.parseInt(quote.alarm_qty, 10) || 0);
  const controllers = Math.max(0, Number.parseInt(quote.ctrl_qty, 10) || 0);
  const concrete = Number(quote.alarm_unit_price) > 98.005;
  const parts = [
    `${alarms} Smoke Alarm${alarms === 1 ? '' : 's'}`,
    concrete ? 'Concrete ceiling' : 'Normal ceiling',
    controllers ? `${controllers} Controller${controllers === 1 ? '' : 's'}` : '',
    quote.grand_total != null ? `Accepted quote $${Number(quote.grand_total).toFixed(2)}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

export async function syncAcceptedSmokeQuoteToDataforce({
  quoteToken,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const verified = await loadAcceptedQuote(quoteToken, fetchImpl, env);
  if (!verified.quote) return { synced: false, reason: verified.reason };

  const token = await dataforceToken(fetchImpl, env);
  const trackingCode = `SMOKE-${quoteReference(quoteToken)}`;
  const existingJobs = await search(fetchImpl, token, '/jobs/search', 'trackingCode', trackingCode);
  let job = (existingJobs.records || [])[0] || null;
  let customerResult = null;
  let jobCreated = false;

  if (!job?.jobId) {
    customerResult = await findOrCreateCustomer({
      quote: verified.quote,
      address: verified.address,
      quoteToken,
      fetchImpl,
      token,
    });
    job = await dataforceRequest(fetchImpl, token, '/jobs', {
      method: 'POST',
      body: JSON.stringify({
        customerId: customerResult.customerId,
        quotationStatus: 'Accepted',
        agentId: GOLDSURE_AGENT_ID,
        clientId: GOLDSURE_CLIENT_ID,
        trackingCode,
      }),
    });
    if (!job.jobId) throw new Error('dataforce-job-id-missing');
    jobCreated = true;
  }

  const appointments = await dataforceRequest(fetchImpl, token, `/jobs/${encodeURIComponent(job.jobId)}/appointments`);
  let appointment = (appointments.records || appointments || []).find(item =>
    Number(item.workTypeId) === SMOKE_INSTALL_WORK_TYPE_ID &&
    !['cancelled', 'canceled'].includes(compact(item.completionStatusDescription).toLowerCase())
  );
  let appointmentCreated = false;
  if (!appointment?.appointmentId) {
    appointment = await dataforceRequest(fetchImpl, token, '/appointments', {
      method: 'POST',
      body: JSON.stringify({
        jobId: Number(job.jobId),
        workTypeId: SMOKE_INSTALL_WORK_TYPE_ID,
        jobInstruction: waitingInstruction(verified.quote),
        duration: WAITING_APPOINTMENT_DURATION,
      }),
    });
    if (!appointment.appointmentId) throw new Error('dataforce-appointment-id-missing');
    appointmentCreated = true;
  }

  return {
    synced: true,
    reason: jobCreated || appointmentCreated ? 'created' : 'already-exists',
    jobId: Number(job.jobId),
    appointmentId: Number(appointment.appointmentId),
    waiting: compact(appointment.completionStatusDescription).toLowerCase() === 'waiting' ||
      (!appointment.fieldworkerId && !appointment.scheduledDate),
    customerCreated: customerResult?.customerCreated === true,
    jobCreated,
    appointmentCreated,
  };
}
