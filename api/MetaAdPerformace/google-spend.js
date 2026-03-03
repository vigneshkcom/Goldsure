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

    // 1️⃣ Get fresh access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        error: "Failed to get access token",
        details: tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // 2️⃣ Use REST search (NOT searchStream)
    const query = `
      SELECT metrics.cost_micros
      FROM customer
    `;

    const adsResponse = await fetch(
      `https://googleads.googleapis.com/v18/customers/${GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": GOOGLE_ADS_DEVELOPER_TOKEN,
          "login-customer-id": GOOGLE_ADS_MANAGER_ID,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          query: query
        })
      }
    );

    const responseText = await adsResponse.text();

    if (!adsResponse.ok) {
      return res.status(500).json({
        error: "Google Ads API error",
        status: adsResponse.status,
        response: responseText
      });
    }

    const data = JSON.parse(responseText);

    let totalMicros = 0;

    if (data.results) {
      data.results.forEach(row => {
        totalMicros += Number(row.metrics?.costMicros || 0);
      });
    }

    const totalSpend = totalMicros / 1_000_000;

    return res.status(200).json({
      success: true,
      total_spend: totalSpend
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
