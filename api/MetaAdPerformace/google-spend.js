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

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: "refresh_token"
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      return res.status(500).json({
        success: false,
        error: "Failed to get access token",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    const query = `
      SELECT metrics.cost_micros
      FROM customer
    `;

    const adsResponse = await fetch(
      `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:searchStream`,
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

    const rawText = await adsResponse.text();

    if (!adsResponse.ok) {
      return res.status(500).json({
        success: false,
        error: "Google Ads API error",
        details: {
          httpStatus: adsResponse.status,
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

    if (Array.isArray(data)) {
      data.forEach(chunk => {
        if (chunk.results) {
          chunk.results.forEach(row => {
            totalMicros += Number(row.metrics?.costMicros || 0);
          });
        }
      });
    }

    const totalSpend = totalMicros / 1_000_000;

    return res.status(200).json({
      success: true,
      total_spend: totalSpend
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
