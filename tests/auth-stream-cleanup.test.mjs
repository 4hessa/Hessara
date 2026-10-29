import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuthBody} from '../lib/signin-security.ts';

const encode=new TextEncoder();
const nativeTimeout=globalThis.setTimeout;
const nativeClearTimeout=globalThis.clearTimeout;
function request(body,signal){return new Request('https://fixture.test/api/auth',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half',...(signal?{signal}:{})});}
function heldBody(bytes,cancelResult=()=>new Promise(()=>{})){
  let cancels=0;
  const body=new ReadableStream({start(controller){if(bytes)controller.enqueue(bytes);},cancel(){cancels++;return cancelResult();}});
  return{body,cancels:()=>cancels};
}
async function bounded(task){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=nativeTimeout(()=>reject(new Error('Auth parser did not settle within500ms')),500);})]);}finally{nativeClearTimeout(timer);}}

test('oversized open auth stream rejects and unlocks without waiting for stalled cancellation',async()=>{
  const fixture=heldBody(new Uint8Array(4097));
  await assert.rejects(bounded(readAuthBody(request(fixture.body))),error=>error.message==='INVALID');
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('valid auth JSON releases its reader and preserves split Arabic UTF8 input',async()=>{
  const payload={action:'signin',email:'person@example.org',password:'كلمة مرور للاختبار'};
  const bytes=encode.encode(JSON.stringify(payload));let cancels=0;
  const body=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();},cancel(){cancels++;}});
  assert.deepEqual(await bounded(readAuthBody(request(body))),payload);assert.equal(body.locked,false);assert.equal(cancels,0);
});

test('malformed auth JSON rejects and releases the closed stream reader',async()=>{
  const body=new ReadableStream({start(controller){controller.enqueue(encode.encode('{invalid}'));controller.close();}});
  await assert.rejects(bounded(readAuthBody(request(body))));assert.equal(body.locked,false);
});

test('invalid UTF8 in an otherwise valid auth password is rejected rather than replaced',async()=>{
  const bytes=Buffer.concat([Buffer.from('{"action":"signin","email":"person@example.org","password":"'),Buffer.from([0xff]),Buffer.from('"}')]);
  const body=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
  await assert.rejects(bounded(readAuthBody(request(body))));assert.equal(body.locked,false);
});

test('an already aborted request never parses credentials and cleans up its reader',async()=>{
  const abort=new AbortController();abort.abort();
  const fixture=heldBody(encode.encode('{"action":"signout"}'));
  await assert.rejects(bounded(readAuthBody(request(fixture.body,abort.signal))),error=>error.message==='INVALID');
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('aborting a pending auth read rejects promptly despite a rejecting source cancellation',async()=>{
  const abort=new AbortController(),fixture=heldBody(undefined,()=>Promise.reject(new Error('private cleanup diagnostic')));
  const reading=readAuthBody(request(fixture.body,abort.signal));abort.abort();
  await assert.rejects(bounded(reading),error=>error.message==='INVALID');
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);await new Promise(setImmediate);
});

test('the actual10s auth deadline rejects and unlocks even when source cancellation stalls',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const fixture=heldBody();
  const reading=readAuthBody(request(fixture.body));t.mock.timers.tick(10000);
  await assert.rejects(bounded(reading),error=>error.message==='INVALID');
  assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('source read failures remain visible without leaking a rejected cleanup promise',async()=>{
  const original=new Error('owned read failure');
  const body=new ReadableStream({start(controller){controller.error(original);}});
  await assert.rejects(bounded(readAuthBody(request(body))),error=>error===original);
  assert.equal(body.locked,false);await new Promise(setImmediate);
});
