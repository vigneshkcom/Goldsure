import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const trackers = [
  '../hotwater/quote-tracker.html',
  '../hotwater-nsw/quote-tracker.html',
  '../aircons/quote-tracker.html',
];

test('all three quote trackers show quote status beside the GHL pipeline stage', async () => {
  for (const path of trackers) {
    const html = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(html, /<th>Quote Status<\/th>\s*<th>GHL Pipeline Stage<\/th>/, path);
    assert.match(html, /id="active-count"/, path);
    assert.match(html, /id="completed-table-body"/, path);
  }
});

test('all three quote trackers move won or installed customers into Completed after GHL loads', async () => {
  for (const path of trackers) {
    const html = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(html, /function isCompletedQuote\(q\)[\s\S]*?local==='installed'[\s\S]*?oppStatus==='won'[\s\S]*?\['won','installed','completed'\]/, path);
    assert.match(html, /const activeQuotes=filtered\.filter\(q=>!isCompletedQuote\(q\)\);\s*const completedQuotes=filtered\.filter\(isCompletedQuote\);/, path);
    assert.match(html, /ghlStages=stages; ghlOppData=map; ghlStagesLoaded=true;\s*renderTable\(\);/, path);
  }
});

test('all three quote tracker scripts compile', async () => {
  for (const path of trackers) {
    const html = await readFile(new URL(path, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(match => !/\bsrc\s*=/.test(match[1]))
      .map(match => match[2]);
    for (const source of scripts) assert.doesNotThrow(() => new Function(source), path);
  }
});
