import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRoutes, lookupArea } from '../lib/electrician-route-suggestions.js';
const limits = { Gurdip: 6, Alex: 13, Mason: 11 };
const locations = new Map([[1, { suburb: 'Yeronga', postcode: '4104' }]]);
const row = (date, name, count) => ({ date, name, appointments: Array.from({ length: count }, () => ({ customerId: 1, scheduledDate: date + 'T09:00:00' })) });
const december = ['2026-12-01','2026-12-03','2026-12-04','2026-12-07','2026-12-08','2026-12-09','2026-12-11'].map(date => row(date, 'Gurdip', 1));
const search = (schedule, alarmType = 'battery', postcode = '4104') => suggestRoutes(schedule, lookupArea(postcode), locations, limits, { alarmType });

test('4104 returns empty Josh first and six distinct battery-compatible dates', () => {
  const result = search([row('2026-11-26', 'Josh', 0), row('2026-11-26','Gurdip',5), row('2026-11-27','Gurdip',4), ...december]);
  assert.equal(result.matches.length, 6);
  assert.equal(new Set(result.matches.map(x => x.date)).size, 6);
  assert.equal(result.matches[0].name, 'Josh');
  assert.equal(result.matches[0].remaining, 5);
  assert.equal(result.matches[0].batteryOnly, true);
});
test('Josh stays first for 4104 until his five-job target is full', () => {
  assert.equal(search([row('2026-11-26','Josh',4), ...december]).matches[0].name,'Josh');
  assert.ok(search([row('2026-11-26','Josh',5), ...december]).matches.every(x => x.name !== 'Josh'));
});
test('hardwired or mixed search returns six December dates and excludes November battery slots', () => {
  const result = search([row('2026-11-26','Josh',0), row('2026-11-26','Gurdip',5), row('2026-11-27','Gurdip',4), ...december], 'hardwired');
  assert.equal(result.matches.length,6);
  assert.ok(result.matches.every(x => x.date >= '2026-12-01' && !x.batteryOnly));
  assert.equal(result.matches[0].date,'2026-12-01');
});
test('hardwired dates still exclude full days and do not invent six if fewer qualify', () => {
  const result = search([row('2026-12-01','Gurdip',6), row('2026-12-03','Gurdip',5)],'hardwired');
  assert.deepEqual(result.matches.map(x => [x.date,x.remaining]),[['2026-12-03',1]]);
});
test('Brisbane priority does not extend Josh to the Gold Coast', () => {
  assert.deepEqual(search([row('2026-11-26','Josh',0)],'battery','4224').matches,[]);
});

test('combined dates fill the closest booked area first, then neighbouring suburbs, with route windows', () => {
  const places = new Map([
    [1, { suburb: 'Yeronga', postcode: '4104' }],
    [2, { suburb: 'Moorooka', postcode: '4105' }],
    [3, { suburb: 'Paddington', postcode: '4064' }]
  ]);
  const schedules = [row('2026-12-03','Gurdip',1),row('2026-12-07','Gurdip',1),row('2026-12-09','Gurdip',5),row('2026-12-11','Gurdip',1)];
  schedules[0].appointments[0].customerId = 2;
  schedules[0].appointments[0].scheduledDate = '2026-12-03T14:00:00';
  schedules[3].appointments[0].customerId = 3;
  const result = suggestRoutes(schedules,lookupArea('4104'),places,limits);
  assert.deepEqual(result.matches.map(x=>x.date),['2026-12-09','2026-12-07','2026-12-03','2026-12-11']);
  assert.equal(result.matches[2].window,'AM');
  assert.equal(result.matches[0].window,'AM');
});
