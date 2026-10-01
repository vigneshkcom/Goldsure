const GHL_BASE = 'https://services.leadconnectorhq.com';

const normalizeName = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizePhone = value => String(value || '').replace(/\D/g, '').slice(-9);

async function readJson(response) {
  return response.json().catch(() => ({}));
}

const ACCEPTED_QUOTE_TABLES = new Set(['quote_emails', 'hotwater_quotes', 'aircon_quotes', 'nsw_hws_quotes']);

async function loadQuote(quoteToken, quoteTable, outcome, fetchImpl, env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!quoteToken) return { reason: 'missing-quote-token' };
  if (!ACCEPTED_QUOTE_TABLES.has(quoteTable)) return { reason: 'unsupported-quote-table' };
  if (!supabaseUrl || !supabaseKey) return { reason: 'supabase-not-configured' };

  const addressField = quoteTable === 'nsw_hws_quotes' ? 'property_address' : 'customer_address';
  const url = `${supabaseUrl}/rest/v1/${quoteTable}?quote_token=eq.${encodeURIComponent(quoteToken)}` +
    `&select=customer_name,customer_email,customer_phone,${addressField},status,accepted,accepted_at&limit=1`;
  const response = await fetchImpl(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!response.ok) return { reason: `quote-lookup-failed-${response.status}` };

  const rows = await readJson(response);
  const quote = Array.isArray(rows) ? rows[0] : null;
  if (!quote) return { reason: 'quote-not-found' };
  if (!quote.customer_address && quote.property_address) quote.customer_address = quote.property_address;
  if (outcome === 'rejected') {
    // Never trust the caller: only move a contact to Not Interested when the
    // quote row itself says it was rejected.
    if (normalizeName(quote.status) !== 'rejected') return { reason: 'quote-not-rejected' };
  } else if (!quote.accepted_at) {
    return { reason: 'quote-not-customer-accepted' };
  } else if (quote.accepted !== true && normalizeName(quote.status) !== 'accepted') {
    return { reason: 'quote-not-accepted' };
  }
  return { quote };
}

async function findContact({ email, phone, locationId, headers, fetchImpl }) {
  const wantedEmail = normalizeEmail(email);
  const wantedPhone = normalizePhone(phone);

  for (const query of [email, phone].filter(Boolean)) {
    const response = await fetchImpl(
      `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(query)}&limit=10`,
      { headers }
    );
    if (!response.ok) continue;
    const data = await readJson(response);
    const contact = (data.contacts || []).find(candidate => {
      const emailMatches = wantedEmail && normalizeEmail(candidate.email) === wantedEmail;
      const phoneMatches = wantedPhone && normalizePhone(candidate.phone) === wantedPhone;
      return emailMatches || phoneMatches;
    });
    if (contact?.id) return contact;
  }

  return null;
}

const STAGE_MATCHERS = {
  accepted: name => name === 'quote accepted',
  // GHL stage is named e.g. "Not Interested/Spam".
  rejected: name => name.includes('not interested'),
};

