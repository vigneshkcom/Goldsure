import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {checkInsertionTiming} from '../lib/electrician-route-fit.js';
const source=readFileSync(new URL('../electrician-availability/route-check.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace(/^export /gm,'')+'\nthis.check=verifyRouteCandidates;';
function checker(computeRoutes){
  const context={checkInsertionTiming,window:{google:{maps:{importLibrary:async()=>({Route:{computeRoutes}})}}}};
  vm.runInNewContext(source,context);
  return context.check;
}
const candidate={date:'2026-12-11',name:'Alex',window:'AM',remaining:3,routePlans:[{
  before:{lat:-27.5,lon:153},target:{lat:-27.51,lon:153.01},after:{lat:-27.52,lon:153.02},
  previousEnd:510,nextStart:600,windowStart:480,windowEnd:720,durationMinutes:60
}]};
test('browser routing checks the fixed previous and next stop before exposing availability',async()=>{
  const check=checker(async request=>{
    assert.equal(request.optimizeWaypointOrder,false);
    assert.equal(request.intermediates.length,1);
    return {routes:[{legs:[{durationMillis:300000},{durationMillis:300000}]}]};
  });
  const result=await check([candidate]);
  assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].windowRemaining,1);
  assert.equal(result.matches[0].routeChecked,true);
  assert.equal('routePlans' in result.matches[0],false);
});
test('a drive that misses the next appointment cannot appear as a match',async()=>{
  const result=await checker(async()=>({routes:[{legs:[{durationMillis:1200000},{durationMillis:1200000}]}]}))([candidate]);
  assert.equal(result.matches.length,0);
});
test('failed or missing driving data remains unverified and hidden',async()=>{
  const result=await checker(async()=>{throw new Error('unavailable');})([candidate]);
  assert.equal(result.matches.length,0);
  assert.equal(result.incomplete,true);
});

test('home-route exceptions compare Google direct and via driving distances',async()=>{
 let calls=0;
 const home={...candidate,routePlans:[{...candidate.routePlans[0],requiresHomeCheck:true}]};
 const good=await checker(async req=>{
  calls++;
  return req.intermediates
   ? {routes:[{legs:[{durationMillis:300000,distanceMeters:3000},{durationMillis:300000,distanceMeters:3000}]}]}
   : {routes:[{legs:[{durationMillis:540000,distanceMeters:5500}]}]};
 })([home]);
 assert.equal(good.matches.length,1);
 assert.equal(calls,2);
 const bad=await checker(async req=>req.intermediates
  ? {routes:[{legs:[{durationMillis:300000,distanceMeters:6000},{durationMillis:300000,distanceMeters:6000}]}]}
  : {routes:[{legs:[{durationMillis:540000,distanceMeters:5500}]}]})([home]);
 assert.equal(bad.matches.length,0);
});
