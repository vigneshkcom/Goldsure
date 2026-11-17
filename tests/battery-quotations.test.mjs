import {responseState,expiresAt,CONSENT_VERSION} from '../Battery/quotes/lifecycle.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';
import {validatePackage,quoteSnapshot,publicQuote,issueSession,verifySession} from '../lib/battery-quote-model.js';
import {createBatteryQuoteHandler} from '../lib/battery-quote-api.js';
import {batteryQuotePdf,batteryQuoteEmail} from '../lib/battery-quote-render.js';
import {BatteryQuoteGhl} from '../lib/battery-quote-ghl.js';
import {bundledDocuments,attachBundledDocuments} from '../lib/battery-quote-documents.js';
const seeds=JSON.parse(await readFile(new URL('../Battery/quotes/seed.json',import.meta.url)));
const manifest=JSON.parse(await readFile(new URL('../Battery/quotes/documents.json',import.meta.url)));
const customer={name:'Preview Customer',email:'preview@example.com',phone:'0412345678',address:'123 Preview Street, Melbourne VIC 3000'};
const settings={id:'default',tax_treatment:'unspecified',pipeline_id:'battery-pipeline',pipeline_name:'Battery Customers',stage_id:'new-lead',stage_name:'New Lead',proposal_stage_id:'proposal-sent',proposal_stage_name:'Proposal Sent',accepted_stage_id:'quote-accepted',accepted_stage_name:'Quote Accepted'};
const bytes=Buffer.from('%PDF-1.4\npreview fixture document\n%%EOF');
const docs=['battery','inverter'].map((kind,i)=>({id:randomUUID(),name:kind+'-preview.pdf',kind,object_path:'test/'+i+'.pdf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
function memory(){const data={packages:structuredClone(seeds),documents:structuredClone(docs),quotes:[],events:[],settings:structuredClone(settings)};data.packages[0].document_ids=docs.map(d=>d.id);return {data,
 async listPackages(){return structuredClone(data.packages)},async listDocuments(){return structuredClone(data.documents)},async settings(){return structuredClone(data.settings)},async quotes(){return structuredClone(data.quotes)},async quote(id){return structuredClone(data.quotes.find(q=>q.id===id))},async token(token){return structuredClone(data.quotes.find(q=>q.public_token===token))},
 async write(table,row){if(table==='battery_quotes'){row={...row,reference:'BAT-TEST-'+(data.quotes.length+1)};data.quotes.push(structuredClone(row))}return structuredClone(row)},
 async accept(token,signer){const q=data.quotes.find(q=>q.public_token===token);if(!q)throw Object.assign(Error('Quote not found.'),{status:404});if(q.acceptance)return {acceptance:q.acceptance,already_accepted:true};if(q.status!=='sent'||responseState(q)==='expired')throw Object.assign(Error('Quote is unavailable or expired.'),{status:409});q.ghl_target_stage='accepted';q.acceptance={signer_name:signer,accepted_at:new Date().toISOString(),consent_version:CONSENT_VERSION};data.events.push({quote_id:q.id,event_type:'accepted'});return {acceptance:q.acceptance,already_accepted:false};},
 async update(id,patch,guard={}){const q=data.quotes.find(q=>q.id===id);if(!q||Object.entries(guard).some(([k,v])=>(q[k]??null)!==v))return null;Object.assign(q,patch);return structuredClone(q)},async event(e){data.events.push(e);return e},async events(id){return data.events.filter(e=>e.quote_id===id)},async documentBytes(){return bytes},async recordView(){},async savePackage(p,version){const index=data.packages.findIndex(p2=>p2.id===p.id);data.packages[index]={...p,version:version+1};return data.packages[index]}
};}
function harness({mailError,ghlError,preview=true}={}){const store=memory(),emails=[],crm=[];const handler=createBatteryQuoteHandler({store,preview,env:{BATTERY_QUOTES_STAFF_PASSWORD:'staff',DASHBOARD_PASSWORD:'admin',SUPABASE_SERVICE_ROLE_KEY:'test-secret'},pdf:async()=>Buffer.from('%PDF-test'),mail:async payload=>{emails.push(payload);if(mailError)throw mailError},ghl:{async preflight(){return true},async sync(q){crm.push(q);if(ghlError)throw Error('GHL unavailable');return {contactId:'contact',opportunityId:'opportunity'}}}});return {store,emails,crm,handler};}
async function call(h,action,body={},headers={}){const res={statusCode:200,setHeader(){},status(c){this.statusCode=c;return this},json(data){this.body=data;return this},send(data){this.body=data;return this}};await h.handler({method:'POST',query:{action},headers,body},res);return res;}
async function draft(h,package_id='BAT-001'){const r=await call(h,'create-quote',{package_id,customer,internal_notes:'INTERNAL SECRET',customer_notes:'Confirmed customer note'});assert.equal(r.statusCode,200);return r.body.quote;}
test('the exact supplied packages are preloaded as data',()=>{assert.deepEqual(seeds.map(p=>[p.id,p.oop,p.stcs]),[['BAT-001',6100,115],['BAT-002',6700,115],['BAT-003',7500,154],['BAT-004',7900,154],['BAT-005',9999,160],['BAT-006',0,146],['BAT-007',5429,114],['BAT-008',6129,114],['BAT-009',7649,151],['BAT-010',7669,151],['BAT-011',5349,99],['BAT-012',6485,134],['BAT-013',8085,146],['BAT-014',8095,146]]);});

test('AlphaESS remains available for historical quotes but is excluded from active package choices',()=>{
 const alpha=seeds.find(p=>p.id==='BAT-006');
 assert.ok(alpha);assert.equal(alpha.active,false);
 assert.equal(seeds.filter(p=>p.active).some(p=>p.id==='BAT-006'),false);
});

test('AlphaESS uses the requested 28kWh marketing labels without changing the technical configuration',async()=>{
 const {batteryPackageName,batteryPackageSubtitle}=await import('../Battery/quotes/pricing.js');
 const p=seeds.find(p=>p.id==='BAT-006');
 assert.equal(batteryPackageName(p),'Alpha ESS 28kWh Battery');
 assert.equal(batteryPackageSubtitle(p),'10kW Alpha ESS · Single Phase');
 assert.equal(p.capacity_kwh,27.98);assert.equal(p.inverter_kw,10);assert.equal(p.stcs,146);assert.equal(p.oop,0);
 assert.equal(p.inverter_brand,'Alpha ESS SMILE-M10-S-INV');
});
test('FoxESS packages match the four supplied EQ4800 and CQ7 configurations',async()=>{
 const {batteryPackageName,batteryPackageSubtitle}=await import('../Battery/quotes/pricing.js');
 const expected=[
  ['BAT-007','FoxESS 18.64kWh Battery','5kW FoxESS H1-G2 · Single Phase','EQ4800',4,18.64,'H1-5.0-E-G2',5,'Single Phase',100,114],
  ['BAT-008','FoxESS 18.64kWh Battery','10kW FoxESS KH10 · Single Phase','EQ4800',4,18.64,'KH10',10,'Single Phase',100,114],
  ['BAT-009','FoxESS 27.84kWh Battery','10kW FoxESS KH10 · Single Phase','CQ7',4,27.84,'KH10',10,'Single Phase',100,151],
  ['BAT-010','FoxESS 27.84kWh Battery','9.9kW FoxESS H3 Smart · Three Phase','CQ7',4,27.84,'H3-9.9-Smart',9.9,'Three Phase',100,151]
 ];
 for(const [id,name,subtitle,model,quantity,capacity,inverterModel,inverterKw,phase,dod,stcs] of expected){
  const p=seeds.find(p=>p.id===id);
  assert.equal(batteryPackageName(p),name);assert.equal(batteryPackageSubtitle(p),subtitle);
  assert.deepEqual([p.battery_manufacturer,p.battery_model,p.battery_quantity,p.capacity_kwh],['FoxESS',model,quantity,capacity]);
  assert.deepEqual([p.inverter_manufacturer,p.inverter_model,p.inverter_kw,p.phase],['FoxESS',inverterModel,inverterKw,phase]);
  assert.deepEqual([p.battery_chemistry,p.depth_of_discharge,p.ip_rating,p.oop,p.stcs],['LiFePO4',dod,'IP65',{ 'BAT-007':5429,'BAT-008':6129,'BAT-009':7649,'BAT-010':7669 }[id],stcs]);
 }
});
test('FoxESS PDFs match the manifest and each package receives its matching three documents',async()=>{
 const fox=manifest.filter(d=>d.path.includes('/foxess/'));
 assert.deepEqual(fox.map(d=>d.kind).sort(),['battery','battery','general','inverter','inverter','inverter']);
 for(const document of fox){
  const file=await readFile(new URL('..'+document.path,import.meta.url));
  assert.equal(file.length,document.bytes);assert.equal(createHash('sha256').update(file).digest('hex'),document.sha256);
 }
 for(const id of ['BAT-007','BAT-008','BAT-009','BAT-010'])assert.deepEqual(fox.filter(d=>d.package_ids.includes(id)).map(d=>d.kind).sort(),['battery','general','inverter']);
});
test('FoxESS quotations snapshot all three documents and expose individual email and customer PDF links',async()=>{
 const h=harness(),pkg=h.store.data.packages.find(p=>p.id==='BAT-007');
 const foxDocs=['battery','inverter','general'].map((kind,index)=>({...docs[0],id:randomUUID(),kind,name:['FoxESS EQ4800 Battery Datasheet.pdf','FoxESS H1-G2 Inverter Datasheet.pdf','FoxESS Australian Warranty Terms.pdf'][index]}));
 h.store.data.documents.push(...foxDocs);pkg.document_ids=foxDocs.map(d=>d.id);
 const q=await draft(h,'BAT-007');assert.equal(q.package_snapshot.documents.length,3);assert.equal(q.package_snapshot.oop,5429);assert.equal(q.package_snapshot.stcs,114);
 assert.equal((await call(h,'send',{id:q.id})).statusCode,200);const html=h.emails[0].html;
 for(const label of ['FoxESS 18.64kWh Battery','5kW FoxESS H1-G2','FoxESS Battery Datasheet','FoxESS Inverter Datasheet','FoxESS Warranty Terms'])assert.match(html,new RegExp(label));
 assert.equal((html.match(/action=public-document/g)||[]).length,3);assert.equal((await call(h,'public-pdf',{token:q.public_token})).statusCode,200);
 pkg.oop=9999;pkg.document_ids=[];const saved=await h.store.quote(q.id);assert.equal(saved.package_snapshot.oop,5429);assert.equal(saved.package_snapshot.documents.length,3);
});
test('FoxESS generated quotation PDF shows the package, inverter, STCs and three document links',async()=>{
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pkg=structuredClone(seeds.find(p=>p.id==='BAT-010'));
 const foxDocs=['battery','inverter','general'].map((kind,index)=>({...docs[0],id:randomUUID(),kind,name:['FoxESS CQ7 Battery Datasheet.pdf','FoxESS H3 Smart Inverter Datasheet.pdf','FoxESS Australian Warranty Terms.pdf'][index]}));
 pkg.document_ids=foxDocs.map(d=>d.id);const snapshot=quoteSnapshot(pkg,customer,settings,foxDocs);
 const pdfBytes=await batteryQuotePdf({id:randomUUID(),public_token:randomUUID(),reference:'BAT-FOX-PDF',created_at:new Date().toISOString(),...snapshot});
 const task=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true});const pdf=await task.promise;let text='';for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){const page=await pdf.getPage(pageNumber);text+=(await page.getTextContent()).items.map(item=>item.str).join(' ');}
 for(const value of ['FoxESS 27.84kWh Battery','9.9kW FoxESS H3 Smart','151 certificates','FoxESS Battery Datasheet','FoxESS Inverter Datasheet','FoxESS Warranty Terms'])assert.match(text,new RegExp(value));await task.destroy();
});
test('GoodWe ESA packages use the supplied prices and correct single/three phase configurations',async()=>{
 const {batteryPackageName,batteryPackageSubtitle}=await import('../Battery/quotes/pricing.js');
 const expected=[
  ['BAT-011','GoodWe ESA 15kWh Battery','5kW GoodWe ESA · Single Phase','GW5.1-BAT-D-G20',3,15,'GW5K-EHA-G20',5,'Single Phase',5349,99],
  ['BAT-012','GoodWe ESA 23kWh Battery','10kW GoodWe ESA · Single Phase','GW6.0-BAT-D-G20',4,23.6,'GW9.999K-EHA-G20',9.999,'Single Phase',6485,134],
  ['BAT-013','GoodWe ESA 27kWh Battery','9.99kW GoodWe ESA · Single Phase','GW9.0-BAT-D-G20',3,26.55,'GW9.999K-EHA-G20',9.999,'Single Phase',8085,146],
  ['BAT-014','GoodWe ESA 27kWh Battery','15kW GoodWe ESA · Three Phase','GW9.0-BAT-D-G20',3,26.55,'GW15K-ETA-G20',15,'Three Phase',8095,146]
 ];
 for(const [id,name,subtitle,model,quantity,capacity,inverterModel,inverterKw,phase,oop,stcs] of expected){
  const p=seeds.find(p=>p.id===id);assert.equal(batteryPackageName(p),name);assert.equal(batteryPackageSubtitle(p),subtitle);
  assert.deepEqual([p.battery_manufacturer,p.battery_model,p.battery_quantity,p.capacity_kwh],['GoodWe',model,quantity,capacity]);
  assert.deepEqual([p.inverter_manufacturer,p.inverter_model,p.inverter_kw,p.phase],['GoodWe',inverterModel,inverterKw,phase]);
  assert.deepEqual([p.battery_chemistry,p.depth_of_discharge,p.ip_rating,p.oop,p.stcs],['LiFePO4',98,'IP66',oop,stcs]);
 }
});
test('GoodWe PDFs match the manifest and each package receives matching battery, inverter and warranty documents',async()=>{
 const goodwe=bundledDocuments().filter(d=>d.path.includes('/goodwe/'));
 assert.deepEqual(goodwe.map(d=>d.kind).sort(),['battery','general','general','inverter','inverter']);
 for(const document of goodwe){const file=await readFile(new URL('..'+document.path,import.meta.url));assert.equal(file.length,document.bytes);assert.equal(createHash('sha256').update(file).digest('hex'),document.sha256);}
 const attached=attachBundledDocuments(seeds);
 for(const id of ['BAT-011','BAT-012','BAT-013','BAT-014']){assert.deepEqual(goodwe.filter(d=>d.package_ids.includes(id)).map(d=>d.kind).sort(),['battery','general','inverter']);assert.equal(attached.find(p=>p.id===id).document_ids.length,3);}
});
test('GoodWe starting prices remain editable while the package STCs stay fixed',()=>{
 const p=seeds.find(p=>p.id==='BAT-014'),base=batteryPricing(p),adjusted=priceAdjustment(snapshotBatteryPricing(p),{oop:'9000'});
 assert.equal(base.oop,8095);assert.equal(base.deduction,146*39.5);assert.equal(adjusted.oop,9000);assert.equal(adjusted.gross_amount,9000+146*39.5);
});
test('GoodWe quote output carries the matching brochures and supplied starting price',async()=>{
 const pkg=structuredClone(seeds.find(p=>p.id==='BAT-014')),goodweDocs=['battery','inverter','general'].map((kind,index)=>({...docs[0],id:randomUUID(),kind,name:['GoodWe Lynx D G2 Battery Datasheet.pdf','GoodWe ESA 5-30kW Three Phase Datasheet.pdf','GoodWe ESA 5-30kW Australian Warranty Terms.pdf'][index]}));
 pkg.document_ids=goodweDocs.map(d=>d.id);const snapshot=quoteSnapshot(pkg,customer,settings,goodweDocs),q={id:randomUUID(),public_token:randomUUID(),reference:'BAT-GOODWE',created_at:new Date().toISOString(),...snapshot};
 assert.equal(q.package_snapshot.oop,8095);assert.equal(q.package_snapshot.documents.length,3);const html=batteryQuoteEmail(q);
 for(const value of ['GoodWe ESA 27kWh Battery','15kW GoodWe ESA','GoodWe Battery Datasheet','GoodWe Inverter Datasheet','GoodWe Warranty Terms'])assert.match(html,new RegExp(value));
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),pdfBytes=await batteryQuotePdf(q),task=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true}),pdf=await task.promise;let text='';for(let i=1;i<=pdf.numPages;i++)text+=(await (await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');for(const value of ['GoodWe ESA 27kWh Battery','15kW GoodWe ESA','$8,095.00','146 certificates','GoodWe Battery Datasheet','GoodWe Inverter Datasheet','GoodWe Warranty Terms'])assert.match(text,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));await task.destroy();
});
test('AlphaESS cannot send until warranty is present, then email includes only its three PDF download links',async()=>{
 const h=harness(),alpha=h.store.data.packages.find(p=>p.id==='BAT-006');
 alpha.active=true;
 alpha.document_ids=docs.map(d=>d.id);
 const lacking=await draft(h,'BAT-006');
 assert.equal((await call(h,'send',{id:lacking.id})).statusCode,409);
 const warranty={...docs[0],id:randomUUID(),kind:'general',name:'AlphaESS Warranty Terms.pdf'};
 h.store.data.documents.push(warranty);alpha.document_ids.push(warranty.id);
 const complete=await draft(h,'BAT-006');
 assert.equal((await call(h,'send',{id:complete.id})).statusCode,200);
 const html=h.emails[0].html;
 for(const label of ['Alpha ESS 28kWh Battery','10kW Alpha ESS','AlphaESS Battery Datasheet','AlphaESS Inverter Datasheet','AlphaESS Warranty Terms'])assert.match(html,new RegExp(label));
 assert.equal((html.match(/action=public-document/g)||[]).length,3);
 assert.deepEqual(h.emails[0].attachments,[]);
 assert.equal((await call(h,'public-pdf',{token:complete.public_token})).statusCode,200);
 const publicData=(await call(h,'public',{token:complete.public_token})).body.quote;
 assert.equal(publicData.package_snapshot.documents.length,3);
 const resent=await call(h,'send',{id:complete.id,confirm_resend:true});
 assert.equal(resent.statusCode,200);
 assert.equal(h.emails[1].html,h.emails[0].html);
});
test('administrator price edit saves BAT-006 while preserving its STCs and other package prices',async()=>{
 const h=harness({preview:false}),env={DASHBOARD_PASSWORD:'admin',SUPABASE_SERVICE_ROLE_KEY:'test-secret'};
 const login=issueSession({agent:'Price Admin',role:'admin',password:'admin'},env);
 const p=h.store.data.packages.find(p=>p.id==='BAT-006'),other=h.store.data.packages[0].oop;
 p.active=true;
 const updated=await call(h,'save-package',{package:{...p,oop:7999},version:p.version},{'x-battery-session':login.token});
 assert.equal(updated.statusCode,200);
 assert.equal(updated.body.package.oop,7999);assert.equal(updated.body.package.stcs,146);
 assert.equal(h.store.data.packages[0].oop,other);
 const q=await draft(h,'BAT-006');assert.equal(q.package_snapshot.oop,7999);
});

