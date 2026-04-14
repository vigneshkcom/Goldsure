// api/smoke-alarms/ghl.js
// Unified GHL endpoint for the Smoke Alarms quote tracker.
// Keeps GHL_API_KEY server-side only.
//
//  GET  /api/smoke-alarms/ghl                        → pipeline stages
//  POST /api/smoke-alarms/ghl  { emails: [...] }     → email → stage map
//  PUT  /api/smoke-alarms/ghl  { opportunityId, stageId } → update stage

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = (extra = {}) => ({
  'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
  ...extra,
});

async function ghlGetRaw(path) {
  const res = await fetch(`${GHL_BASE}${path}`, { headers: GHL_HEADERS() });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: null, raw: text.slice(0, 200) }; }
}

// ── GET: return Smoke Alarms pipeline stages ────────────────────────────────

async function getPipelineStages(locationId) {
  // GHL v2 pipelines endpoint uses camelCase locationId (not location_id)
  const r = await fetch(
    `${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
    { headers: GHL_HEADERS() }
  );
  if (!r.ok) {
    const text = await r.text();
    console.error('GHL pipelines fetch failed:', r.status, text.slice(0, 200));
    return { error: 'Failed to fetch GHL pipelines', status: r.status, detail: text.slice(0, 200) };
  }
  const data = await r.json();
  const pipelines = data.pipelines || [];
  const pipeline = pipelines.find(p => (p.name || '').toLowerCase().includes('smoke')) || pipelines[0];
  if (!pipeline) return { error: 'No pipelines found in GHL' };
  return {
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stages: (pipeline.stages || [])
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(s => ({ id: s.id, name: s.name, position: s.position ?? 0 })),
  };
}

// ── POST: batch email → stage lookup ───────────────────────────────────────

async function getStageForEmail(email, locationId) {
  const r = await ghlGetRaw(`/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(email)}&limit=5`);
  if (!r.ok) {
    console.error(`GHL contacts lookup failed for ${email}: HTTP ${r.status}`, r.raw || r.data);
    return null;
  }
  const contacts = r.data?.contacts || [];
  const contact = contacts.find(c => (c.email || '').toLowerCase() === email.toLowerCase()) || contacts[0];
  if (!contact) return null;

  const o = await ghlGetRaw(`/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=1`);
  if (!o.ok) {
    console.error(`GHL opportunities lookup failed for contact ${contact.id}: HTTP ${o.status}`, o.data);
    return null;
  }
  const opp = o.data?.opportunities?.[0];
  if (!opp) return null;

  return {
    stage: opp.pipelineStageName || opp.pipelineStage?.name || null,
    stageId: opp.pipelineStageId || opp.pipelineStage?.id || null,
    opportunityId: opp.id || null,
    pipelineId: opp.pipelineId || null,
    pipeline: opp.pipelineName || opp.pipeline?.name || null,
  };
}

// ── PUT: update opportunity stage ───────────────────────────────────────────

async function updateStage(opportunityId, stageId) {
  const r = await fetch(`${GHL_BASE}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PUT',
    headers: GHL_HEADERS({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
  if (!r.ok) {
    const text = await r.text();
    console.error(`GHL update stage failed for opp ${opportunityId}: HTTP ${r.status}`, text.slice(0, 200));
    return { error: 'GHL update failed', detail: text.slice(0, 200), status: r.status };
  }
  return { success: true };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return res.status(500).json({ error: 'GHL credentials not configured' });

  // GET → pipeline stages
  if (req.method === 'GET') {
    const result = await getPipelineStages(locationId);
    if (result.error) return res.status(result.status || 404).json(result);
    return res.status(200).json(result);
  }

  // POST → batch email lookup
  if (req.method === 'POST') {
    const { emails } = req.body || {};
    if (!Array.isArray(emails) || emails.length === 0) return res.status(400).json({ error: 'emails array required' });
    const unique = [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))];
    const result = {};
    const BATCH = 5;
    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      await Promise.all(batch.map(async (email) => {
        try { result[email] = await getStageForEmail(email, locationId); }
        catch { result[email] = null; }
      }));
    }
    return res.status(200).json(result);
  }

  // PUT → update opportunity stage
  if (req.method === 'PUT') {
    const { opportunityId, stageId } = req.body || {};
    if (!opportunityId || !stageId) return res.status(400).json({ error: 'opportunityId and stageId are required' });
    const result = await updateStage(opportunityId, stageId);
    if (result.error) return res.status(result.status || 500).json(result);
    return res.status(200).json(result);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
