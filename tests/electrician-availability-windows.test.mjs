import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingWindowLimits } from '../electrician-availability/availability.js';
import { suggestRoutes, lookupArea } from '../lib/electrician-route-suggestions.js';
const limits = { Alex: 13, Gurdip: 6, Mason: 11 };
const places = new Map([
  [1, { suburb: 'Cornubia', postcode: '4130' }],
  [2, { suburb: 'Mango Hill', postcode: '4509' }],
  [3, { suburb: 'Elanora', postcode: '4221' }]
]);
const day = (name, ids) => ({ date: '2026-12-03', name, appointments: ids.map(customerId => ({
  customerId, scheduledDate: '2026-12-03T17:00:00'
})) });
const search = (name, ids, area) => suggestRoutes([day(name, ids)], lookupArea(area), places, limits);
test('daily capacity splits round the extra job into AM', () => {
  assert.deepEqual(bookingWindowLimits('2026-12-03','Alex'), { AM:7, PM:6 });
  assert.deepEqual(bookingWindowLimits('2026-12-03','Gurdip'), { AM:3, PM:3 });
  assert.deepEqual(bookingWindowLimits('2026-12-03','Mason'), { AM:6, PM:5 });
});
test('Alex Cornubia 4130 is AM even when Dataforce times are in the afternoon', () => {
  const result = search('Alex',[1,1,1,1,1,1,1,2,2],'4130');
  assert.equal(result.matches[0].window,'AM');
  assert.equal(result.matches[0].remaining,4);
});
test('Alex route position seven is AM and position eight is PM', () => {
  assert.equal(search('Alex',[1,1,1,1,1,1,2],'4509').matches[0].window,'AM');
  assert.equal(search('Alex',[1,1,1,1,1,1,1,2],'4509').matches[0].window,'PM');
});
test('Gurdip route position three is AM and position four is PM', () => {
  assert.equal(search('Gurdip',[1,1,2],'4509').matches[0].window,'AM');
  assert.equal(search('Gurdip',[1,1,1,2],'4509').matches[0].window,'PM');
});
test('Mason route position six is AM and position seven is PM', () => {
  assert.equal(search('Mason',[1,1,1,1,1,3],'4221').matches[0].window,'AM');
  assert.equal(search('Mason',[1,1,1,1,1,1,3],'4221').matches[0].window,'PM');
});
test('full days remain excluded for all three electricians', () => {
  for (const [name, limit] of Object.entries(limits)) {
    assert.deepEqual(search(name,Array(limit).fill(1),'4130').matches,[]);
  }
});
test('missing booked locations cannot produce a guessed AM or PM split', () => {
  const result = search('Alex',[1,99],'4130');
  assert.deepEqual(result.matches,[]);
  assert.equal(result.incomplete,true);
});
