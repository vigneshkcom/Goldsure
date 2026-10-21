import {BatteryQuoteError} from './battery-quote-model.js';
export class BatteryQuoteGhl {
 constructor(env=process.env,fetchImpl=fetch){this.env=env;this.fetch=fetchImpl;}
 async call(path,options={}){if(!this.env.GHL_API_KEY||!this.env.GHL_LOCATION_ID)throw new BatteryQuoteError('GHL access is not configured.',503);const r=await this.fetch('https://services.leadconnectorhq.com'+path,{...options,headers:{Authorization:`Bearer ${this.env.GHL_API_KEY}`,Version:'2021-07-28','Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new BatteryQuoteError(`GHL could not complete this step (${r.status}). Retry GHL sync from the tracker.`,502);return r.json();}
 async search(query){
  const q=String(query||'').trim();if(q.length<2)return [];if(q.length>120)throw new BatteryQuoteError('Search by a shorter name, phone or email.');
  const data=await this.call(`/contacts/?locationId=${encodeURIComponent(this.env.GHL_LOCATION_ID)}&query=${encodeURIComponent(q)}&limit=30`);
  return (data.contacts||[]).map(c=>({id:c.id,name:c.name||[c.firstName,c.lastName].filter(Boolean).join(' '),email:c.email||'',phone:c.phone||'',address:[c.address1,c.city,c.state,c.postalCode].filter(Boolean).join(', ')}));
 }
 async preflight(settings){const data=await this.call(`/opportunities/pipelines?locationId=${encodeURIComponent(this.env.GHL_LOCATION_ID)}`);const pipe=(data.pipelines||[]).find(p=>p.id===settings.pipeline_id);const stage=pipe?.stages.find(s=>s.id===settings.stage_id);if(!pipe||!stage||pipe.name!==settings.pipeline_name||stage.name!==settings.stage_name)throw new BatteryQuoteError('The configured Battery pipeline or New Lead stage changed. An administrator must review the settings.',409);return true;}
 async sync(q,settings){
  await this.preflight(settings);
  const customer=q.customer,phone=customer.phone.replace(/\D/g,'').slice(-9),email=customer.email.toLowerCase();const matches=new Map();
  for(const search of [customer.phone,customer.email]){const data=await this.call(`/contacts/?locationId=${encodeURIComponent(this.env.GHL_LOCATION_ID)}&query=${encodeURIComponent(search)}&limit=100`);for(const c of data.contacts||[]){if(String(c.phone||'').replace(/\D/g,'').slice(-9)===phone||String(c.email||'').toLowerCase()===email)matches.set(c.id,c);}}
  if(matches.size>1)throw new BatteryQuoteError('Multiple GHL contacts match this customer. Review them before retrying GHL sync.',409);
  let contactId=[...matches.keys()][0];
  if(!contactId){const [firstName,...names]=customer.name.split(/\s+/);const created=await this.call('/contacts/',{method:'POST',body:JSON.stringify({locationId:this.env.GHL_LOCATION_ID,firstName,lastName:names.join(' '),phone:customer.phone,email:customer.email,address1:customer.address,source:'Direct Call'})});contactId=created.contact?.id||created.id;}
  if(!contactId)throw new BatteryQuoteError('GHL did not confirm a customer contact.',502);

  const name=`${customer.name} - Direct Call | ${q.reference}`;
  const search=await this.call(`/opportunities/search?location_id=${encodeURIComponent(this.env.GHL_LOCATION_ID)}&contact_id=${encodeURIComponent(contactId)}&limit=100`);
  const match=(search.opportunities||[]).find(o=>(o.pipelineId||o.pipeline_id)===settings.pipeline_id&&o.name===name);
  let opportunityId=q.ghl_opportunity_id||match?.id;
  if(!opportunityId){const result=await this.call('/opportunities/',{method:'POST',body:JSON.stringify({pipelineId:settings.pipeline_id,pipelineStageId:settings.stage_id,locationId:this.env.GHL_LOCATION_ID,contactId,name,status:'open',source:'Direct Call',monetaryValue:q.package_snapshot.oop})});opportunityId=result.opportunity?.id||result.id;}
  if(!opportunityId)throw new BatteryQuoteError('GHL did not confirm the Battery lead.',502);
  const base=(this.env.SITE_URL||'https://portal.goldsure.com.au').replace(/\/$/,'');
  const prefix=`Battery quotation [${q.reference}]`;
  const existingNotes=await this.call(`/contacts/${encodeURIComponent(contactId)}/notes`);
  if(!(existingNotes.notes||[]).some(note=>String(note.body||'').startsWith(prefix))){
    const p=q.package_snapshot;
    const body=[prefix,`Source: Direct Call`,`System: ${p.capacity_kwh}kWh ${p.battery_name} + ${p.inverter_kw}kW ${p.inverter_brand}`,`Out-of-pocket: $${Number(p.oop).toFixed(2)}`,`STCs: ${p.stcs}`,`View quote: ${base}/Battery/quote.html?token=${q.public_token}`,
      ...p.documents.map(d=>`${d.name}: ${base}/api/battery/request-callback?module=quotes&action=public-document&token=${q.public_token}&document_id=${d.id}`)].join('\n');
    await this.call(`/contacts/${encodeURIComponent(contactId)}/notes`,{method:'POST',body:JSON.stringify({body})});
  }
  return {contactId,opportunityId};
 }
}
