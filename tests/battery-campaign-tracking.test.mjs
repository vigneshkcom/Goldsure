import test from 'node:test';
import assert from 'node:assert/strict';
import { batteryTrackingUrls, isTrackingToken } from '../lib/battery-campaign-tracking.js';

const token = 'd2719d52-a3d1-4bea-9044-6eb57f817620';

test('builds opaque tracking URLs for campaign recipients', () => {
  const urls = batteryTrackingUrls(token);
  assert.match(urls.pixelUrl, /battery-email-open/);
  assert.match(urls.callbackUrl, /battery-email-click/);
  assert.match(urls.unsubscribeUrl, /Battery\/unsubscribe\.html/);
  assert.ok(isTrackingToken(token));
});

test('rejects malformed tracking tokens', () => {
  assert.equal(isTrackingToken('customer@example.com'), false);
  assert.throws(() => batteryTrackingUrls('not-a-token'));
});