test('package validation rejects negative, fractional STCs and invalid prices',()=>{for(const patch of [{oop:-1},{oop:1.001},{stcs:3.5},{stcs:-1},{phase:'Other'}])assert.throws(()=>validatePackage({...seeds[0],...patch}));});
test('saved quotes retain pricing, tax, documents and details after package changes',async()=>{const h=harness(),q=await draft(h);h.store.data.packages[0].oop=9999;h.store.data.packages[0].battery_name='Changed';h.store.data.settings.tax_treatment='inclusive';const newer=await draft(h);assert.equal(newer.package_snapshot.oop,9999);assert.equal(q.package_snapshot.oop,6100);assert.equal(q.package_snapshot.battery_name,'Dyness Battery');assert.equal(q.package_snapshot.tax_treatment,'unspecified');assert.equal(q.package_snapshot.documents.length,2);});
test('internal notes and storage paths are absent from public quote and email',async()=>{const h=harness(),q=await draft(h);const data=JSON.stringify(publicQuote(q));assert.doesNotMatch(data,/INTERNAL SECRET|object_path|sha256/);const email=batteryQuoteEmail(q);assert.doesNotMatch(email,/INTERNAL SECRET|GST included|GST excluded/);assert.match(email,/View your quote/);});
test('server signatures enforce roles and reject token tampering',async()=>{const env={BATTERY_QUOTES_STAFF_PASSWORD:'staff',DASHBOARD_PASSWORD:'admin',SUPABASE_SERVICE_ROLE_KEY:'secret'};assert.throws(()=>issueSession({agent:'User',role:'admin',password:'staff'},env));const session=issueSession({agent:'User',role:'staff',password:'staff'},env);assert.equal(verifySession(session.token,env).role,'staff');assert.throws(()=>verifySession(session.token+'x',env));const h=harness({preview:false});const token=issueSession({agent:'User',role:'staff',password:'staff'},{...env,SUPABASE_SERVICE_ROLE_KEY:'test-secret'}).token;const result=await call(h,'save-package',{package:seeds[0],version:1},{'x-battery-session':token});assert.equal(result.statusCode,403);});
test('sending delivers only a short email with the interactive quote link and no PDF attachments',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});assert.equal(h.emails.length,1);assert.deepEqual(h.emails[0].attachments,[]);assert.match(h.emails[0].html,/View your quote/);assert.match(h.emails[0].html,new RegExp(q.public_token));assert.doesNotMatch(h.emails[0].html,/quotation attached|6,100|system price/i);});
test('sending is blocked if matching product documents are missing',async()=>{const h=harness(),q=await draft(h,'BAT-002');const result=await call(h,'send',{id:q.id});assert.equal(result.statusCode,409);assert.equal(h.emails.length,0);assert.equal((await h.store.quote(q.id)).status,'draft');});
test('product document hash mismatch blocks customer brochure download',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});h.store.documentBytes=async()=>Buffer.from('tampered');const response={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this},json(body){this.body=body;return this},send(body){this.body=body;return this}};await h.handler({method:'GET',query:{action:'public-document',token:q.public_token,document_id:docs[0].id}},response);assert.equal(response.statusCode,409);});
test('two simultaneous send requests result in one provider call',async()=>{const h=harness(),q=await draft(h);const results=await Promise.all([call(h,'send',{id:q.id}),call(h,'send',{id:q.id})]);assert.equal(h.emails.length,1);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);});
test('resending requires explicit confirmation and retains snapshot price and files',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});h.store.data.packages[0].oop=8888;assert.equal((await call(h,'send',{id:q.id})).statusCode,409);assert.equal((await call(h,'send',{id:q.id,confirm_resend:true})).statusCode,200);assert.equal(h.emails.length,2);assert.deepEqual(h.emails[0].attachments,h.emails[1].attachments);assert.equal((await h.store.quote(q.id)).send_count,2);});
test('provider rejection records send_failed; network uncertainty prevents blind retries',async()=>{for(const [error,status] of [[Object.assign(Error('Rejected'),{status:422}),'send_failed'],[Error('Network timeout'),'delivery_uncertain']]){const h=harness({mailError:error}),q=await draft(h);assert.equal((await call(h,'send',{id:q.id})).statusCode,502);assert.equal((await h.store.quote(q.id)).status,status);if(status==='delivery_uncertain'){assert.equal((await call(h,'send',{id:q.id})).statusCode,409);assert.equal(h.emails.length,1)}}});
test('GHL failure leaves email sent; retrying GHL never emails again',async()=>{const h=harness({ghlError:true}),q=await draft(h);const result=await call(h,'send',{id:q.id});assert.equal(result.statusCode,200);assert.equal(result.body.ghl_synced,false);assert.equal((await h.store.quote(q.id)).status,'sent');await call(h,'retry-ghl',{id:q.id});assert.equal(h.emails.length,1);});
test('public view denies drafts and never exposes internal notes after sending',async()=>{const h=harness(),q=await draft(h);assert.equal((await call(h,'public',{token:q.public_token})).statusCode,404);await call(h,'send',{id:q.id});const r=await call(h,'public',{token:q.public_token});assert.equal(r.statusCode,200);assert.doesNotMatch(JSON.stringify(r.body),/INTERNAL SECRET|object_path/);});
test('GHL creates the exact Battery pipeline Proposal Sent with Direct Call source',async()=>{const calls=[];const ghl=new BatteryQuoteGhl({GHL_API_KEY:'test',GHL_LOCATION_ID:'location'},async(url,options={})=>{calls.push({url,options});if(url.includes('/pipelines?'))return new Response(JSON.stringify({pipelines:[{id:'battery-pipeline',name:'Battery Customers',stages:[{id:'new-lead',name:'New Lead'},{id:'proposal-sent',name:'Proposal Sent'},{id:'quote-accepted',name:'Quote Accepted'}]}]}));if(url.endsWith('/contacts/contact/notes'))return new Response(JSON.stringify(options.method==='POST'?{note:{id:'note'}}:{notes:[]}));if(url.includes('/contacts/?'))return new Response(JSON.stringify({contacts:[{id:'contact',phone:customer.phone,email:customer.email}]}));if(url.includes('/opportunities/search'))return new Response(JSON.stringify({opportunities:[]}));if(url.endsWith('/opportunities/'))return new Response(JSON.stringify({opportunity:{id:'new-lead-id'}}));throw Error('Unexpected GHL request');});const q={customer,reference:'BAT-TEST',package_snapshot:{...seeds[0],documents:[]}};await ghl.sync(q,settings);const body=JSON.parse(calls.find(c=>c.url.endsWith('/opportunities/')).options.body);assert.equal(body.pipelineId,settings.pipeline_id);assert.equal(body.pipelineStageId,settings.proposal_stage_id);assert.equal(body.source,'Direct Call');assert.equal(body.monetaryValue,6100);const note=JSON.parse(calls.find(c=>c.url.endsWith('/contacts/contact/notes')&&c.options.method==='POST').options.body).body;assert.doesNotMatch(note,/public-pdf/);assert.match(note,/View quote:/);});
test('PDF is a readable single A4 page without internal notes or inferred GST',async()=>{const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const h=harness(),q=await draft(h);const bytes=await batteryQuotePdf(q);const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const pdf=await task.promise;assert.equal(pdf.numPages,1);const page=await pdf.getPage(1),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');assert.match(text,/6,100.00/);assert.match(text,/115 certificates/);assert.doesNotMatch(text,/INTERNAL SECRET|GST included|GST excluded/);assert.match(text,/ABN 66 683 305 106/);await task.destroy();});
import {batteryPricing,snapshotBatteryPricing,priceAdjustment,brighteFinance} from '../Battery/quotes/pricing.js';
test('confirmed STC calculation preserves $7,900 OOP with 154 STCs at $39.50',()=>{
 const p={oop:7900,stcs:154};assert.deepEqual(batteryPricing(p),{gross:13983,deduction:6083,rate:39.5,oop:7900,discount:0,discountLabel:''});
 const saved={...p,...snapshotBatteryPricing(p)};assert.equal(saved.stc_rate,39.5);assert.equal(saved.gross_amount,13983);assert.equal(saved.stc_deduction,6083);
});
test('all package OOP amounts survive STC gross-up and deduction',()=>{
 for(const p of seeds){const b=batteryPricing(p);assert.equal(Math.round((b.gross-b.deduction)*100),Math.round(p.oop*100));assert.equal(b.deduction,p.stcs*39.5);}
});
test('Brighte finance keeps the 6800 system price and shows the full five-year repayment estimate',async()=>{
 const pkg={id:'BAT-FIN',battery_name:'Alpha ESS',capacity_kwh:28,inverter_brand:'Alpha ESS',inverter_kw:10,phase:'Single Phase',oop:6800,stcs:146,active:true,document_ids:[],version:1};
 const q={reference:'BAT-FINANCE',created_at:new Date().toISOString(),public_token:randomUUID(),customer,customer_notes:'',package_snapshot:quoteSnapshot(pkg,customer,settings,[],{pricing:{oop:6800},finance:{type:'brighte_green_loan'}}).package_snapshot};
 assert.equal(q.package_snapshot.oop,6800);assert.equal(q.package_snapshot.finance.principal,6800);assert.equal(q.package_snapshot.finance.amount_financed,6999);assert.equal(q.package_snapshot.finance.establishment_fee_assumed,199);assert.equal(q.package_snapshot.finance.term_months,60);assert.equal(q.package_snapshot.finance.annual_rate_percent,9.99);assert.equal(q.package_snapshot.finance.estimated_fortnightly_repayment,74.48);assert.equal(q.package_snapshot.finance.estimated_total_repayments,9682.4);assert.equal(q.package_snapshot.finance.estimated_finance_cost,2882.4);assert.equal(publicQuote(q).package_snapshot.finance.product,'Brighte Green Loan');
 const estimate=brighteFinance(6800);assert.equal(estimate.principal,6800);assert.equal(estimate.estimate_only,true);
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await batteryQuotePdf(q),task=getDocument({data:new Uint8Array(pdf)}),document=await task.promise;let text='';for(let i=1;i<=document.numPages;i++)text+=(await (await document.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');for(const value of ['SYSTEM PURCHASE PRICE','$6,800.00','Brighte Green Loan estimate','$6,999.00','$74.48 per fortnight','130 repayments','$9,682.40','$2,882.40','subject to Brighte credit approval'])assert.match(text,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));await task.destroy();
});
test('saved quotes retain STC prices while the short email links to the interactive proposal',async()=>{const h=harness(),q=await draft(h,'BAT-004');assert.equal(q.package_snapshot.gross_amount,13983);assert.equal(q.package_snapshot.stc_deduction,6083);assert.equal(q.package_snapshot.oop,7900);assert.match(batteryQuoteEmail(q),/View your quote/);});
test('GHL search supports name, phone or email and returns contact autofill fields',async()=>{
 const calls=[];const ghl=new BatteryQuoteGhl({GHL_API_KEY:'key',GHL_LOCATION_ID:'location'},async(url)=>{calls.push(url);return new Response(JSON.stringify({contacts:[{id:'abc',firstName:'Test',lastName:'Customer',email:'test@example.com',phone:'0412345678',address1:'12 Example Street',city:'Melbourne',state:'VIC',postalCode:'3000'}]}));});
 assert.deepEqual(await ghl.search('a'),[]);for(const query of ['Test Customer','0412345678','test@example.com']){const result=await ghl.search(query);assert.equal(result[0].name,'Test Customer');assert.equal(result[0].address,'12 Example Street, Melbourne, VIC, 3000');assert.ok(calls.at(-1).includes(encodeURIComponent(query)));}
});
test('battery workspace opens without login while configuration changes remain restricted',async()=>{const h=harness({preview:false});const b=await call(h,'bootstrap');assert.equal(b.statusCode,200);assert.equal(b.body.session.role,'staff');const q=await draft(h);assert.equal(q.created_by,'Goldsure team');const denied=await call(h,'save-package',{package:seeds[0]});assert.equal(denied.statusCode,403);});

import {sendBatteryQuoteSms} from '../lib/battery-quote-sms.js';
test('customer quote PDF download is disabled after sending',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});const response=await call(h,'public-pdf',{token:q.public_token});assert.equal(response.statusCode,404);});
test('battery SMS uses existing gateway and logs the quote link to the SMS thread',async()=>{const h=harness(),q=await draft(h),calls=[];const env={SMSGATE_USERNAME:'test',SMSGATE_PASSWORD:'test',SUPABASE_URL:'https://storage.test',SUPABASE_ANON_KEY:'test'};const result=await sendBatteryQuoteSms(q,env,async(url,options={})=>{calls.push({url,options});if(url.includes('select=status'))return new Response('[]');if(url.endsWith('/messages'))return new Response(JSON.stringify({id:'sms-test'}));return new Response(null,{status:201});});assert.equal(result.status,'sent');const message=JSON.parse(calls.find(c=>c.url.endsWith('/messages')).options.body);assert.deepEqual(message.phoneNumbers,['+61412345678']);assert.match(message.textMessage.text,new RegExp(q.public_token));assert.match(message.textMessage.text,/Battery\/quote.html/);assert.equal(result.logged,true);});
test('battery SMS respects opt-outs, invalid mobiles and failed preference checks',async()=>{const h=harness(),q=await draft(h),env={SMSGATE_USERNAME:'test',SMSGATE_PASSWORD:'test',SUPABASE_URL:'https://storage.test',SUPABASE_ANON_KEY:'test'};let calls=0;const opted=await sendBatteryQuoteSms(q,env,async()=>{calls++;return new Response('[{"status":"optout"}]');});assert.equal(opted.status,'skipped');assert.equal(calls,1);assert.equal((await sendBatteryQuoteSms({...q,customer:{...q.customer,phone:'123'}},env,()=>{throw Error('Must not send')})).status,'skipped');assert.equal((await sendBatteryQuoteSms(q,env,async()=>new Response('error',{status:503}))).status,'failed');});

test('expiry begins at first successful send and resends preserve the exact deadline',async()=>{const h=harness(),q=await draft(h);assert.equal(q.expires_at,undefined);await call(h,'send',{id:q.id});const first=await h.store.quote(q.id);assert.equal(first.expires_at,expiresAt(first.sent_at));await call(h,'send',{id:q.id,confirm_resend:true});const again=await h.store.quote(q.id);assert.equal(again.sent_at,first.sent_at);assert.equal(again.expires_at,first.expires_at);assert.equal(again.send_count,2);});
test('energy fields are independently optional and never manufacture savings',async()=>{const h=harness();for(const energy of [undefined,{bill_amount:'350'},{consumption_kwh:'750'},{import_tariff:'0.32',solar_kw:'6.6'}]){const result=await call(h,'create-quote',{package_id:'BAT-001',customer,energy});assert.equal(result.statusCode,200);assert.equal(result.body.quote.energy_snapshot?.savings_estimate??null,null);}const bad=await call(h,'create-quote',{package_id:'BAT-001',customer,energy:{bill_amount:-1}});assert.equal(bad.statusCode,400);});
test('acceptance uses the saved name and explicit acknowledgment; repeat accepts are idempotent',async()=>{const h=harness(),q=await draft(h);assert.equal((await call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:true})).statusCode,404);await call(h,'send',{id:q.id});assert.equal((await call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:false})).statusCode,400);const both=await Promise.all([call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:true}),call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:true})]);assert.ok(both.every(r=>r.statusCode===200));assert.equal(h.store.data.events.filter(e=>e.event_type==='accepted').length,1);const viewed=await call(h,'public',{token:q.public_token});assert.equal(viewed.body.quote.response_state,'accepted');assert.doesNotMatch(JSON.stringify(viewed.body),/INTERNAL SECRET|object_path|ghl_contact|quote_id/);});
test('expired and failed quotes cannot be accepted; expired quotes stay readable',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});await h.store.update(q.id,{expires_at:'2020-01-01T00:00:00Z'});assert.equal((await call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:true})).statusCode,409);const viewed=await call(h,'public',{token:q.public_token});assert.equal(viewed.statusCode,200);assert.equal(viewed.body.quote.response_state,'expired');assert.equal((await call(h,'send',{id:q.id,confirm_resend:true})).statusCode,409);await h.store.update(q.id,{status:'send_failed',expires_at:expiresAt(new Date().toISOString())});assert.equal((await call(h,'accept',{token:q.public_token,signer_name:customer.name,consent:true})).statusCode,409);});
test('preview requires an isolated store and quote lists exclude bearer tokens',async()=>{assert.throws(()=>createBatteryQuoteHandler({preview:true}),/isolated store/);const h=harness();await draft(h);const result=await call(h,'quotes');assert.doesNotMatch(JSON.stringify(result.body),/public_token|INTERNAL SECRET/);});

