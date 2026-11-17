import {energySnapshot,acceptanceOf,responseState,expiresAt} from '../Battery/quotes/lifecycle.js';
import {snapshotBatteryPricing,priceAdjustment,hasSpecificationDocuments,brighteFinance} from '../Battery/quotes/pricing.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
export class BatteryQuoteError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export const money=value=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:2}).format(Number(value)||0);
export const clean=value=>String(value??'').trim();
const optional=value=>clean(value)||null;
export const taxLabels={unspecified:'',inclusive:'GST included',exclusive:'GST excluded'};
export function validatePackage(input){
 const item={id:clean(input.id),battery_name:clean(input.battery_name),battery_manufacturer:optional(input.battery_manufacturer),battery_model:optional(input.battery_model),battery_quantity:input.battery_quantity===undefined||input.battery_quantity===null||input.battery_quantity===''?null:Number(input.battery_quantity),capacity_kwh:Number(input.capacity_kwh),inverter_brand:clean(input.inverter_brand),inverter_manufacturer:optional(input.inverter_manufacturer),inverter_model:optional(input.inverter_model),inverter_kw:Number(input.inverter_kw),phase:clean(input.phase),battery_chemistry:optional(input.battery_chemistry),depth_of_discharge:input.depth_of_discharge===undefined||input.depth_of_discharge===null||input.depth_of_discharge===''?null:Number(input.depth_of_discharge),ip_rating:optional(input.ip_rating),oop:Number(input.oop),stcs:Number(input.stcs),active:input.active!==false,document_ids:[...new Set(input.document_ids||[])]};
 if(!/^[A-Za-z0-9-]{3,64}$/.test(item.id)||!item.battery_name||item.battery_name.length>120||!item.inverter_brand||item.inverter_brand.length>80||!['Single Phase','Three Phase'].includes(item.phase))throw new BatteryQuoteError('Enter package names, an ID, and a valid phase.');
 if(!Number.isFinite(item.oop)||item.oop<0||item.oop>1000000||Math.abs(item.oop*100-Math.round(item.oop*100))>0.0001)throw new BatteryQuoteError('Enter a non-negative price with at most two decimal places.');
 if(!Number.isInteger(item.stcs)||item.stcs<0||![item.capacity_kwh,item.inverter_kw].every(n=>Number.isFinite(n)&&n>0&&n<=10000))throw new BatteryQuoteError('Enter valid capacities and a non-negative whole STC quantity.');
 if(item.battery_quantity!==null&&(!Number.isInteger(item.battery_quantity)||item.battery_quantity<1||item.battery_quantity>100))throw new BatteryQuoteError('Enter a valid battery quantity.');
 if(item.depth_of_discharge!==null&&(!Number.isFinite(item.depth_of_discharge)||item.depth_of_discharge<=0||item.depth_of_discharge>100))throw new BatteryQuoteError('Enter a valid depth of discharge.');
 if([item.battery_manufacturer,item.battery_model,item.inverter_manufacturer,item.inverter_model,item.battery_chemistry,item.ip_rating].some(value=>value&&value.length>80))throw new BatteryQuoteError('Technical package fields must be 80 characters or fewer.');
 if(item.document_ids.some(id=>!/^[a-f0-9-]{36}$/i.test(id)))throw new BatteryQuoteError('Invalid document selection.');
 return item;
}
export function customerDetails(input){
 const result={name:clean(input.name),email:clean(input.email).toLowerCase(),phone:clean(input.phone),address:clean(input.address)};
 if(result.name.length<2||result.name.length>150||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)||result.email.length>254||result.phone.replace(/\D/g,'').length<8||result.address.length<8||result.address.length>400)throw new BatteryQuoteError('Enter the customer’s full name, email, contact number and complete installation address.');
 return result;
}
export function quoteSnapshot(pkg,customer,settings,documents,notes={}){
 if(!pkg.active)throw new BatteryQuoteError('This package is no longer available.');
 const selected=pkg.document_ids.map(id=>documents.find(d=>d.id===id));
 if(selected.some(d=>!d))throw new BatteryQuoteError('A package document could not be found. Ask an administrator to review it.');
 const snapshot=structuredClone({...pkg,...snapshotBatteryPricing(pkg),tax_treatment:settings.tax_treatment||'unspecified',documents:selected.map(d=>({id:d.id,name:d.name,kind:d.kind,object_path:d.object_path,sha256:d.sha256,bytes:d.bytes}))});
 const adjustment=priceAdjustment(snapshot,notes.pricing);if(adjustment.error)throw new BatteryQuoteError(adjustment.error);delete adjustment.error;Object.assign(snapshot,adjustment);if(notes.finance?.type==='brighte_green_loan'){snapshot.finance=brighteFinance(snapshot.oop);if(!snapshot.finance)throw new BatteryQuoteError('Enter a positive system price before adding Brighte finance.');}
 let energy;try{energy=energySnapshot(notes.energy);}catch(error){throw new BatteryQuoteError(error.message);}return {energy_snapshot:energy,customer:customerDetails(customer),package_snapshot:snapshot,customer_notes:clean(notes.customer_notes).slice(0,4000),internal_notes:clean(notes.internal_notes).slice(0,8000)};
}
export function missingDocuments(quote){const kinds=hasSpecificationDocuments(quote.package_snapshot)?['battery','inverter','general']:['battery','inverter'];return kinds.filter(kind=>!quote.package_snapshot.documents.some(d=>d.kind===kind));}
export function publicQuote(q){return {reference:q.reference,created_at:q.created_at,sent_at:q.sent_at,status:q.status,customer:q.customer,package_snapshot:{...q.package_snapshot,documents:q.package_snapshot.documents.map(({id,name,kind})=>({id,name,kind}))},customer_notes:q.customer_notes,first_sent_at:q.first_sent_at||q.sent_at,expires_at:q.expires_at||expiresAt(q.first_sent_at||q.sent_at),response_state:responseState(q),acceptance:acceptanceOf(q)?{signer_name:acceptanceOf(q).signer_name,accepted_at:acceptanceOf(q).accepted_at,consent_version:acceptanceOf(q).consent_version}:null};}
const signingKey=env=>env.BATTERY_QUOTES_SESSION_SECRET||env.SUPABASE_SERVICE_ROLE_KEY;
export function issueSession({agent,role,password},env=process.env){
 const expected=role==='admin'?env.DASHBOARD_PASSWORD:(env.BATTERY_QUOTES_STAFF_PASSWORD||env.DASHBOARD_PASSWORD);
 if(!expected)throw new BatteryQuoteError(role==='admin'?'Goldsure portal password is not configured on the server.':'Staff access is not configured.',503);
 const actual=Buffer.from(String(password||'')),wanted=Buffer.from(expected);
 if(!clean(agent)||!['admin','staff'].includes(role)||actual.length!==wanted.length||!timingSafeEqual(actual,wanted))throw new BatteryQuoteError('Check your name, role and password.',401);
 if(!signingKey(env))throw new BatteryQuoteError('Quote session signing is not configured.',503);
 const payload=Buffer.from(JSON.stringify({agent:clean(agent).slice(0,80),role,expires:Date.now()+8*3600000})).toString('base64url');
 return {token:payload+'.'+createHmac('sha256',signingKey(env)).update(payload).digest('base64url'),agent:clean(agent),role};
}
export function verifySession(token,env=process.env){
 try{const [body,signature]=String(token||'').split('.');const expected=createHmac('sha256',signingKey(env)||'').update(body).digest();const actual=Buffer.from(signature||'','base64url');if(!signingKey(env)||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();const session=JSON.parse(Buffer.from(body,'base64url'));if(session.expires<Date.now()||!['admin','staff'].includes(session.role))throw Error();return session;}catch{throw new BatteryQuoteError('Your session expired. Sign in again.',401);}
}
