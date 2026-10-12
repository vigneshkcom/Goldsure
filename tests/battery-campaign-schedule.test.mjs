import test from 'node:test';
import assert from 'node:assert/strict';
import { batterySendingWindow } from '../lib/battery-campaign-schedule.js';

test('Melbourne campaign sends from 8 am inclusive until 6 pm exclusive', () => {
  for (const [time, allowed] of [
    ['2026-10-12T20:59:59Z', false], ['2026-10-12T21:00:00Z', true],
    ['2026-10-13T06:59:59Z', true], ['2026-10-13T07:00:00Z', false],
  ]) assert.equal(batterySendingWindow(new Date(time)).allowed, allowed, time);
});
test('tonight resumes at 8 am tomorrow in Melbourne, including DST changes', () => {
  for (const [time, next] of [
    ['2026-10-12T07:00:00Z', '2026-10-12T21:00:00.000Z'],
    ['2026-10-12T20:59:59Z', '2026-10-12T21:00:00.000Z'],
    ['2026-10-03T08:00:00Z', '2026-10-03T21:00:00.000Z'],
    ['2027-04-03T07:00:00Z', '2027-04-03T22:00:00.000Z'],
  ]) assert.equal(batterySendingWindow(new Date(time)).nextSendAt, next, time);
});