test('21 calendar days preserve Sydney local time across daylight saving changes',()=>{assert.equal(expiresAt('2026-09-20T02:30:00.123Z'),'2026-10-11T01:30:00.123Z');assert.equal(expiresAt('2026-03-20T01:30:00.123Z'),'2026-04-10T02:30:00.123Z');const q={sent_at:'2026-10-01T00:00:00Z',expires_at:'2026-10-22T00:00:00Z'};assert.equal(responseState(q,Date.parse(q.expires_at)-1),'awaiting');assert.equal(responseState(q,Date.parse(q.expires_at)),'expired');});

test('acceptance emails staff once and records the accepted GHL target using the saved customer name',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});const submit=()=>call(h,'accept',{token:q.public_token,consent:true,signer_name:'Spoofed Name'});await Promise.all([submit(),submit()]);const accepted=await h.store.quote(q.id);assert.equal(accepted.acceptance.signer_name,customer.name);assert.equal(accepted.ghl_target_stage,'accepted');assert.equal(accepted.ghl_synced_target,'accepted');const notifications=h.emails.filter(mail=>mail.to[0]==='info@goldsure.com.au');assert.equal(notifications.length,1);assert.match(notifications[0].subject,/Battery quote accepted/);assert.match(notifications[0].text,new RegExp(customer.name));assert.equal(accepted.acceptance_email_status,'sent');await submit();assert.equal(h.emails.filter(mail=>mail.to[0]==='info@goldsure.com.au').length,1);});
test('acceptance notification failure does not undo acceptance or invite duplicate uncertain emails',async()=>{const h=harness(),q=await draft(h);await call(h,'send',{id:q.id});const original=h.handler;h.handler=createBatteryQuoteHandler({store:h.store,preview:true,mail:async()=>{throw Error('response lost')},ghl:{async sync(){return {contactId:'test',opportunityId:'test'}}}});const accepted=await call(h,'accept',{token:q.public_token,consent:true});assert.equal(accepted.statusCode,200);assert.equal((await h.store.quote(q.id)).acceptance_email_status,'uncertain');let retried=0;h.handler=createBatteryQuoteHandler({store:h.store,preview:true,mail:async()=>{retried++}});await call(h,'retry-acceptance',{id:q.id});assert.equal(retried,0);assert.ok((await h.store.quote(q.id)).acceptance);});
test('acceptance racing with a send sync is repaired to Quote Accepted before the worker releases its claim',async()=>{const h=harness(),q=await draft(h);const targets=[];const ghl={async preflight(){},async sync(current){targets.push(current.ghl_target_stage);if(current.ghl_target_stage==='proposal_sent'){await h.store.update(current.id,{ghl_target_stage:'accepted',acceptance:{signer_name:customer.name,accepted_at:new Date().toISOString()}});}return {contactId:'c',opportunityId:'o'};}};h.handler=createBatteryQuoteHandler({store:h.store,preview:true,ghl,mail:async()=>({})});await call(h,'send',{id:q.id});assert.deepEqual(targets,['proposal_sent','accepted']);assert.equal((await h.store.quote(q.id)).ghl_synced_target,'accepted');});

