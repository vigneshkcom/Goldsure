import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupArea,suggestRoutes} from '../lib/electrician-route-suggestions.js';
import {checkInsertionTiming} from '../lib/electrician-route-fit.js';
test('4124 can start a route on a confirmed empty Saturday with both drives verified',()=>{
 const result=suggestRoutes([{name:'Gurdip',date:'2026-12-12',appointments:[]}],lookupArea('4124'),new Map(),{Gurdip:6});
 assert.deepEqual(result.matches.map(row=>row.window),['AM','PM']);
 for(const row of result.matches){
  assert.equal(row.newRoute,true);
  assert.equal(row.remaining,6);
  const plan=row.routePlans[0];
  assert.equal(plan.previousEnd,480);
  assert.equal(plan.nextStart,960);
  assert.ok(checkInsertionTiming(plan,[60,60]));
  assert.equal(checkInsertionTiming(plan,[300,300]),null);
 }
});
test('a missing schedule cannot be treated as an empty day',()=>{
 assert.equal(suggestRoutes([{name:'Gurdip',date:'2026-12-12',appointments:null}],lookupArea('4124'),new Map(),{Gurdip:6}).matches.length,0);
});
