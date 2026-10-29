import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedBytes} from '../lib/reverse-engineering/content.ts';
function held(bytes,cancelResult=()=>new Promise(()=>{})){
  let cancels=0;const body=new ReadableStream({start(controller){controller.enqueue(bytes);},cancel(){cancels++;return cancelResult();}});
  return{body,cancels:()=>cancels};
}
async function bounded(task){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Artifact cleanup exceeded500ms')),500);})]);}finally{clearTimeout(timer);}}
for(const rejecting of [false,true])test(`artifact limit rejects promptly with source cancellation rejecting=${rejecting}`,async()=>{
  const fixture=held(Uint8Array.of(1,2,3,4),rejecting?()=>Promise.reject(new Error('private cleanup diagnostic')):undefined);
  await assert.rejects(bounded(boundedBytes(new Response(fixture.body),3)),error=>error.code==='ARTIFACT_TOO_LARGE'&&error.status===413);
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);await new Promise(setImmediate);
});
test('failed storage HTTP cancels the unused body without waiting or returning bytes',async()=>{
  const fixture=held(Uint8Array.of(1));
  await assert.rejects(bounded(boundedBytes(new Response(fixture.body,{status:503}),3)),error=>error.code==='STORAGE_UNAVAILABLE'&&error.status===503);
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});
test('artifact reader releases on successful chunked binary output without modifying bytes',async()=>{
  let cancels=0;const body=new ReadableStream({start(controller){controller.enqueue(Uint8Array.of(0,255));controller.enqueue(Uint8Array.of(17));controller.close();},cancel(){cancels++;}});
  assert.deepEqual(await bounded(boundedBytes(new Response(body),3)),Uint8Array.of(0,255,17));assert.equal(body.locked,false);assert.equal(cancels,0);
});
test('source failure keeps its original error and unlocks the artifact reader',async()=>{
  const original=new Error('owned fixture read error');const body=new ReadableStream({start(controller){controller.error(original);}});
  await assert.rejects(bounded(boundedBytes(new Response(body),3)),error=>error===original);assert.equal(body.locked,false);
});
