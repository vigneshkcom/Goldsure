import crypto from 'node:crypto';

const COOKIE = 'goldsure_rebooking_session';
const SESSION_SECONDS = 12 * 60 * 60;

export function json(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(body));
}
export function goodOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  try{return new URL(origin).host===req.headers.host;}catch{return false;}
}
function sign(value){
  const secret=process.env.GOLDSURE_REBOOKING_SESSION_SECRET;
  return secret?.length>=32?crypto.createHmac('sha256',secret).update(value).digest('hex'):null;
}
export function issueSession(res,req){
  const expiry=Math.floor(Date.now()/1000)+SESSION_SECONDS;
  const payload=String(expiry)+'.'+crypto.randomBytes(20).toString('hex');
  const sig=sign(payload);
  if(!sig)return false;
  const secure=(req.headers['x-forwarded-proto']||'https')==='https'?'; Secure':'';
  res.setHeader('Set-Cookie',COOKIE+'='+payload+'.'+sig+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+SESSION_SECONDS+secure);
  return true;
}
export function clearSession(res){
  res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
}
export function validSession(req){
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>{
    const p=s.indexOf('=');
    return p<0?[]:[s.slice(0,p).trim(),s.slice(p+1).trim()];
  }).filter(x=>x.length===2));
  const token=cookies[COOKIE];if(!token)return false;
  const parts=token.split('.');
  if(parts.length!==3||!/^\d+$/.test(parts[0])||!/^[a-f0-9]{40}$/.test(parts[1])||!/^[a-f0-9]{64}$/.test(parts[2]))return false;
  const expiry=Number(parts[0]),now=Date.now()/1000;
  if(!Number.isSafeInteger(expiry)||expiry<now||expiry>now+SESSION_SECONDS+60)return false;
  const signature=sign(parts[0]+'.'+parts[1]);
  return !!signature&&crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(parts[2],'hex'));
}
export const STAFF=['Vignesh','David','Shanira','Alda','Amit','Bharath'];
export function validStaff(name){return typeof name==='string'&&STAFF.includes(name);}
export function configured(){
  return Boolean(process.env.GOLDSURE_REBOOKING_SESSION_SECRET?.length>=32);
}
export async function db(path,method='GET',body=undefined,extraHeaders={}){
  const url=process.env.SUPABASE_URL||'https://yxgdixwneprhjxzdlaqw.supabase.co';
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw new Error('Database backend not configured');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{
    method,
    headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...extraHeaders},
    body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'
  });
  const content=await response.text();
  let payload;try{payload=content?JSON.parse(content):null;}catch{payload={message:'Unexpected database response'};}
  if(!response.ok){
    const error=new Error(payload?.message||'Database HTTP '+response.status);
    error.status=response.status;throw error;
  }
  return payload;
}
