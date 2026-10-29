/** Security/compatibility regression. All values synthetic; no provider, account or configuration I/O. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import {z} from 'zod';
import {RunInputSchema,WorkflowInvokePayloadSchema,SnapshotMetadataSchema,encodeSnapshotEnvelope,decodeSnapshotEnvelope} from '@workflow/world';
import {inspectEmbeddedZod,assessZodEntrypoint} from '../scripts/audit-embedded-dependencies.mjs';
const require=createRequire(import.meta.url);

for(const kind of ['array','set','map']) test(`patched ${kind} bounds reject before inspecting attacker-controlled elements`,()=>{
  for(const compiled of [false,true]) {
    let visits=0;
    const value=z.string().superRefine(()=>{visits++;});
    let schema=kind==='array'?z.array(value).max(2):kind==='set'?z.set(value).max(2):z.map(z.string(),value).max(2);
    if(compiled) schema=z.compile(schema);
    const input=kind==='array'?['a','b','c']:kind==='set'?new Set(['a','b','c']):new Map([['a','a'],['b','b'],['c','c']]);
    const result=schema.safeParse(input);
    assert.equal(result.success,false);assert.equal(visits,0);assert.equal(result.error.issues.length,1);assert.equal(result.error.issues[0].code,'too_big');
    const valid=kind==='array'?['a','b']:kind==='set'?new Set(['a','b']):new Map([['a','a'],['b','b']]);
    assert.equal(schema.safeParse(valid).success,true);assert.equal(visits,2);
  }
});

test('Workflow and CLI external Zod resolution is the patched shared version',()=>{
  const version=require('zod/package.json').version;
  assert.match(version,/^4\./);
  const [,minor,patch]=version.split('.').map(Number);assert.ok(minor>6 || minor===6&&patch>=6);
  for(const entry of ['@workflow/world','@workflow/core/serialization','@vercel/cli-auth/oauth.js','@vercel/cli-config']) {
    const from=createRequire(require.resolve(entry));assert.equal(from('zod/package.json').version,version,entry);
  }
});

test('actual Workflow compiled queue schemas preserve typed payload and mutually exclusive source contracts',()=>{
  const input={input:new Uint8Array([1,2]),deploymentId:'test',workflowName:'test',specVersion:7,executionContext:{queueNamespace:'test'},dynamicWorkflowCode:new Uint8Array([3])};
  assert.equal(RunInputSchema.safeParse(input).success,true);
  assert.equal(RunInputSchema.safeParse({...input,dynamicWorkflowCodeRef:'test-ref'}).success,false);
  const payload={runId:'test-run',stepId:'test-step',stepInput:{input:new Uint8Array([1,2])},requestedAt:'2026-10-25T00:00:00.000Z'};
  assert.deepEqual(WorkflowInvokePayloadSchema.parse(payload).stepInput.input,new Uint8Array([1,2]));
  assert.equal(WorkflowInvokePayloadSchema.safeParse({...payload,stepInput:{input:[1,2]}}).success,false);
});

test('actual Workflow snapshot envelope retains metadata, dates and opaque bytes',()=>{
  const metadata=SnapshotMetadataSchema.parse({eventsCursor:null,createdAt:'2026-10-25T00:00:00Z',eventCount:2,rngDraws:3,serdeRootPtr:1,engineVersion:'fixture',formatVersion:3});
  const envelope=encodeSnapshotEnvelope(metadata,new Uint8Array([1,2]));
  const decoded=decodeSnapshotEnvelope(envelope);
  assert.deepEqual(decoded.metadata,metadata);assert.deepEqual(decoded.data,new Uint8Array([1,2]));
  assert.equal(decodeSnapshotEnvelope(new Uint8Array([0,1])),null);
  assert.equal(SnapshotMetadataSchema.safeParse({...metadata,createdAt:'invalid-date'}).success,false);
});

test('actual Workflow serialization roundtrips Arabic, dates, collections and shared references',async()=>{
  const {dehydrateStepArguments,hydrateStepArguments,dehydrateStepReturnValue,hydrateStepReturnValue}=await import('@workflow/core/serialization');
  const shared={text:'اختبار عربي',date:new Date('2026-10-25T00:00:00Z'),bytes:new Uint8Array([3,7]),map:new Map([['key',42]]),optional:undefined};
  for(const [encode,decode] of [[dehydrateStepArguments,hydrateStepArguments],[dehydrateStepReturnValue,hydrateStepReturnValue]]) {
    const encoded=await encode([shared,shared],'test-run',undefined);
    assert.ok(encoded instanceof Uint8Array);
    const decoded=await decode(encoded,'test-run',undefined);
    assert.deepEqual(decoded,[shared,shared]);assert.equal(decoded[0],decoded[1]);
  }
});

test('actual CLI OAuth response parser accepts and rejects synthetic responses without network access',async()=>{
  const {OAuth}=await import('@vercel/cli-auth/oauth.js');
  const oauth=OAuth({issuer:new URL('https://example.invalid/'),clientId:'fixture',userAgent:'fixture'});
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Network forbidden in this contract test');};
  try {
    const [error,result]=await oauth.processTokenResponse(Response.json({access_token:'synthetic-not-a-real-token',token_type:'Bearer',expires_in:60}));
    assert.equal(error,null);assert.equal(result.expires_in,60);
    for(const change of [{expires_in:'60'},{token_type:'unsupported'}]) {
      const [invalid]=await oauth.processTokenResponse(Response.json({access_token:'synthetic-not-a-real-token',token_type:'Bearer',expires_in:60,...change}));assert.ok(invalid instanceof Error);
    }
    assert.equal(calls,0);
  } finally {globalThis.fetch=original;}
});

test('CLI public config parsers preserve synthetic optional and passthrough fields',()=>{
  // Compatibility only: this public entrypoint still embeds the older parser; the audit reports it separately.
  const {parseGlobalConfig,parseAuthConfig,globalConfigSchema}=require('@vercel/cli-config');
  const config={credStorage:'file',telemetry:{enabled:false},futureSetting:'preserved'};
  assert.deepEqual(parseGlobalConfig(config),config);assert.equal(globalConfigSchema.safeParse({...config,credStorage:'invalid'}).success,false);
  assert.equal(parseAuthConfig({token:'synthetic-not-a-real-token',expiresAt:0}).expiresAt,0);
});

test('embedded dependency review distinguishes a vulnerable bundle from an external patched dependency',()=>{
  assert.deepEqual(inspectEmbeddedZod('var version={major:4,minor:1,patch:11}; $ZodType; $ZodError;'),{state:'embedded',versions:['4.1.11'],needsReview:true});
  assert.equal(inspectEmbeddedZod('var version={major:4,minor:6,patch:7}; $ZodType; $ZodError;').needsReview,false);
  assert.equal(inspectEmbeddedZod('import * as z from "zod/mini";').state,'external');
  assert.equal(inspectEmbeddedZod('$ZodType; $ZodError;').needsReview,true);
  assert.equal(inspectEmbeddedZod('unidentified implementation').needsReview,true);
});


test('the standalone audit requires patched external resolution and treats unknown/prerelease versions as review required',()=>{
  const external='import * as z from "zod/mini";';
  assert.equal(assessZodEntrypoint(external,'4.5.4').needsReview,true);
  assert.equal(assessZodEntrypoint(external,'4.6.7').needsReview,false);
  for(const version of [undefined,'unrecognized','4.6.6-beta.1','3.25.76']) assert.equal(assessZodEntrypoint(external,version).needsReview,true);
});


test('legacy loader resolves patched esbuild and still transforms owned TypeScript synchronously and asynchronously',async()=>{
  const from=createRequire(require.resolve('@esbuild-kit/core-utils'));
  const [major,minor]=from('esbuild/package.json').version.split('.').map(Number);
  assert.ok(major>0 || minor>=25,'core-utils must resolve a patched esbuild, not a stale nested installation');
  const {transformSync,transform}=require('@esbuild-kit/core-utils');
  const source='export const value: number = 42; export const label = "اختبار";';
  const path=resolve('tests/fixtures/dependency-security-transform.ts');
  for(const transformed of [transformSync(source,path,{format:'cjs'}),await transform(source,path,{format:'cjs'})]) {
    const compiledModule={exports:{}};
    runInNewContext(transformed.code,{module:compiledModule,exports:compiledModule.exports},{timeout:1000});
    assert.equal(compiledModule.exports.value,42);assert.equal(compiledModule.exports.label,'اختبار');
  }
});
