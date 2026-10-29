import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {CLOUDFLARE_MODELS,cloudflareConnection,invokeCloudflare,FREE_MODEL_LIMITS,reserveFreeModelCall} from '../lib/cloudflare-models.ts';

const owner='11111111-1111-4111-8111-111111111111';
const env={HESSARA_INFERENCE_URL:'https://hessara-model-gateway.hessa-alzahrani-sa.workers.dev/',HESSARA_INFERENCE_SECRET:'s'.repeat(64),HESSARA_FREE_MODELS_ENABLED:'true'};
const db={prepare(sql){return{bind(...values){return{sql,values};}};},async ownerQuotaBatch(lock,statements){assert.equal(lock,'cloudflare-free-global');assert.equal(statements[0].values[0],'cloudflare-free:global');assert.equal(statements[0].values[3],`cloudflare-free:${owner}`);return [{results:[{used:1},{used:1}]}];}};

test('free inference remains disabled without explicit activation and a restricted server-only bridge',()=>{
  assert.ok(cloudflareConnection(env));
  for(const change of [{HESSARA_FREE_MODELS_ENABLED:'false'},{HESSARA_INFERENCE_SECRET:'short'},{HESSARA_INFERENCE_URL:'http://hessara-model-gateway.hessa-alzahrani-sa.workers.dev/'},{HESSARA_INFERENCE_URL:'https://attacker.workers.dev/'},{HESSARA_INFERENCE_URL:env.HESSARA_INFERENCE_URL+'?secret=no'},{HESSARA_INFERENCE_URL:env.HESSARA_INFERENCE_URL+'v1/infer'}])assert.equal(cloudflareConnection({...env,...change}),null);
});

test('actual upstream call is signed over identity and exact body; real output and evidence survive',async()=>{
  let calls=0;
  const result=await invokeCloudflare('أجب بكلمة واحدة: مرحبًا',CLOUDFLARE_MODELS[0].model,owner,db,{maxOutputTokens:1024},env,async(url,init)=>{
    calls++;assert.equal(String(url),env.HESSARA_INFERENCE_URL+'v1/infer');
    const body=JSON.parse(init.body);assert.equal(body.max_tokens,512);assert.equal(body.prompt,'أجب بكلمة واحدة: مرحبًا');
    assert.equal(init.redirect,'error');assert.equal(init.headers['x-hessara-owner'],owner);
    assert.equal(init.headers['x-hessara-signature'],createHmac('sha256',env.HESSARA_INFERENCE_SECRET).update(`${init.headers['x-hessara-timestamp']}\n${owner}\n${init.body}`).digest('hex'));
    assert.ok(!init.body.includes(env.HESSARA_INFERENCE_SECRET));
    return Response.json({output:'مرحبًا',model:body.model,provider:'cloudflare',truncated:false,requestId:'test-request',input_tokens:20,output_tokens:4});
  });
  assert.equal(calls,1);assert.equal(result.output,'مرحبًا');assert.equal(result.error,null);assert.equal(result.cost,null);assert.equal(result.input_tokens,20);assert.equal(JSON.parse(result.metadata).request_id,'test-request');assert.equal(JSON.parse(result.metadata).max_output_tokens,512);assert.equal(JSON.parse(result.metadata).resolved_model,null,'an echoed identifier is not a verified revision');
});

test('quota, oversized content, forged model and malformed identity prevent requests',async()=>{
  const never=async()=>{throw new Error('must not fetch');};
  const limited={...db,ownerQuotaBatch:async()=>[{results:[]}]};
  assert.equal((await invokeCloudflare('question',CLOUDFLARE_MODELS[0].model,owner,limited,undefined,env,never)).error,'provider_http_429');
  assert.equal((await invokeCloudflare('x'.repeat(FREE_MODEL_LIMITS.promptCharacters+1),CLOUDFLARE_MODELS[0].model,owner,db,undefined,env,never)).error,'provider_input_too_large');
  assert.equal((await invokeCloudflare('question','not-allowed',owner,db,undefined,env,never)).error,'provider_not_configured');
  assert.equal((await invokeCloudflare('question',CLOUDFLARE_MODELS[0].model,'anonymous',db,undefined,env,never)).error,'provider_not_configured');
});

