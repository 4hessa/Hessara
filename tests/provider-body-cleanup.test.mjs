import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {getEventListeners} from 'node:events';
import {readProviderJson,PROVIDER_RESPONSE_BYTES} from '../lib/nvidia.ts';
import {readAssistantJson,assistantLimits,invokeAssistant} from '../lib/assistant-providers.ts';
import {readLabJson,LAB_LIMITS} from '../lib/custom-lab.ts';
import {createCodeWorkspaceHandlers,CODE_WORKSPACE_LIMITS} from '../lib/code-workspace-bridge.ts';

const encoder=new TextEncoder();
const nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout;
const request=body=>new Request('https://fixture.test',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'});
function heldBody(bytes,cancelResult=()=>new Promise(()=>{})){
 let cancels=0;const body=new ReadableStream({start(controller){if(bytes)controller.enqueue(bytes);},cancel(){cancels++;return cancelResult();}});
 return{body,cancels:()=>cancels};
}
async function bounded(task){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=nativeTimeout(()=>reject(new Error('Cleanup did not settle within500ms')),500);})]);}finally{nativeClearTimeout(timer);}}
const readers=[
 {name:'NVIDIA response',limit:PROVIDER_RESPONSE_BYTES,read:body=>readProviderJson(new Response(body)),error:'provider_response_too_large'},
 {name:'assistant response',limit:assistantLimits.responseBytes,read:body=>readAssistantJson(new Response(body)),error:'PROVIDER_RESPONSE',status:502},
 {name:'assistant input',limit:assistantLimits.requestBytes,read:body=>readAssistantJson(request(body),true),error:'INVALID_INPUT',status:413},
 {name:'lab input',limit:LAB_LIMITS.requestBytes,read:body=>readLabJson(request(body)),error:'INVALID_INPUT',status:413},
];
for(const reader of readers)test(`${reader.name} overflow preserves its intended error and unlocks despite stalled or rejected cancellation`,async()=>{
 for(const cancel of [()=>new Promise(()=>{}),()=>Promise.reject(new Error('private cleanup detail'))]){
  const fixture=heldBody(new Uint8Array(reader.limit+1),cancel);
  await assert.rejects(bounded(reader.read(fixture.body)),error=>error.message===reader.error&&(reader.status===undefined||error.status===reader.status));
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);await new Promise(setImmediate);
 }
});
for(const[name,read]of [
 ['NVIDIA',body=>readProviderJson(new Response(body,{headers:{'content-length':String(PROVIDER_RESPONSE_BYTES+1)}}))],
 ['assistant',body=>readAssistantJson(new Response(body,{headers:{'content-length':String(assistantLimits.responseBytes+1)}}))],
 ['lab',body=>readLabJson(new Request('https://fixture.test',{method:'POST',headers:{'content-length':String(LAB_LIMITS.requestBytes+1)},body,duplex:'half'}))],
])test(`${name} advertised oversize cancels the unused body without waiting`,async()=>{
 const fixture=heldBody();await assert.rejects(bounded(read(fixture.body)));assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});
test('nonOK assistant calls preserve sanitized authentication/rate-limit errors despite stalled or rejected cleanup',async()=>{
 for(const[status,expected,http]of [[401,'PROVIDER_AUTH',502],[429,'PROVIDER_RATE_LIMIT',429]])for(const cancel of [()=>new Promise(()=>{}),()=>Promise.reject(new Error('private cleanup detail'))]){
  const fixture=heldBody(undefined,cancel);let requests=0;
  await assert.rejects(bounded(invokeAssistant({provider:'grok',action:'run',apiKey:'fixture-key-not-real',prompt:'controlled fixture request'},'fixture-owner',async(url,init)=>{
   requests++;assert.equal(url,'https://api.x.ai/v1/chat/completions');assert.equal(init.redirect,'error');return new Response(fixture.body,{status});
  })),error=>error.message===expected&&error.status===http);
  assert.equal(requests,1);assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);await new Promise(setImmediate);
 }
});
test('bounded JSON readers retain normal Arabic data and unlock on source read failure',async()=>{
 for(const reader of readers){
  const value={text:'مرحبا بالعالم'};const body=new ReadableStream({start(controller){controller.enqueue(encoder.encode(JSON.stringify(value)));controller.close();}});
  assert.deepEqual(await reader.read(body),value);assert.equal(body.locked,false);
  const original=new Error('owned read failure');const failed=new ReadableStream({start(controller){controller.error(original);}});
  await assert.rejects(reader.read(failed),error=>error===original);assert.equal(failed.locked,false);
 }
});
const owner='f9179bf6-e92d-43dd-a7d0-27b5efb6b97e';
function bridge(fetcher=async()=>assert.fail('Invalid inputs must not reach the worker')){
 return createCodeWorkspaceHandlers({identity:async()=>owner,environment:()=>({HESSARA_CODE_WORKER_URL:'https://fixture-code.workers.dev',HESSARA_CODE_WORKER_SECRET:'fixture-secret-32-characters-long-enough'}),fetcher});
}
test('code bridge rejects oversized input promptly and releases the reader when cancellation stalls',async()=>{
 const fixture=heldBody(new Uint8Array(CODE_WORKSPACE_LIMITS.requestBytes+1));
 const response=await bounded(bridge().POST(request(fixture.body)));assert.equal(response.status,429);assert.deepEqual(await response.json(),{error:'LIMIT'});assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});
