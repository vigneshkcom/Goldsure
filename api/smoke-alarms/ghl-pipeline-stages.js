// api/smoke-alarms/ghl-pipeline-stages.js
// Returns the stages of the Smoke Alarms pipeline in GHL.
// Keeps GHL_API_KEY server-side only.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
});

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return res.status(500).json({ error: 'GHL credentials not configured' });

  const r = await fetch(
    `${GHL_BASE}/opportunities/pipelines?location_id=${encodeURIComponent(locationId)}`,
    { headers: GHL_HEADERS() }
  );
  if (!r.ok) {
    const text = await r.text();
    console.error('GHL pipelines fetch failed:', r.status, text.slice(0, 200));
    return res.status(500).json({ error: 'Failed to fetch GHL pipelines', status: r.status });
  }

  const data = await r.json();
  const pipelines = data.pipelines || [];

  // Find the Smoke Alarms pipeline (case-insensitive contains match)
  const pipeline = pipelines.find(p =>
    (p.name || '').toLowerCase().includes('smoke')
  ) || pipelines[0]; // fallback to first pipeline if none matches

  if (!pipeline) return res.status(404).json({ error: 'No pipelines found in GHL' });

  return res.status(200).json({
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    stages: (pipeline.stages || [])
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(s => ({ id: s.id, name: s.name, position: s.position ?? 0 })),
  });
}
