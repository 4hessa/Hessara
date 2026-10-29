import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {configurationHash} from '../lib/model-verification.ts';
import {NVIDIA_MODELS,NVIDIA_CATALOG_ENDPOINT,NVIDIA_ENDPOINT,readNvidiaAvailability} from '../lib/nvidia.ts';

const directory=await mkdtemp(resolve('.model-connectivity-test-'));
let routes;
try{
 const bundled=await build({absWorkingDir:process.cwd(),stdin:{contents:"export * as nvidia from './app/api/catalog/nvidia/route'; export * as profile from './app/api/models/route'; export * as openrouter from './app/api/catalog/connect/route';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',packages:'external',write:false,tsconfig:resolve('tsconfig.json'),plugins:[{name:'model-route-boundaries',setup(builder){
  builder.onResolve({filter:/^@\/lib\/server$/},()=>({path:'server',namespace:'model-fixture'}));
  builder.onLoad({filter:/.*/,namespace:'model-fixture'},()=>({contents:`
   export class HttpError extends Error { constructor(message,status=400){super(message);this.status=status;} }
   export async function identity(){return 'test-owner';}
   export function fail(error){return Response.json({error:error instanceof HttpError?error.message:'UNAVAILABLE'},{status:error instanceof HttpError?error.status:503});}
   export async function availableModels(){return [];}
   export function database(){globalThis.__modelStorageCalls++;return {prepare(sql){return {bind(...values){return {sql,values,async first(){return {n:0};}};}};},async scopedBatch(owner,statements){globalThis.__modelVerifications.push(...statements);return [];},async ownerQuotaBatch(owner,statements){if(owner!=='test-owner')throw Error('Wrong owner');globalThis.__modelWrites.push(...statements);return statements.map(()=>({meta:{changes:1}}));}};}
  `}));
 }}]});
 const file=join(directory,'routes.mjs');await writeFile(file,bundled.outputFiles[0].text);routes=await import(pathToFileURL(file).href);
}finally{assert.ok(directory.startsWith(resolve('.model-connectivity-test-')));await rm(directory,{recursive:true,force:true});}

const body={ids:[NVIDIA_MODELS[0].id],apiKey:'safe-fixture-provider-key'};
const request=(value,type='application/json')=>new Request('https://hessara.test/api/catalog/nvidia',{method:'POST',headers:{'content-type':type},body:typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)});
function environment(t){const previous=process.env.HESSARA_ENCRYPTION_KEY;process.env.HESSARA_ENCRYPTION_KEY=randomBytes(32).toString('base64');globalThis.__modelWrites=[];globalThis.__modelVerifications=[];globalThis.__modelStorageCalls=0;t.after(()=>{if(previous===undefined)delete process.env.HESSARA_ENCRYPTION_KEY;else process.env.HESSARA_ENCRYPTION_KEY=previous;delete globalThis.__modelWrites;delete globalThis.__modelVerifications;delete globalThis.__modelStorageCalls;});}
const currentCatalog=()=>Response.json({object:'list',data:NVIDIA_MODELS.filter(model=>model.id!=='moonshotai/kimi-k3').map(({id})=>({id}))});

test('live NVIDIA catalog metadata reports retired presets instead of making every default connection fail',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,NVIDIA_CATALOG_ENDPOINT);assert.equal(init.redirect,'error');return currentCatalog();});
 const catalog=await readNvidiaAvailability();assert.equal(catalog.ids.has('moonshotai/kimi-k3'),false);assert.equal(catalog.ids.size,3);
 const response=await routes.nvidia.GET(),value=await response.json();assert.equal(response.status,200);assert.equal(value.catalogStatus,'checked');assert.ok(Number.isFinite(Date.parse(value.checkedAt)));assert.equal(value.models.filter(model=>model.available===true).length,3);assert.equal(value.models.find(model=>model.id==='moonshotai/kimi-k3').available,false);
});

