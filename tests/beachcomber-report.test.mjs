import test from 'node:test';
import assert from 'node:assert/strict';
import { newSession, readSession, validateReport, reportText, deliverReport, beachcomberReport } from '../lib/beachcomber-report.js';

Object.assign(process.env,{ZOHO_CLIENT_SECRET:'test-only',ZOHO_CLIENT_ID:'test',ZOHO_REFRESH_TOKEN:'test',ZOHO_WORKDRIVE_QLD_PHOTOS_PARENT_FOLDER_ID:'qld-parent',HOSTINGER_MAILBOX_RESOURCE_ID:'test',HOSTINGER_MAIL_API_TOKEN:'test'});
const body=()=>({safe:true,unit:'1005/1006',name:'Elena',email:'pm@example.com',sound:'loud',trigger:'cooking',outcome:'stopped',notes:'Cooking in the adjoining room.'});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(data){this.data=data;return this;}});
function store({failMail=false,failUpload=false}={}) {
  const tree=new Map([['qld-parent',[]]]),states=[],uploads=[],mails=[];
  let id=0;
  return {states,uploads,mails, deps:{
    getAccessToken:async()=> 'token',
    listChildren:async(_,folder)=> tree.get(folder) || [],
    createFolder:async(_,name,parent)=>{const key=`folder-${++id}`;(tree.get(parent)||[]).push({id:key,attributes:{name,is_folder:true}});tree.set(key,[]);return key;},
    setState:async(_,folder,value)=>{states.push(value);for(const nodes of tree.values()){const node=nodes.find(x=>x.id===folder);if(node)node.attributes.description=value;}},
    uploadFile:async(_,folder,name,data)=>{if(failUpload)throw new Error('storage failure');uploads.push({folder,name,data});},
    send:async mail=>{if(failMail)throw new Error('mail failure');mails.push(mail);},
  }};
}
test('signed sessions reject tampering, future timestamps and expiry',()=>{
  const now=Date.now(), token=newSession(now);
  assert.match(readSession(token,now).id,/^[a-f0-9-]{36}$/);
  assert.throws(()=>readSession(token+'x',now));
  assert.throws(()=>readSession(token,now+3600001));
  assert.throws(()=>readSession(newSession(now+60000),now));
});
test('validation requires safety, contact, valid choices and a bounded unit',()=>{
  assert.equal(validateReport(body()).unit,'1005/1006');
  for(const change of [{safe:false},{unit:'<script>'},{email:''},{outcome:'okay'},{website:'bot'},{email:'bad\nmail'}])assert.throws(()=>validateReport({...body(),...change}));
});
test('attachments require real supported image bytes and strict total limits',()=>{
  assert.throws(()=>validateReport({...body(),files:[{type:'image/jpeg',data:Buffer.from('not a photo').toString('base64')}]}));
  assert.throws(()=>validateReport({...body(),files:[{type:'text/html',data:'abcd'}]}));
  const buffer=Buffer.alloc(1100000);buffer[0]=255;buffer[1]=216;buffer[2]=255;
  assert.throws(()=>validateReport({...body(),files:[1,2].map(()=>({type:'image/jpeg',data:buffer.toString('base64')}))}));
});
test('delivery saves readable and structured reports before emailing only Vignesh',async()=>{
  const s=store(), report=validateReport(body()), session=readSession(newSession());
  const result=await deliverReport(report,session,s.deps);
  assert.equal(result.ok,true);assert.equal(s.uploads.length,2);
  assert.match(s.uploads[0].data.toString(),/1005\/1006[\s\S]*Cooking fumes[\s\S]*Stopped and returned to normal/);
  assert.deepEqual(s.mails[0].to,['vignesh@goldsure.com.au']);
  assert.match(s.mails[0].text,/workdrive.zoho.com.au\/folder/);
  const duplicate=await deliverReport(report,session,s.deps);
  assert.equal(duplicate.duplicate,true);assert.equal(s.mails.length,1);
  await assert.rejects(deliverReport({...report,notes:'Changed'},session,s.deps),/already submitted/);
  await assert.rejects(deliverReport({...report,unit:'1805'},session,s.deps),/already submitted/);
});
test('email failure is reported as saved, and retry sends without another report folder',async()=>{
  const s=store({failMail:true}), report=validateReport(body()), session=readSession(newSession());
  const result=await deliverReport(report,session,s.deps);assert.equal(result.saved,true);assert.equal(result.ok,false);
  s.deps.send=async mail=>s.mails.push(mail);
  const retry=await deliverReport(report,session,s.deps);assert.equal(retry.ok,true);assert.equal(s.mails.length,1);
  assert.equal(new Set(s.uploads.map(x=>x.folder)).size,1);
});
test('storage failure never sends an email or reports success',async()=>{
  const s=store({failUpload:true});await assert.rejects(deliverReport(validateReport(body()),readSession(newSession()),s.deps));assert.equal(s.mails.length,0);
});
test('email escapes supplied HTML and report text preserves a neutral outcome',async()=>{
  const s=store(), report=validateReport({...body(),name:'<img src=x>',outcome:'ongoing'});
  await deliverReport(report,readSession(newSession()),s.deps);
  assert.doesNotMatch(s.mails[0].html,/<img src=x>/);assert.match(s.mails[0].html,/&lt;img/);
  assert.match(reportText(report,'BC-test',new Date()),/not an equipment diagnosis/);
});
test('public route rejects unsafe reports and cross-origin writes before storage',async()=>{
  const s=store(), token=newSession();let res=response();
  await beachcomberReport({method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:{...body(),token}},res,s.deps);assert.equal(res.code,403);
  res=response();await beachcomberReport({method:'POST',headers:{'content-type':'application/json'},body:{...body(),token,safe:false}},res,s.deps);assert.equal(res.code,400);assert.equal(s.uploads.length,0);
});
test('public success returns a reference without leaking WorkDrive identifiers',async()=>{
  const s=store(), res=response();
  await beachcomberReport({method:'POST',headers:{origin:'https://portal.goldsure.com.au','content-type':'application/json'},body:{...body(),token:newSession()}},res,s.deps);
  assert.equal(res.code,200);assert.equal(res.data.ok,true);assert.equal(res.data.folderId,undefined);assert.equal(res.headers['Cache-Control'],'no-store');
});
