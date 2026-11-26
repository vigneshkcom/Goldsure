import {verifyBookingAction} from '../../lib/smoke-booking-actions.js';
import {calculatorBookingStatus,syncCalculatorBooking,sendCalculatorBookingRequest} from '../../lib/smoke-calculator-booking.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed.'});
  const params=req.method==='GET'?req.query:req.body;
  if(!verifyBookingAction(params||{}))return res.status(401).json({error:'This staff booking link is invalid or expired.'});
  try{
    if(req.method==='GET')return res.status(200).json(await calculatorBookingStatus(params.token));
    if(params.action==='sync')return res.status(200).json(await syncCalculatorBooking(params.token));
    if(params.action==='send')return res.status(200).json(await sendCalculatorBookingRequest(params.token));
    return res.status(400).json({error:'Unknown action.'});
  }catch(error){console.error('[Calculator booking action]',error.message);return res.status(409).json({error:error.message});}
}
