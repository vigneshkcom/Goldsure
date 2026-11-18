import {json,goodOrigin,validSession,validStaff} from './_shared.js';

const COOKIE = 'goldsure_dataforce_staff';
const tokenFormat = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export function enabled() {
  return process.env.GOLDSURE_DATAFORCE_EMAIL_LOGIN_ENABLED === 'true' &&
    Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY &&
      process.env.DATAFORCE_CLIENT_ID && process.env.DATAFORCE_CLIENT_SECRET);
}

function auth(path, body, token) {
  return fetch(process.env.SUPABASE_URL.replace(/\/$/,'')+'/auth/v1/'+path,{
    method:body?'POST':'GET',
    headers:{apikey:process.env.SUPABASE_ANON_KEY,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:AbortSignal.timeout(8000),
  });
}

function staffFor(user) {
  const staff = user?.app_metadata?.goldsure_rebooking_staff;
  return user?.email_confirmed_at && validStaff(staff) ? staff : null;
}

export async function verifiedStaff(req) {
  if (!enabled()) return null;
  const cookie = (req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(COOKIE+'='));
  const token = cookie?.slice(COOKIE.length+1);
  if (!token || !tokenFormat.test(token)) return null;
  const response = await auth('user',undefined,token);
  if (response.status >= 500) throw Error('Email sign-in unavailable');
  return response.ok ? staffFor(await response.json()) : null;
}

export default async function handler(req,res) {
  if (!validSession(req)) return json(res,401,{error:'Choose your staff name first.'});
  if (!enabled()) return json(res,503,{error:'Email sign-in for direct moves is unavailable.'});
  if (req.method !== 'POST') return json(res,405,{error:'Method not allowed'});
  if (!goodOrigin(req)) return json(res,403,{error:'Origin rejected'});
  const email = String(req.body?.email||'').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]{1,64}@goldsure\.com\.au$/.test(email)) return json(res,400,{error:'Enter your Goldsure work email.'});
  try {
    if (req.body?.action === 'send') {
      const response = await auth('otp',{email,create_user:false});
      if (response.status === 429) return json(res,429,{error:'Please wait before requesting another code.'});
      if (response.status >= 500) return json(res,503,{error:'Email sign-in is temporarily unavailable.'});
      return json(res,200,{message:'If your email has been enrolled, check your inbox for a code.'});
    }
    if (req.body?.action !== 'verify') return json(res,400,{error:'Choose a sign-in action.'});
    const token = String(req.body.code||'').trim();
    if (!/^\d{6,10}$/.test(token)) return json(res,400,{error:'Enter the one-time code from your email.'});
    const response = await auth('verify',{email,token,type:'email'});
    const result = await response.json();
    const staff = staffFor(result.user);
    if (!response.ok || !staff || !tokenFormat.test(result.access_token||'')) return json(res,403,{error:'The code has expired or this account is not authorised for direct moves.'});
    const age = Math.min(Number(result.expires_in)||3600,3600);
    res.setHeader('Set-Cookie',COOKIE+'='+result.access_token+'; Path=/api/rescheduling/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age);
    return json(res,200,{staff,message:'Work email verified.'});
  } catch {
    return json(res,503,{error:'Email sign-in is temporarily unavailable.'});
  }
}