test('acceptance reuses the existing customer opportunity and moves it to Quote Accepted',async()=>{const calls=[];const ghl=new BatteryQuoteGhl({GHL_API_KEY:'test',GHL_LOCATION_ID:'location'},async(url,options={})=>{calls.push({url,options});if(url.includes('/pipelines?'))return new Response(JSON.stringify({pipelines:[{id:'battery-pipeline',name:'Battery Customers',stages:[{id:'proposal-sent',name:'Proposal Sent'},{id:'quote-accepted',name:'Quote Accepted'}]}]}));if(url.includes('/contacts/?'))return new Response(JSON.stringify({contacts:[{id:'contact',phone:customer.phone,email:customer.email}]}));if(url.includes('/opportunities/search'))return new Response(JSON.stringify({opportunities:[{id:'existing',name:'Customer lead',pipelineId:'battery-pipeline',status:'open'}]}));if(url.endsWith('/opportunities/existing'))return new Response(JSON.stringify({opportunity:{id:'existing'}}));if(url.endsWith('/contacts/contact/notes'))return new Response(JSON.stringify({notes:[{body:'Battery quotation [BAT-TEST]'}]}));throw Error('Unexpected GHL call');});const q={customer,reference:'BAT-TEST',ghl_target_stage:'accepted',package_snapshot:{...seeds[0],documents:[]}};await ghl.sync(q,settings);const update=calls.find(c=>c.url.endsWith('/opportunities/existing'));assert.equal(update.options.method,'PUT');assert.equal(JSON.parse(update.options.body).pipelineStageId,'quote-accepted');assert.equal(calls.filter(c=>c.url.endsWith('/opportunities/')&&c.options.method==='POST').length,0);});

