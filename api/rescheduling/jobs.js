import {json,goodOrigin,validSession,db} from './_shared.js';
import {MOVE_IN_PROGRESS,MOVE_LOCK_MS} from './_dataforce.js';

const allowed = new Set([
  'assigned_electrician','assignment_date','assignment_slot','route_order','alternate_options',
  'contact_status','call_attempts','sms_sent','email_sent','customer_response','alarm_type',
  'hardwired_qty','battery_qty','notes','follow_up_date','contact_review'
]);
const dates = ['2026-11-26','2026-12-14','2026-12-15','2026-12-16'];
const statuses = ['Not contacted','Called - no answer','Left voicemail','SMS sent - awaiting reply','Email sent - awaiting reply','Spoke - considering','Spoke - agreed','Callback requested','Invalid contact'];
const responses = ['Awaiting contact','Awaiting customer reply','Customer agreed','Customer wants another date','Customer declined'];
const alarmTypes = ['Unconfirmed','Existing hardwired','Existing battery','Mixed hardwired/battery','No existing alarms'];
const slot = s => s === 'AM' || s === 'PM';
const safeDate = s => s === null || dates.includes(s);
function cleanPatch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw Error('Invalid changes');
  const keys=Object.keys(p);
  if (!keys.length || keys.some(k=>!allowed.has(k))) throw Error('Unsupported field');
  const out={...p};
  if ('assignment_date' in out && !safeDate(out.assignment_date)) throw Error('Unsupported date');
  if ('assigned_electrician' in out && out.assigned_electrician !== null && !['Alex Symonds','Mason Adams'].includes(out.assigned_electrician)) throw Error('Unsupported electrician');
  if ('assignment_slot' in out && !slot(out.assignment_slot)) throw Error('Choose AM or PM');
  if ('route_order' in out && !(Number.isInteger(out.route_order) && out.route_order>=1&&out.route_order<=100)) throw Error('Invalid route order');
  if ('alternate_options' in out && (!Array.isArray(out.alternate_options)||out.alternate_options.length>3 || out.alternate_options.some(x=>!x || typeof x!=='object' || !dates.includes(x.date)||!slot(x.slot)))) throw Error('Invalid alternate date/slot');
  if ('contact_status' in out && !statuses.includes(out.contact_status)) throw Error('Invalid contact status');
  if ('customer_response' in out && !responses.includes(out.customer_response)) throw Error('Invalid response status');
  if ('alarm_type' in out && !alarmTypes.includes(out.alarm_type)) throw Error('Invalid alarm type');
  for (const field of ['sms_sent','email_sent','contact_review']) if (field in out && typeof out[field]!=='boolean') throw Error(`Invalid ${field}`);
  for (const field of ['hardwired_qty','battery_qty']) if (field in out && out[field] !== null && !(Number.isInteger(out[field]) && out[field]>=0&&out[field]<=100)) throw Error(`Invalid ${field}`);
  if ('call_attempts' in out && !(Number.isInteger(out.call_attempts)&&out.call_attempts>=0&&out.call_attempts<=1000)) throw Error('Invalid call attempts');
  if ('notes' in out && (typeof out.notes!=='string'||out.notes.length>5000)) throw Error('Notes too long');
  if ('follow_up_date' in out && out.follow_up_date!==null && !/^\d{4}-\d{2}-\d{2}$/.test(out.follow_up_date)) throw Error('Invalid follow-up date');
  return out;
}
const actorOk = a => typeof a==='string' && /^[\p{L}\p{M} .'-]{2,70}$/u.test(a.trim());

export default async function handler(req,res){
  if(!validSession(req)) return json(res,401,{error:'Sign into the Goldsure staff portal first'});
  if(req.method==='GET'){
    try{
      if(req.query?.history){
        const id=Number(req.query.history);
        if(!Number.isSafeInteger(id)||id<1) return json(res,400,{error:'Invalid job ID'});
        const history=await db(`goldsure_rebooking_history?job_id=eq.${id}&select=id,job_id,actor,changed_at,changes&order=changed_at.desc&limit=100`);
        return json(res,200,{history});
      }
      const jobs=await db('goldsure_rebooking_jobs?withdrawn_at=is.null&select=*&order=assignment_date.asc,assignment_slot.asc,route_order.asc&limit=100');
      return json(res,200,{jobs,server_time:new Date().toISOString()});
    }catch(e){return json(res,503,{error:'Could not load tracker from Supabase. Verify database configuration.'});}
  }
  if(req.method!=='PATCH') return json(res,405,{error:'Method not allowed'});
  if(!goodOrigin(req)) return json(res,403,{error:'Origin rejected'});
  try{
    const body=req.body||{}; const id=Number(body.job_id), version=Number(body.expected_version), actor=body.actor?.trim();
    if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(version)||version<1) throw Error('Invalid job/version');
    if(!actorOk(actor)) throw Error('Enter your name first');
    const patch=cleanPatch(body.patch);
    if('assignment_date' in patch || 'assigned_electrician' in patch){
      if(!('assignment_date' in patch)||!('assigned_electrician' in patch)) throw Error('Choose date and electrician together');
      if(patch.assignment_date===null ? patch.assigned_electrician!==null : !((patch.assignment_date==='2026-11-26'&&patch.assigned_electrician==='Alex Symonds')||(patch.assignment_date!=='2026-11-26'&&patch.assigned_electrician==='Mason Adams'))) throw Error('Invalid date/electrician pairing');
    }
    const stale=new Date(Date.now()-MOVE_LOCK_MS).toISOString();
    const unlocked=`or=(dataforce_status.is.null,dataforce_status.neq.${encodeURIComponent(MOVE_IN_PROGRESS)},approved_at.lt.${stale})`;
    const updated=await db(`goldsure_rebooking_jobs?job_id=eq.${id}&version=eq.${version}&withdrawn_at=is.null&${unlocked}&select=*`,'PATCH',{...patch,updated_by:actor},{Prefer:'return=representation'});
    if(!updated?.length) return json(res,409,{error:'This job changed or a Dataforce move is in progress. Refresh to see the latest version.'});
    return json(res,200,{job:updated[0]});
  }catch(e){
    if(/capacity exceeded/i.test(e?.message)) return json(res,409,{error:'Capacity reached. Please choose another date/slot.'});
    if(/Existing Mason|Already synced/i.test(e?.message)) return json(res,409,{error:e.message});
    if(/Invalid|Unsupported|Choose|Enter|too long/i.test(e?.message)) return json(res,400,{error:e.message});
    return json(res,503,{error:'Save failed; please refresh and retry.'});
  }
}
