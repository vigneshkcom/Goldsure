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
test('Alex stays on the Gold Coast in AM and offers Cornubia only in PM', () => {
  const result = search('Alex',[3,3,3,3,3,3,3,1,1],'4130');
  assert.equal(result.matches[0].window,'PM');
  assert.equal(result.matches[0].windowRemaining,4);
  assert.equal(result.matches[0].remaining,4);
  assert.deepEqual(search('Alex',[3,3,3,3,3,3,3,1,1],'4221').matches,[]);
});
test('each electrician keeps their morning group full and offers space on the afternoon route', () => {
  for (const [name, am, expected] of [['Alex',7,5],['Gurdip',3,2],['Mason',6,4]]) {
    const far = name === 'Mason' ? 2 : 3;
    const ids = [...Array(am).fill(far),1];
    const result = search(name,ids,'4130');
    assert.equal(result.matches[0].window,'PM');
    assert.equal(result.matches[0].windowRemaining,expected);
  }
});
test('a morning enquiry cannot spill into a distant afternoon route', () => {
  assert.deepEqual(search('Gurdip',[3,3,3,1],'4221').matches,[]);
});
test('a nearby enquiry joins the available afternoon route without moving AM jobs', () => {
  const result = search('Alex',[3,3,3,3,3,3,3,1],'Mount Cotton 4165');
  assert.equal(result.matches[0].window,'PM');
});
test('AM remains available when its route has fewer than the morning limit', () => {
  const result = search('Alex',[3,3,1],'4221');
  assert.equal(result.matches[0].window,'AM');
  assert.equal(result.matches[0].windowRemaining,4);
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
