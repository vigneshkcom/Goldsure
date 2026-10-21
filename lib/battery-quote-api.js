import {expiresAt,responseState,acceptanceOf} from '../Battery/quotes/lifecycle.js';
import {sendBatteryQuoteSms} from './battery-quote-sms.js';
import {randomUUID,createHash} from 'node:crypto';
import {BatteryQuoteError,clean,validatePackage,quoteSnapshot,missingDocuments,publicQuote,issueSession,verifySession,taxLabels} from './battery-quote-model.js';
import {BatteryQuoteStore} from './battery-quote-store.js';
import {BatteryQuoteGhl} from './battery-quote-ghl.js';
import {batteryQuoteEmail,batteryQuotePdf,batteryAcceptanceEmail} from './battery-quote-render.js';
import {hasHostingerMailConfig,sendHostingerMail} from './hostinger-mail.js';
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value||''));
export function createBatteryQuoteHandler(deps={}){
 const preview=Boolean(deps.preview);if(preview&&!deps.store)throw new Error('Preview requires an explicitly isolated store.');
 const store=deps.store||new BatteryQuoteStore(),ghl=deps.ghl||(preview?{async preflight(){},async sync(){return {contactId:null,opportunityId:null}},async search(){return []}}:new BatteryQuoteGhl()),env=deps.env||process.env;
 const pdf=deps.pdf||batteryQuotePdf,mail=deps.mail||(preview?async()=>({preview:true}):sendHostingerMail);
 const event=async(q,type,details={})=>store.event({id:randomUUID(),quote_id:q.id,event_type:type,details,created_at:new Date().toISOString()});
 async function syncGhl(q){
  let current=await store.quote(q.id);if(current.ghl_status==='synced'&&current.ghl_synced_target===current.ghl_target_stage)return true;
  const token=randomUUID(),now=new Date().toISOString();
  if(current.ghl_sync_token&&Date.now()-Date.parse(current.ghl_sync_started_at||now)<120000)return false;
  const claimed=await store.update(q.id,{ghl_sync_token:token,ghl_sync_started_at:now,ghl_status:'syncing'},{ghl_sync_token:current.ghl_sync_token||null});if(!claimed)return false;
  try{for(let pass=0;pass<3;pass++){
   current=await store.quote(q.id);const target=current.ghl_target_stage||'proposal_sent';const result=await ghl.sync(current,await store.settings());
   const saved=await store.update(q.id,{ghl_status:'synced',ghl_synced_target:target,ghl_contact_id:result.contactId,ghl_opportunity_id:result.opportunityId,ghl_error:null,ghl_sync_token:null},{ghl_sync_token:token,ghl_target_stage:target});if(saved)return true;
   // Acceptance may have changed the desired stage during the external request.
   await store.update(q.id,{ghl_contact_id:result.contactId,ghl_opportunity_id:result.opportunityId},{ghl_sync_token:token});
  }await store.update(q.id,{ghl_status:'pending',ghl_sync_token:null},{ghl_sync_token:token});return false;}
  catch(error){await store.update(q.id,{ghl_status:'failed',ghl_error:String(error.message).slice(0,500),ghl_sync_token:null},{ghl_sync_token:token});return false;}
 }
 async function notifyAcceptance(q,retry=false){
  const accepted=acceptanceOf(q);if(!accepted)return {status:'not_accepted'};const status=q.acceptance_email_status||'not_sent';
  if(['sent','sending','uncertain'].includes(status)||status==='failed'&&!retry)return {status};
  const attempt=randomUUID();const claimed=await store.update(q.id,{acceptance_email_status:'sending',acceptance_email_attempt:attempt,acceptance_email_error:null},{acceptance_email_status:status});if(!claimed)return {status:'in_progress'};
  try{const note=batteryAcceptanceEmail(q,accepted,env.SITE_URL||'https://portal.goldsure.com.au');await mail({to:['info@goldsure.com.au'],displayName:'Goldsure Quotes',subject:note.subject,html:note.html,text:note.text,attachments:[]});
   const saved=await store.update(q.id,{acceptance_email_status:'sent',acceptance_email_error:null},{acceptance_email_attempt:attempt});await event(q,preview?'preview_acceptance_email':'acceptance_email_sent',{recipient:'info@goldsure.com.au'});return {status:saved?'sent':'sending'};
  }catch(error){const status=Number.isInteger(error.status)?'failed':'uncertain';await store.update(q.id,{acceptance_email_status:status,acceptance_email_error:status==='failed'?'Notification provider rejected the email.':'Notification delivery is uncertain. Check the mailbox before retrying.'},{acceptance_email_attempt:attempt});return {status};}
 }
 async function acceptanceEffects(q,retry=false){const synced=await syncGhl(q);const email=await notifyAcceptance(await store.quote(q.id),retry);return {ghl_synced:synced,notification:email};}
 return async function batteryQuoteHandler(req,res){
  res.setHeader?.('Cache-Control','no-store');const action=req.query?.action||req.body?.action||'bootstrap';const body=req.body||{};
  try{
   if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
   if(action==='login'){
    if(req.method!=='POST')throw new BatteryQuoteError('Use POST.',405);
    return res.status(200).json(preview?{token:'local-preview',agent:clean(body.agent)||'Preview Agent',role:body.role==='staff'?'staff':'admin'}:issueSession(body,env));
   }
   if(['public','public-pdf','public-document','record-view','accept'].includes(action)){
    const token=req.query?.token||body.token;if(!uuid(token))throw new BatteryQuoteError('Quote not found.',404);
    const q=await store.token(token);if(!q?.sent_at)throw new BatteryQuoteError('Quote not found.',404);
    if(action==='accept'){if(req.method!=='POST')throw new BatteryQuoteError('Use POST.',405);const signer=clean(q.customer.name);if(signer.length<2||signer.length>150||/[\x00-\x1f]/.test(signer)||body.consent!==true)throw new BatteryQuoteError('Confirm that you accept this quotation.');if(clean(q.customer.address).length<8){const address=clean(body.address);if(address.length<8||address.length>400||/[\x00-\x1f]/.test(address))throw new BatteryQuoteError('Enter your full installation address to accept this quotation.');await store.update(q.id,{customer:{...q.customer,address}});}const result=await store.accept(token,signer);let effects;try{effects=await acceptanceEffects(await store.quote(q.id));}catch{effects={ghl_synced:false,notification:{status:'needs_attention'}};}return res.status(200).json({...result,preview});}
    if(action==='record-view'){if(req.method!=='POST')throw new BatteryQuoteError('Use POST.',405);await store.recordView(q.id);return res.status(200).json({success:true});}
    if(action==='public')return res.status(200).json({quote:publicQuote(q),preview});
    if(action==='public-pdf')throw new BatteryQuoteError('Customer quotation download is unavailable.',404);
    const d=q.package_snapshot.documents.find(d=>d.id===req.query.document_id);if(!d)throw new BatteryQuoteError('Document not found.',404);const bytes=await store.documentBytes(d);if(createHash('sha256').update(bytes).digest('hex')!==d.sha256)throw new BatteryQuoteError('Product document verification failed.',409);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${d.name.replace(/[^A-Za-z0-9_. -]/g,'_')}"`);res.setHeader('X-Content-Type-Options','nosniff');return res.status(200).send(bytes);
   }
   const session=preview?{agent:'Preview Agent',role:'admin'}:req.headers?.['x-battery-session']?verifySession(req.headers['x-battery-session'],env):{agent:'Goldsure team',role:'staff'};
   const admin=()=>{if(session.role!=='admin')throw new BatteryQuoteError('Administrator access is required for pricing and document changes.',403);};
   if(action==='ghl-search')return res.status(200).json({contacts:await ghl.search(req.query?.q||body.q)});
   if(action==='bootstrap')return res.status(200).json({session:{agent:session.agent,role:session.role},preview,packages:await store.listPackages(),documents:await store.listDocuments(),settings:await store.settings(),email_configured:preview||hasHostingerMailConfig()});
   if(action==='quotes')return res.status(200).json({quotes:(await store.quotes()).map(({public_token,internal_notes,...quote})=>quote)});
   if(action==='quote'||action==='pdf'||action==='email-preview'||action==='events'){
    const id=req.query?.id||body.id;if(!uuid(id))throw new BatteryQuoteError('Invalid quote ID.');const q=await store.quote(id);if(!q)throw new BatteryQuoteError('Quote not found.',404);
    if(action==='quote')return res.status(200).json({quote:q});
    if(action==='events')return res.status(200).json({events:await store.events(q.id)});
    if(action==='email-preview')return res.status(200).json({html:batteryQuoteEmail(q,env.SITE_URL)});
    res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${q.reference}.pdf"`);return res.status(200).send(await pdf(q));
   }
   if(req.method!=='POST')throw new BatteryQuoteError('Use POST for changes.',405);
   if(action==='save-package'){
    admin();const packages=await store.listPackages(),existing=packages.find(p=>p.id===body.package?.id);if(existing&&Number(body.version)!==existing.version)throw new BatteryQuoteError('Refresh this package before saving.',409);
    const value=validatePackage(body.package);const docs=await store.listDocuments();if(value.document_ids.some(id=>!docs.some(d=>d.id===id)))throw new BatteryQuoteError('Select existing uploaded documents.');
    return res.status(200).json({package:await store.savePackage(value,existing?existing.version:undefined)});
   }
   if(action==='save-settings'){
    admin();if(!Object.hasOwn(taxLabels,body.tax_treatment))throw new BatteryQuoteError('Choose a valid tax setting.');const settings=await store.settings();return res.status(200).json({settings:await store.write('battery_quote_settings',{...settings,tax_treatment:body.tax_treatment},{upsert:true})});
   }
   if(action==='upload-document'){
    admin();if(!['battery','inverter','general'].includes(body.kind))throw new BatteryQuoteError('Select the document type.');const name=clean(body.name).replace(/[^\p{L}\p{N}_. -]/gu,'_').slice(0,150);if(!name.toLowerCase().endsWith('.pdf'))throw new BatteryQuoteError('Upload a PDF document.');const bytes=Buffer.from(String(body.content||''),'base64');if(bytes.length<10||bytes.length>3*1024*1024||!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))throw new BatteryQuoteError('Upload a valid PDF no larger than 3 MB.');const id=randomUUID();return res.status(200).json({document:await store.upload({id,name,kind:body.kind,object_path:`documents/${id}.pdf`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,created_at:new Date().toISOString()},bytes)});
   }
   if(action==='create-quote'){
    const pkg=(await store.listPackages()).find(p=>p.id===body.package_id);if(!pkg)throw new BatteryQuoteError('Select an available package.');const snapshot=quoteSnapshot(pkg,body.customer,await store.settings(),await store.listDocuments(),body);
    const quote=await store.write('battery_quotes',{id:randomUUID(),public_token:randomUUID(),...snapshot,created_by:session.agent,created_at:new Date().toISOString(),status:'draft',send_count:0,ghl_status:'not_sent',ghl_target_stage:'proposal_sent',ghl_synced_target:null,ghl_sync_token:null,acceptance_email_status:'not_sent'});
    await event(quote,'created',{agent:session.agent,package_id:pkg.id,package_version:pkg.version});return res.status(200).json({quote});
   }
   if(action==='retry-acceptance'){const q=await store.quote(body.id);if(!q||!acceptanceOf(q))throw new BatteryQuoteError('This quote has not been accepted.');return res.status(200).json(await acceptanceEffects(q,true));}
   if(action==='retry-ghl'){
    const q=await store.quote(body.id);if(!q?.sent_at)throw new BatteryQuoteError('This quote has not been sent.');const success=await syncGhl(q);return res.status(success?200:502).json({success,error:success?undefined:'The quote is sent, but GHL still needs attention. Check tracker details.'});
   }
   if(action==='send'){
    if(!uuid(body.id))throw new BatteryQuoteError('Invalid quote ID.');let q=await store.quote(body.id);if(!q)throw new BatteryQuoteError('Quote not found.',404);
    if(['sending','delivery_uncertain'].includes(q.status))throw new BatteryQuoteError('Delivery needs verification before another send. Ask an administrator to check the provider.',409);
    if(q.status==='sent'&&body.confirm_resend!==true)throw new BatteryQuoteError('Confirm resending this saved quotation.',409);
    if(!preview&&!hasHostingerMailConfig())throw new BatteryQuoteError('Configure HOSTINGER_MAIL_API_TOKEN and HOSTINGER_MAILBOX_RESOURCE_ID before sending.',503);
    if(responseState(q)==='expired')throw new BatteryQuoteError('This quote has expired. Create a new quote instead of resending.',409);const missing=missingDocuments(q);if(missing.length)throw new BatteryQuoteError('The matching '+missing.join(' and ')+' product documents are not configured yet.',409);await ghl.preflight(await store.settings());
    const attempt=randomUUID();const claimed=await store.update(q.id,{status:'sending',send_attempt:attempt,last_error:null},{status:q.status,send_count:q.send_count});if(!claimed)throw new BatteryQuoteError('Another send is in progress. Refresh the tracker.',409);q=claimed;
    await event(q,'send_started',{attempt,agent:session.agent,recipient:q.customer.email,attachments:[]});
    try{await mail({to:[q.customer.email],displayName:'Goldsure Quotes',subject:`Your Goldsure battery quotation: ${q.package_snapshot.capacity_kwh}kWh ${q.package_snapshot.battery_name} + ${q.package_snapshot.inverter_kw}kW ${q.package_snapshot.inverter_brand} (${q.reference})`,html:batteryQuoteEmail(q,env.SITE_URL),attachments:[]});}
    catch(error){const knownFailure=Number.isInteger(error.status);const status=knownFailure?'send_failed':'delivery_uncertain';await store.update(q.id,{status,last_error:knownFailure?'Email provider rejected the request.':'The provider response was interrupted. Verify delivery before resending.'},{send_attempt:attempt});await event(q,status,{attempt,provider_status:error.status||null});throw new BatteryQuoteError(knownFailure?'The email provider rejected this send. No sent confirmation was recorded.':'Delivery is uncertain. Check the email provider before retrying.',502);}
    const sentAt=q.first_sent_at||q.sent_at||new Date().toISOString();let saved=null;
    for(let i=0;i<3&&!saved;i++){try{saved=await store.update(q.id,{status:'sent',sent_at:sentAt,first_sent_at:sentAt,expires_at:q.expires_at||expiresAt(sentAt),send_count:q.send_count+1,ghl_status:q.ghl_status==='synced'?'synced':'pending',last_error:null},{send_attempt:attempt});}catch{}}
    if(!saved)throw new BatteryQuoteError('The email provider confirmed sending, but the tracker could not be updated. Do not resend; verify delivery with an administrator.',502);
    await event(saved,preview?'preview_sent':'sent',{attempt,recipient:q.customer.email,attachment_names:[],first_sent_at:sentAt});
    let sms={status:'skipped',reason:'SMS not selected.'};if(body.send_sms!==false){try{sms=preview?{status:'preview'}:await (deps.sms||sendBatteryQuoteSms)(saved,env);}catch{sms={status:'uncertain',reason:'SMS result could not be confirmed.'};}try{await event(saved,'sms_'+sms.status,{attempt,...sms});}catch{}}const synced=await syncGhl(saved);return res.status(200).json({success:true,preview,sms,ghl_synced:synced,quote:await store.quote(q.id)});
   }
   if(action==='resolve-delivery'){
    admin();if(!['confirmed_sent','confirmed_not_sent'].includes(body.resolution)||clean(body.evidence).length<10)throw new BatteryQuoteError('Record the email-provider evidence and confirmed delivery outcome.');const q=await store.quote(body.id);if(!q||!['sending','delivery_uncertain'].includes(q.status))throw new BatteryQuoteError('This quote does not need delivery resolution.');const sent=body.resolution==='confirmed_sent';const verifiedAt=q.first_sent_at||q.sent_at||body.confirmed_sent_at;if(sent&&(!verifiedAt||!Number.isFinite(Date.parse(verifiedAt))||Date.parse(verifiedAt)>Date.now()||Date.parse(verifiedAt)<Date.parse(q.created_at)))throw new BatteryQuoteError('Record the original provider-confirmed send timestamp.');await event(q,'delivery_verified',{resolution:body.resolution,evidence:clean(body.evidence).slice(0,2000),agent:session.agent});const updated=await store.update(q.id,{status:sent?'sent':'send_failed',...(sent?{sent_at:verifiedAt,first_sent_at:verifiedAt,expires_at:q.expires_at||expiresAt(verifiedAt),send_count:q.send_count+1,ghl_status:'pending'}:{}),last_error:null},{status:q.status});if(!updated)throw new BatteryQuoteError('The status changed. Refresh first.',409);if(sent)await syncGhl(updated);return res.status(200).json({success:true});
   }
   throw new BatteryQuoteError('Unknown battery quote action.');
  }catch(error){console.error('[Battery quotations]',error.message);return res.status(error.status||500).json({error:error instanceof BatteryQuoteError?error.message:'Battery quote service encountered an error. Refresh the tracker before retrying.'});}
 };
}
export default createBatteryQuoteHandler();
