import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBatteryCampaignEmail, buildBatteryCampaignText, escapeHtml } from '../lib/battery-campaign-email.js';

test('campaign email personalises safely and links to the callback page', () => {
  const html = buildBatteryCampaignEmail({ firstName: 'Ava <Admin>', callbackUrl: 'https://portal.goldsure.com.au/Battery/request-callback.html?source=test' });
  assert.match(html, /Hi Ava &lt;Admin&gt;,/);
  assert.doesNotMatch(html, /Hi Ava <Admin>,/);
  assert.match(html, /request-callback\.html\?source=test/);
  assert.match(html, /STC factor changes from 6\.8 to 5\.7/);
});

test('plain-text fallback uses the first name and callback URL', () => {
  const text = buildBatteryCampaignText({ firstName: 'Ava', callbackUrl: 'https://example.test/callback' });
  assert.match(text, /Hi Ava,/);
  assert.match(text, /https:\/\/example\.test\/callback/);
});

test('HTML escaping protects all email template fields', () => {
  assert.equal(escapeHtml(`"<&>'`), '&quot;&lt;&amp;&gt;&#39;');
});
