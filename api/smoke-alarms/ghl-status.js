// api/smoke-alarms/ghl-status.js
// Returns the GHL Smoke Alarms pipeline stage for a batch of customer emails.
// Keeps GHL_API_KEY server-side only.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = () => ({
  'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
});

async function ghlGet(path) {
  const res = await fetch(`${GHL_BASE}${path}`, { headers: GHL_HEADERS() });
  if (!res.ok) return null;
  return res.json();
}

async function getStageForEmail(email, locationId) {
  // 1. Search GHL contacts by email
  const data = await ghlGet(`/contacts/search?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(email)}`);
  const contacts = data?.contacts || [];
  // Exact email match (search is fuzzy)
  const contact = contacts.find(c => (c.email || '').toLowerCase() === email.toLowerCase());
  if (!contact) return null;

  // 2. Get most recent opportunity for this contact
  const oppData = await ghlGet(`/opportunities/search?location_id=${encodeURIComponent(locationId)}&contact_id=${encodeURIComponent(contact.id)}&limit=1`);
  const opp = oppData?.opportunities?.[0];
  if (!opp) return null;

  return {
    stage: opp.pipelineStage?.name || opp.status || null,
    pipeline: opp.pipeline?.name || opp.pipelineName || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return res.status(500).json({ error: 'GHL credentials not configured' });

  const { emails } = req.body || {};
  if (!Array.isArray(emails) || emails.length === 0) return res.status(400).json({ error: 'emails array required' });

  // Deduplicate
  const unique = [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))];

  // Process in batches of 5 concurrently
  const result = {};
  const BATCH = 5;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    await Promise.all(batch.map(async (email) => {
      try {
        result[email] = await getStageForEmail(email, locationId);
      } catch {
        result[email] = null;
      }
    }));
  }

  return res.status(200).json(result);
}
