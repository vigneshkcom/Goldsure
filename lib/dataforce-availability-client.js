export function retryDelay(response, attempt, random = Math.random, now = Date.now()) {
  const header = response.headers?.get?.('retry-after');
  const seconds = header && Number(header);
  const retryAt = header && !Number.isFinite(Number(header)) ? Date.parse(header) : NaN;
  const required = Number.isFinite(retryAt) ? Math.max(0,retryAt-now) : seconds > 0 ? seconds*1000 : 0;
  return Math.max(required, 1000 * 2 ** attempt) + Math.floor(random()*500);
}
export function dataforceClient({env=process.env,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),random=Math.random}={}) {
  let token;
  const deadline=Date.now()+45000;
  async function request(path, init={}) {
    for(let attempt=0;attempt<3;attempt++) {
      if(Date.now()+1000>=deadline)throw new Error('Dataforce sync time budget reached.');
      const response=await fetchImpl('https://asap-api.dataforce.com.au'+path,{
        ...init,headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{}),...init.headers},
        signal:AbortSignal.timeout(Math.min(10000,Math.max(1,deadline-Date.now())))
      });
      if(response.ok) {await sleep(250);return response.json();}
      const transient=response.status===429 || response.status===503;
      const delay=retryDelay(response,attempt,random);
      // Long waits are persisted by the worker so serverless execution can finish.
      if(!transient || attempt===2 || delay>5000 || Date.now()+delay+10000>deadline) {
        const error=new Error('Dataforce request failed ('+response.status+').');
        error.retryMs=transient?Math.max(delay,60000):60000;
        throw error;
      }
      await sleep(delay);
    }
  }
  return {
    async authenticate() {
      if(!env.DATAFORCE_CLIENT_ID || !env.DATAFORCE_CLIENT_SECRET)throw new Error('Dataforce credentials are missing.');
      const result=await request('/authorization/token',{method:'POST',headers:{
        Authorization:'Basic '+Buffer.from(env.DATAFORCE_CLIENT_ID+':'+env.DATAFORCE_CLIENT_SECRET).toString('base64'),
        'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'client_credentials',scope:'appointment customer fieldworker job'})});
      if(!result.access_token)throw new Error('Dataforce token missing.');
      token=result.access_token;
    },
    async appointments(workerId,start,end) {
      const result=[],seen=new Set();
      for(let after=0;after<10000;) {
        const page=await request('/GOLDSURE_ASAP/appointments/search',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({filterGroups:[{filters:[
            {propertyName:'fieldworkerId',value:String(workerId),operator:'EQ'},
            {propertyName:'scheduledDate',value:start+'T00:00:00',operator:'GTE'},
            {propertyName:'scheduledDate',value:end+'T00:00:00',operator:'LT'}
          ]}],sorts:[{propertyName:'scheduledDate',direction:'asc'}],limit:100,after})});
        if(!Array.isArray(page.records))throw new Error('Dataforce schedule records missing.');
        for(const appointment of page.records) {
          if(appointment.appointmentId && seen.has(appointment.appointmentId))throw new Error('Dataforce repeated a schedule page.');
          if(appointment.appointmentId)seen.add(appointment.appointmentId);
          if(!/(cancel|abort)/i.test(appointment.completionStatusDescription || ''))result.push(appointment);
        }
        if(page.records.length<100)return result;
        after+=page.records.length;
      }
      throw new Error('Dataforce schedule pagination exceeded the limit.');
    },
    detail(path) {return request('/GOLDSURE_ASAP/'+path);}
  };
}
