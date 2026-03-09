export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const {
      GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REFRESH_TOKEN,
      GOOGLE_ADS_MANAGER_ID,
      GOOGLE_ADS_CUSTOMER_ID,
    } = process.env;

    // ── 1. Get access token ───────────────────────────────────────────────
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(200).json({
        success: false,
        error:   'OAuth token exchange failed',
        details: tokenData,
      });
    }

    const accessToken = tokenData.access_token;

    // ── 2. Query Google Ads API ───────────────────────────────────────────
    // Querying FROM campaign (not FROM customer) gives lifetime cost_micros
    // per campaign. FROM customer only reflects the current day's segment
    // and often returns a single row with 0 spend outside of today.
    const gaqlQuery = `SELECT campaign.id, campaign.name, metrics.cost_micros FROM campaign`;

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':     `Bearer ${accessToken}`,
          'developer-token':   GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id': GOOGLE_ADS_MANAGER_ID,
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({ query: gaqlQuery, pageSize: 10000 }),
      }
    );

    const rawText = await adsRes.text();

    if (!adsRes.ok) {
      let parsed = null;
      try { parsed = JSON.parse(rawText); } catch (_) {}
      return res.status(200).json({
        success: false,
        error:   'Google Ads API error',
        details: { httpStatus: adsRes.status, body: parsed ?? rawText },
      });
    }

    const data = JSON.parse(rawText);

    // ── 3. Sum cost_micros ────────────────────────────────────────────────
    // The REST API returns fields in snake_case (cost_micros), NOT camelCase.
    // The old code used row.metrics?.costMicros which was always undefined,
    // so every row summed to 0. We check both forms defensively.
    let totalMicros = 0;
    const results = data.results ?? [];
    for (const row of results) {
      const m = row.metrics ?? {};
      totalMicros += Number(m.cost_micros ?? m.costMicros ?? 0);
    }

    // Handle pagination (accounts with many campaigns)
    let nextPageToken = data.nextPageToken;
    while (nextPageToken) {
      const pageRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
        {
          method: 'POST',
          headers: {
            'Authorization':     `Bearer ${accessToken}`,
            'developer-token':   GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id': GOOGLE_ADS_MANAGER_ID,
            'Content-Type':      'application/json',
          },
          body: JSON.stringify({ query: gaqlQuery, pageSize: 10000, pageToken: nextPageToken }),
        }
      );
      if (!pageRes.ok) break;
      const pageData = JSON.parse(await pageRes.text());
      for (const row of (pageData.results ?? [])) {
        const m = row.metrics ?? {};
        totalMicros += Number(m.cost_micros ?? m.costMicros ?? 0);
      }
      nextPageToken = pageData.nextPageToken;
    }

    return res.status(200).json({
      success:        true,
      total_spend:    totalMicros / 1_000_000,
      total_micros:   totalMicros,
      campaign_count: results.length,
      currency:       'AUD',
      note:           'Lifetime spend inc-GST. Frontend divides by 1.1 for ex-GST.',
    });

  } catch (err) {
    return res.status(200).json({
      success: false,
      error:   err.message ?? 'Unexpected server error',
    });
  }
}
