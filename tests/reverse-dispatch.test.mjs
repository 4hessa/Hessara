import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import {createDatabase} from '../lib/postgres-database.ts';
import {createReverseEngineeringService} from '../lib/reverse-engineering/service.ts';
import {createReverseEngineeringQueue} from '../lib/reverse-engineering/queue.ts';

async function queueFixture(){
 const pg=new PGlite();
 try{
  await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE hessara_runtime NOLOGIN NOINHERIT NOBYPASSRLS;GRANT USAGE ON SCHEMA public TO hessara_runtime;');
  await pg.exec(await readFile(new URL('../supabase/reverse-engineering-draft.sql',import.meta.url),'utf8'));
  await pg.exec('SET ROLE hessara_runtime');
  const execute=client=>async(sql,values)=>{const r=await client.query(sql,values);return{rows:r.rows,count:r.affectedRows??r.rows.length};};
  const db=createDatabase(execute(pg),work=>pg.transaction(tx=>work(execute(tx))));
  const service=createReverseEngineeringService(db),queue=createReverseEngineeringQueue(db),owner='fixture-owner';
  const project=await service.createProject(owner,{name:'Authored dispatch fixture'});
  const artifact=await service.reserveArtifact(owner,{projectId:project.id,name:'authored.elf',sizeBytes:128,storageKey:owner+'/fixture/'+randomUUID()});
  await service.completeArtifact(owner,artifact.id,{format:'elf',sha256:'a'.repeat(64)});
  const worker={workerId:'dispatch-worker',engines:[{id:'rizin',version:'fixture-version',healthy:true,enabled:true,capacity:1,capabilities:['functions'],verification:{passed:true,imageDigest:'fixture.invalid/test@sha256:'+'a'.repeat(64),engineVersion:'fixture-version',artifactSha256:'b'.repeat(64),verifiedAt:Date.now()-1000}}],capacity:{slots:1,cpuCount:1,availableMemoryMb:4096,diskFreeMb:4096}};
  await queue.registerWorker(worker);await service.configure(owner,true,{engineId:'rizin',enabled:true});await service.configure(owner,true,{acceptingJobs:true});
  const job=await service.createJob(owner,{projectId:project.id,artifactId:artifact.id,engineId:'rizin',authorizationConfirmed:true,idempotencyKey:randomUUID()});
  const claimed=await queue.claim(worker);assert.equal(claimed.job.id,job.id);
  const lease={workerId:worker.workerId,jobId:job.id,leaseToken:claimed.leaseToken};
  const workerSQL=async(sql,...values)=>(await db.batch([db.prepare("SELECT set_config('hessara.re_worker','true',true)"),db.prepare(sql).bind(...values)]))[1].results;
  const state=async()=>({job:(await workerSQL('SELECT * FROM re_jobs WHERE id=?',job.id))[0],executions:await workerSQL('SELECT * FROM re_executions WHERE job_id=? ORDER BY attempt',job.id),audits:await workerSQL('SELECT * FROM re_audit WHERE entity_id=? ORDER BY created_at,id',job.id)});
  return{pg,db,service,queue,owner,worker,job,lease,workerSQL,state};
 }catch(error){await pg.close();throw error;}
}

