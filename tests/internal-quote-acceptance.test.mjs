import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('internal tracker acceptance is labelled administrative and does not call customer acceptance actions', async () => {
  const trackers = await Promise.all([
    'smoke-alarms/quote-tracker.html',
    'hotwater/quote-tracker.html',
    'aircons/quote-tracker.html',
    'hotwater-nsw/quote-tracker.html',
  ].map(read));

  for (const source of trackers) {
    assert.match(source, /Accepted internally/);
    assert.match(source, /Customer accepted/);
  }

  assert.doesNotMatch(trackers[0], /fetch\('\/api\/smoke-alarms\/accept'/);
  assert.doesNotMatch(trackers[1], /accepted:\(newStatus/);
  assert.doesNotMatch(trackers[2], /accepted:\(newStatus/);
  assert.doesNotMatch(trackers[3], /accepted:\(newStatus/);

  const sms = await read('sms/index.html');
  assert.match(sms, /Accepted internally/);
  assert.match(sms, /will not send an acceptance email, move GHL, add a GHL comment, or create a Dataforce job/);
  assert.doesNotMatch(sms, /fetch\('\/api\/smoke-alarms\/accept'/);
});

test('customer pages require accepted_at before claiming the customer accepted', async () => {
  const pages = await Promise.all([
    'accept-quote.html',
    'smoke-alarms/quote.html',
    'hotwater/accept.html',
    'hotwater/view.html',
    'aircons/accept.html',
    'aircons/view.html',
    'hotwater-nsw/accept.html',
    'hotwater-nsw/quote.html',
    'reject-quote.html',
    'hotwater/reject.html',
    'aircons/reject.html',
  ].map(read));

  for (const source of pages) {
    assert.match(source, /accepted_at/);
    assert.doesNotMatch(source, /accepted\s*===\s*true\s*\|\|\s*(?:row\.|q\.)?status\s*===\s*'accepted'/);
  }
});
