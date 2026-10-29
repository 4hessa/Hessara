import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyArchiveNames } from "../lib/reverse-engineering/format-policy.ts";
import { inspectArtifact } from "../lib/reverse-engineering/content.ts";
import { analysisUsage } from "../lib/reverse-engineering/usage.ts";
import { regeneratedReport } from "../lib/reverse-engineering/report-export.ts";
import { reDiagnostics, rePhase } from "../lib/reverse-engineering/diagnostics.ts";
import { readReJson } from "../lib/reverse-engineering/security.ts";
import { createDatabase } from "../lib/postgres-database.ts";
import { createReverseEngineeringQueue } from "../lib/reverse-engineering/queue.ts";
import { compatibleEngines, engineDefinition, recommendEngines } from "../lib/reverse-engineering/catalog.ts";

function zipEntries(names) {
  const local=[], central=[]; let offset=0;
  for(const value of names){const name=Buffer.from(value), data=Buffer.from('authored-fixture'), head=Buffer.alloc(30), directory=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(name.length,26);head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(head,name,data);central.push(directory,name);offset+=head.length+name.length+data.length;}
  const directory=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
test("API archive detection obeys the same canonical Android/Java fixture contract as workers", async()=>{
  const cases=JSON.parse(await readFile(new URL('./fixtures/reverse-format-cases.json',import.meta.url),'utf8'));
  for(const fixture of cases){assert.equal(classifyArchiveNames(fixture.names),fixture.format,JSON.stringify(fixture.names));assert.equal(inspectArtifact(zipEntries(fixture.names),'misleading.apk').format,fixture.format);}
});
test("unknown CPU measurements are omitted and measured zero remains a real observation",()=>{
  assert.deepEqual(analysisUsage({durationMs:5}),[['analysis',1,'job'],['duration',5,'milliseconds']]);
  assert.deepEqual(analysisUsage({cpuSeconds:0}),[['analysis',1,'job'],['cpu',0,'seconds']]);
  for(const cpuSeconds of [NaN,Infinity,-1,'2'])assert.throws(()=>analysisUsage({cpuSeconds}),/INVALID_METRICS/);
});
test("report downloads disclose regeneration and change when retained evidence changes",async()=>{
  let retained=[{id:'e1',content:'owned evidence'}];const calls=[];
  const service={getReport:async(owner,id)=>({id,jobId:'job',createdAt:1}),getJob:async()=>({id:'job',owner:'owner',storageKey:'private-key'}),findings:async(owner,id,page)=>{calls.push([owner,id,page]);return [];},evidence:async()=>retained};
  const before=await regeneratedReport(service,'owner','report',100);
  assert.equal(before.report.createdAt,1);assert.equal(before.report.generatedAt,100);assert.equal(before.report.exportMode,'regenerated');assert.match(before.notice,/not an immutable historical snapshot/);assert.equal(before.job.storageKey,undefined);assert.equal(before.job.owner,undefined);assert.deepEqual(calls[0],['owner','job',{limit:100}]);
  retained=[];const after=await regeneratedReport(service,'owner','report',200);assert.equal(before.evidence.length,1);assert.equal(after.evidence.length,0);assert.equal(after.report.generatedAt,200);
});
test("report exports omit infrastructure identifiers from every row without changing analysis or source records",async()=>{
  const rows={
    report:{id:'report-1',jobId:'job-1',owner:'private-report-owner',storageKey:'internal/report-object',createdAt:17,format:'json'},
    job:{id:'job-1',projectId:'project-1',artifactId:'artifact-1',owner:'private-job-owner',storageKey:'internal/job-object',summary:'Authored static observation',metadata:{limitations:['Static only'],metrics:{durationMs:12}}},
    finding:{id:'finding-1',jobId:'job-1',owner:'private-finding-owner',storageKey:'internal/finding-object',title:'Entry function',description:'Owned analysis',confidence:'confirmed',evidenceIds:['evidence-1']},
    evidence:{id:'evidence-1',jobId:'job-1',owner:'private-evidence-owner',storageKey:'internal/evidence-object',kind:'function',name:'main',content:'int main()',location:'sample.c:1',metadata:{language:'c',analysis:{owner:'source-level symbol owner',storageKey:'source-level identifier'}}},
  };
  const before=structuredClone(rows),calls=[];
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};
  freeze(rows);
  const lookup=key=>async(owner,id,page)=>{calls.push({key,owner,id,page});return key==='finding'||key==='evidence'?[rows[key]]:rows[key];};
  const result=await regeneratedReport({getReport:lookup('report'),getJob:lookup('job'),findings:lookup('finding'),evidence:lookup('evidence')},'authorized-owner','report-1',23);
  const exported=[result.report,result.job,...result.findings,...result.evidence];
  for(const row of exported){assert.equal(Object.hasOwn(row,'owner'),false,'Exported '+row.id+' retains owner');assert.equal(Object.hasOwn(row,'storageKey'),false,'Exported '+row.id+' retains storageKey');}
  assert.deepEqual(exported.map(row=>row.id),['report-1','job-1','finding-1','evidence-1']);
  assert.equal(result.report.jobId,result.job.id);assert.equal(result.findings[0].jobId,result.job.id);assert.equal(result.evidence[0].jobId,result.job.id);assert.deepEqual(result.findings[0].evidenceIds,[result.evidence[0].id]);
  assert.equal(result.report.createdAt,17);assert.equal(result.report.generatedAt,23);assert.equal(result.report.exportMode,'regenerated');
  for(const [source,actual]of [[rows.report,result.report],[rows.job,result.job],[rows.finding,result.findings[0]],[rows.evidence,result.evidence[0]]]){
    const expected=Object.fromEntries(Object.entries(source).filter(([key])=>key!=='owner'&&key!=='storageKey'));
    for(const [key,value]of Object.entries(expected))assert.deepEqual(actual[key],value,key+' analysis value must survive export');
    assert.notEqual(actual,source,'Each export row is a separate value');
  }
  assert.deepEqual(rows,before,'Export must not delete or overwrite source fields');
  assert.ok(calls.every(call=>call.owner==='authorized-owner'));assert.equal(calls[1].id,'job-1');
  assert.deepEqual(calls.slice(2).map(call=>call.page),[{limit:100},{limit:100}]);
});