test('staff can edit the system price and add a labelled discount, and the saved quote keeps it',()=>{
 const pkg={id:'BAT-X',battery_name:'Test',capacity_kwh:20,inverter_brand:'Solinteg',inverter_kw:8,phase:'Single Phase',oop:6700,stcs:115,active:true,document_ids:[],version:1};
 const customer={name:'Test User',email:'a@b.co',phone:'0412345678',address:'1 Example Street Melbourne VIC'};
 const unchanged=quoteSnapshot(pkg,customer,{},[],{}).package_snapshot;assert.equal(unchanged.oop,6700);assert.equal(unchanged.discount_amount,undefined);
 const s=quoteSnapshot(pkg,customer,{},[],{pricing:{gross:'12000',discount:'250.50',discount_label:'Loyalty'}}).package_snapshot;
 assert.equal(s.gross_amount,12000);assert.equal(s.stc_deduction,4542.5);assert.equal(s.discount_amount,250.5);assert.equal(s.discount_label,'Loyalty');assert.equal(s.oop,7207);assert.equal(batteryPricing(s).discount,250.5);
 assert.throws(()=>quoteSnapshot(pkg,customer,{},[],{pricing:{discount:'999999'}}),/negative/);assert.throws(()=>quoteSnapshot(pkg,customer,{},[],{pricing:{discount:'-1'}}),/valid amounts/);
});

