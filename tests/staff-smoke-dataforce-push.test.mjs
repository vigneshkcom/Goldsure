import { withSmokeProductApi } from './helpers/smoke-product-api.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/smoke-alarms/quotes.js';
import {pushStaffSmokeQuoteToDataforce,syncAcceptedSmokeQuoteToDataforce} from '../lib/dataforce-smoke-quote.js';
const token='11111111-1111-4111-8111-111111111111';
const quote={customer_name:'Preview Customer',customer_phone:'0412345678',customer_email:'preview@example.com',customer_address:'12 Example Street, Brisbane QLD 4000',service_type:'Installation Quote',customer_type:'digital',ceiling_type:'normal',alarm_qty:6,alarm_unit_price:98,ctrl_qty:0,grand_total:621};
const env={SUPABASE_URL:'https://supabase.example',SUPABASE_ANON_KEY:'test',DATAFORCE_CLIENT_ID:'client',DATAFORCE_CLIENT_SECRET:'secret'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function response(){return {code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}}}
test('staff action creates a pending waiting job without claiming customer acceptance',async()=>{
 const calls=[];const fetchImpl=async(url,opts={})=>{const path=new URL(url).pathname;calls.push({path,opts});if(path.endsWith('/authorization/token'))return json({access_token:'test'});if(path.endsWith('/jobs/search')||path.endsWith('/customers/search'))return json({records:[]});if(path.includes('/customers/ref/'))return json({},404);if(path.endsWith('/customers')){assert.match(JSON.parse(opts.body).customerRef,/^[A-Za-z0-9]+$/);return json({customerId:501})}if(path.endsWith('/jobs')){assert.equal(JSON.parse(opts.body).quotationStatus,'Pending');return json({jobId:601})}if(path.endsWith('/jobs/601/appointments'))return json({records:[]});if(path.endsWith('/appointments')){assert.match(JSON.parse(opts.body).jobInstruction,/Staff quote \$621.00/);return json({appointmentId:701})}throw Error(path)};
 const result=await pushStaffSmokeQuoteToDataforce({quoteToken:token,quote,fetchImpl:withSmokeProductApi(fetchImpl),env});assert.equal(result.jobId,601);assert.equal(result.synced,true);assert.equal(calls.some(c=>c.path.includes('supabase')||c.path.includes('rest/v1')),false);
});
test('accepted quote reuses staff job and updates our waiting instructions for revised quantity',async()=>{
 let patch;const fetchImpl=async(url,opts={})=>{const path=new URL(url).pathname;if(path.includes('/rest/v1/quote_emails'))return json([{...quote,alarm_qty:7,grand_total:719,accepted_at:new Date().toISOString(),accepted:true,status:'accepted'}]);if(path.endsWith('/authorization/token'))return json({access_token:'test'});if(path.endsWith('/jobs/search'))return json({records:[{jobId:601}]});if(path.endsWith('/jobs/601/appointments'))return json({records:[{appointmentId:701,workTypeId:62,completionStatusDescription:'Waiting',jobInstruction:'6 Smoke Alarms | Normal ceiling | Staff quote $621.00'}]});if(path.endsWith('/appointments/701/reschedule')){patch=JSON.parse(opts.body);return json({appointmentId:701})}throw Error(path)};
 const result=await syncAcceptedSmokeQuoteToDataforce({quoteToken:token,fetchImpl:withSmokeProductApi(fetchImpl),env});assert.equal(result.jobId,601);assert.deepEqual(patch,{jobInstruction:'7 Smoke Alarms | Normal ceiling | Accepted quote $719.00',triggerEmailEvents:false});
});
test('staff push rejects postcode-only, incomplete and interstate addresses before network access',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network calls permitted')};try{for(const address of ['','4123','Brisbane QLD 4000','Example Street, Brisbane QLD 4000','12 Example Street, Sydney NSW 2000']){const res=response();await handler({method:'POST',body:{...quote,action:'staff-push-dataforce',token,customer_address:address}},res);assert.equal(res.code,400)}}finally{globalThis.fetch=original}
});
test('staff push does not change an emailed quote with different quantities',async()=>{
 const original=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_ANON_KEY;process.env.SUPABASE_URL=env.SUPABASE_URL;process.env.SUPABASE_ANON_KEY='test';let calls=0;globalThis.fetch=async()=>{calls++;return json([{...quote,alarm_qty:8}])};try{const res=response();await handler({method:'POST',body:{...quote,action:'staff-push-dataforce',token}},res);assert.equal(res.code,409);assert.equal(calls,1)}finally{globalThis.fetch=original;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_ANON_KEY;else process.env.SUPABASE_ANON_KEY=oldKey}
});
