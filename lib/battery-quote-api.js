import {randomUUID,createHash} from 'node:crypto';
import {BatteryQuoteError,clean,validatePackage,quoteSnapshot,missingDocuments,publicQuote,issueSession,verifySession,taxLabels} from './battery-quote-model.js';
import {BatteryQuoteStore} from './battery-quote-store.js';
import {BatteryQuoteGhl} from './battery-quote-ghl.js';
import {batteryQuoteEmail,batteryQuotePdf} from './battery-quote-render.js';
import {hasHostingerMailConfig,sendHostingerMail} from './hostinger-mail.js';
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(value||''));
export function createBatteryQuoteHandler(deps={}){
 const store=deps.store||new BatteryQuoteStore(),ghl=deps.ghl||new BatteryQuoteGhl(),env=deps.env||process.env;
 const pdf=deps.pdf||batteryQuotePdf,mail=deps.mail||sendHostingerMail,preview=Boolean(deps.preview);
 const event=async(q,type,details={})=>store.event({id:randomUUID(),quote_id:q.id,event_type:type,details,created_at:new Date().toISOString()});
 async function syncGhl(q){
  try{const result=await ghl.sync(q,await store.settings());await store.update(q.id,{ghl_status:'synced',ghl_contact_id:result.contactId,ghl_opportunity_id:result.opportunityId,ghl_error:null});return true;}
  catch(error){await store.update(q.id,{ghl_status:'failed',ghl_error:String(error.message).slice(0,500)});return false;}
 }
 async function attachments(q){
  const missing=missingDocuments(q);if(missing.length)throw new BatteryQuoteError(`The matching ${missing.join(' and ')} PDF${missing.length>1?'s are':' is'} not configured yet. Sending is blocked until the product files are supplied.`,409);
  const result=[{filename:`${q.reference}.pdf`,content:(await pdf(q)).toString('base64'),contentType:'application/pdf'}];
  let total=0;
  for(const document of q.package_snapshot.documents){const bytes=await store.documentBytes(document);if(createHash('sha256').update(bytes).digest('hex')!==document.sha256)throw new BatteryQuoteError(`Attachment verification failed: ${document.name}. Sending stopped.`,409);total+=bytes.length;if(total>8*1024*1024)throw new BatteryQuoteError('The selected attachments exceed the 8 MB total limit.');result.push({filename:document.name,content:bytes.toString('base64'),contentType:'application/pdf'});}
  return result;
 }
 return async function batteryQuoteHandler(req,res){
  res.setHeader?.('Cache-Control','no-store');const action=req.query?.action||req.body?.action||'bootstrap';const body=req.body||{};
  try{
   if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
   if(action==='login'){
    if(req.method!=='POST')throw new BatteryQuoteError('Use POST.',405);
    return res.status(200).json(preview?{token:'local-preview',agent:clean(body.agent)||'Preview Agent',role:body.role==='staff'?'staff':'admin'}:issueSession(body,env));
   }
   if(['public','public-pdf','public-document','record-view'].includes(action)){
    const token=req.query?.token||body.token;if(!uuid(token))throw new BatteryQuoteError('Quote not found.',404);
    const q=await store.token(token);if(!q?.sent_at)throw new BatteryQuoteError('Quote not found.',404);
    if(action==='record-view'){if(req.method!=='POST')throw new BatteryQuoteError('Use POST.',405);await store.recordView(q.id);return res.status(200).json({success:true});}
    if(action==='public')return res.status(200).json({quote:publicQuote(q)});
    if(action==='public-pdf'){res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${q.reference}.pdf"`);return res.status(200).send(await pdf(q));}
    const d=q.package_snapshot.documents.find(d=>d.id===req.query.document_id);if(!d)throw new BatteryQuoteError('Document not found.',404);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${d.name.replace(/[^A-Za-z0-9_. -]/g,'_')}"`);return res.status(200).send(await store.documentBytes(d));
   }
   const session=preview?{agent:'Preview Agent',role:'admin'}:req.headers?.['x-battery-session']?verifySession(req.headers['x-battery-session'],env):{agent:'Goldsure team',role:'staff'};
   const admin=()=>{if(session.role!=='admin')throw new BatteryQuoteError('Administrator access is required for pricing and document changes.',403);};
   if(action==='ghl-search')return res.status(200).json({contacts:await ghl.search(req.query?.q||body.q)});
   if(action==='bootstrap')return res.status(200).json({session:{agent:session.agent,role:session.role},preview,packages:await store.listPackages(),documents:await store.listDocuments(),settings:await store.settings(),email_configured:preview||hasHostingerMailConfig()});
   if(action==='quotes')return res.status(200).json({quotes:await store.quotes()});
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
    const quote=await store.write('battery_quotes',{id:randomUUID(),public_token:randomUUID(),...snapshot,created_by:session.agent,created_at:new Date().toISOString(),status:'draft',send_count:0,ghl_status:'not_sent'});
    await event(quote,'created',{agent:session.agent,package_id:pkg.id,package_version:pkg.version});return res.status(200).json({quote});
   }
   if(action==='retry-ghl'){
    const q=await store.quote(body.id);if(!q?.sent_at)throw new BatteryQuoteError('This quote has not been sent.');const success=await syncGhl(q);return res.status(success?200:502).json({success,error:success?undefined:'The quote is sent, but GHL still needs attention. Check tracker details.'});
   }
   if(action==='send'){
    if(!uuid(body.id))throw new BatteryQuoteError('Invalid quote ID.');let q=await store.quote(body.id);if(!q)throw new BatteryQuoteError('Quote not found.',404);
    if(['sending','delivery_uncertain'].includes(q.status))throw new BatteryQuoteError('Delivery needs verification before another send. Ask an administrator to check the provider.',409);
    if(q.status==='sent'&&body.confirm_resend!==true)throw new BatteryQuoteError('Confirm resending this saved quotation.',409);
    if(!preview&&!hasHostingerMailConfig())throw new BatteryQuoteError('Configure HOSTINGER_MAIL_API_TOKEN and HOSTINGER_MAILBOX_RESOURCE_ID before sending.',503);
    const files=await attachments(q);await ghl.preflight(await store.settings());
    const attempt=randomUUID();const claimed=await store.update(q.id,{status:'sending',send_attempt:attempt,last_error:null},{status:q.status,send_count:q.send_count});if(!claimed)throw new BatteryQuoteError('Another send is in progress. Refresh the tracker.',409);q=claimed;
    await event(q,'send_started',{attempt,agent:session.agent,recipient:q.customer.email,attachments:files.map(a=>a.filename)});
    try{await mail({to:[q.customer.email],displayName:'Goldsure Quotes',subject:`Your Goldsure Battery Quote - ${q.reference}`,html:batteryQuoteEmail(q,env.SITE_URL),attachments:files});}
    catch(error){const knownFailure=Number.isInteger(error.status);const status=knownFailure?'send_failed':'delivery_uncertain';await store.update(q.id,{status,last_error:knownFailure?'Email provider rejected the request.':'The provider response was interrupted. Verify delivery before resending.'},{send_attempt:attempt});await event(q,status,{attempt,provider_status:error.status||null});throw new BatteryQuoteError(knownFailure?'The email provider rejected this send. No sent confirmation was recorded.':'Delivery is uncertain. Check the email provider before retrying.',502);}
    const sentAt=new Date().toISOString();let saved=null;
    for(let i=0;i<3&&!saved;i++){try{saved=await store.update(q.id,{status:'sent',sent_at:sentAt,send_count:q.send_count+1,ghl_status:q.ghl_status==='synced'?'synced':'pending',last_error:null},{send_attempt:attempt});}catch{}}
    if(!saved)throw new BatteryQuoteError('The email provider confirmed sending, but the tracker could not be updated. Do not resend; verify delivery with an administrator.',502);
    await event(saved,preview?'preview_sent':'sent',{attempt,recipient:q.customer.email,attachment_names:files.map(f=>f.filename)});
    const synced=await syncGhl(saved);return res.status(200).json({success:true,preview,ghl_synced:synced,quote:await store.quote(q.id)});
   }
   if(action==='resolve-delivery'){
    admin();if(!['confirmed_sent','confirmed_not_sent'].includes(body.resolution)||clean(body.evidence).length<10)throw new BatteryQuoteError('Record the email-provider evidence and confirmed delivery outcome.');const q=await store.quote(body.id);if(!q||!['sending','delivery_uncertain'].includes(q.status))throw new BatteryQuoteError('This quote does not need delivery resolution.');const sent=body.resolution==='confirmed_sent';await event(q,'delivery_verified',{resolution:body.resolution,evidence:clean(body.evidence).slice(0,2000),agent:session.agent});const updated=await store.update(q.id,{status:sent?'sent':'send_failed',...(sent?{sent_at:new Date().toISOString(),send_count:q.send_count+1,ghl_status:'pending'}:{}),last_error:null},{status:q.status});if(!updated)throw new BatteryQuoteError('The status changed. Refresh first.',409);if(sent)await syncGhl(updated);return res.status(200).json({success:true});
   }
   throw new BatteryQuoteError('Unknown battery quote action.');
  }catch(error){console.error('[Battery quotations]',error.message);return res.status(error.status||500).json({error:error instanceof BatteryQuoteError?error.message:'Battery quote service encountered an error. Refresh the tracker before retrying.'});}
 };
}
export default createBatteryQuoteHandler();