test('accepting without an address on file requires one and saves it; the checkbox is not needed',async()=>{
 const h=await harness(),q=await draft(h);await call(h,'send',{id:q.id});await h.store.update(q.id,{customer:{...q.customer,address:''}});
 const missing=await call(h,'accept',{token:q.public_token,consent:true});assert.equal(missing.statusCode,400);assert.match(missing.body.error,/installation address/);
 const ok=await call(h,'accept',{token:q.public_token,consent:true,address:'1 Example Street, Melbourne VIC 3000'});assert.equal(ok.statusCode,200);
 assert.equal((await h.store.quote(q.id)).customer.address,'1 Example Street, Melbourne VIC 3000');
});

test('staff can set the final price while the STC deduction stays fixed',()=>{
 const pkg={id:'BAT-X',battery_name:'Test',capacity_kwh:40,inverter_brand:'Solis',inverter_kw:10,phase:'Three Phase',oop:9999,stcs:160,active:true,document_ids:[],version:1};
 const customer={name:'Test User',email:'a@b.co',phone:'0412345678',address:'1 Example Street Melbourne VIC'};
 const s=quoteSnapshot(pkg,customer,{},[],{pricing:{oop:'15000'}}).package_snapshot;
 assert.equal(s.oop,15000);assert.equal(s.stc_deduction,6320);assert.equal(s.stcs,160);assert.equal(s.gross_amount,21320);assert.equal(s.base_gross_amount,16319);assert.equal(s.discount_amount,0);
 assert.equal(quoteSnapshot(pkg,customer,{},[],{pricing:{oop:'9999'}}).package_snapshot.oop,9999);
 assert.throws(()=>quoteSnapshot(pkg,customer,{},[],{pricing:{oop:'-5'}}),/final price/);
});
