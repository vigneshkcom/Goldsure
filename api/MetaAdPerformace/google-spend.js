/**
 * api/MetaAdPerformace/google-spend.js
 *
 * Returns lifetime Google Ads spend (all-time, inc-GST, in AUD) for the
 * configured customer account via the Google Ads REST API v18.
 *
 * Response shape:
 *   { success: true,  total_spend: <number in AUD inc-GST> }
 *   { success: false, error: "<message>", details?: <any> }
 *
 * Environment variables required (set in Vercel project settings):
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_MANAGER_ID      (login-customer-id, no dashes)
 *   GOOGLE_ADS_CUSTOMER_ID     (ads customer id, no dashes)
 */

export default async function handler(req, res) {
  // ── CORS / method guard ──────────────────────────────────────────────────
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

    // ── Validate env vars ──────────────────────────────────────────────────
    const missing = [
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET',
      'GOOGLE_ADS_REFRESH_TOKEN',
      'GOOGLE_ADS_MANAGER_ID',
      'GOOGLE_ADS_CUSTOMER_ID',
    ].filter(k => !process.env[k]);

    if (missing.length) {
      return res.status(500).json({
        success: false,
        error: 'Missing required environment variables',
        details: missing,
      });
    }

    // ── Step 1: Exchange refresh token for access token ────────────────────
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id:     GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(502).json({
        success: false,
        error:   'Failed to obtain Google OAuth access token',
        details: { status: tokenRes.status, body: tokenData },
      });
    }

    const accessToken = tokenData.access_token;

    // ── Step 2: Query Google Ads API for all-time campaign cost ───────────
    //
    // We query the `campaign` resource which returns cost_micros per campaign.
    // Summing gives lifetime spend across all campaigns in the account.
    // metrics.cost_micros is always in the account currency (AUD).
    //
    const gaqlQuery = `
      SELECT
        campaign.id,
        metrics.cost_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `.trim();

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization':       `Bearer ${accessToken}`,
          'developer-token':     GOOGLE_ADS_DEVELOPER_TOKEN,
          'login-customer-id':   GOOGLE_ADS_MANAGER_ID,
          'Content-Type':        'application/json',
        },
        body: JSON.stringify({
          query:    gaqlQuery,
          pageSize: 10000,
        }),
      }
    );

    const rawText = await adsRes.text();

    if (!adsRes.ok) {
      let parsed = null;
      try { parsed = JSON.parse(rawText); } catch (_) {}
      return res.status(502).json({
        success: false,
        error:   'Google Ads API returned an error',
        details: { httpStatus: adsRes.status, body: parsed ?? rawText },
      });
    }

    const data = JSON.parse(rawText);

    // ── Step 3: Sum cost_micros across all campaigns (with pagination) ────
    let totalMicros = 0;
    if (Array.isArray(data.results)) {
      for (const row of data.results) {
        totalMicros += Number(row.metrics?.costMicros ?? 0);
      }
    }

    let nextPageToken = data.nextPageToken;
    while (nextPageToken) {
      const pageRes = await fetch(
        `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
        {
          method: 'POST',
          headers: {
            'Authorization':       `Bearer ${accessToken}`,
            'developer-token':     GOOGLE_ADS_DEVELOPER_TOKEN,
            'login-customer-id':   GOOGLE_ADS_MANAGER_ID,
            'Content-Type':        'application/json',
          },
          body: JSON.stringify({ query: gaqlQuery, pageSize: 10000, pageToken: nextPageToken }),
        }
      );
      if (!pageRes.ok) break;
      const pageData = JSON.parse(await pageRes.text());
      if (Array.isArray(pageData.results)) {
        for (const row of pageData.results) {
          totalMicros += Number(row.metrics?.costMicros ?? 0);
        }
      }
      nextPageToken = pageData.nextPageToken;
    }

    const totalSpend = totalMicros / 1_000_000;

    return res.status(200).json({
      success:     true,
      total_spend: totalSpend,
      currency:    'AUD',
      note:        'Lifetime spend (inc-GST). Divide by 1.1 for ex-GST.',
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error:   err.message ?? 'Unexpected server error',
    });
  }
}
