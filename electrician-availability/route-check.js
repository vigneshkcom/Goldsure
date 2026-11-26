import {checkInsertionTiming} from '/lib/electrician-route-fit.js';
let mapsReady;
async function routeLibrary() {
  if (!mapsReady) mapsReady = (async()=>{
    if (!window.google?.maps?.importLibrary) {
      const response=await fetch('/api/smoke-alarms/google-key',{cache:'no-store'});
      const data=await response.json();
      if (!response.ok || !data.key) throw new Error('Driving verification is unavailable.');
      await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        const timeout=setTimeout(()=>reject(new Error('Driving maps did not load.')),15000);
        window.__availabilityMapsReady=()=>{clearTimeout(timeout);delete window.__availabilityMapsReady;resolve();};
        script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(data.key)+'&v=weekly&callback=__availabilityMapsReady';
        script.async=true;
        script.onerror=()=>{clearTimeout(timeout);reject(new Error('Driving maps did not load.'));};
        document.head.appendChild(script);
      });
    }
    return window.google.maps.importLibrary('routes');
  })().catch(error=>{mapsReady=null;throw error;});
  return mapsReady;
}
export async function verifyRouteCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return {matches:[],incomplete:false};
  let library;
  try {library=await routeLibrary();} catch {return {matches:[],incomplete:true};}
  const checked=new Array(candidates.length);
  let next=0, incomplete=false;
  async function worker(){
    while(next<candidates.length){
      const index=next++;
      const {routePlans=[],...match}=candidates[index];
      for(const plan of routePlans){
        try {
          const point=p=>({lat:p.lat,lng:p.lon});
          const response=await library.Route.computeRoutes({
            origin:point(plan.before),destination:point(plan.after),
            intermediates:[{location:point(plan.target)}],
            travelMode:'DRIVING',routingPreference:'TRAFFIC_AWARE',
            optimizeWaypointOrder:false,language:'en-AU',region:'au',
            fields:['legs']
          });
          const legs=response.routes?.[0]?.legs;
          if(!Array.isArray(legs)||legs.length!==2) throw new Error('Driving legs unavailable.');
          const minutes=legs.map(leg=>Math.ceil(Number(leg.durationMillis)/60000));
          if(minutes.some(n=>!Number.isFinite(n))) throw new Error('Driving duration unavailable.');
          const timing=checkInsertionTiming(plan,minutes);
          if(timing){
            checked[index]={...match,routeChecked:true,windowRemaining:1,durationMinutes:plan.durationMinutes};
            break;
          }
        } catch {incomplete=true;break;}
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(3,candidates.length)},worker));
  return {matches:checked.filter(Boolean).slice(0,6),incomplete};
}