test('code bridge cancels advertised oversized input and invalid worker content without awaiting either',async()=>{
 const fixture=heldBody();const oversized=new Request('https://fixture.test',{method:'POST',headers:{'content-type':'application/json','content-length':String(CODE_WORKSPACE_LIMITS.requestBytes+1)},body:fixture.body,duplex:'half'});
 assert.equal((await bounded(bridge().POST(oversized))).status,429);assert.equal(fixture.cancels(),1);
 const upstream=heldBody();const result=await bounded(bridge(async()=>new Response(upstream.body,{headers:{'content-type':'text/plain'}})).GET(new Request('https://fixture.test')));
 assert.equal((await result.json()).readiness.connected,false);assert.equal(upstream.cancels(),1);assert.equal(upstream.body.locked,false);
});

// Exercise the actual decisions route while isolating only identity/database access.
const bundle=await build({absWorkingDir:process.cwd(),entryPoints:['app/api/decisions/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,tsconfig:'tsconfig.json',plugins:[{name:'no-external-services',setup(builder){
 builder.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}export async function identity(){return 'fixture-owner'}export function database(){return{prepare(){return{bind(){return{async first(){return{used:1}}}}}}}}export function fail(error){return Response.json({error:error.message},{status:error.status??503})}`}));
}}]});
const routeModule={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),routeModule,routeModule.exports);const decision=routeModule.exports;
test('decision input overflow rejects and unlocks without waiting on caller-controlled cancellation',async()=>{
 const fixture=heldBody(new Uint8Array(12001));const response=await bounded(decision.POST(request(fixture.body)));assert.equal(response.status,413);assert.deepEqual(await response.json(),{error:'INVALID_INPUT'});assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});
test('decision route releases valid input and output readers and cleans an unused provider error body',async()=>{
 const previous=globalThis.fetch;
 try{
  const fixtureBody=()=>encoder.encode(JSON.stringify({engine:'jev',state:'A controlled test input description',apiKey:'fixture-key'}));
  let responseBody,requests=0;
  globalThis.fetch=async(url)=>{requests++;assert.equal(url,'https://api.typesafe.ai/v1/systemone');responseBody=new ReadableStream({start(controller){controller.enqueue(encoder.encode(JSON.stringify({answers:{benchmark:{choice:'coding'}},model:'fixture'})));controller.close();}});return new Response(responseBody);};
  const body=new ReadableStream({start(controller){controller.enqueue(fixtureBody());controller.close();}});const response=await bounded(decision.POST(request(body)));assert.equal(response.status,200);assert.equal((await response.json()).category,'coding');assert.equal(body.locked,false);assert.equal(responseBody.locked,false);assert.equal(requests,1);
  const failed=heldBody();globalThis.fetch=async()=>new Response(failed.body,{status:401});
  const denied=await bounded(decision.POST(request(fixtureBody())));assert.equal(denied.status,502);assert.equal((await denied.json()).error,'PROVIDER_AUTH');assert.equal(failed.cancels(),1);assert.equal(failed.body.locked,false);
 }finally{globalThis.fetch=previous;}
});


const requestReaders=[
 {name:'lab',run:input=>readLabJson(input),code:'INVALID_INPUT'},
 {name:'assistant',run:input=>readAssistantJson(input,true),code:'INVALID_INPUT'},
 {name:'code bridge',run:input=>bridge().POST(input),code:'INTERRUPTED',response:true,status:409},
 {name:'decisions',run:input=>decision.POST(input),code:'INVALID_INPUT',response:true},
];
function inputWithSignal(body,signal){return new Request('https://fixture.test',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half',signal});}
async function inputFailure(spec,task,status){
 if(spec.response){const response=await task;assert.equal(response.status,spec.status??status);assert.deepEqual(await response.json(),{error:spec.code});}
 else await assert.rejects(task,error=>error.message===spec.code&&error.status===status);
}
for(const spec of requestReaders){
 test(spec.name+' request body is bounded by the actual10s receive deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const fixture=heldBody();const input=request(fixture.body);
  const reading=inputFailure(spec,spec.run(input),408);await Promise.resolve();t.mock.timers.tick(10000);
  await bounded(reading);assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
 });
 test(spec.name+' request pre-abort and pending abort settle promptly without caller cleanup',async()=>{
  for(const preAborted of [true,false]){
   const abort=new AbortController();if(preAborted)abort.abort();const fixture=heldBody();const input=inputWithSignal(fixture.body,abort.signal);
   const reading=inputFailure(spec,spec.run(input),499);if(!preAborted){await Promise.resolve();abort.abort();}
   await bounded(reading);assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
  }
 });
}
test('successful request reads remove abort listeners and discard their deadline timers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const spec of requestReaders.slice(0,2)){
  let cancels=0;const body=new ReadableStream({start(controller){controller.enqueue(encoder.encode('{"text":"مرحبا"}'));controller.close();},cancel(){cancels++;}});const input=request(body);const before=getEventListeners(input.signal,'abort').length;
  assert.deepEqual(await spec.run(input),{text:'مرحبا'});assert.equal(getEventListeners(input.signal,'abort').length,before);assert.equal(body.locked,false);
  t.mock.timers.tick(10000);await Promise.resolve();assert.equal(cancels,0);
 }
});
test('the request-only deadline does not truncate a provider response after10s',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let controller;let cancels=0;
 const body=new ReadableStream({start(value){controller=value;},cancel(){cancels++;}});const reading=readAssistantJson(new Response(body));
 t.mock.timers.tick(10001);controller.enqueue(encoder.encode('{"text":"provider fixture after10s"}'));controller.close();
 assert.deepEqual(await bounded(reading),{text:'provider fixture after10s'});assert.equal(cancels,0);assert.equal(body.locked,false);
});
