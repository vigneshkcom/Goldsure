import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {bookingActionUrl,verifyBookingAction,signBridge,verifyBridge} from '../lib/smoke-booking-actions.js';
import {acceptCalculatorQuote,calculatorQuote,calculatorBookingStatus,sendCalculatorBookingRequest,pushCalculatorStatus} from '../lib/smoke-calculator-booking.js';
import handler from '../api/smoke-alarms/calculator-booking.js';
const lead={id:'123e4567-e89b-12d3-a456-426614174000',quote_token:'1234567890abcdef1234567890abcdef',full_name:'Example Customer',email:'customer@example.com',phone:'0400000000',property_address:'12 Example Street, Brisbane QLD 4000, Australia',alarm_qty:4,controller_qty:0,booking_fee:33,total_inc_gst:425,status:'accepted',accepted_at:'2026-11-26T20:07:20Z',created_at:'2026-11-25T00:00:00Z'};
const env={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',SMOKE_CALCULATOR_BRIDGE_SECRET:'fixture-signing-secret',SMSGATE_USERNAME:'fixture',SMSGATE_PASSWORD:'fixture'};
const json=data=>new Response(JSON.stringify(data));
function fixture(){
 const state={quote:null,record:null,email:[],sms:[],callback:[],jobs:0,ghl:0,optout:false,smsFail:false,emailFail:false};
 state.fetchImpl=async(url,init={})=>{
   const u=new URL(url),body=init.body?JSON.parse(init.body):{};
   if(u.hostname==='smokealarms.goldsure.com.au'){assert.equal(verifyBridge(body,init.headers,env),true);state.callback.push(body);return json({success:true});}
   if(u.hostname==='api.sms-gate.app'){state.sms.push(body);if(state.smsFail)return new Response('{}',{status:503});return json({id:'sms-fixture'});}
   assert.equal(u.hostname,'fixture.supabase.co');
   if(u.pathname.endsWith('/quote_emails')){
     if(init.method==='POST'){state.quote ||= structuredClone(body);return json([]);}
     return json(state.quote?[state.quote]:[]);
   }
   if(u.pathname.endsWith('/smoke_calculator_bookings')){
     if(init.method==='POST'){state.record ||= {email_status:'pending',sms_status:'pending',...structuredClone(body)};return json([]);}
     if(!state.record)return json([]);
     if(init.method==='PATCH'){
       if(u.searchParams.has('or')&&state.record.locked_until&&Date.parse(state.record.locked_until)>Date.now())return json([]);
       if(u.searchParams.has('lock_token')&&u.searchParams.get('lock_token')!=='eq.'+state.record.lock_token)return json([]);
       Object.assign(state.record,body);return json([state.record]);
     }
     return json([state.record]);
   }
   if(u.pathname.endsWith('/sms_messages'))return json(init.method==='POST'?[]:state.optout?[{status:'optout'}]:[]);
   throw new Error('Unexpected URL '+url);
 };
 state.options={env,fetchImpl:state.fetchImpl,syncDataforce:async()=>{state.jobs++;return {synced:true,jobId:12345,appointmentId:67890};},syncGhl:async()=>{state.ghl++;return {moved:true};},mail:async mail=>{state.email.push(mail);if(state.emailFail){const error=new Error('Mailbox rejected send');error.status=503;throw error;}}};
 state.accept=()=>acceptCalculatorQuote(lead,state.options);
 state.send=()=>sendCalculatorBookingRequest('calc-'+lead.quote_token,state.options);
 return state;
}
test('signed staff links reject tampering and expiry',()=>{
 const url=new URL(bookingActionUrl('calc-'+lead.quote_token,env));
 const params=Object.fromEntries(url.searchParams);
 assert.equal(verifyBookingAction(params,env),true);
 assert.equal(verifyBookingAction({...params,token:'calc-another-customer'},env),false);
 assert.equal(verifyBookingAction(params,env,Date.now()+31*86400000),false);
});
test('bridge authentication binds the exact accepted quote and expires',()=>{
 const timestamp=String(Date.now()),body={lead},signature=signBridge(body,timestamp,env);
 assert.equal(verifyBridge(body,{'x-goldsure-timestamp':timestamp,'x-goldsure-signature':signature},env),true);
 assert.equal(verifyBridge({lead:{...lead,email:'wrong@example.com'}},{'x-goldsure-timestamp':timestamp,'x-goldsure-signature':signature},env),false);
 assert.equal(verifyBridge(body,{'x-goldsure-timestamp':timestamp,'x-goldsure-signature':signature},env,Date.now()+360000),false);
});
test('only a genuinely accepted fixed-price calculator quote is normalised',()=>{
 assert.equal(calculatorQuote(lead).grand_total_numeric,425);
 assert.equal(calculatorQuote(lead).fee_amount,33);
 assert.equal(calculatorQuote(lead).customer_address,'12 Example Street, Brisbane QLD 4000');
 assert.throws(()=>calculatorQuote({...lead,accepted_at:null}));
 assert.throws(()=>calculatorQuote({...lead,total_inc_gst:1}));
 assert.throws(()=>calculatorQuote({...lead,booking_fee:0}));
});
test('acceptance creates the canonical quote and waiting-job link, moves GHL and never sends a payment request automatically',async()=>{
 const s=fixture(),r=await s.accept();
 assert.equal(r.job_id,12345);
 assert.equal(r.ghl_accepted,true);
 assert.equal(s.record.dataforce_appointment_id,67890);
 assert.equal(s.quote.accepted,true);
 assert.equal(s.email.length,0);assert.equal(s.sms.length,0);
 assert.equal(s.callback[0].dataforce_job_id,12345);
 assert.match(r.staff_booking_url,/booking-request.html/);
 await s.accept();
 assert.equal(s.ghl,1,'recovery does not repeat the acceptance note');
});
test('request sends both channels to stored recipients and repeated clicks do not resend',async()=>{
 const s=fixture();await s.accept();
 assert.equal((await s.send()).success,true);
 assert.equal(s.email.length,1);assert.equal(s.sms.length,1);
 assert.deepEqual(s.email[0].to,['customer@example.com']);
 assert.deepEqual(s.sms[0].phoneNumbers,['+61400000000']);
 assert.match(s.sms[0].textMessage.text,/\$33/);
 assert.match(s.email[0].html,/accept-quote.html\?token=calc-/);
 await s.send();
 assert.equal(s.email.length,1);assert.equal(s.sms.length,1);
});
test('partial failure retries only the failed channel',async()=>{
 const s=fixture();await s.accept();s.smsFail=true;
 const partial=await s.send();assert.equal(partial.email_sent,true);assert.equal(partial.sms_sent,false);
 s.smsFail=false;assert.equal((await s.send()).success,true);
 assert.equal(s.email.length,1);assert.equal(s.sms.length,2);
});
test('a recorded $33 payment blocks both sends and is mirrored into the calculator tracker',async()=>{
 const s=fixture();await s.accept();
 Object.assign(s.quote,{booking_fee_paid_at:new Date().toISOString(),booking_fee_amount:33,stripe_checkout_session_id:'cs_paid_fixture',stripe_payment_intent_id:'pi_paid_fixture'});
 assert.equal((await s.send()).already_paid,true);
 assert.equal(s.email.length,0);assert.equal(s.sms.length,0);
 await pushCalculatorStatus(s.quote.quote_token,s.options);
 assert.equal(s.callback.at(-1).booking_fee_amount,33);
 assert.equal(s.callback.at(-1).stripe_checkout_session_id,'cs_paid_fixture');
 assert.equal((await calculatorBookingStatus(s.quote.quote_token,s.options)).paid,true);
});
test('overlapping sends are excluded by the durable booking lease',async()=>{
 const s=fixture();await s.accept();s.record.locked_until=new Date(Date.now()+60000).toISOString();
 await assert.rejects(s.send(),/being processed/);
 assert.equal(s.email.length,0);assert.equal(s.sms.length,0);
});
test('unknown delivery is not blindly retried',async()=>{
 const s=fixture();await s.accept();s.record.email_status='unknown';
 await s.send();assert.equal(s.email.length,0);assert.equal(s.sms.length,1);
});
test('SMS opt-out is respected and reported independently of email',async()=>{
 const s=fixture();await s.accept();s.optout=true;const result=await s.send();
 assert.equal(result.email_sent,true);assert.equal(result.sms_status,'opted-out');assert.equal(s.sms.length,0);
});
test('unsigned action requests and scanners cannot trigger customer messages',async()=>{
 for(const method of ['GET','POST']){
  const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
  await handler({method,headers:{},query:{},body:{action:'send',token:'calc-'+lead.quote_token}},res);
  assert.equal(res.code,401);
 }
});
