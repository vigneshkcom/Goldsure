import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatteryCampaignEmail, buildBatteryCampaignText } from '../lib/battery-campaign-email-final.js';
import { escapeHtml } from '../lib/battery-campaign-email.js';

test('campaign email personalises safely and links to the callback page', () => {
  const html = buildBatteryCampaignEmail({ firstName: 'Ava <Admin>', callbackUrl: 'https://portal.goldsure.com.au/Battery/request-callback.html?source=test' });
  assert.match(html, /Hi Ava &lt;Admin&gt;,/);
  assert.doesNotMatch(html, /Hi Ava <Admin>,/);
  assert.match(html, /request-callback\.html\?source=test/);
  assert.match(html, /government battery rebate drops/i);
  assert.match(html, /Rebate changes 1 January 2027/);
});

test('plain-text fallback uses the first name and callback URL', () => {
  const text = buildBatteryCampaignText({ firstName: 'Ava', callbackUrl: 'https://example.test/callback' });
  assert.match(text, /Hi Ava,/);
  assert.match(text, /https:\/\/example\.test\/callback/);
});

test('HTML escaping protects all email template fields', () => {
  assert.equal(escapeHtml(`"<&>'`), '&quot;&lt;&amp;&gt;&#39;');
});

test('email can include an unsubscribe link and open tracker pixel', () => {
  const html = buildBatteryCampaignEmail({
    unsubscribeUrl: 'https://portal.goldsure.com.au/Battery/unsubscribe.html?t=token',
    trackingPixelUrl: 'https://portal.goldsure.com.au/api/battery/request-callback?action=battery-email-open&t=token',
  });
  assert.match(html, /Unsubscribe/);
  assert.match(html, /battery-email-open/);
});