test("failure diagnostics preserve a useful SQLSTATE/phase without raw database secrets",async()=>{
  const cause=Object.assign(new Error('secret postgres://private?token=credentials raw-query'),{code:'22023',query:'private SQL'});
  let error;try{await rePhase('engines.discovery',async()=>{throw cause;});}catch(failure){error=failure;}
  assert.deepEqual(reDiagnostics(error),{phase:'engines.discovery',code:'22023',category:'database'});assert.ok(!JSON.stringify(reDiagnostics(error)).includes('private'));
  assert.equal(reDiagnostics({code:'secret-token',message:'credentials'}).code,null);
});
test("a stalled or aborted JSON stream releases its reader within its bounded receive deadline",async()=>{
  let cancelled=false;const stream=new ReadableStream({pull(){},cancel(){cancelled=true;}});
  const request=new Request('https://fixture.example',{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'});
  await assert.rejects(readReJson(request,100,10),error=>error.code==='REQUEST_TIMEOUT'&&error.status===408);assert.equal(cancelled,true);
  const controller=new AbortController();controller.abort();await assert.rejects(readReJson(new Request('https://fixture.example',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:controller.signal}),100,10),/REQUEST_TIMEOUT/);
});
test("queue retries only explicit allowlisted transient faults, with a bounded attempt predicate",async()=>{
  for(const [code,retryable,expected]of [['NETWORK_TEMPORARY',true,true],['STORAGE_TEMPORARY',true,true],['NETWORK_TEMPORARY',false,false],['TOOL_FAILURE',true,false],['MEMORY_LIMIT',true,false],['TIMEOUT',true,false]]){
    const statements=[];const execute=async(sql,values)=>{statements.push({sql,values});return {rows:sql.startsWith('UPDATE re_jobs SET status=')?[{status:expected?'queued':'failed'}]:[],count:1};};
    const queue=createReverseEngineeringQueue(createDatabase(execute,work=>work(execute)));
    await queue.fail({jobId:'job',workerId:'worker',leaseToken:'lease',code,retryable});
    const mutation=statements.find(x=>x.sql.startsWith('UPDATE re_jobs SET status='));assert.equal(mutation.values[2],expected,code);assert.match(mutation.sql,/attempt<2/);assert.match(mutation.sql,/5000\*power\(2,attempt\)/);
  }
});
test("capabilities expose implemented viewers and do not promise standalone JavaScript execution",()=>{
  assert.deepEqual(compatibleEngines('javascript'),[]);assert.deepEqual(recommendEngines('javascript',['rea']),[]);
  const source=inspectArtifact(Buffer.from('export const safe = 42;'),'safe.js');assert.equal(source.metadata.analysisSupported,false);
  assert.ok(!engineDefinition('mobsf').capabilities.includes('dependencies'));assert.ok(!engineDefinition('rea').capabilities.includes('modules'));assert.ok(engineDefinition('jadx').capabilities.includes('method-navigation'));assert.ok(!engineDefinition('jadx').capabilities.includes('classes'));
});
