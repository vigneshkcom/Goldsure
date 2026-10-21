import {SMSGATE_API} from './sms-gate.js';
export async function sendBatteryQuoteSms(quote,env=process.env,fetchImpl=fetch){
 let phone=String(quote.customer.phone||'').replace(/[\s().-]/g,'');if(phone.startsWith('0061'))phone='+'+phone.slice(2);else if(/^61\d{9}$/.test(phone))phone='+'+phone;else if(/^0\d{9}$/.test(phone))phone='+61'+phone.slice(1);else if(/^4\d{8}$/.test(phone))phone='+61'+phone;
 if(!/^\+614\d{8}$/.test(phone))return {status:'skipped',reason:'A valid Australian mobile number is required.'};
 if(!env.SMSGATE_USERNAME||!env.SMSGATE_PASSWORD)return {status:'failed',reason:'SMS gateway is not configured.'};
 const key=env.SUPABASE_ANON_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 try{
  const opt=await fetchImpl(`${env.SUPABASE_URL}/rest/v1/sms_messages?phone_number=eq.${encodeURIComponent(phone)}&status=in.(optout,optin)&order=created_at.desc&limit=1&select=status`,{headers,signal:AbortSignal.timeout(10000)});
  if(!opt.ok)return {status:'failed',reason:'Could not check SMS preferences.'};const rows=await opt.json();if(!Array.isArray(rows))return {status:'failed',reason:'Could not check SMS preferences.'};if(rows[0]?.status==='optout')return {status:'skipped',reason:'Customer has opted out of SMS.'};
  const first=quote.customer.name.trim().split(/\s+/)[0]||'there',base=(env.SITE_URL||'https://portal.goldsure.com.au').replace(/\/$/,'');
  const text=`Hi ${first}, your Goldsure battery quote (${quote.reference}) is ready.\n\nView your quote: ${base}/Battery/quote.html?token=${quote.public_token}\n\nWe have also emailed the quote link to ${quote.customer.email}. Questions? Reply here or call 03 7050 2846.`;
  const response=await fetchImpl(`${SMSGATE_API}/messages`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${env.SMSGATE_USERNAME}:${env.SMSGATE_PASSWORD}`).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({phoneNumbers:[phone],textMessage:{text},...(env.SMSGATE_DEVICE_ID?{deviceId:env.SMSGATE_DEVICE_ID}:{})}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)return {status:'failed',reason:'SMS gateway rejected the request.'};const result=await response.json().catch(()=>({}));
  let logged=false;try{const log=await fetchImpl(`${env.SUPABASE_URL}/rest/v1/sms_messages`,{method:'POST',headers:{...headers,Prefer:'return=minimal'},body:JSON.stringify({phone_number:phone,message:text,direction:'outbound',status:'sent',sms_gate_id:result.id||null}),signal:AbortSignal.timeout(10000)});logged=log.ok;}catch{}
  return {status:'sent',logged};
 }catch{return {status:'uncertain',reason:'SMS response was interrupted. Check the SMS portal before retrying.'};}
}
