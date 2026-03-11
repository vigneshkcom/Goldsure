export default async function handler(req, res) {
  try {
    const {
      GOOGLE_ADS_DEVELOPER_TOKEN,
      GOOGLE_ADS_CLIENT_ID,
      GOOGLE_ADS_CLIENT_SECRET,
      GOOGLE_ADS_REFRESH_TOKEN,
      GOOGLE_ADS_MANAGER_ID,
      GOOGLE_ADS_CUSTOMER_ID
    } = process.env;

    if (
      !GOOGLE_ADS_DEVELOPER_TOKEN ||
      !GOOGLE_ADS_CLIENT_ID ||
      !GOOGLE_ADS_CLIENT_SECRET ||
      !GOOGLE_ADS_REFRESH_TOKEN ||
      !GOOGLE_ADS_MANAGER_ID ||
      !GOOGLE_ADS_CUSTOMER_ID
    ) {
      return res.status(500).json({
        success: false,
        error: "Missing required environment variables"
      });
    }

    // ── FIX 1: Strip dashes from customer/manager IDs ──
    // Google Ads REST API requires numeric-only IDs (no dashes).
    // If env vars were stored as "123-456-7890" the URL would be invalid.
    const customerId = GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
    const managerId  = GOOGLE_ADS_MANAGER_ID.replace(/-/g, '');

    // ── Validate and extract date range from query params ──
    const { from, to } = req.query;

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid date parameters. Required: ?from=YYYY-MM-DD&to=YYYY-MM-DD"
      });
    }

    if (from > to) {
      return res.status(400).json({
        success: false,
        error: "from date must be on or before to date"
      });
    }

    // 1. Get fresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id:     GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type:    "refresh_token"
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(500).json({
        success: false,
        error:   "Failed to get Google OAuth access token — refresh token may have expired",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // 2. Query Google Ads spend filtered by date range
    // ── FIX 2: Added campaign.status filter to exclude REMOVED campaigns ──
    //    (they can still appear with zero spend and inflate campaign_count)
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        segments.date,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}'
        AND metrics.cost_micros > 0
        AND campaign.status != 'REMOVED'
    `;

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization:       `Bearer ${accessToken}`,
          "developer-token":   GOOGLE_ADS_DEVELOPER_TOKEN,
          "login-customer-id": managerId,
          "Content-Type":      "application/json"
        },
        body: JSON.stringify({ query })
      }
    );

    const rawText = await adsRes.text();

    if (!adsRes.ok) {
      return res.status(500).json({
        success: false,
        error:   "Google Ads API error",
        details: { httpStatus: adsRes.status, body: rawText }
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error:   "Failed to parse Google Ads response",
        details: rawText
      });
    }

    let totalMicros = 0;
    const seenCampaigns = new Set();

    if (Array.isArray(data.results)) {
      data.results.forEach(row => {
        // ── FIX 3: Google REST API returns costMicros as a STRING ──
        // Use parseInt not Number to safely handle "1234567" or 1234567.
        const metrics = row.metrics || {};
        // camelCase (REST v23) first, snake_case fallback
        const rawVal = metrics.costMicros ?? metrics.cost_micros ?? '0';
        totalMicros += parseInt(rawVal, 10) || 0;

        const campId = row.campaign?.id;
        if (campId) seenCampaigns.add(String(campId));
      });
    }

    const totalSpend = totalMicros / 1_000_000;

    return res.status(200).json({
      success:        true,
      total_spend:    totalSpend,
      total_micros:   totalMicros,
      campaign_count: seenCampaigns.size,
      row_count:      data.results?.length ?? 0,
      from,
      to
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error:   error.message
    });
  }
}
