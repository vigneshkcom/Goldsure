import crypto from 'node:crypto';
import {syncAcceptedSmokeQuoteToDataforce,parseAcceptedPropertyAddress} from './dataforce-smoke-quote.js';
import {syncAcceptedSmokeAlarmStage} from './ghl-smoke-alarm-stage.js';
import {hasReceivedBookingFee} from './smoke-booking-notice.js';
import {sendHostingerMail} from './hostinger-mail.js';
import {SMSGATE_API} from './sms-gate.js';
import {bookingActionUrl,signBridge} from './smoke-booking-actions.js';
const TABLE='smoke_calculator_bookings';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function db(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Booking database is not configured.');
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  return {base:env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'}};
}
async function request(path,init={},options={}){
  const {env=process.env,fetchImpl=fetch}=options,{base,headers}=db(env);
  const r=await fetchImpl(base+'/'+path,{...init,headers:{...headers,...init.headers},cache:'no-store'});
  if(!r.ok)throw new Error('Booking database request failed ('+r.status+').');
  return r.status===204?null:r.json();
}
const rowPath=token=>TABLE+'?quote_token=eq.'+encodeURIComponent(token);
async function patch(token,body,options){return request(rowPath(token),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...body,updated_at:new Date().toISOString()})},options);}
async function quoteFor(token,options){
  const [quote]=await request('quote_emails?quote_token=eq.'+encodeURIComponent(token)+'&select=*&limit=1',{},options);
  if(!quote?.accepted_at||!quote.accepted)throw new Error('Customer acceptance is not recorded.');
  return quote;
}
async function recordFor(token,options){
  const [row]=await request(rowPath(token)+'&select=*&limit=1',{},options);
  if(!row)throw new Error('Calculator booking was not found.');
  return row;
}
async function lease(token,options){
  const now=new Date(),lock=crypto.randomUUID();
  const rows=await request(rowPath(token)+'&or=(locked_until.is.null,locked_until.lt.'+now.toISOString()+')',{
    method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({lock_token:lock,locked_until:new Date(now.getTime()+120000).toISOString()})
  },options);
  if(!rows.length)throw new Error('This booking is being processed. Please try again shortly.');
  return ()=>request(rowPath(token)+'&lock_token=eq.'+lock,{method:'PATCH',body:JSON.stringify({lock_token:null,locked_until:null})},options);
}
export function calculatorQuote(lead){
  const address=parseAcceptedPropertyAddress(lead?.property_address);
  if(!lead?.accepted_at||String(lead.status).toLowerCase()!=='accepted'||!Number.isFinite(Date.parse(lead.accepted_at))||
    !/^[a-zA-Z0-9-]{8,80}$/.test(String(lead.quote_token||''))||!address||
    !/^[0-9a-f-]{36}$/i.test(String(lead.id||''))||
    !Number.isInteger(Number(lead.alarm_qty))||Number(lead.alarm_qty)<1||
    !Number.isInteger(Number(lead.controller_qty||0))||Number(lead.controller_qty||0)<0||
    Number(lead.booking_fee)!==33)throw new Error('A valid customer-accepted calculator quote is required.');
  const alarms=Number(lead.alarm_qty),controllers=Number(lead.controller_qty||0),total=alarms*98+controllers*49+33;
  if(Math.abs(Number(lead.total_inc_gst)-total)>0.01)throw new Error('The accepted calculator total needs review.');
  return {
    quote_token:'calc-'+lead.quote_token,customer_name:lead.full_name,customer_email:lead.email,
    customer_phone:lead.phone,customer_address:address.formatted,customer_type:'digital',agent_name:'Website Calculator',
    service_type:'Installation Quote',alarm_qty:alarms,alarm_unit_price:98,alarm_total:alarms*98,
    ctrl_qty:controllers,ctrl_total:controllers*49,fee_label:'Booking Fee',fee_amount:33,
    grand_total:'$'+total.toFixed(2),grand_total_numeric:total,status:'accepted',accepted:true,
    accepted_at:lead.accepted_at,sent_at:lead.created_at
  };
}
export async function acceptCalculatorQuote(lead,options={}){
  const quote=calculatorQuote(lead);
  await request('quote_emails?on_conflict=quote_token',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(quote)},options);
  const existing=await quoteFor(quote.quote_token,options);
  if(existing.customer_email.toLowerCase()!==String(quote.customer_email).toLowerCase()||existing.customer_address!==quote.customer_address)throw new Error('Quote identity does not match.');
  await request(TABLE+'?on_conflict=quote_token',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({quote_token:quote.quote_token,lead_token:lead.quote_token,lead_id:lead.id})},options);
  const result=await syncCalculatorBooking(quote.quote_token,options);
  return {...result,staff_booking_url:bookingActionUrl(quote.quote_token,options.env||process.env)};
}
export async function pushCalculatorStatus(token,options={}){
  if(!String(token).startsWith('calc-'))return {skipped:true};
  const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch;
  const quote=await quoteFor(token,options),record=await recordFor(token,options);
  const body={
    quote_token:record.lead_token,
    dataforce_job_id:record.dataforce_job_id,
    dataforce_appointment_id:record.dataforce_appointment_id,
    ghl_accepted_at:record.ghl_accepted_at,
    ...(hasReceivedBookingFee(quote)?{
      booking_fee_paid_at:quote.booking_fee_paid_at,booking_fee_amount:33,
      stripe_checkout_session_id:quote.stripe_checkout_session_id,
      stripe_payment_intent_id:quote.stripe_payment_intent_id
    }:{})
  };
  const timestamp=String(Date.now());
  const response=await fetchImpl('https://smokealarms.goldsure.com.au/api/smoke-alarm/booking-status',{
    method:'POST',headers:{'Content-Type':'application/json','x-goldsure-timestamp':timestamp,'x-goldsure-signature':signBridge(body,timestamp,env)},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok){await patch(token,{landing_synced_at:null},options);throw new Error('Website booking status needs retry ('+response.status+').');}
  await patch(token,{landing_synced_at:new Date().toISOString()},options);
  return {synced:true};
}
export async function syncCalculatorBooking(token,options={}){
  const release=await lease(token,options);
  try{
    const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch;
    await quoteFor(token,options);
    const errors=[];
    const previous=await recordFor(token,options);
    let job={};
    try{
      job=await (options.syncDataforce||syncAcceptedSmokeQuoteToDataforce)({quoteToken:token,env,fetchImpl});
      if(!job.synced)errors.push('Dataforce: '+job.reason);
      else await patch(token,{dataforce_job_id:job.jobId,dataforce_appointment_id:job.appointmentId},options);
      if(job.productError)errors.push('Products: '+job.productError);
    }catch(error){errors.push('Dataforce: '+error.message);}
    const current=await recordFor(token,options);
    let stage={};
    try{
      stage=current.ghl_accepted_at && (previous.dataforce_job_id || !current.dataforce_job_id)
        ? {reason:'already-in-quote-accepted'}
        : await (options.syncGhl||syncAcceptedSmokeAlarmStage)({quoteToken:token,dataforceJobId:current.dataforce_job_id||null,env,fetchImpl});
      if(stage.moved||stage.reason==='already-in-quote-accepted')await patch(token,{ghl_accepted_at:new Date().toISOString()},options);
      else errors.push('GHL: '+stage.reason);
    }catch(error){errors.push('GHL: '+error.message);}
    await patch(token,{sync_error:errors.join('; ')||null},options);
    try{await pushCalculatorStatus(token,options);}catch(error){errors.push(error.message);}
    const record=await recordFor(token,options);
    return {success:errors.length===0,quote_token:token,job_id:record.dataforce_job_id,appointment_id:record.dataforce_appointment_id,ghl_accepted:Boolean(record.ghl_accepted_at),errors};
  }finally{await release();}
}
export async function reconcileCalculatorBookings(options={}){
  if(!(options.env||process.env).SMOKE_CALCULATOR_BRIDGE_SECRET)return {skipped:true};
  const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch;
  const pendingBody={action:'pending'},timestamp=String(Date.now());
  let pendingSynced=0;
  try{
    const pending=await fetchImpl('https://smokealarms.goldsure.com.au/api/smoke-alarm/booking-status',{
      method:'POST',headers:{'Content-Type':'application/json','x-goldsure-timestamp':timestamp,'x-goldsure-signature':signBridge(pendingBody,timestamp,env)},
      body:JSON.stringify(pendingBody),signal:AbortSignal.timeout(10000)
    });
    if(pending.ok){
      const payload=await pending.json();
      for(const lead of payload.leads||[]){try{await acceptCalculatorQuote(lead,options);pendingSynced++;}catch(error){console.error('[Calculator recovery]',error.message);}}
    }
  }catch(error){console.error('[Calculator pending sync]',error.message);}
  const rows=await request(TABLE+'?select=quote_token&or=(dataforce_job_id.is.null,ghl_accepted_at.is.null,landing_synced_at.is.null,sync_error.not.is.null)&order=updated_at.asc&limit=5',{},options);
  let synced=0,failed=0;
  for(const row of rows){
    try{const result=await syncCalculatorBooking(row.quote_token,options);result.success?synced++:failed++;}
    catch{failed++;}
  }
  return {synced,failed,pendingSynced};
}
export async function calculatorBookingStatus(token,options={}){
  const quote=await quoteFor(token,options),record=await recordFor(token,options);
  return {customer_name:quote.customer_name,customer_email:quote.customer_email,customer_phone:quote.customer_phone,
    customer_address:quote.customer_address,job_id:record.dataforce_job_id,ghl_accepted:Boolean(record.ghl_accepted_at),
    paid:hasReceivedBookingFee(quote),paid_at:quote.booking_fee_paid_at||null,amount:33,
    email_status:record.email_status,sms_status:record.sms_status,sync_error:record.sync_error,request_error:record.request_error};
}
function mobile(raw){
  let digits=String(raw||'').replace(/\D/g,'');
  if(digits.startsWith('61'))digits='0'+digits.slice(2);
  if(!/^04\d{8}$/.test(digits))throw new Error('A valid Australian mobile is required for SMS.');
  return '+61'+digits.slice(1);
}
export function bookingRequestCopy(quote,jobId){
  const url='https://portal.goldsure.com.au/accept-quote.html?token='+encodeURIComponent(quote.quote_token);
  const first=String(quote.customer_name||'there').trim().split(/\s+/)[0];
  const text='Hi '+first+', thank you for accepting your Goldsure smoke alarm quote. Please pay your $33 booking fee securely here: '+url+' Our team will confirm your installation booking. Questions? Call (07) 2145 5155. Goldsure Pty Ltd';
  const html='<div style="font-family:Arial,sans-serif;max-width:560px;padding:24px;color:#141c2e"><h2>Goldsure $33 booking fee</h2><p>Hi '+esc(first)+',</p><p>Thank you for accepting your smoke alarm quote'+(jobId?' (Job '+esc(jobId)+')':'')+'.</p><p>Please pay the <strong>$33 booking fee</strong> using the secure link below. Our team will confirm your installation booking.</p><p><a style="display:inline-block;background:#b08d2e;color:#111;padding:14px 20px;text-decoration:none;font-weight:bold;border-radius:6px" href="'+esc(url)+'">Pay $33 booking fee</a></p><p>The booking fee is included in your accepted quote total. Please do not pay it again if you have already paid.</p><p>Goldsure Team<br>(07) 2145 5155</p></div>';
  return {url,sms:text,subject:'Goldsure'+(jobId?' Job '+jobId:'')+' | $33 booking payment request',html,text};
}
export async function sendCalculatorBookingRequest(token,options={}){
  const env=options.env||process.env,fetchImpl=options.fetchImpl||fetch;
  const quote=await quoteFor(token,options);
  if(hasReceivedBookingFee(quote)||quote.booking_fee_paid_at)return {already_paid:true,success:true};
  if(['rejected','expired','installed'].includes(String(quote.status).toLowerCase()))throw new Error('This quote cannot receive a booking request.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(quote.customer_email||'')))throw new Error('The customer email needs correction.');
  const phone=mobile(quote.customer_phone);
  if(!env.SMSGATE_USERNAME||!env.SMSGATE_PASSWORD)throw new Error('SMS delivery is not configured.');
  const record=await recordFor(token,options);
  if(!record.dataforce_job_id||!record.ghl_accepted_at)throw new Error('Sync the Dataforce job and GHL stage before requesting payment.');
  const release=await lease(token,options);
  try{
    const latest=await quoteFor(token,options);
    if(hasReceivedBookingFee(latest)||latest.booking_fee_paid_at)return {already_paid:true,success:true};
    let current=await recordFor(token,options);
    const copy=bookingRequestCopy(latest,current.dataforce_job_id);
    const errors=[];
    if(current.email_status==='pending'||current.email_status==='failed'){
      await patch(token,{email_status:'sending'},options);
      try{
        await (options.mail||sendHostingerMail)({to:[latest.customer_email],displayName:'Goldsure Pty Ltd',subject:copy.subject,html:copy.html,text:copy.text});
        await patch(token,{email_status:'sent',email_sent_at:new Date().toISOString()},options);
      }catch(error){
        const status=Number(error.status);
        await patch(token,{email_status:status>=400?'failed':'unknown'},options);
        errors.push('Email: '+(status>=400?'delivery failed.':'delivery could not be confirmed; check before retrying.'));
      }
    }
    current=await recordFor(token,options);
    if(current.sms_status==='pending'||current.sms_status==='failed'){
      const opt=await request('sms_messages?phone_number=eq.'+encodeURIComponent(phone)+'&status=in.(optout,optin)&order=created_at.desc&limit=1&select=status',{},options);
      if(opt[0]?.status==='optout'){await patch(token,{sms_status:'opted-out'},options);errors.push('SMS: this number opted out.');}
      else{
        await patch(token,{sms_status:'sending'},options);
        try{
          const response=await fetchImpl(SMSGATE_API+'/messages',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.SMSGATE_USERNAME+':'+env.SMSGATE_PASSWORD).toString('base64'),'Content-Type':'application/json'},
            body:JSON.stringify({phoneNumbers:[phone],textMessage:{text:copy.sms},...(env.SMSGATE_DEVICE_ID?{deviceId:env.SMSGATE_DEVICE_ID}:{})}),signal:AbortSignal.timeout(20000)});
          if(!response.ok){const error=new Error('SMS delivery failed.');error.status=response.status;throw error;}
          const sms=await response.json().catch(()=>({}));
          await patch(token,{sms_status:'sent',sms_sent_at:new Date().toISOString()},options);
          await request('sms_messages',{method:'POST',body:JSON.stringify({phone_number:phone,message:copy.sms,direction:'outbound',status:'sent',sms_gate_id:sms.id||null})},options).catch(()=>{});
        }catch(error){await patch(token,{sms_status:Number(error.status)>=400?'failed':'unknown'},options);errors.push('SMS: '+(Number(error.status)>=400?'delivery failed.':'delivery could not be confirmed; check before retrying.'));}
      }
    }
    await patch(token,{request_error:errors.join(' ')||null},options);
    const final=await recordFor(token,options);
    return {success:final.email_status==='sent'&&final.sms_status==='sent',email_sent:final.email_status==='sent',sms_sent:final.sms_status==='sent',email_status:final.email_status,sms_status:final.sms_status,errors};
  }finally{await release();}
}
