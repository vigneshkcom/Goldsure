import crypto from 'node:crypto';
import {availableDates} from '../electrician-availability/availability.js';
import {cacheRequest} from './electrician-schedule-cache.js';
import {dataforceClient} from './dataforce-availability-client.js';
function scheduleDateKey(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dataforce = text.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!dataforce) return '';
  const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(dataforce[2].toLowerCase());
  if (month < 0) return '';
  return `${dataforce[3]}-${String(month + 1).padStart(2, '0')}-${String(dataforce[1]).padStart(2, '0')}`;
}

export async function syncSchedule({env=process.env,fetchImpl=fetch,client}={}) {
  const options={env,fetchImpl},lease=crypto.randomUUID(),started=Date.now();
  const claimed=await cacheRequest('rpc/claim_electrician_schedule_sync',{
    method:'POST',body:JSON.stringify({p_token:lease})},options);
  if(!claimed.length)return {skipped:true};
  const row=claimed[0],payload=row.payload || {};
  payload.workers ||= {};
  payload.locations ||= {};
  payload.durations ||= {};
  const names=[...new Set(availableDates.flatMap(day=>day.electricians))];
  const ids={Alex:1009,Gurdip:1011,Mason:1012};
  const cursor=Number(payload.cursor || 0)%names.length,name=names[cursor];
  const path='electrician_schedule_cache?id=eq.dataforce&lease_token=eq.'+lease;
  const save=body=>cacheRequest(path,{method:'PATCH',body:JSON.stringify(body)},options);
  const api=client || dataforceClient({env,fetchImpl});
  try {
    await api.authenticate();
    const end=new Date(availableDates.at(-1).date+'T00:00:00Z');
    end.setUTCDate(end.getUTCDate()+1);
    if(!ids[name])throw new Error('Fieldworker mapping missing for '+name);
    const appointments=await api.appointments(ids[name],availableDates[0].date,end.toISOString().slice(0,10));
    payload.workers[name]={appointments:appointments.map(appointment=>({
      appointmentId:appointment.appointmentId,customerId:appointment.customerId,
      scheduledDate:appointment.scheduledDate,date:scheduleDateKey(appointment.scheduledDate),
      duration:appointment.duration || payload.durations[appointment.appointmentId]
    })),updatedAt:new Date().toISOString()};
    payload.cursor=(cursor+1)%names.length;
    // Save successful counts before enriching the route so later failures cannot discard them.
    await save({payload,updated_at:new Date().toISOString()});
    const all=Object.values(payload.workers).flatMap(worker=>worker.appointments);
    let enriched=0;
    for(const appointment of all) {
      if(Date.now()-started>30000 || enriched>=8)break;
      if(appointment.customerId && (!payload.locations[appointment.customerId] || Date.now()-Date.parse(payload.locations[appointment.customerId].fetchedAt || 0)>86400000)) {
        const customer=await api.detail('customers/id/'+appointment.customerId);
        payload.locations[appointment.customerId]={suburb:String(customer.suburb || '').trim(),postcode:String(customer.postCode || '').trim(),fetchedAt:new Date().toISOString()};
        enriched++;
      }
      if(!(Number(appointment.duration)>0) && appointment.appointmentId && Date.now()-started<30000 && enriched<8) {
        const detail=await api.detail('appointments/'+appointment.appointmentId);
        appointment.duration=detail.duration;
        payload.durations[appointment.appointmentId]=detail.duration;
        enriched++;
      }
    }
    await save({payload,lease_token:null,locked_until:null,next_attempt_at:null,failures:0,last_error:null});
    return {synced:name,enriched};
  } catch(error) {
    const failures=Number(row.failures || 0)+1;
    const delay=Math.max(error.retryMs || 0,Math.min(900000,30000*2**Math.min(failures,5)))+Math.floor(Math.random()*1000);
    payload.cursor=(cursor+1)%names.length;
    await save({payload,lease_token:null,locked_until:null,failures,last_error:error.message,
      next_attempt_at:new Date(Date.now()+delay).toISOString()});
    console.error('[Electrician schedule sync]',error.message);
    return {failed:true,retryInSeconds:Math.ceil(delay/1000)};
  }
}
