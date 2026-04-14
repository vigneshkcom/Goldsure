// api/smoke-alarms/ghl-update-stage.js
// Updates an opportunity's pipeline stage in GHL.
// Body: { opportunityId, stageId }
// Keeps GHL_API_KEY server-side only.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
  'Version': '2021-07-28',
  'Content-Type': 'application/json',
  'Accept': 'application/json',
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GHL credentials not configured' });

  const { opportunityId, stageId } = req.body || {};
  if (!opportunityId || !stageId) {
    return res.status(400).json({ error: 'opportunityId and stageId are required' });
  }

  const r = await fetch(`${GHL_BASE}/opportunities/${encodeURIComponent(opportunityId)}`, {
    method: 'PUT',
    headers: GHL_HEADERS(),
    body: JSON.stringify({ pipelineStageId: stageId }),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error(`GHL update stage failed for opp ${opportunityId}: HTTP ${r.status}`, text.slice(0, 200));
    return res.status(r.status).json({ error: 'GHL update failed', detail: text.slice(0, 200) });
  }

  return res.status(200).json({ success: true });
}
