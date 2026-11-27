import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestRoutes,lookupArea,isIpswichDirection} from '../lib/electrician-route-suggestions.js';
test('Gurdip cannot be offered towards Ipswich on 8 December through any search mode',()=>{
 for(const input of ['Ipswich','4305','4300','Redbank Plains','Springfield Lakes','Greenbank','4124','Forest Lake']){
  const area=lookupArea(input);
  assert.equal(isIpswichDirection(area),true,input);
  for(const alarmType of ['battery','hardwired'])for(const checkRoute of [true,false]){
   const result=suggestRoutes([{name:'Gurdip',date:'2026-12-08',appointments:[]}],area,new Map(),{Gurdip:6},{alarmType,checkRoute});
   assert.equal(result.matches.length,0,input);
  }
 }
});
test('the Ipswich restriction is specific to Gurdip on 8 December',()=>{
 const area=lookupArea('4124');
 for(const [name,date,limit] of [['Gurdip','2026-12-12',6],['Mason','2026-12-08',11]]){
  assert.ok(suggestRoutes([{name,date,appointments:[]}],area,new Map(),{[name]:limit}).matches.length>0);
 }
 assert.equal(isIpswichDirection(lookupArea('Mango Hill')),false);
});
