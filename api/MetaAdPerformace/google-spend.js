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

    // 1. Get fresh access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(500).json({
        success: false,
        error: "Failed to get access token",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // 2. Query Google Ads spend
    const query = `
      SELECT campaign.id, campaign.name, metrics.cost_micros
      FROM campaign
    `;

    const adsRes = await fetch(
      `https://googleads.googleapis.com/v23/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
          "login-customer-id": GOOGLE_ADS_MANAGER_ID,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ query })
      }
    );

    const rawText = await adsRes.text();

    if (!adsRes.ok) {
      return res.status(500).json({
        success: false,
        error: "Google Ads API error",
        details: {
          httpStatus: adsRes.status,
          body: rawText
        }
      });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: "Failed to parse Google Ads response",
        details: rawText
      });
    }

    let totalMicros = 0;
    let campaignCount = 0;

    if (Array.isArray(data.results)) {
      data.results.forEach(row => {
        const metrics = row.metrics || {};
        const val = metrics.costMicros ?? metrics.cost_micros ?? 0;
        totalMicros += Number(val);
        campaignCount += 1;
      });
    }

    const totalSpend = totalMicros / 1_000_000;

    return res.status(200).json({
      success: true,
      total_spend: totalSpend,
      total_micros: totalMicros,
      campaign_count: campaignCount
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
