import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSchedule} from '../lib/electrician-schedule-cache.js';
test('the saved snapshot replaces bookings after cancellations, reschedules and assignment changes',()=>{
 const dates=[{date:'2026-12-02',electricians:['Gurdip','Alex']}];
 const updatedAt=new Date().toISOString();
 const snapshot={payload:{workers:{
  Gurdip:{updatedAt,appointments:[{date:'2026-12-03',customerId:1}]},
  Alex:{updatedAt,appointments:[{date:'2026-12-02',customerId:2}]}
 }}};
 const result=savedSchedule(snapshot,dates);
 assert.equal(result.schedule[0].appointments.length,0);
 assert.equal(result.schedule[1].appointments.length,1);
 assert.equal(result.stale,false);
 const missing=savedSchedule({payload:{}},dates);
 assert.equal(missing.schedule[0].appointments,null);
 assert.equal(missing.stale,true);
});