test('failures and mismatched responses are never shown as successful or automatically retried',async()=>{
  for(const response of [Response.json({error:'PROVIDER_LIMIT'},{status:429}),Response.json({output:'invented',model:'other',provider:'cloudflare'}),new Response('invalid')]){
    let calls=0;const result=await invokeCloudflare('question',CLOUDFLARE_MODELS[0].model,owner,db,undefined,env,async()=>{calls++;return response;});assert.equal(calls,1);assert.ok(result.error);assert.equal(result.output,'');
  }
});

test('a mixed laboratory comparison rejects an output setting the free provider cannot honor before creating a run',async()=>{
  const {createLabService}=await import('../lib/lab-service.ts');
  let mutations=0;
  const service=createLabService({db:{prepare(){return{bind(){return{first:async()=>null};}};},ownerQuotaBatch:async()=>{mutations++;throw new Error('must not create run');}},
    availableModels:async()=>[{id:'cf-llama33',provider:'cloudflare',ready:true},{id:'private',provider:'anthropic',ready:true}],
    modelConfig:async id=>({id,provider:id==='private'?'anthropic':'cloudflare',model:id,name:id,inputPrice:null,outputPrice:null}),
    invokeModel:async()=>{throw new Error('must not invoke');}});
  await assert.rejects(service.createLabRun(owner,{requestId:crypto.randomUUID(),name:'Fair comparison',taskType:'writing',locale:'ar',models:['cf-llama33','private'],cases:[{id:crypto.randomUUID(),title:'Question',prompt:'Write a sentence.'}],maxOutputTokens:1024}),{message:'INVALID_INPUT'});
  assert.equal(mutations,0);
});

test('persistent database quota protects concurrent callers and resets on a new UTC day',async()=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const {createDatabase}=await import('../lib/postgres-database.ts');
  const pg=new PGlite();
  try{
    await pg.exec('CREATE TABLE decision_usage(owner TEXT PRIMARY KEY,day TEXT NOT NULL,used INTEGER NOT NULL);');
    const database=createDatabase(async(sql,values)=>{const r=await pg.query(sql,values);return{rows:r.rows,count:r.affectedRows??r.rows.length};},work=>pg.transaction(tx=>work(async(sql,values)=>{
      if(sql.startsWith('SET TRANSACTION')||sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[],count:0};
      const r=await tx.query(sql,values);return{rows:r.rows,count:r.affectedRows??r.rows.length};
    })));
    const day=new Date('2026-10-15T12:00:00Z');
    const outcomes=await Promise.all(Array.from({length:18},()=>reserveFreeModelCall(database,owner,day)));
    assert.equal(outcomes.filter(Boolean).length,FREE_MODEL_LIMITS.ownerDaily);
    assert.equal((await pg.query('SELECT used FROM decision_usage WHERE owner=$1',[`cloudflare-free:${owner}`])).rows[0].used,FREE_MODEL_LIMITS.ownerDaily);
    assert.equal((await pg.query('SELECT used FROM decision_usage WHERE owner=$1',['cloudflare-free:global'])).rows[0].used,FREE_MODEL_LIMITS.ownerDaily,'denied owner calls cannot burn the shared quota');
    await pg.query('UPDATE decision_usage SET used=$1 WHERE owner=$2',[FREE_MODEL_LIMITS.globalDaily,'cloudflare-free:global']);
    assert.equal(await reserveFreeModelCall(database,'22222222-2222-4222-8222-222222222222',day),false);
    assert.equal((await pg.query('SELECT used FROM decision_usage WHERE owner=$1',['cloudflare-free:22222222-2222-4222-8222-222222222222'])).rows.length,0,'denied global calls do not consume the owner quota');
    assert.equal(await reserveFreeModelCall(database,owner,new Date('2026-10-16T00:00:00Z')),true);
  }finally{await pg.close();}
});
