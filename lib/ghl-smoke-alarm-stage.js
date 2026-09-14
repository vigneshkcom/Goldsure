const GHL_BASE = 'https://services.leadconnectorhq.com';

const normalizeName = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizePhone = value => String(value || '').replace(/\D/g, '').slice(-9);

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function loadAcceptedQuote(quoteToken, fetchImpl, env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!quoteToken) return { reason: 'missing-quote-token' };
  if (!supabaseUrl || !supabaseKey) return { reason: 'supabase-not-configured' };

  const url = `${supabaseUrl}/rest/v1/quote_emails?quote_token=eq.${encodeURIComponent(quoteToken)}` +
    '&select=customer_email,customer_phone,status,accepted&limit=1';
  const response = await fetchImpl(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!response.ok) return { reason: `quote-lookup-failed-${response.status}` };

  const rows = await readJson(response);
  const quote = Array.isArray(rows) ? rows[0] : null;
  if (!quote) return { reason: 'quote-not-found' };
  if (quote.accepted !== true && normalizeName(quote.status) !== 'accepted') {
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

export async function syncAcceptedSmokeAlarmStage({ quoteToken, fetchImpl = fetch, env = process.env }) {
  const verified = await loadAcceptedQuote(quoteToken, fetchImpl, env);
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

  const pipelineResponse = await fetchImpl(
    `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers }
  );
  if (!pipelineResponse.ok) return { moved: false, reason: `pipeline-lookup-failed-${pipelineResponse.status}` };

  const pipelineData = await readJson(pipelineResponse);
  const configuredPipelineId = String(env.SMOKE_ALARMS_PIPELINE_ID || '').trim();
  const smokePipeline = (pipelineData.pipelines || []).find(pipeline =>
    configuredPipelineId
      ? pipeline.id === configuredPipelineId
      : normalizeName(pipeline.name) === 'smoke alarms'
  ) || (pipelineData.pipelines || []).find(pipeline =>
    !configuredPipelineId && normalizeName(pipeline.name).includes('smoke')
  );
  if (!smokePipeline) return { moved: false, reason: 'smoke-pipeline-not-found' };

  const configuredStageId = String(env.SMOKE_ALARMS_QUOTE_ACCEPTED_STAGE_ID || '').trim();
  const acceptedStage = (smokePipeline.stages || []).find(stage =>
    configuredStageId
      ? stage.id === configuredStageId
      : normalizeName(stage.name) === 'quote accepted'
  );
  if (!acceptedStage) return { moved: false, reason: 'quote-accepted-stage-not-found' };

  const opportunityResponse = await fetchImpl(
    `${GHL_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=100`,
    { headers }
  );
  if (!opportunityResponse.ok) return { moved: false, reason: `opportunity-lookup-failed-${opportunityResponse.status}` };

  const opportunityData = await readJson(opportunityResponse);
  const smokeOpportunities = (opportunityData.opportunities || [])
    .filter(opportunity => opportunity.pipelineId === smokePipeline.id)
    .sort((a, b) => new Date(b.updatedAt || b.dateUpdated || 0) - new Date(a.updatedAt || a.dateUpdated || 0));
  const opportunity = smokeOpportunities.find(item => normalizeName(item.status) === 'open') || smokeOpportunities[0];
  if (!opportunity?.id) return { moved: false, reason: 'smoke-opportunity-not-found' };
  if (opportunity.pipelineStageId === acceptedStage.id) {
    return { moved: false, reason: 'already-in-quote-accepted', opportunityId: opportunity.id, stageId: acceptedStage.id };
  }

  const updateResponse = await fetchImpl(
    `${GHL_BASE}/opportunities/${encodeURIComponent(opportunity.id)}`,
    {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pipelineStageId: acceptedStage.id }),
    }
  );
  if (!updateResponse.ok) return { moved: false, reason: `stage-update-failed-${updateResponse.status}` };

  return {
    moved: true,
    reason: 'moved',
    opportunityId: opportunity.id,
    pipelineId: smokePipeline.id,
    stageId: acceptedStage.id,
  };
}
