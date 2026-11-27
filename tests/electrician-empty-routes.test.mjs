import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupArea,suggestRoutes,localitiesForArea,sameOrAdjoiningLocality} from '../lib/electrician-route-suggestions.js';
test('empty rostered days cannot advertise a suburb where there is no booked route',()=>{
 for(const area of ['4305','4124'])for(const date of ['2026-12-12','2026-12-21','2026-12-22']){
  assert.deepEqual(suggestRoutes([{name:'Gurdip',date,appointments:[]}],lookupArea(area),new Map(),{Gurdip:6}).matches,[]);
 }
});
test('locality matching uses one shared suburb boundary',()=>{
 const ipswich={suburb:'Ipswich',postcode:'4305'};
 assert.equal(sameOrAdjoiningLocality(localitiesForArea(lookupArea('Woodend 4305'))[0],ipswich),true);
 assert.equal(sameOrAdjoiningLocality(localitiesForArea(lookupArea('Greenbank 4124'))[0],ipswich),false);
 assert.equal(sameOrAdjoiningLocality(localitiesForArea(lookupArea('Springfield 4871'))[0],{suburb:'Greenbank',postcode:'4124'}),false);
});
test('a missing schedule cannot be treated as an empty day',()=>{
 assert.equal(suggestRoutes([{name:'Gurdip',date:'2026-12-12',appointments:null}],lookupArea('4124'),new Map(),{Gurdip:6}).matches.length,0);
});
