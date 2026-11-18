import {json,goodOrigin,issueSession,validSession,validStaff,configured,clearSession} from './_shared.js';

export default async function handler(req,res){
  if(!['GET','POST','DELETE'].includes(req.method))return json(res,405,{error:'Method not allowed'});
  if(req.method==='GET')return json(res,validSession(req)?200:401,{authenticated:validSession(req)});
  if(!goodOrigin(req))return json(res,403,{error:'Invalid request origin'});
  if(req.method==='DELETE'){clearSession(res);return json(res,200,{ok:true});}
  if(!configured())return json(res,503,{error:'Portal session has not been configured on the server'});
  if(!validStaff(req.body?.staff))return json(res,400,{error:'Choose a staff member'});
  if(!issueSession(res,req))return json(res,503,{error:'Portal session secret not configured'});
  return json(res,200,{authenticated:true});
}
