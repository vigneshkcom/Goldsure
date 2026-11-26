import test from 'node:test';
import assert from 'node:assert/strict';
import {insertionCandidates,verifyInsertion,appointmentMinutes} from '../lib/electrician-route-fit.js';
import {suggestRoutes,lookupArea} from '../lib/electrician-route-suggestions.js';
const point={lat:-27.55,lon:153.08};
const stop=(minute,duration,where=point)=>({minute,duration,point:where});
const drive=(minutes=10)=>async()=>({ok:true,json:async()=>({routes:[{legs:[{duration:String(minutes*60)+'s'},{duration:String(minutes*60)+'s'}]}]})});

test('free daily capacity does not create a gap in a continuous booked morning',()=>{
  const stops=[480,510,540,570,600,630,660,690].map(minute=>stop(minute,30));
  assert.deepEqual(insertionCandidates(stops,point,point,'AM',60),[]);
});
test('insertion considers the next appointment even when it belongs to PM',async()=>{
  const plans=insertionCandidates([stop(480,180),stop(725,60)],point,point,'AM',60);
  assert.equal(plans.length,1);
  assert.equal(await verifyInsertion(plans[0],{apiKey:'test',fetchImpl:drive(15)}),null);
});
test('job and both driving legs must fit before the next booked stop',async()=>{
  const plans=insertionCandidates([stop(480,30),stop(600,120)],point,point,'AM',60);
  assert.equal(plans.length,1);
  assert.equal(await verifyInsertion(plans[0],{apiKey:'test',fetchImpl:drive(20)}),null);
  const accepted=await verifyInsertion(plans[0],{apiKey:'test',fetchImpl:drive(5)});
  assert.equal(accepted.startMinute,520);
  assert.equal(accepted.endMinute,580);
});
test('southward backtracking is rejected when later work heads north',()=>{
  const upperMtGravatt={lat:-27.56,lon:153.08},woodridge={lat:-27.63,lon:153.10},nundah={lat:-27.40,lon:153.06};
  const plans=insertionCandidates([stop(480,30,upperMtGravatt),stop(660,120,nundah)],woodridge,nundah,'AM',60);
  assert.deepEqual(plans,[]);
});
test('missing appointment duration cannot invent free time',()=>{
  assert.deepEqual(insertionCandidates([stop(540,NaN)],point,point,'AM'),[]);
});
test('Google routing failures do not fall back to assumed travel times',async()=>{
  const plan=insertionCandidates([stop(540,30)],point,point,'AM',30)[0];
  await assert.rejects(verifyInsertion(plan,{apiKey:'test',fetchImpl:async()=>({ok:false,status:503})}));
});
test('4130/4114 cannot use an apparent AM vacancy if subsequent jobs fill the day',()=>{
  const places=new Map([[1,{suburb:'Upper Mount Gravatt',postcode:'4122'}],[2,{suburb:'Nundah',postcode:'4012'}]]);
  const appointments=[480,510,540,570,600,630].map(minute=>({
    customerId:1,duration:30,scheduledDate:'2026-12-11T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')+':00'
  }));
  appointments.push({customerId:2,duration:60,scheduledDate:'2026-12-11T12:00:00'});
  const result=suggestRoutes([{date:'2026-12-11',name:'Alex',appointments}],lookupArea('4114'),places,{Alex:13});
  assert.deepEqual(result.matches,[]);
});
test('clock minutes preserve Dataforce 12 hour and ISO ordering',()=>{
  assert.equal(appointmentMinutes('11-Dec-2026 01:30:00 PM'),810);
  assert.equal(appointmentMinutes('2026-12-11T09:30:00'),570);
});
