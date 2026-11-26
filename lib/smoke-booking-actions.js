import crypto from 'node:crypto';
const ORIGIN = 'https://portal.goldsure.com.au';
const tokenPattern = /^calc-[a-zA-Z0-9-]{8,80}$/;
const equal = (a,b) => {const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && crypto.timingSafeEqual(x,y);};
const secret = env => {if(!env.SMOKE_CALCULATOR_BRIDGE_SECRET) throw new Error('Booking actions are not configured.');return env.SMOKE_CALCULATOR_BRIDGE_SECRET;};
export function signBridge(body,timestamp,env=process.env){
  return crypto.createHmac('sha256',secret(env)).update('calculator-bridge:v1:'+timestamp+'.'+JSON.stringify(body)).digest('hex');
}
export function verifyBridge(body,headers,env=process.env,now=Date.now()){
  const stamp=String(headers['x-goldsure-timestamp']||'');
  if(!/^\d+$/.test(stamp)||Math.abs(now-Number(stamp))>300000) return false;
  try{return equal(headers['x-goldsure-signature'],signBridge(body,stamp,env));}catch{return false;}
}
export function bookingActionUrl(quoteToken,env=process.env,now=Date.now()){
  if(!tokenPattern.test(quoteToken)) throw new Error('Invalid calculator quote.');
  const expires=String(Math.floor(now/1000)+30*86400);
  const signature=crypto.createHmac('sha256',secret(env)).update('staff-booking:v1:'+quoteToken+':'+expires).digest('hex');
  return ORIGIN+'/smoke-alarms/booking-request.html?'+new URLSearchParams({token:quoteToken,expires,signature});
}
export function verifyBookingAction(params,env=process.env,now=Date.now()){
  if(!tokenPattern.test(String(params.token||''))||!/^\d+$/.test(String(params.expires||'')))return false;
  const expiry=Number(params.expires);
  if(expiry<now/1000||expiry>now/1000+31*86400)return false;
  try{
    const signature=crypto.createHmac('sha256',secret(env)).update('staff-booking:v1:'+params.token+':'+params.expires).digest('hex');
    return equal(params.signature,signature);
  }catch{return false;}
}
