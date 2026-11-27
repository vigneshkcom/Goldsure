import test from 'node:test';
import assert from 'node:assert/strict';
import {retryDelay,dataforceClient} from '../lib/dataforce-availability-client.js';
import {syncSchedule} from '../lib/electrician-schedule-sync.js';
const response=(status,body,headers={})=>new Response(JSON.stringify(body),{status,headers});
test('exponential retries use jitter, respect Retry-After and stop at three attempts',async()=>{
 assert.equal(retryDelay(response(429,{}),0,()=>0),1000);
 assert.equal(retryDelay(response(429,{}),2,()=>0.5),4250);
 assert.ok(retryDelay(response(429,{}, {'Retry-After':'60'}),0,()=>0)>=60000);
 let calls=0,waits=[];
 const api=dataforceClient({env:{DATAFORCE_CLIENT_ID:'test',DATAFORCE_CLIENT_SECRET:'test'},
  random:()=>0,sleep:async ms=>waits.push(ms),fetchImpl:async()=>{calls++;return response(429,{});}});
 await assert.rejects(api.authenticate(),/429/);
 assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
});
test('a long Retry-After is deferred without retrying early',async()=>{
 let calls=0;
 const api=dataforceClient({env:{DATAFORCE_CLIENT_ID:'test',DATAFORCE_CLIENT_SECRET:'test'},
  fetchImpl:async()=>{calls++;return response(429,{}, {'Retry-After':'120'});}});
 await assert.rejects(api.authenticate(),e=>e.retryMs>=120000);
 assert.equal(calls,1);
});
test('failed background sync retains the last successful snapshot and persists a cooldown',async()=>{
 const payload={workers:{Alex:{appointments:[{customerId:7}],updatedAt:'2026-11-27T00:00:00Z'}}},writes=[];
 const db=async(url,init)=>url.includes('/rpc/')?response(200,[{payload,failures:0}]):(writes.push(JSON.parse(init.body)),new Response(null,{status:204}));
 const result=await syncSchedule({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'},fetchImpl:db,
  client:{authenticate:async()=>{throw Object.assign(new Error('429'),{retryMs:120000});}}});
 assert.equal(result.failed,true);
 assert.equal(writes[0].payload.workers.Alex.appointments[0].customerId,7);
 assert.ok(Date.parse(writes[0].next_attempt_at)>=Date.now()+119000);
 assert.equal(writes[0].lease_token,null);
});
test('an occupied lease prevents all upstream calls',async()=>{
 const result=await syncSchedule({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'},
 fetchImpl:async()=>response(200,[]),client:{authenticate:async()=>assert.fail('must not call upstream')}});
 assert.equal(result.skipped,true);
});

test('a successful sync replaces removed and reassigned jobs while preserving other workers',async()=>{
 const payload={workers:{Gurdip:{appointments:[{appointmentId:1},{appointmentId:2}],updatedAt:'old'},
 Alex:{appointments:[{appointmentId:9,customerId:7,duration:60}],updatedAt:'old'}},locations:{7:{suburb:'Test',postcode:'4000',fetchedAt:new Date().toISOString()}}};
 const writes=[];
 const result=await syncSchedule({env:{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test'},
 fetchImpl:async(url,init)=>url.includes('/rpc/')?response(200,[{payload,failures:0}]):(writes.push(JSON.parse(init.body)),new Response(null,{status:204})),
 client:{authenticate:async()=>{},appointments:async()=>[{appointmentId:2,customerId:7,scheduledDate:'2026-12-05T08:00:00',duration:60}]}});
 assert.equal(result.synced,'Gurdip');
 const saved=writes.at(-1).payload;
 assert.deepEqual(saved.workers.Gurdip.appointments.map(a=>a.appointmentId),[2]);
 assert.equal(saved.workers.Gurdip.appointments[0].date,'2026-12-05');
 assert.equal(saved.workers.Alex.appointments[0].appointmentId,9);
 assert.equal(writes.at(-1).lease_token,null);
});
