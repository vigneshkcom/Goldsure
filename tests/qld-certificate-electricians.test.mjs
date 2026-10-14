import test from 'node:test';
import assert from 'node:assert/strict';
import { certificateElectrician, listCertificateElectricians } from '../lib/qld-certificate-electricians.js';
import { certificateAction } from '../lib/qld-certificates.js';
const worker = {fieldworkerId:1009,firstName:'Sam',surname:'Example',companyName:'Example Electrical',email:'sam@example.test',mobilePhone:'0400000001',apiPassword:'never-expose',taxId:'never-expose',attributes:[{name:'Electrical License Number',value:'0012345'},{name:'Electrical License Expiry',value:'2026-10-01T00:00:00+10:00'}],abilities:[{name:'QLD Smoke + LED',setting:true}]};
test('Dataforce electrical licence is prefilled for the contractor field and secrets never leave server',()=>{
  const result = certificateElectrician(worker,new Date('2026-10-13'));
  assert.equal(result.name,'Sam Example'); assert.equal(result.contractorLicence,'0012345');
  assert.equal(result.recordedElectricalLicence,'0012345'); assert.equal(result.electricalLicenceExpired,true);
  assert.doesNotMatch(JSON.stringify(result),/never-expose|apiPassword|taxId/);
});
test('explicit contractor licence takes priority; missing licences stay empty; disabled QLD ability excluded',()=>{
  assert.equal(certificateElectrician({...worker,attributes:[{name:'Electrical Contractor Licence Number',value:'012345'}]}).contractorLicence,'012345');
  assert.equal(certificateElectrician({...worker,attributes:[]}).recordedElectricalLicence,'');
  assert.equal(certificateElectrician({...worker,abilities:[{name:'QLD Smoke + LED',setting:false}]}),null);
  assert.equal(certificateElectrician({...worker,fieldworkerId:undefined}),null);
});
test('electricians list needs no password and only reads fieldworkers',async()=>{
  const calls=[]; const env={DATAFORCE_CLIENT_ID:'test',DATAFORCE_CLIENT_SECRET:'test'};
  const fetchImpl=async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify(url.includes('/authorization/')?{access_token:'fake'}:{totalCount:1,records:[worker]}));};
  const result=await certificateAction({action:'qld-certificate-electricians'},{headers:{}},{env,store:{},fetch:fetchImpl});
  assert.equal(result.electricians.length,1); assert.equal(calls.length,2); assert.equal(calls[1].init.method,undefined);
  assert.equal(calls[1].url,'https://asap-api.dataforce.com.au/GOLDSURE_ASAP/fieldworkers');
});
test('Dataforce errors and incomplete results fail explicitly, never masquerade as an empty successful list',async()=>{
  const env={DATAFORCE_CLIENT_ID:'test',DATAFORCE_CLIENT_SECRET:'test'};
  await assert.rejects(listCertificateElectricians(env,async()=>new Response('{}',{status:401})),/authentication failed/);
  await assert.rejects(listCertificateElectricians(env,async(url)=>new Response(JSON.stringify(url.includes('/authorization/')?{access_token:'fake'}:{totalCount:2,records:[worker]}))),/incomplete/);
});