test('undelivered claims refund analysis attempts, back off, audit dispatch failures and stop after three',async()=>{
 const f=await queueFixture();
 try{
  let lease=f.lease;
  for(let failure=1;failure<=3;failure++){
   const released=await f.queue.releaseClaim({...lease,code:failure===1?'unknown-private-key-or-url':'STORAGE_UNAVAILABLE'});
   assert.deepEqual(released,{released:true,status:failure===3?'failed':'queued'});
   const current=await f.state(),job=current.job;
   assert.equal(job.attempt,0,'URL signing does not consume actual tool attempts');assert.equal(job.metadata.dispatchFailures,failure);assert.equal(job.metadata.executionIdentity,undefined);
   assert.equal(job.lease_token,null);assert.equal(Number(job.lease_until),0);assert.equal(job.worker_id,null);assert.equal(job.deadline_at,null);assert.equal(job.started_at,null);assert.equal(current.executions.length,0);
   const audit=current.audits.filter(row=>row.action==='job.dispatch_failed');assert.equal(audit.length,failure);assert.equal(audit.at(-1).details.analysisStarted,false);assert.equal(audit.at(-1).details.reservedAttempt,1);assert.equal(audit.at(-1).details.dispatchFailures,failure);
   assert.equal(audit[0].details.code,'ARTIFACT_SIGN_FAILED');assert.ok(!JSON.stringify(audit).includes('private-key'));
   if(failure<3){
    assert.equal(job.finished_at,null);assert.equal(job.stage,'dispatch_wait');assert.ok(Number(job.available_at)>Date.now());
    assert.equal((await f.queue.claim(f.worker)).job,null,'Backoff prevents an immediate busy loop');
    await f.workerSQL('UPDATE re_jobs SET available_at=? WHERE id=?',Date.now()-1,f.job.id);
    const next=await f.queue.claim(f.worker);assert.equal(next.job.id,f.job.id,'Refund can claim the same attempt again without a unique-execution collision');assert.notEqual(next.leaseToken,lease.leaseToken);
    lease={...lease,leaseToken:next.leaseToken};
   }else{assert.equal(job.stage,'dispatch_failed');assert.ok(Number(job.finished_at)>0);assert.equal((await f.queue.claim(f.worker)).job,null);}
  }
  for(const table of ['re_usage','re_findings','re_evidence'])assert.equal((await f.workerSQL(`SELECT * FROM ${table} WHERE job_id=?`,f.job.id)).length,0);
  assert.equal((await f.workerSQL("SELECT failures FROM re_engines WHERE id='rizin'"))[0].failures,0,'Storage dispatch failures do not trip engine failure circuits');
 }finally{await f.pg.close();}
});

test('cancellation wins over dispatch retry and duplicate compensation is an immutable no-op',async()=>{
 const f=await queueFixture();
 try{
  await f.service.cancelJob(f.owner,f.job.id);
  assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:true,status:'cancelled'});
  const before=await f.state();assert.equal(before.job.error_code,'CANCELLED');assert.equal(before.job.attempt,0);assert.equal(before.executions.length,0);assert.ok(Number(before.job.finished_at)>0);
  assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),before);
 }finally{await f.pg.close();}
});

test('stale, mismatched, expired and already-running leases cannot refund execution or change history',async()=>{
 const f=await queueFixture();
 try{
  for(const lease of [{...f.lease,leaseToken:'wrong-token'},{...f.lease,workerId:'wrong-worker'},{...f.lease,jobId:'wrong-job'}]){
   const before=await f.state();assert.deepEqual(await f.queue.releaseClaim({...lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),before);
  }
  const initial=await f.state();
  await f.workerSQL('UPDATE re_jobs SET deadline_at=? WHERE id=?',Date.now()-1,f.job.id);
  let guarded=await f.state();assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),guarded);
  await f.workerSQL('UPDATE re_jobs SET deadline_at=? WHERE id=?',Number(initial.job.deadline_at),f.job.id);
  await f.workerSQL("UPDATE re_executions SET finished_at=?,status='failed' WHERE job_id=?",Date.now(),f.job.id);
  guarded=await f.state();assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),guarded);
  await f.workerSQL("UPDATE re_executions SET finished_at=NULL,status='validating' WHERE job_id=?",f.job.id);
  await f.workerSQL('UPDATE re_jobs SET lease_until=? WHERE id=?',Date.now()-1,f.job.id);
  let before=await f.state();assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),before);
  await f.queue.recover();await f.workerSQL('UPDATE re_jobs SET available_at=? WHERE id=?',Date.now()-1,f.job.id);
  const secondWorker={...f.worker,workerId:'reassigned-worker'};const next=await f.queue.claim(secondWorker);assert.equal(next.job.id,f.job.id);
  before=await f.state();assert.deepEqual(await f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),before);
  const lease={workerId:secondWorker.workerId,jobId:f.job.id,leaseToken:next.leaseToken};
  await f.queue.heartbeat({...lease,stage:'validating',capacity:secondWorker.capacity});
  before=await f.state();assert.equal(before.job.status,'running');assert.deepEqual(await f.queue.releaseClaim({...lease,code:'STORAGE_UNAVAILABLE'}),{released:false});assert.deepEqual(await f.state(),before);
 }finally{await f.pg.close();}
});

