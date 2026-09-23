// lib/ghl-opportunity.js
// Make sure a GHL contact has an open opportunity sitting in the right
// pipeline/stage, creating one if none exists.
//
// Being "in GHL" as a contact is not the same as being trackable on a
// pipeline board — GHL only shows a stage for an opportunity (a deal), and
// nothing here created one automatically for NSW Hot Water leads the way an
// inbound-lead workflow does for the other pipelines. Quotes sent through
// this flow previously only ever wrote a contact + note, so the tracker's
// GHL Stage column had nothing to show. This closes that gap going forward.
// Best-effort throughout: never throws, a GHL hiccup just skips silently.

const GHL_BASE = 'https://services.leadconnectorhq.com';

export async function ensureOpportunityInStage({
  contactId, opportunityName, pipelineIdEnv = '', nameHints = [], stageNames = [],
  source = 'Direct Phone Call', pipelineCandidates = [], createIfMissing = true,
}) {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId || !contactId) return null;
  const hdrs = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28', Accept: 'application/json' };

  try {
    const pRes = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers: hdrs });
    const pipes = pRes.ok ? ((await pRes.json()).pipelines || []) : [];
    const requestedCandidates = pipelineCandidates.length
      ? pipelineCandidates
      : [{ pipelineIdEnv, nameHints }];
    const candidatePipes = [];
    for (const candidate of requestedCandidates) {
      let candidatePipe = candidate.pipelineIdEnv
        ? pipes.find(p => p.id === candidate.pipelineIdEnv)
        : null;
      const normalisedHints = (candidate.nameHints || []).map(h => String(h || '').trim().toLowerCase()).filter(Boolean);
      if (!candidatePipe) candidatePipe = pipes.find(p => normalisedHints.includes(String(p.name || '').trim().toLowerCase()));
      if (!candidatePipe) candidatePipe = pipes.find(p => normalisedHints.some(h => String(p.name || '').toLowerCase().includes(h)));
      if (candidatePipe && !candidatePipes.some(p => p.id === candidatePipe.id)) candidatePipes.push(candidatePipe);
    }
    if (!candidatePipes.length) return null;

    // Already has an open opportunity in this pipeline? Move it forward rather
    // than opening a duplicate deal.
    const oRes = await fetch(`${GHL_BASE}/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contactId)}&limit=100`, { headers: hdrs });
    const opps = oRes.ok ? ((await oRes.json()).opportunities || []) : [];
    const candidatePipeIds = new Set(candidatePipes.map(p => p.id));
    const openInCandidates = opps.filter(o => candidatePipeIds.has(o.pipelineId) && !['won', 'lost', 'abandoned'].includes(String(o.status || '').toLowerCase()));
    if (openInCandidates.length) {
      const opp = openInCandidates.sort((a, b) => new Date(b.updatedAt || b.dateUpdated || 0) - new Date(a.updatedAt || a.dateUpdated || 0))[0];
      const pipe = candidatePipes.find(p => p.id === opp.pipelineId);
      const stages = (pipe?.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      if (!stages.length) return null;
      const wanted = stageNames.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
      const targetStage = stages.find(s => wanted.includes(String(s.name || '').trim().toLowerCase()))
        || stages.find(s => wanted.some(w => String(s.name || '').toLowerCase().includes(w)))
        || stages[0];
      if (opp.pipelineStageId === targetStage.id) return { opportunityId: opp.id, pipelineId: pipe.id, created: false, moved: false };
      const uRes = await fetch(`${GHL_BASE}/opportunities/${encodeURIComponent(opp.id)}`, {
        method: 'PUT', headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId: pipe.id, pipelineStageId: targetStage.id }),
      });
      return { opportunityId: opp.id, pipelineId: pipe.id, created: false, moved: uRes.ok };
    }

    if (!createIfMissing) return null;

    // No open opportunity in this pipeline — create one on the target stage.
    const pipe = candidatePipes[0];
    const stages = (pipe.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    if (!stages.length) return null;
    const wanted = stageNames.map(s => String(s || '').trim().toLowerCase()).filter(Boolean);
    const targetStage = stages.find(s => wanted.includes(String(s.name || '').trim().toLowerCase()))
      || stages.find(s => wanted.some(w => String(s.name || '').toLowerCase().includes(w)))
      || stages[0];
    const cRes = await fetch(`${GHL_BASE}/opportunities/`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: pipe.id,
        locationId,
        contactId,
        name: opportunityName || 'Quote sent',
        pipelineStageId: targetStage.id,
        status: 'open',
        source,
      }),
    });
    if (!cRes.ok) {
      console.error('[ghl-opportunity] create failed', cRes.status, (await cRes.text().catch(() => '')).slice(0, 300));
      return null;
    }
    const data = await cRes.json().catch(() => ({}));
    const opportunityId = data?.opportunity?.id || data?.id;
    return opportunityId ? { opportunityId, pipelineId: pipe.id, created: true, moved: false } : null;
  } catch (e) {
    console.error('[ghl-opportunity]', e.message);
    return null;
  }
}
