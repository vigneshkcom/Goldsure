import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/electrician-availability.js';
test('calendar and area requests read Supabase only, preserve counts and suppress stale availability',async()=>{
 const oldFetch=global.fetch,oldEnv={...process.env};
 process.env.SUPABASE_URL='https://cache.test';
 process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
 let stale=false,count=6;
 global.fetch=async url=>{
  assert.ok(url.startsWith('https://cache.test/rest/v1/'),'page requests never call Dataforce');
  const updatedAt=new Date(Date.now()-(stale?660000:1000)).toISOString();
  return new Response(JSON.stringify([{payload:{workers:{Gurdip:{updatedAt,appointments:Array.from({length:count},(_,i)=>({date:'2026-12-02',customerId:1,duration:30,scheduledDate:'2026-12-02T'+String(i<3?8+i:14+i-3).padStart(2,'0')+':00:00'}))}},locations:{1:{suburb:'Morningside',postcode:'4170'}}}}]));
 };
 const request=async body=>{
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  await handler({method:'POST',headers:{},body},res);
  assert.equal(res.code,200);return res.body;
 };
 try {
  const calendar=await request({});
  assert.equal(calendar.matches.find(r=>r.name==='Gurdip'&&r.date==='2026-12-02').jobCount,6);
  assert.ok(calendar.updatedAt);
  let area=await request({area:'4170'});
  assert.ok(area.candidates.every(r=>r.name!=='Gurdip'),'full daily limit excluded');
  count=5;area=await request({area:'4170'});
  assert.equal(area.candidates.find(r=>r.name==='Gurdip').remaining,1);
  stale=true;area=await request({area:'4170'});
  assert.equal(area.candidates.length,0);
  assert.equal(area.counts.find(r=>r.name==='Gurdip'&&r.date==='2026-12-02').jobCount,5,'old counts stay visible');
  assert.equal(area.stale,true);
 }finally {global.fetch=oldFetch;process.env=oldEnv;}
});
