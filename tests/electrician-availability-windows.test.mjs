import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingWindowLimits } from '../electrician-availability/availability.js';
import { suggestRoutes, lookupArea, appointmentWindow } from '../lib/electrician-route-suggestions.js';
const limits = { Alex:13, Gurdip:7, Mason:11 };
const places = new Map([[1,{suburb:'Cornubia',postcode:'4130'}],[2,{suburb:'Mango Hill',postcode:'4509'}],[3,{suburb:'Elanora',postcode:'4221'}]]);
function search(name, am, pm, area='4130', unknown=false) {
  const appointments = [
    ...Array.from({length:am},()=>({customerId:3,scheduledDate:'03-Dec-2026 09:00:00 AM'})),
    ...Array.from({length:pm},()=>({customerId:1,scheduledDate:'03-Dec-2026 02:00:00 PM'}))
  ];
  if(unknown) appointments.push({customerId:1,scheduledDate:'2026-12-03T00:00:00'});
  return suggestRoutes([{date:'2026-12-03',name,appointments}],lookupArea(area),places,limits,{checkRoute:false});
}
test('capacity splits remain 7/6, 4/3 and 6/5',()=>{
  assert.deepEqual(bookingWindowLimits('2026-12-03','Alex'),{AM:7,PM:6});
  assert.deepEqual(bookingWindowLimits('2026-12-03','Gurdip'),{AM:4,PM:3});
  assert.deepEqual(bookingWindowLimits('2026-12-03','Mason'),{AM:6,PM:5});
});
test('Dataforce ISO, 12-hour with seconds and noon times are classified correctly',()=>{
  for(const value of ['2026-12-03T09:00:00','03-Dec-2026 09:00:00 AM','2026-12-03 11:59:00']) assert.equal(appointmentWindow(value),'AM');
  for(const value of ['2026-12-03T12:00:00','03-Dec-2026 12:00:00 PM','03-Dec-2026 02:00:00 PM','2026-12-03T18:00:00']) assert.equal(appointmentWindow(value),'PM');
  for(const value of ['', '2026-12-03', '2026-12-03T00:00:00','2026-12-03T25:00:00']) assert.equal(appointmentWindow(value),null);
});
test('Alex 3 AM plus 6 PM has four daily spaces but cannot take Cornubia in PM',()=>{
  assert.deepEqual(search('Alex',3,6).matches,[]);
  const am=search('Alex',3,6,'4221').matches[0];
  assert.equal(am.window,'AM');
  assert.equal(am.windowRemaining,4);
});
test('PM space is counted from Dataforce PM bookings, not the daily remainder',()=>{
  const result=search('Alex',3,5).matches[0];
  assert.equal(result.window,'PM');
  assert.equal(result.windowRemaining,1);
  assert.equal(result.remaining,5);
});
test('all electricians exclude a full PM window even when AM has space',()=>{
  for(const [name,pm] of [['Alex',6],['Gurdip',3],['Mason',5]]) assert.deepEqual(search(name,1,pm).matches,[]);
});
test('AM booked route cannot justify a PM booking in a distant suburb',()=>{
  assert.deepEqual(search('Alex',7,2,'4221').matches,[]);
  assert.equal(search('Alex',7,2).matches[0].window,'PM');
});
test('unknown appointment times cannot create assumed spare slots',()=>{
  const result=search('Alex',1,1,'4130',true);
  assert.deepEqual(result.matches,[]);
  assert.equal(result.incomplete,true);
});
test('daily limit still excludes a full day',()=>{
  for(const [name,am,pm] of [['Alex',7,6],['Gurdip',4,3],['Mason',6,5]]) assert.deepEqual(search(name,am,pm).matches,[]);
});
