import {json,goodOrigin,validSession,db} from './_shared.js';

// Live Dataforce API writes remain disabled until the official rescheduling
// endpoint method/path/payload can be verified. Do not guess on real bookings.
export default async function handler(req,res){
  if(!validSession(req))return json(res,401,{error:'Not signed into staff portal'});
  if(req.method==='GET')return json(res,200,{connected:false,reason:'Dataforce OAuth credentials are available in Vercel, but its appointment-reschedule API contract still needs verification.'});
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(!goodOrigin(req))return json(res,403,{error:'Origin rejected'});
  const body=req.body||{};
  const jobId=Number(body.job_id),version=Number(body.expected_version);
  const actor=String(body.actor||'').trim(),reply=String(body.customer_reply||'').trim();
  const start=String(body.confirmed_start_time||'').trim();
  if(!Number.isSafeInteger(jobId)||!Number.isSafeInteger(version)||version<1)return json(res,400,{error:'Invalid job ID/version'});
  if(!/^[\p{L}\p{M} .'-]{2,70}$/u.test(actor))return json(res,400,{error:'Agent name is required'});
  if(reply.length<8||reply.length>3000||/\b(cannot|can't|decline|not available|does not work|don't want|please cancel|won't work)\b/i.test(reply))return json(res,400,{error:'Paste the affirmative customer reply, not a refusal.'});
  if(!body.confirmed_agreement)return json(res,400,{error:'Confirm the customer explicitly agreed to the displayed date and AM/PM slot.'});
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))return json(res,400,{error:'Select an exact internal appointment time for Dataforce.'});
  try{
    const filter='goldsure_rebooking_jobs?job_id=eq.'+jobId+'&version=eq.'+version+'&select=*';
    const rows=await db(filter);
    if(!rows?.length)return json(res,409,{error:'This job was changed. Refresh before submitting.'});
    const job=rows[0];
    if(job.is_existing)return json(res,403,{error:'Existing bookings are protected'});
    if(job.dataforce_updated)return json(res,409,{error:'Already marked as moved in Dataforce'});
    if(!job.assignment_date||!job.assignment_slot)return json(res,400,{error:'Choose the date and slot first.'});
    const result=await db(filter,'PATCH',{
      approved_customer_reply:reply,approved_by:actor,approved_at:new Date().toISOString(),
      confirmed_start_time:start,customer_response:'Customer agreed',
      contact_status:'Spoke - agreed',
      dataforce_status:'Agreement recorded — Dataforce move pending',updated_by:actor
    },{Prefer:'return=representation'});
    if(!result?.length)return json(res,409,{error:'Another agent changed this job. Refresh and retry.'});
    return json(res,501,{
      error:'Customer agreement saved securely. Automatic Dataforce movement is not enabled until the official endpoint contract is verified. Open the job in Dataforce and move it manually.',
      job:result[0],
      dataforce_url:'https://asap.dataforce.com.au/~goldsure/appointment/job.php?iJobId='+jobId+'&database=GOLDSURE_ASAP'
    });
  }catch(error){
    return json(res,503,{error:'Failed to save approval. No Dataforce change was made.'});
  }
}