test('refunding an undelivered retry preserves real analysis history and malformed dispatch budgets fail closed',async()=>{
 const f=await queueFixture();
 try{
  await f.queue.heartbeat({...f.lease,stage:'running',capacity:f.worker.capacity});
  await f.queue.fail({...f.lease,code:'NETWORK_TEMPORARY',retryable:true});
  const history=await f.state();assert.equal(history.executions.length,1);assert.equal(history.executions[0].status,'failed');assert.equal(history.job.attempt,1);
  await f.workerSQL('UPDATE re_jobs SET available_at=? WHERE id=?',Date.now()-1,f.job.id);
  const next=await f.queue.claim(f.worker);const lease={...f.lease,leaseToken:next.leaseToken};
  assert.deepEqual(await f.queue.releaseClaim({...lease,code:'STORAGE_UNAVAILABLE'}),{released:true,status:'queued'});
  const refunded=await f.state();assert.equal(refunded.job.attempt,1);assert.equal(refunded.job.started_at,history.job.started_at);assert.deepEqual(refunded.executions,history.executions);
  assert.equal(refunded.audits.filter(row=>row.action==='job.dispatch_failed').at(-1).details.reservedAttempt,2);
  await f.workerSQL('UPDATE re_jobs SET available_at=? WHERE id=?',Date.now()-1,f.job.id);
  const final=await f.queue.claim(f.worker);assert.equal(final.job.id,f.job.id);
  await f.workerSQL('UPDATE re_jobs SET metadata=?::jsonb WHERE id=?',JSON.stringify({dispatchFailures:'1'}),f.job.id);
  assert.deepEqual(await f.queue.releaseClaim({...lease,leaseToken:final.leaseToken,code:'STORAGE_NOT_CONFIGURED'}),{released:true,status:'failed'});
  const ended=await f.state();assert.equal(ended.job.metadata.dispatchFailures,3);assert.equal(ended.job.attempt,1);assert.deepEqual(ended.executions,history.executions);
 }finally{await f.pg.close();}
});
test('dispatch compensation and reservation deletion roll back if their audit write fails',async()=>{
 const f=await queueFixture();
 try{
  await f.pg.exec("RESET ROLE;CREATE FUNCTION reject_dispatch_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='job.dispatch_failed' THEN RAISE EXCEPTION 'owned audit fixture failure';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_dispatch_fixture BEFORE INSERT ON re_audit FOR EACH ROW EXECUTE FUNCTION reject_dispatch_fixture();SET ROLE hessara_runtime;");
  const before=await f.state();await assert.rejects(f.queue.releaseClaim({...f.lease,code:'STORAGE_UNAVAILABLE'}),/owned audit fixture failure/);assert.deepEqual(await f.state(),before);
 }finally{await f.pg.close();}
});

