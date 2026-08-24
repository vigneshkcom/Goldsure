// Customer-facing quote support actions.
// POST { action: 'record-view', token } atomically records a genuine online open.

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { action, token } = req.body || {};
  if (action !== 'record-view') return res.status(400).json({ error: 'Unknown action.' });
  if (!token) return res.status(400).json({ error: 'token is required.' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Supabase is not configured.' });

  try {
    const viewRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_smoke_quote_view`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_token: token }),
    });

    if (!viewRes.ok) {
      const detail = await viewRes.text().catch(() => '');
      console.error('[Smoke quote view] update failed', viewRes.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'Could not record quote view.' });
    }

    const rows = await viewRes.json().catch(() => []);
    return res.status(200).json({ success: true, ...(rows[0] || {}) });
  } catch (error) {
    console.error('[Smoke quote view] update error', error.message);
    return res.status(502).json({ error: 'Could not record quote view.' });
  }
}
