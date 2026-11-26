import test from 'node:test';
import assert from 'node:assert/strict';
import {syncSmokeJobProducts} from '../lib/dataforce-smoke-products.js';
test('product question writes include the actual Dataforce job customer ID',async()=>{
 let saved={answers:[],blockAnswers:[]},reads=0,writes=0;
 const request=async(path,init={})=>{
  if(path==='/jobs/601'){reads++;return {customerId:987};}
  if(path.endsWith('/quote'))return {productLines:[{productId:3431,lineQty:4}]};
  if(init.method==='POST'){const body=JSON.parse(init.body);assert.equal(body.customerId,987);saved=body;writes++;}
  return structuredClone(saved);
 };
 const result=await syncSmokeJobProducts({request,jobId:601,quote:{service_type:'Installation Quote',alarm_qty:4,ctrl_qty:0,alarm_unit_price:98}});
 assert.equal(result.synced,true);assert.equal(reads,1);assert.equal(writes,1);
});