async function updateOpportunityJobId({ opportunityId, jobId, locationId, headers, fetchImpl }) {
  if (!jobId) return {};
  try {
    const fieldsResponse = await fetchImpl(
      `${GHL_BASE}/locations/${encodeURIComponent(locationId)}/customFields?model=opportunity`,
      { headers }
    );
    if (!fieldsResponse.ok) {
      return { jobIdFieldUpdated: false, jobIdFieldReason: `field-lookup-failed-${fieldsResponse.status}` };
    }
    const fieldsPayload = await readJson(fieldsResponse);
    const jobIdField = (fieldsPayload.customFields || []).find(field =>
      normalizeName(field.name) === 'job id' || String(field.fieldKey || '').toLowerCase().endsWith('.job_id')
    );
    if (!jobIdField?.id) return { jobIdFieldUpdated: false, jobIdFieldReason: 'job-id-field-not-found' };
    const updateResponse = await fetchImpl(
      `${GHL_BASE}/opportunities/${encodeURIComponent(opportunityId)}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: [{ id: jobIdField.id, fieldValue: String(jobId) }] }),
      }
    );
    return updateResponse.ok
      ? { jobIdFieldUpdated: true, jobIdFieldReason: 'updated' }
      : { jobIdFieldUpdated: false, jobIdFieldReason: `field-update-failed-${updateResponse.status}` };
  } catch (_) {
    return { jobIdFieldUpdated: false, jobIdFieldReason: 'field-update-failed-network' };
  }
}

async function syncQuoteStage({
  outcome,
  quoteToken,
  quoteTable,
  pipelineNames,
  pipelineId = '',
  stageId = '',
  noteBuilder = null,
  opportunityJobId = '',
  fetchImpl = fetch,
  env = process.env,
}) {
  const verified = await loadQuote(quoteToken, quoteTable, outcome, fetchImpl, env);
  if (!verified.quote) return { moved: false, reason: verified.reason };

  const apiKey = env.GHL_API_KEY;
  const locationId = env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return { moved: false, reason: 'ghl-not-configured' };

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Version: '2021-07-28',
    Accept: 'application/json',
  };
  const contact = await findContact({
    email: verified.quote.customer_email,
    phone: verified.quote.customer_phone,
    locationId,
    headers,
    fetchImpl,
  });
  if (!contact) return { moved: false, reason: 'contact-not-found' };

  let noteResult = {};
  if (typeof noteBuilder === 'function') {
    const noteBody = String(noteBuilder(verified.quote) || '').trim();
    if (!noteBody) {
      noteResult = { noteAdded: false, noteReason: 'note-body-empty', contactId: contact.id };
    } else {
      try {
        const noteResponse = await fetchImpl(
          `${GHL_BASE}/contacts/${encodeURIComponent(contact.id)}/notes`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: noteBody }),
          }
        );
        noteResult = noteResponse.ok
          ? { noteAdded: true, noteReason: 'added', contactId: contact.id }
          : { noteAdded: false, noteReason: `note-add-failed-${noteResponse.status}`, contactId: contact.id };
      } catch (_) {
        noteResult = { noteAdded: false, noteReason: 'note-add-failed-network', contactId: contact.id };
      }
    }
  }
  const withNote = result => ({ ...result, ...noteResult });

  const pipelineResponse = await fetchImpl(
    `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers }
  );
  if (!pipelineResponse.ok) return withNote({ moved: false, reason: `pipeline-lookup-failed-${pipelineResponse.status}` });

  const pipelineData = await readJson(pipelineResponse);
  const configuredPipelineId = String(pipelineId || '').trim();
  const wantedPipelineNames = (pipelineNames || []).map(normalizeName).filter(Boolean);
  const targetPipeline = (pipelineData.pipelines || []).find(pipeline =>
    configuredPipelineId
      ? pipeline.id === configuredPipelineId
      : wantedPipelineNames.includes(normalizeName(pipeline.name))
  ) || (pipelineData.pipelines || []).find(pipeline =>
    !configuredPipelineId && wantedPipelineNames.some(name => normalizeName(pipeline.name).includes(name))
  );
  if (!targetPipeline) return withNote({ moved: false, reason: 'pipeline-not-found' });

  const configuredStageId = String(stageId || '').trim();
  const matchesStage = STAGE_MATCHERS[outcome];
  const acceptedStage = (targetPipeline.stages || []).find(stage =>
    configuredStageId
      ? stage.id === configuredStageId
      : matchesStage(normalizeName(stage.name))
  );
  if (!acceptedStage) {
    return withNote({ moved: false, reason: outcome === 'rejected' ? 'not-interested-stage-not-found' : 'quote-accepted-stage-not-found' });
  }

  const opportunityResponse = await fetchImpl(
    `${GHL_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=100`,
    { headers }
  );
  if (!opportunityResponse.ok) return withNote({ moved: false, reason: `opportunity-lookup-failed-${opportunityResponse.status}` });

  const opportunityData = await readJson(opportunityResponse);
  const matchingOpportunities = (opportunityData.opportunities || [])
    .filter(opportunity => opportunity.pipelineId === targetPipeline.id)
    .sort((a, b) => new Date(b.updatedAt || b.dateUpdated || 0) - new Date(a.updatedAt || a.dateUpdated || 0));
  const opportunity = matchingOpportunities.find(item => normalizeName(item.status) === 'open') || matchingOpportunities[0];
  if (!opportunity?.id) return withNote({ moved: false, reason: 'opportunity-not-found' });
  // A rejected quote must not pull a job that is already won out of that state.
  if (outcome === 'rejected' && normalizeName(opportunity.status) === 'won') {
    return withNote({ moved: false, reason: 'opportunity-already-won', opportunityId: opportunity.id });
  }

  const alreadyInStage = opportunity.pipelineStageId === acceptedStage.id;
  if (!alreadyInStage) {
    const updateResponse = await fetchImpl(
      `${GHL_BASE}/opportunities/${encodeURIComponent(opportunity.id)}`,
      {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStageId: acceptedStage.id }),
      }
    );
    if (!updateResponse.ok) return withNote({ moved: false, reason: `stage-update-failed-${updateResponse.status}` });
  }

  const jobIdResult = await updateOpportunityJobId({
    opportunityId: opportunity.id,
    jobId: opportunityJobId,
    locationId,
    headers,
    fetchImpl,
  });

  return withNote({
    moved: !alreadyInStage,
    reason: alreadyInStage
      ? (outcome === 'rejected' ? 'already-in-not-interested' : 'already-in-quote-accepted')
      : 'moved',
    opportunityId: opportunity.id,
    pipelineId: targetPipeline.id,
    pipelineName: targetPipeline.name,
    stageId: acceptedStage.id,
    ...jobIdResult,
  });
}

