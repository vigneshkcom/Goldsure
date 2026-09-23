import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('NSW Hot Water GHL quote notes include the personal view-only quote link', async () => {
  const source = await read('api/hotwater-nsw/send.js');

  assert.match(source, /const quoteUrl = `\$\{SITE\}\/hotwater-nsw\/quote\.html\?token=\$\{encodeURIComponent\(token\)\}`/);
  assert.match(source, /`\\nView quote: \$\{quoteUrl\}`/);
});

test('VIC Hot Water GHL quote and reminder notes include the personal view-only quote link', async () => {
  const source = await read('api/battery/request-callback.js');

  assert.match(source, /const quoteUrl = `\$\{SITE\}\/hotwater\/view\.html\?token=\$\{encodeURIComponent\(token\)\}`/);
  assert.match(source, /Reminder sent[\s\S]*?View quote: \$\{quoteUrl\}/);
  assert.match(source, /Hot Water quote sent by[\s\S]*?View quote: \$\{quoteUrl\}/);
});
