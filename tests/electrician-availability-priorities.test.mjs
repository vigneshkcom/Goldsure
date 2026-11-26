import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRoutes, lookupArea, isSouthGoldCoast } from '../lib/electrician-route-suggestions.js';

const limits = { Gurdip: 6, Alex: 13, Mason: 11 };
const locations = new Map([
  [1, { suburb: 'Elanora', postcode: '4221' }],
  [2, { suburb: 'Bray Park', postcode: '4500' }],
  [3, { suburb: 'Mango Hill', postcode: '4509' }]
]);
const row = (date, name, count, customerId = 1) => ({ date, name,
  appointments: count === null ? null : Array.from({ length: count }, () => ({ customerId, scheduledDate: date + 'T09:00:00' })) });
const search = (schedule, area = 'Elanora 4221') => suggestRoutes(schedule, lookupArea(area), locations, limits);

test('South Gold Coast lists Mason November, Mason December, and Alex Thursday in order', () => {
  const result = search([row('2026-11-30', 'Mason', 3), row('2026-12-02', 'Mason', 0), row('2026-12-03', 'Alex', 2)]);
  assert.deepEqual(result.matches.map(x => [x.name, x.date, x.remaining]), [['Mason', '2026-11-30', 1], ['Mason', '2026-12-02', 11], ['Alex', '2026-12-03', 11]]);
});
test('after November target is met, Mason can fill an empty December day', () => {
  const result = search([row('2026-11-30', 'Mason', 4), row('2026-12-02', 'Mason', 0), row('2026-12-03', 'Alex', 2)]);
  assert.deepEqual(result.matches.map(x => [x.name, x.date, x.remaining]), [['Mason', '2026-12-02', 11], ['Alex', '2026-12-03', 11]]);
});
test('December priority ranks first at ten jobs and disappears at eleven', () => {
  const schedule = [row('2026-12-02', 'Mason', 10), row('2026-12-03', 'Alex', 2)];
  assert.equal(search(schedule).matches[0].name, 'Mason');
  schedule[0] = row('2026-12-02', 'Mason', 11);
  assert.equal(search(schedule).matches[0].name, 'Alex');
});
test('missing Mason counts keep other verified dates visible with an incomplete flag', () => {
  const result = search([row('2026-11-30', 'Mason', null), row('2026-12-02', 'Mason', 0), row('2026-12-03', 'Alex', 2)]);
  assert.deepEqual(result.matches.map(x => x.name), ['Mason', 'Alex']);
  assert.equal(result.incomplete, true);
});
test('Josh can start his empty priority day with battery-only jobs', () => {
  const result = search([row('2026-11-26', 'Josh', 0), row('2026-11-26', 'Gurdip', 3, 2)], 'Bray Park 4500');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].name, 'Josh');
  assert.equal(result.matches[0].remaining, 5);
  assert.equal(result.matches[0].batteryOnly, true);
});
test('battery priorities still require route space in the offered window', () => {
  const schedule = [row('2026-11-26', 'Josh', 5, 2), row('2026-11-26', 'Gurdip', 3, 2), row('2026-11-27', 'Gurdip', 4, 2)];
  let result = search(schedule, 'Bray Park 4500');
  assert.deepEqual(result.matches.map(x => [x.name, x.date, x.remaining, x.batteryOnly]), [['Gurdip', '2026-11-27', 2, true]]);
  schedule[1] = row('2026-11-26', 'Gurdip', 6, 2);
  result = search(schedule, 'Bray Park 4500');
  assert.deepEqual(result.matches.map(x => [x.date, x.remaining, x.batteryOnly]), [['2026-11-27', 2, true]]);
});
test('priority near Josh takes precedence over a later exact suburb match', () => {
  const result = search([row('2026-11-26', 'Josh', 0), row('2026-12-03', 'Alex', 2, 3)], 'Mango Hill 4509');
  assert.equal(result.matches[0].name, 'Josh');
});
test('priority routes do not offer Josh to distant Gold Coast customers', () => {
  const result = search([row('2026-11-26', 'Josh', 0), row('2026-12-03', 'Alex', 2)]);
  assert.equal(result.matches[0].name, 'Alex');
  assert.equal(result.matches[0].batteryOnly, false);
});
test('northern Gold Coast is not offered the reserved Mason slots', () => {
  assert.equal(isSouthGoldCoast(lookupArea('Coombabah 4216')), false);
  assert.equal(isSouthGoldCoast(lookupArea('Burleigh Heads 4220')), true);
  assert.equal(isSouthGoldCoast(lookupArea('Coolangatta 4225')), true);
  assert.equal(isSouthGoldCoast(lookupArea('Robina 4226')), true);
  assert.equal(isSouthGoldCoast(lookupArea('4226')), true);
  assert.deepEqual(search([row('2026-12-02', 'Mason', 0)], 'Coombabah 4216').matches, []);
});
test('ordinary nearby-route suggestions continue after priorities are full', () => {
  const result = search([row('2026-11-26', 'Josh', 5, 2), row('2026-11-26', 'Gurdip', 6, 3), row('2026-11-27', 'Gurdip', 6, 3), row('2026-12-03', 'Alex', 2, 3)], '4506');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].name, 'Alex');
  assert.equal(result.matches[0].priority, false);
});

test('4224 shows the next dates even while November still has space', () => {
  const result = search([row('2026-11-30', 'Mason', 3), row('2026-12-02', 'Mason', 0), row('2026-12-03', 'Alex', 3)], '4224');
  assert.deepEqual(result.matches.map(x => [x.date, x.name]), [['2026-11-30', 'Mason'], ['2026-12-02', 'Mason'], ['2026-12-03', 'Alex']]);
});
