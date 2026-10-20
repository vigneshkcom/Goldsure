import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustSmokeQuote } from '../lib/smoke-quote-adjustment.js';
import handler from '../api/smoke-alarms/quotes.js';
const quote={quote_token:'test-token',service_type:'Installation Quote',alarm_qty:8,alarm_total:784,alarm_unit_price:98,ctrl_qty:0,ctrl_total:0,fee_amount:33,fee_label:'Electrician Booking Fee',grand_total:797,grand_total_numeric:797,status:'sent',sent_at:new Date().toISOString(),accepted_at:null,customer_name:'Test Customer',customer_email:'test@example.com',customer_address:'12 Example Street, Brisbane QLD 4000'};
test('additional pricing preserves existing discount and controller charges',()=>{
 assert.equal(adjustSmokeQuote(quote,9).grand_total,895);
 assert.equal(adjustSmokeQuote({...quote,alarm_unit_price:109,alarm_total:872,grand_total:905,grand_total_numeric:905},9).grand_total,1014);
 assert.equal(adjustSmokeQuote({...quote,ctrl_qty:1,ctrl_total:49,grand_total:846,grand_total_numeric:846},9).grand_total,944);
});
test('rejects reductions, fractional, invalid, excessive and inspection additions',()=>{
 for(const qty of [7,8.5,NaN,Infinity,101])assert.throws(()=>adjustSmokeQuote(quote,qty));
 assert.throws(()=>adjustSmokeQuote({...quote,service_type:'Inspection Quote'},9));
});
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
function res(){return {statusCode:200,status(c){this.statusCode=c;return this},json(v){this.body=v;return this}}}
async function runCase(row,body,{conflict=false}={}){
 const oldFetch=globalThis.fetch;const savedEnv={...process.env};process.env.SUPABASE_URL='https://supabase.example';process.env.SUPABASE_ANON_KEY='test';delete process.env.DATAFORCE_CLIENT_ID;delete process.env.GHL_API_KEY;delete process.env.HOSTINGER_MAIL_API_TOKEN;
 const calls=[];let current={...row};
 globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),options});if(String(url).includes('/rest/v1/quote_emails')){if(options.method==='PATCH'){const patch=JSON.parse(options.body);current={...current,...patch};return json(conflict?[]:[current])}return json([current])}if(String(url).includes('api.resend.com'))return json({id:'test'});throw new Error('Unexpected request '+url)};
 const response=res();try{await handler({method:'POST',body:{action:'accept-customer',token:'test-token',customer_address:quote.customer_address,...body}},response);return {response,calls,current}}finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in savedEnv))delete process.env[k];Object.assign(process.env,savedEnv)}
}
test('server ignores browser totals, atomically saves selection, and sends revised notification',async()=>{
 const {response,calls}=await runCase(quote,{alarm_qty:9,grand_total:1});assert.equal(response.statusCode,200);assert.equal(response.body.quote.grand_total,895);assert.ok(response.body.quote.accepted_at);
 const patch=calls.find(c=>c.options.method==='PATCH');assert.match(patch.url,/accepted_at=is.null/);assert.equal(JSON.parse(patch.options.body).alarm_total,882);
 const notification=calls.find(c=>c.url.includes('api.resend.com'));assert.ok(notification);assert.match(JSON.parse(notification.options.body).html,/Customer added 1 smoke alarm/);assert.match(JSON.parse(notification.options.body).html,/Accepted quote: 9 alarms · \$895.00/);
});
test('already accepted, expired and rejected quotes cause no writes or notifications',async()=>{
 for(const row of [{...quote,accepted_at:new Date().toISOString()},{...quote,status:'expired'},{...quote,status:'rejected'},{...quote,sent_at:'2020-01-01'}]){const {response,calls}=await runCase(row,{alarm_qty:9});assert.ok([200,409].includes(response.statusCode));assert.equal(calls.length,1)}
});
test('concurrent save returns conflict and does not send notification',async()=>{
 const {response,calls}=await runCase(quote,{alarm_qty:9},{conflict:true});assert.equal(response.statusCode,409);assert.equal(calls.length,2);
});
