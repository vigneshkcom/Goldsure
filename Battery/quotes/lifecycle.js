export const VALID_DAYS=21;
export const CONSENT_VERSION='battery-acceptance-v1';
export const CONSENT_TEXT='I accept this quotation, including the selected battery and inverter configuration and the stated customer out-of-pocket total.';
const sydney=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function wallTime(ms){const p=Object.fromEntries(sydney.formatToParts(new Date(ms)).map(part=>[part.type,part.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second,new Date(ms).getUTCMilliseconds());}
export function expiresAt(sentAt){if(!sentAt)return null;const start=Date.parse(sentAt);const target=wallTime(start)+VALID_DAYS*86400000;const candidates=[-1,0,1].map(day=>{const probe=target+day*86400000;return target-(wallTime(probe)-probe);});const exact=candidates.filter(candidate=>wallTime(candidate)===target);return new Date(Math.max(...(exact.length?exact:candidates))).toISOString();}
export function acceptanceOf(q){return Array.isArray(q.acceptance)?q.acceptance[0]||null:q.acceptance||null;}
export function responseState(q,now=Date.now()){if(acceptanceOf(q))return 'accepted';if(!q.sent_at)return 'draft';const expiry=q.expires_at||expiresAt(q.first_sent_at||q.sent_at);return new Date(expiry).getTime()<=now?'expired':'awaiting';}
export function energySnapshot(input){
 if(input==null)return null;if(typeof input!=='object'||Array.isArray(input))throw Error('Enter valid optional electricity details.');
 const result={};const limits={bill_amount:100000,consumption_kwh:1000000,import_tariff:10,feed_in_tariff:10,daily_supply_charge:100,solar_kw:1000,solar_surplus_kwh_day:10000,evening_demand_kwh_day:10000};
 for(const [key,max] of Object.entries(limits)){if(input[key]==null||input[key]==='')continue;const value=Number(input[key]);if(!Number.isFinite(value)||value<0||value>max)throw Error('Enter a valid non-negative electricity value: '+key.replaceAll('_',' '));result[key]=value;}
 for(const key of ['bill_period','consumption_period']){if(!input[key])continue;if(!['monthly','quarterly','daily','annual'].includes(input[key]))throw Error('Choose a valid electricity period.');result[key]=input[key];}
 return Object.keys(result).length?{version:1,inputs:result,savings_estimate:null}:null;
}
