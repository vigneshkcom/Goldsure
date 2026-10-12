export const BATTERY_CAMPAIGN_SLUG = 'vic-battery-existing-customers-2026';
export const PORTAL_URL = 'https://portal.goldsure.com.au';

export function isTrackingToken(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function batteryTrackingUrls(token) {
  if (!isTrackingToken(token)) throw new Error('Invalid campaign tracking token');
  const encoded = encodeURIComponent(token);
  return {
    pixelUrl: `${PORTAL_URL}/api/battery/request-callback?action=battery-email-open&t=${encoded}`,
    callbackUrl: `${PORTAL_URL}/api/battery/request-callback?action=battery-email-click&t=${encoded}&kind=callback`,
    unsubscribeUrl: `${PORTAL_URL}/Battery/unsubscribe.html?t=${encoded}`,
  };
}
