// Verified against the Goldsure Dataforce product/question register.
// The selected product for every quoted alarm is Raptor Battery Powered (3431).
export const SMOKE_PRODUCTS = {
  alarm: { block: 34, question: 6950, answer: '23541', product: 3431, name: 'Raptor Battery Powered Smoke Alarm' },
  controller: { block: 36, question: 6949, answer: '23540', product: 3434, name: 'Raptor Smoke Alarm Controller' },
};
const same = (a,b) => Number(a) === Number(b);

export function smokeProductQuantities(quote) {
  return [
    { ...SMOKE_PRODUCTS.alarm, quantity: Number(quote.alarm_qty)||0 },
    { ...SMOKE_PRODUCTS.controller, quantity: Number(quote.ctrl_qty)||0 },
  ];
}

export function buildSmokeJobQuestions(existing, quote, jobId) {
  const result = structuredClone(existing || {});
  result.jobId = Number(jobId);
  result.answers ||= [];
  result.blockAnswers ||= [];
  const quantities = smokeProductQuantities(quote);
  if (quote.service_type !== 'Installation Quote' || quantities.some(p=>!Number.isInteger(p.quantity)||p.quantity<0||p.quantity>100) || !quantities[0].quantity) {
    throw new Error('Invalid installation product quantities');
  }
  const answer = (questionId, answerValue) => {
    const index=result.answers.findIndex(a=>same(a.questionId,questionId));
    const value={questionId,answerValue:String(answerValue)};
    if(index>=0)result.answers[index]=value;else result.answers.push(value);
  };
  // These are quote questions, not completion/installation answers.
  answer(6930,'23485');
  answer(6954,'23558');
  answer(6955,quantities[1].quantity ? '23560' : '23561');
  answer(6976,Number(quote.alarm_unit_price)>98.005?'23606':'23607');
  for(const product of quantities){
    const groups=result.blockAnswers.filter(g=>same(g.questionBlockTypeId,product.block));
    let protectedCount=0;const protectedBlocks=[];
    for(const group of groups){
      for(const block of group.blocks||[]){
        const selection=(block.answers||[]).find(a=>same(a.questionId,product.question));
        if(selection && !same(selection.answerValue,product.answer))throw new Error('Existing alarm/controller product selections need staff review');
        // Retain any location details or other staff-entered answers intact.
        if((block.answers||[]).length!==1 || !selection){protectedBlocks.push(block);if(selection)protectedCount++;}
      }
    }
    if(protectedCount>product.quantity)throw new Error('Cannot remove product blocks containing staff-entered details');
    const blocks=[...protectedBlocks,...Array.from({length:product.quantity-protectedCount},()=>({answers:[{questionId:product.question,answerValue:product.answer}]}))];
    const first=result.blockAnswers.findIndex(g=>same(g.questionBlockTypeId,product.block));
    result.blockAnswers=result.blockAnswers.filter(g=>!same(g.questionBlockTypeId,product.block));
    const group={...(groups[0]||{}),questionBlockTypeId:product.block,blocks};
    if(first>=0)result.blockAnswers.splice(first,0,group);else if(blocks.length)result.blockAnswers.push(group);
  }
  if(Number(quote.alarm_unit_price)>98.005){
    const group=result.blockAnswers.find(g=>same(g.questionBlockTypeId,39));
    if(group && (group.blocks?.length>1 || group.blocks?.some(b=>(b.answers||[]).some(a=>!same(a.questionId,6977)))))throw new Error('Existing ceiling details need staff review');
    const ceiling={questionBlockTypeId:39,blocks:[{answers:[{questionId:6977,answerValue:String(quantities[0].quantity)}]}]};
    if(group)Object.assign(group,ceiling);else result.blockAnswers.push(ceiling);
  }
  return result;
}

export function verifySmokeProductLines(document, quote) {
  const products=smokeProductQuantities(quote);
  const lines=document?.productLines;
  if(!Array.isArray(lines))throw new Error('Dataforce product verification unavailable');
  for(const product of products){
    const quantity=lines.filter(l=>same(l.productId,product.product)).reduce((n,l)=>n+Number(l.lineQty||0),0);
    if(quantity!==product.quantity)throw new Error(`Dataforce did not confirm ${product.quantity} × ${product.name}`);
  }
  if(lines.some(l=>same(l.productId,3430)&&Number(l.lineQty)>0))throw new Error('Unexpected hardwired alarm selection needs review');
  return products.filter(p=>p.quantity>0).map(({product,name,quantity})=>({product_id:product,name,quantity}));
}

export async function syncSmokeJobProducts({ request, jobId, quote }) {
  if(quote.service_type!=='Installation Quote')return {synced:false,reason:'not-installation',products:[]};
  const path=`/jobs/${encodeURIComponent(jobId)}/questions`;
  const existing=await request(path);
  const desired=buildSmokeJobQuestions(existing,quote,jobId);
  if(JSON.stringify(existing)!==JSON.stringify(desired)){
    // This endpoint replaces all answers: desired includes unrelated answers.
    await request(path,{method:'POST',body:JSON.stringify(desired)});
  }
  const saved=await request(path);
  // Check the answers AND the calculated quote, rather than trusting a POST 201.
  for(const p of smokeProductQuantities(quote)){
    const count=(saved.blockAnswers||[]).filter(g=>same(g.questionBlockTypeId,p.block)).flatMap(g=>g.blocks||[]).filter(b=>(b.answers||[]).some(a=>same(a.questionId,p.question)&&same(a.answerValue,p.answer))).length;
    if(count!==p.quantity)throw new Error('Dataforce product answers did not persist');
  }
  const document=await request(`/jobs/${encodeURIComponent(jobId)}/quote`);
  return {synced:true,products:verifySmokeProductLines(document,quote)};
}
