import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSmokeJobQuestions,verifySmokeProductLines,syncSmokeJobProducts} from '../lib/dataforce-smoke-products.js';
const quote={service_type:'Installation Quote',alarm_qty:6,ctrl_qty:2,alarm_unit_price:98};
test('six battery alarms and two controllers become real product selections, without certificate or warranty',()=>{
 const payload=buildSmokeJobQuestions({answers:[],blockAnswers:[]},quote,601);
 assert.equal(payload.blockAnswers.find(g=>g.questionBlockTypeId===34).blocks.length,6);
 assert.equal(payload.blockAnswers.find(g=>g.questionBlockTypeId===36).blocks.length,2);
 const products=verifySmokeProductLines({productLines:[{productId:3431,lineQty:6},{productId:3434,lineQty:2}]},quote);
 assert.deepEqual(products.map(p=>p.product_id),[3431,3434]);
 assert.equal(payload.blockAnswers.length,2);
});
test('repeat synchronization replaces owned quantities, does not accumulate duplicates, and clears zero controllers',()=>{
 const first=buildSmokeJobQuestions({},quote,601);
 assert.deepEqual(buildSmokeJobQuestions(first,quote,601),first);
 const revised=buildSmokeJobQuestions(first,{...quote,alarm_qty:7,ctrl_qty:0},601);
 assert.equal(revised.blockAnswers.find(g=>g.questionBlockTypeId===34).blocks.length,7);
 assert.equal(revised.blockAnswers.find(g=>g.questionBlockTypeId===36).blocks.length,0);
});
test('preserves unrelated answers and staff location details',()=>{
 const existing={jobId:601,answers:[{questionId:999,answerValue:'Keep this'}],blockAnswers:[{questionBlockTypeId:35,blocks:[{answers:[{questionId:998,answerValue:'LED'}]}]},{questionBlockTypeId:34,blocks:[{answers:[{questionId:6950,answerValue:'23541'},{questionId:888,answerValue:'Bedroom'}]}]}]};
 const result=buildSmokeJobQuestions(existing,quote,601);
 assert.deepEqual(result.blockAnswers[0],existing.blockAnswers[0]);
 assert.deepEqual(result.blockAnswers[1].blocks[0],existing.blockAnswers[1].blocks[0]);
 assert.deepEqual(result.answers[0],existing.answers[0]);
});
test('does not overwrite a manually selected hardwired product',()=>{
 assert.throws(()=>buildSmokeJobQuestions({blockAnswers:[{questionBlockTypeId:34,blocks:[{answers:[{questionId:6950,answerValue:'23542'}]}]}]},quote,601),/staff review/);
});
test('concrete ceiling quantities follow the selected alarm count',()=>{
 const result=buildSmokeJobQuestions({},{...quote,alarm_unit_price:109},601);
 assert.equal(result.blockAnswers.find(g=>g.questionBlockTypeId===39).blocks[0].answers[0].answerValue,'6');
});
test('does not report quantities as saved just because the POST succeeded',async()=>{
 const request=async(path,options={})=>path.endsWith('/quote')?{productLines:[]}:{answers:[],blockAnswers:[]};
 await assert.rejects(syncSmokeJobProducts({request,jobId:601,quote}),/did not persist/);
 assert.throws(()=>verifySmokeProductLines({productLines:[{productId:3431,lineQty:5}]},quote),/did not confirm/);
});