async function routeFixture(){
 const stubs={
  '@/lib/auth':'export async function authenticatedUser(){throw Error("Unexpected user auth");}',
  '@/lib/server':'export const availableModels=()=>{},invokeModel=()=>{},modelConfig=()=>{};',
  '@/lib/postgres-database':'export function database(){return{prepare(){return{bind(){return{first:async()=>({used:1})}}}}}}',
  '@/lib/reverse-engineering/queue':'export const reQueue={async claim(){const s=globalThis.__dispatchRouteFixture;s.claims++;return s.claim;},async releaseClaim(input){const s=globalThis.__dispatchRouteFixture;s.releases.push(input);if(s.releaseFails)throw Object.assign(Error("private database URL"),{code:"08006"});return{released:true,status:"queued"};}};',
  '@/lib/reverse-engineering/storage':'import{ArtifactError}from"@/lib/reverse-engineering/content";export async function signWorkerArtifact(key){const s=globalThis.__dispatchRouteFixture;s.signs.push(key);if(s.signFails)throw new ArtifactError("STORAGE_UNAVAILABLE",503);return"https://fixture.invalid/signed-download";}export const signArtifactUpload=()=>{},storageHealth=()=>{},verifyStoredArtifact=()=>{},removeStoredArtifact=()=>{};'
 };
 const bundle=await build({entryPoints:['app/api/reverse-engineering/[...path]/route.ts'],absWorkingDir:process.cwd(),bundle:true,platform:'node',format:'cjs',packages:'external',write:false,tsconfig:resolve('tsconfig.json'),plugins:[{name:'controlled-dispatch-boundary',setup(builder){builder.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'dispatch-test'}:undefined);builder.onLoad({filter:/.*/,namespace:'dispatch-test'},args=>({contents:stubs[args.path],resolveDir:process.cwd()}));}}]});
 const mod={exports:{}},logs=[];
 new Function('require','module','exports','process','console',bundle.outputFiles[0].text)(createRequire(resolve('package.json')),mod,mod.exports,{env:{HESSARA_RE_WORKER_TOKEN:'x'.repeat(40)}},{...console,error:(...values)=>logs.push(values)});
 return{route:mod.exports,logs};
}
test('actual worker route compensates failed signing but keeps truthful errors and unchanged successful dispatch',async()=>{
 const fixture=await routeFixture();
 const request=token=>new Request('https://hessara.test/api/reverse-engineering/worker',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({action:'claim',registration:{workerId:'fixture-worker'}})});
 const call=token=>fixture.route.POST(request(token??'x'.repeat(40)),{params:Promise.resolve({path:['worker']})});
 const initial=()=>({claims:0,releases:[],signs:[],signFails:false,releaseFails:false,claim:{job:{id:'fixture-job',artifact:{storageKey:'fixture-storage'}},leaseToken:'fixture-lease',leaseSeconds:45}});
 try{
  let state=globalThis.__dispatchRouteFixture=initial();const denied=await call('untrusted');assert.equal(denied.status,401);assert.equal(state.claims,0);
  const success=await call();assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'no-store');assert.equal((await success.json()).job.artifact.downloadUrl,'https://fixture.invalid/signed-download');assert.equal(state.releases.length,0);
  state=globalThis.__dispatchRouteFixture=initial();state.signFails=true;
  const failed=await call();assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'STORAGE_UNAVAILABLE'});assert.deepEqual(state.releases,[{workerId:'fixture-worker',jobId:'fixture-job',leaseToken:'fixture-lease',code:'STORAGE_UNAVAILABLE'}]);
  state=globalThis.__dispatchRouteFixture=initial();state.signFails=true;state.releaseFails=true;
  const recoveryFailed=await call();assert.equal(recoveryFailed.status,503);assert.deepEqual(await recoveryFailed.json(),{error:'STORAGE_UNAVAILABLE'});assert.equal(state.releases.length,1);assert.ok(!JSON.stringify(fixture.logs).includes('private database URL'));
  state=globalThis.__dispatchRouteFixture=initial();state.claim={job:null};const empty=await call();assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{job:null});assert.equal(state.signs.length,0);assert.equal(state.releases.length,0);
 }finally{delete globalThis.__dispatchRouteFixture;}
});
