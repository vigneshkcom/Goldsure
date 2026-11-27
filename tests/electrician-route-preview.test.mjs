import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAreaRoutePreview,lookupArea} from '../lib/electrician-route-suggestions.js';
test('route preview preserves the scheduled appointment order and uses the searched locality',()=>{
 const row={name:'Alex',date:'2026-12-03',appointments:[
  {appointmentId:22,customerId:2,scheduledDate:'2026-12-03T14:00:00'},
  {appointmentId:11,customerId:1,scheduledDate:'2026-12-03T08:00:00'}
 ]};
 const preview=buildAreaRoutePreview(row,lookupArea('Runaway Bay 4216'),new Map([
  [1,{suburb:'Runaway Bay',postcode:'4216'}],[2,{suburb:'Ormeau',postcode:'4208'}]
 ]),'AM');
 assert.deepEqual(preview.appointmentIds,['11','22']);
 assert.equal(preview.workerId,1009);
 assert.equal(preview.address,'Runaway Bay QLD 4216 Australia');
 assert.equal(preview.availabilityVerified,false);
 assert.ok([0,1].includes(preview.insertPosition));
});
test('incomplete route details never invent an insertion position',()=>{
 assert.equal(buildAreaRoutePreview({name:'Gurdip',appointments:[{appointmentId:1,customerId:1,scheduledDate:'2026-12-17T08:00:00'}]},
  lookupArea('4305'),new Map(),'AM'),null);
});
