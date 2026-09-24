import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const trackerUrl = new URL('../hotwater/photo-tracker.html', import.meta.url);
const apiUrl = new URL('../api/zoho/create-photo-request.js', import.meta.url);
const ghlUrl = new URL('../api/battery/request-callback.js', import.meta.url);

test('shared photo tracker shows the GHL stage and a separate Completed section', async () => {
  const html = await readFile(trackerUrl, 'utf8');
  assert.match(html, /<div class="cell c">GHL Pipeline Stage<\/div>/);
  assert.match(html, /const completed = list\.filter\(isCompletedFolder\)/);
  assert.match(html, /groupHtml\('completed', 'Completed'/);
  assert.match(html, /status === 'won'/);
  assert.match(html, /installed\|completed\|install complete/);
});

test('GHL lookup supports both full phone and last-four folder names', async () => {
  const html = await readFile(trackerUrl, 'utf8');
  assert.match(html, /const suffix = \(\/\\\(\(\\\+\?\[\\d\\s-\]\{3,\}\)\\\)\\s\*\$\//);
  assert.match(html, /suffix\.replace\(\/\\D\/g, ''\)\.slice\(-4\)/);
});

test('folder deletion is password protected and constrained to the selected product parent', async () => {
  const [html, api] = await Promise.all([readFile(trackerUrl, 'utf8'), readFile(apiUrl, 'utf8')]);
  assert.match(html, /data-delete="\$\{esc\(f\.id\)\}"/);
  assert.match(html, /method: 'DELETE'/);
  assert.match(html, /body: JSON\.stringify\(\{ folderId, product: PRODUCT, pin \}\)/);
  assert.match(api, /const expectedPin = process\.env\.SMS_DELETE_PIN \|\| '4321'/);
  assert.match(api, /const children = await listChildren\(accessToken, parentId\)/);
  assert.match(api, /attributes: \{ status: '51' \}/);
});

test('photo lookup returns GHL opportunity status and tracker script compiles', async () => {
  const [html, ghlApi] = await Promise.all([readFile(trackerUrl, 'utf8'), readFile(ghlUrl, 'utf8')]);
  assert.match(html, /action=ghl-find&product=' \+ encodeURIComponent\(PRODUCT\)/);
  assert.match(ghlApi, /if \(product === 'hws-nsw'\) return name\.includes\('nsw'\)/);
  assert.match(ghlApi, /const productPipelineIds = new Set/);
  assert.match(ghlApi, /const relevantOpps = productPipelineIds\.size \? opps\.filter\(o => productPipelineIds\.has\(o\.pipelineId\)\) : opps/);
  assert.match(ghlApi, /const candidates = relevantOpps\.length \? relevantOpps : opps/);
  assert.match(ghlApi, /for \(let offset = 0; offset < items\.length; offset \+= 5\)/);
  assert.match(ghlApi, /response\.status !== 429/);
  assert.match(ghlApi, /info\.status\s*=\s*opp\.status \|\| ''/);
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/.test(match[1]))
    .map(match => match[2]);
  for (const source of scripts) assert.doesNotThrow(() => new Function(source));
});