test('unavailable public catalog stays explicitly unknown without a fabricated check timestamp',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('network unavailable');});
 const response=await routes.nvidia.GET(),value=await response.json();assert.equal(value.catalogStatus,'unavailable');assert.equal(value.checkedAt,null);assert.equal(value.error,'PROVIDER_CATALOG_UNAVAILABLE');assert.ok(value.models.every(model=>model.available===null));
});

test('all connection routes bound request bytes, content type and UTF-8 before storage or upstream access',async t=>{
 environment(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Invalid request reached provider');});
 for(const route of [routes.nvidia,routes.profile,routes.openrouter])for(const[value,type,status]of [['{','application/json',400],['{}','text/plain',415],['x'.repeat(40001),'application/json',413],[new Uint8Array([255]),'application/json',400]]){
  const response=await route.POST(request(value,type));assert.equal(response.status,status);assert.equal((await response.json()).error,'INVALID_INPUT');
 }
 assert.equal(calls,0);assert.equal(globalThis.__modelStorageCalls,0);
});

test('an absent NVIDIA model fails before any inference or secret write',async t=>{
 environment(t);let infer=0;t.mock.method(globalThis,'fetch',async url=>{if(url===NVIDIA_CATALOG_ENDPOINT)return currentCatalog();infer++;throw Error('Retired model reached inference');});
 const response=await routes.nvidia.POST(request({...body,ids:['moonshotai/kimi-k3']}));assert.equal(response.status,409);assert.equal((await response.json()).error,'NOT_READY');assert.equal(infer,0);assert.equal(globalThis.__modelWrites.length,0);
});

test('HTTP 200 with empty, malformed or incomplete NVIDIA inference never saves a connection',async t=>{
 environment(t);let payload;
 t.mock.method(globalThis,'fetch',async url=>url===NVIDIA_CATALOG_ENDPOINT?currentCatalog():Response.json(payload));
 for(const response of [[],{}, {choices:[{message:{content:''},finish_reason:'stop'}]}, {choices:[{message:{content:'  '},finish_reason:'stop'}]}, {choices:[{message:{content:'partial'},finish_reason:'length'}]}]){
  payload=response;const result=await routes.nvidia.POST(request(body));assert.equal(result.status,503);assert.equal((await result.json()).error,'PROVIDER_UNAVAILABLE');
 }
 assert.equal(globalThis.__modelWrites.length,0);
});

test('a complete bounded NVIDIA probe saves encrypted profiles with unknown rather than invented zero prices',async t=>{
 environment(t);let inference=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(url===NVIDIA_CATALOG_ENDPOINT)return currentCatalog();
  assert.equal(url,NVIDIA_ENDPOINT);assert.equal(init.headers.Authorization,`Bearer ${body.apiKey}`);const sent=JSON.parse(init.body);assert.equal(sent.max_tokens,128);assert.equal(sent.model,body.ids[0]);inference++;
  return Response.json({model:sent.model,choices:[{message:{content:'READY'},finish_reason:'stop'}]});
 });
 const response=await routes.nvidia.POST(request({...body,ids:[NVIDIA_MODELS[0].id,NVIDIA_MODELS[1].id]}));assert.equal(response.status,201);assert.equal(inference,1);assert.equal(globalThis.__modelWrites.length,2);
 for(const write of globalThis.__modelWrites){assert.ok(write.sql.includes('NULL,NULL'));assert.ok(!JSON.stringify(write.values).includes(body.apiKey));}
 assert.equal(globalThis.__modelVerifications.length,1,'only the actually tested first model is verified');
 const verified=globalThis.__modelVerifications[0].values,stored=globalThis.__modelWrites[0].values;
 assert.equal(verified[0],'test-owner');assert.equal(verified[1],stored[0]);assert.equal(verified[2],configurationHash('nvidia',body.ids[0],stored[4]));assert.equal(verified[4],true);
 assert.ok(!JSON.stringify(await response.json()).includes(body.apiKey));
});

