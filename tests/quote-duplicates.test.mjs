import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyseDuplicates, duplicateSignature } from '../assets/quote-duplicates.mjs';

const base = {
  customer_email: 'customer@example.com',
  customer_phone: '0412 345 678',
  customer_address: '1 Example Street, Richmond VIC 3121',
  tank_model: 'EG-330FRE-WR',
  total_out_of_pocket: 2198,
  status: 'sent',
};

test('finds exact same-day quote copies and keeps the newest one', () => {
  const quotes = [
    { ...base, id: 'old', sent_at: '2026-10-01T01:00:00Z' },
    { ...base, id: 'new', sent_at: '2026-10-01T01:05:00Z' },
  ];
  const result = analyseDuplicates(quotes);
  assert.deepEqual([...result.groupIds].sort(), ['new', 'old']);
  assert.deepEqual([...result.deleteIds], ['old']);
  assert.equal(result.roles.get('new'), 'Keep: newest');
  assert.equal(result.roles.get('old'), 'Copy to delete');
});

test('never automatically selects an accepted or installed quote', () => {
  const quotes = [
    { ...base, id: 'accepted-old', sent_at: '2026-10-01T01:00:00Z', status: 'accepted', accepted_at: '2026-10-01T01:03:00Z' },
    { ...base, id: 'sent-new', sent_at: '2026-10-01T01:05:00Z' },
    { ...base, id: 'installed', sent_at: '2026-10-01T01:04:00Z', status: 'installed' },
  ];
  const result = analyseDuplicates(quotes);
  assert.deepEqual([...result.deleteIds], ['sent-new']);
  assert.equal(result.roles.get('accepted-old'), 'Keep: accepted');
  assert.equal(result.roles.get('installed'), 'Keep: accepted');
});

test('shows same-customer same-day variations for review without auto-selecting them', () => {
  const original = { ...base, id: 'one', sent_at: '2026-10-01T01:00:00Z' };
  for (const changed of [
    { ...original, id: 'price', total_out_of_pocket: 2298 },
    { ...original, id: 'address', customer_address: '2 Example Street, Richmond VIC 3121' },
  ]) {
    const result = analyseDuplicates([original, changed]);
    assert.equal(result.groupIds.size, 2);
    assert.equal(result.deleteIds.size, 0);
    assert.equal(result.roles.get('one'), 'Review');
    assert.notEqual(duplicateSignature(original), duplicateSignature(changed));
  }
});

test('does not group quotes from different days or customers', () => {
  const original = { ...base, id: 'one', sent_at: '2026-10-01T01:00:00Z' };
  for (const changed of [
    { ...original, id: 'day', sent_at: '2026-10-02T01:00:00Z' },
    { ...original, id: 'customer', customer_email: 'someone-else@example.com' },
  ]) assert.equal(analyseDuplicates([original, changed]).groupIds.size, 0);
});

test('all quote trackers expose the three-step duplicate cleanup controls', async () => {
  for (const path of [
    'smoke-alarms/quote-tracker.html',
    'hotwater/quote-tracker.html',
    'hotwater-nsw/quote-tracker.html',
    'aircons/quote-tracker.html',
  ]) {
    const html = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(html, /id="duplicatesBtn"/);
    assert.match(html, /id="selectDuplicatesBtn"/);
    assert.match(html, /Select copies to delete/);
    assert.match(html, /deleteSelected\(\)/);
    assert.match(html, /QuoteDuplicates\.analyseDuplicates\(allQuotes\)/);
    assert.match(html, /duplicateAnalysis\.deleteIds\.has/);
  }
});
