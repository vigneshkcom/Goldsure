import {json,goodOrigin,validSession,validStaff,db} from './_shared.js';
import {DAYS,MOVE_IN_PROGRESS,MOVE_LOCK_MS,moveAppointment} from './_dataforce.js';
import {enabled,verifiedStaff} from './dataforce-auth.js';

export default async function handler(req,res){
  if(!validSession(req))return json(res,401,{error:'Not signed into staff portal'});
  if(req.method==='GET'){
    try{return json(res,200,{connected:enabled(),staff:await verifiedStaff(req)});}
    catch{return json(res,503,{error:'Could not check your work email sign-in.'});}
  }
  if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
  if(!goodOrigin(req))return json(res,403,{error:'Origin rejected'});
  const body=req.body||{};
  const jobId=Number(body.job_id),version=Number(body.expected_version);
  let actor=String(body.actor||'').trim();
  const reply=String(body.customer_reply||'').trim();
  const start=String(body.confirmed_start_time||'').trim();
  const chosenDate=String(body.chosen_date||''),chosenSlot=String(body.chosen_slot||'');
  if(!Number.isSafeInteger(jobId)||jobId<1||!Number.isSafeInteger(version)||version<1)return json(res,400,{error:'Invalid job ID/version'});
  if(!validStaff(actor))return json(res,400,{error:'Agent name is required'});
  if(reply.length<8||reply.length>3000||/\b(cannot|can't|decline|not available|does not work|don't want|please cancel|won't work)\b/i.test(reply))return json(res,400,{error:'Paste the affirmative customer reply, not a refusal.'});
  if(body.confirmed_agreement!==true)return json(res,400,{error:'Confirm the customer explicitly agreed to the displayed date and AM/PM slot.'});
  if(!Object.hasOwn(DAYS,chosenDate)||!['AM','PM'].includes(chosenSlot))return json(res,400,{error:'Choose which date the customer agreed to.'});
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||(chosenSlot==='AM'?Number(start.slice(0,2))>=12:Number(start.slice(0,2))<12))return json(res,400,{error:'Choose a start time inside the selected AM or PM window.'});

  const manual = body.manual === true;
  if (!manual) {
    if (!enabled()) return json(res,503,{error:'Direct Dataforce moves are unavailable. Use Save for manual move.'});
    try { actor=await verifiedStaff(req); }
    catch { return json(res,503,{error:'Work email verification is temporarily unavailable.'}); }
    if (!actor) return json(res,403,{error:'Verify your Goldsure work email before moving a job in Dataforce.'});
  }

  const filter = v => 'goldsure_rebooking_jobs?job_id=eq.'+jobId+'&version=eq.'+v+'&select=*';
  const patch = async (v, changes) => {
    const rows = await db(filter(v),'PATCH',{...changes,updated_by:actor},{Prefer:'return=representation'});
    return rows?.[0];
  };
  const link = 'https://asap.dataforce.com.au/~goldsure/appointment/job.php?iJobId='+jobId+'&database=GOLDSURE_ASAP';
  let saved;
  try {
    const [job] = await db(filter(version));
    if (!job) return json(res,409,{error:'This job was changed. Refresh before submitting.'});
    if (job.is_existing) return json(res,403,{error:'Existing bookings are protected'});
    if (job.dataforce_updated) return json(res,409,{error:'Already marked as moved in Dataforce'});
    if (job.dataforce_status === MOVE_IN_PROGRESS && Date.now() - Date.parse(job.approved_at) < MOVE_LOCK_MS) {
      return json(res,409,{error:'Another move is in progress. Refresh and check the booking.'});
    }
    const offered = [{date:job.assignment_date,slot:job.assignment_slot},...(job.alternate_options||[])];
    if (!offered.some(o=>o?.date===chosenDate&&o.slot===chosenSlot)) {
      return json(res,400,{error:'Choose one of the dates and windows offered for this job.'});
    }
    saved = await patch(version,{
      assigned_electrician:DAYS[chosenDate],assignment_date:chosenDate,assignment_slot:chosenSlot,
      approved_customer_reply:reply,approved_by:actor,approved_at:new Date().toISOString(),
      confirmed_start_time:start,customer_response:'Customer agreed',contact_status:'Spoke - agreed',
      dataforce_status:manual?'Agreement recorded — Dataforce move pending':MOVE_IN_PROGRESS,
      dataforce_error:null,
    });
    if (!saved) return json(res,409,{error:'Another agent changed this job. Refresh and retry.'});
  } catch (error) {
    if (/capacity exceeded/i.test(error?.message)) return json(res,409,{error:'That date and slot is full. Choose another option.'});
    return json(res,503,{error:'Failed to save approval. No Dataforce change was made.'});
  }

  if (manual) return json(res,200,{job:saved,moved:false,dataforce_url:link});

  try {
    await moveAppointment({job:saved,date:chosenDate,start,worker:DAYS[chosenDate]});
  } catch (error) {
    const detail = error.message;
    let updated;
    try {
      updated = await patch(saved.version,{dataforce_status:'Agreement recorded — check Dataforce',dataforce_error:detail});
    } catch {
      // The approval is already saved. The move lock expires if this update fails.
    }
    return json(res,502,{error:'Customer agreement saved. '+detail,job:updated||saved,dataforce_url:link});
  }

  try {
    const updated = await patch(saved.version,{
      dataforce_updated:true,dataforce_updated_at:new Date().toISOString(),
      dataforce_status:'Moved in Dataforce',dataforce_error:null,
    });
    if (updated) return json(res,200,{job:updated,moved:true,message:'Dataforce confirmed the appointment change.'});
  } catch {
    // The successful read-back is authoritative even if updating the tracker fails.
  }
  return json(res,200,{job:saved,moved:true,message:'Dataforce confirmed the move. Refresh to sync the tracker.'});
}
