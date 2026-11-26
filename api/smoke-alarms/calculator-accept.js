import {verifyBridge} from '../../lib/smoke-booking-actions.js';
import {acceptCalculatorQuote} from '../../lib/smoke-calculator-booking.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed.'});
  if(!verifyBridge(req.body,req.headers))return res.status(401).json({error:'Invalid integration signature.'});
  try{return res.status(200).json(await acceptCalculatorQuote(req.body?.lead));}
  catch(error){console.error('[Calculator quote acceptance]',error.message);return res.status(502).json({error:'The accepted quote could not be synchronised.'});}
}
