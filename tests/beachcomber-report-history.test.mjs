import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {reserveReport,updateReport} from '../lib/beachcomber-report-history.js';

test('actual SQL allocates increasing unit references and preserves retries',async()=>{
  const db=new PGlite();
  try{
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    await db.exec(await readFile(new URL('../smoke-alarms/beachcomber-reports-schema.sql',import.meta.url),'utf8'));
    const digest='a'.repeat(64),id=randomUUID();
    const reserve=async(session,unit,hash=digest)=>(await db.query('SELECT * FROM public.reserve_beachcomber_report($1::uuid,$2,$3)',[session,unit,hash])).rows[0];
    assert.equal((await reserve(id,'1005')).reference,'1005-1');
    assert.equal((await reserve(id,'1005')).reference,'1005-1');
    assert.equal((await reserve(randomUUID(),'1005')).reference,'1005-2');
    assert.equal((await reserve(randomUUID(),'1805')).reference,'1805-1');
    await assert.rejects(reserve(id,'1805'),/already submitted/);
    await assert.rejects(reserve(id,'1005','b'.repeat(64)),/already submitted/);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM public.beachcomber_reports'),/permission denied/);
    await assert.rejects(reserve(randomUUID(),'1005'),/permission denied/);
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await reserve(randomUUID(),'1005')).reference,'1005-3');
    await db.exec('RESET ROLE');
    const security=await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.beachcomber_reports'::regclass");
    assert.equal(security.rows[0].relrowsecurity,true);
  }finally{await db.close();}
});

test('REST reservation uses only server credentials and validates the returned reference',async()=>{
  const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
  const session={id:randomUUID()},digest='a'.repeat(64);let request;
  const fetchImpl=async(url,init)=>{request={url,init};return new Response(JSON.stringify([{session_id:session.id,unit:'1005',payload_hash:digest,report_number:2,reference:'1005-2'}]));};
  assert.equal((await reserveReport(session,'1005',digest,{env,fetchImpl})).reference,'1005-2');
  assert.match(request.url,/rpc\/reserve_beachcomber_report$/);
  assert.equal(request.init.headers.apikey,'server-only');
  await assert.rejects(reserveReport(session,'1005',digest,{env,fetchImpl:async()=>new Response('[]')}),/confirm the report number/);
});

test('delivery update permits only folder and email state and requires an actual updated row',async()=>{
  const session={id:randomUUID()},env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'};let sent;
  await updateReport(session,{workdrive_folder_id:'folder',reference:'9999-1'},{env,fetchImpl:async(_,init)=>{sent=JSON.parse(init.body);return new Response(JSON.stringify([{session_id:session.id}]));}});
  assert.deepEqual(sent,{workdrive_folder_id:'folder'});
  await assert.rejects(updateReport(session,{emailed_at:new Date().toISOString()},{env,fetchImpl:async()=>new Response('[]')}),/record report delivery/);
});