export function syncAcceptedQuoteStage(args) {
  return syncQuoteStage({ ...args, outcome: 'accepted' });
}

export async function verifyCustomerAcceptedQuote({ quoteToken, quoteTable, fetchImpl = fetch, env = process.env }) {
  const result = await loadQuote(quoteToken, quoteTable, 'accepted', fetchImpl, env);
  return result.quote
    ? { verified: true, quote: result.quote }
    : { verified: false, reason: result.reason };
}

// Customer (or staff) rejected the quote -> move their opportunity to the
// pipeline's "Not Interested" stage. Optional per-product override env vars:
// SMOKE_ALARMS_ / HWS_ / AIRCON_ / NSW_HWS_ + QUOTE_NOT_INTERESTED_STAGE_ID.
export function syncRejectedQuoteStage(args) {
  return syncQuoteStage({ ...args, outcome: 'rejected' });
}

const REJECT_PIPELINES = {
  quote_emails:    { names: ['Smoke Alarms'],    pipelineEnv: 'SMOKE_ALARMS_PIPELINE_ID', stageEnv: 'SMOKE_ALARMS_QUOTE_NOT_INTERESTED_STAGE_ID' },
  hotwater_quotes: { names: ['HWS Pipeline'],    pipelineEnv: 'HWS_PIPELINE_ID',          stageEnv: 'HWS_QUOTE_NOT_INTERESTED_STAGE_ID' },
  aircon_quotes:   { names: ['Aircons'], pipelineEnv: 'AIRCON_PIPELINE_ID', stageEnv: 'AIRCON_QUOTE_NOT_INTERESTED_STAGE_ID' },
  nsw_hws_quotes:  { names: ['NSW HWS Pipeline'], pipelineEnv: 'NSW_HWS_PIPELINE_ID',    stageEnv: 'NSW_HWS_QUOTE_NOT_INTERESTED_STAGE_ID' },
};

export function syncRejectedQuoteStageForTable({ quoteToken, quoteTable, fetchImpl = fetch, env = process.env }) {
  const cfg = REJECT_PIPELINES[quoteTable];
  if (!cfg) return Promise.resolve({ moved: false, reason: 'unsupported-quote-table' });
  return syncRejectedQuoteStage({
    quoteToken,
    quoteTable,
    pipelineNames: cfg.names,
    pipelineId: env[cfg.pipelineEnv],
    stageId: env[cfg.stageEnv],
    fetchImpl,
    env,
  });
}

export function syncAcceptedSmokeAlarmStage({ quoteToken, dataforceJobId = '', fetchImpl = fetch, env = process.env }) {
  return syncAcceptedQuoteStage({
    quoteToken,
    quoteTable: 'quote_emails',
    pipelineNames: ['Smoke Alarms'],
    pipelineId: env.SMOKE_ALARMS_PIPELINE_ID,
    stageId: env.SMOKE_ALARMS_QUOTE_ACCEPTED_STAGE_ID,
    noteBuilder: quote => quote.customer_address ? [
      'Smoke alarm quote accepted',
      `Customer: ${quote.customer_name || 'Customer'}`,
      `Property address: ${String(quote.customer_address).trim().replace(/\s+/g, ' ')}`,
      dataforceJobId ? `Dataforce job: ${dataforceJobId} (Waiting list)` : '',
    ].filter(Boolean).join('\n') : '',
    opportunityJobId: dataforceJobId,
    fetchImpl,
    env,
  });
}
