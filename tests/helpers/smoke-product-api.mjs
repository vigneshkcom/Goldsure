// Simulates the product API for the existing job-creation integration tests.
export function withSmokeProductApi(fetchImpl) {
 let saved={answers:[],blockAnswers:[]};
 return async (url,options={})=>{
  const path=new URL(url).pathname;
  if(/\/jobs\/\d+\/questions$/.test(path)){
   if(options.method==='POST')saved=JSON.parse(options.body);
   return new Response(JSON.stringify(saved),{status:200});
  }
  if(/\/jobs\/\d+\/quote$/.test(path)){
   const lines=[];
   for(const [block,question,answer,productId] of [[34,6950,23541,3431],[36,6949,23540,3434]]){
    const lineQty=(saved.blockAnswers||[]).filter(g=>g.questionBlockTypeId===block).flatMap(g=>g.blocks||[]).filter(b=>b.answers.some(a=>a.questionId===question&&Number(a.answerValue)===answer)).length;
    if(lineQty)lines.push({productId,lineQty});
   }
   return new Response(JSON.stringify({productLines:lines}),{status:200});
  }
  return fetchImpl(url,options);
 };
}
