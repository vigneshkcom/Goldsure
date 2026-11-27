import {syncSchedule} from '../lib/electrician-schedule-sync.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
  if(!process.env.CRON_SECRET || req.headers.authorization!=='Bearer '+process.env.CRON_SECRET)
    return res.status(401).json({error:'Unauthorized.'});
  try {return res.status(200).json(await syncSchedule());}
  catch(error) {console.error('[Schedule worker]',error.message);return res.status(502).json({error:'Schedule sync failed.'});}
}
