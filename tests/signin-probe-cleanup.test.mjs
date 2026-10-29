import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSignInAvailability} from '../lib/signin-config.ts';

const encoder=new TextEncoder(),nativeTimeout=globalThis.setTimeout,nativeClearTimeout=globalThis.clearTimeout;
const env={NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_EMAIL_AUTH_ENABLED:'true',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
const unavailable={email:false,password:false,linking:false,providers:{google:false}};
function held(bytes,cancelResult=()=>new Promise(()=>{})){
 let cancels=0;const body=new ReadableStream({start(controller){if(bytes)controller.enqueue(bytes);},cancel(){cancels++;return cancelResult();}});
 return{body,cancels:()=>cancels};
}
async function bounded(task){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=nativeTimeout(()=>reject(new Error('Availability probe did not settle within500ms')),500);})]);}finally{nativeClearTimeout(timer);}}
const response=(body,status=200)=>new Response(body,{status});

test('oversized held settings body fails closed without waiting for stalled cancellation',async()=>{
 const fixture=held(new Uint8Array(16385));
 assert.deepEqual(await bounded(loadSignInAvailability(env,async()=>response(fixture.body))),unavailable);
 assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('non-success settings response cancels its body without awaiting stalled cleanup',async()=>{
 const fixture=held();
 assert.deepEqual(await bounded(loadSignInAvailability(env,async()=>response(fixture.body,503))),unavailable);
 assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('settings rejection cleanup is caught and leaves no locked reader',async()=>{
 const fixture=held(new Uint8Array(16385),()=>Promise.reject(new Error('private cleanup detail')));
 assert.deepEqual(await bounded(loadSignInAvailability(env,async()=>response(fixture.body))),unavailable);
 assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);await new Promise(setImmediate);
});

test('valid split UTF8 settings are accepted and release their reader',async()=>{
 const bytes=encoder.encode(JSON.stringify({external:{email:true,google:true},label:'واجهة عربية'}));let cancels=0;
 const body=new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();},cancel(){cancels++;}});
 assert.deepEqual(await bounded(loadSignInAvailability(env,async()=>response(body))),{email:true,password:true,linking:false,providers:{google:true}});
 assert.equal(body.locked,false);assert.equal(cancels,0);
});

test('malformed settings UTF8 is rejected instead of repairing the provider document',async()=>{
 const bytes=Buffer.concat([Buffer.from('{"external":{"email":true,"google":true},"label":"'),Buffer.from([0xff]),Buffer.from('"}')]);
 const body=new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});
 assert.deepEqual(await bounded(loadSignInAvailability(env,async()=>response(body))),unavailable);assert.equal(body.locked,false);
});

test('actual5s deadline bounds body reads independent from transport signal handling',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const fixture=held();let signal;
 const task=loadSignInAvailability(env,async(_url,options)=>{signal=options.signal;return response(fixture.body);});
 await new Promise(setImmediate);t.mock.timers.tick(5000);
 assert.deepEqual(await bounded(task),unavailable);assert.equal(signal.aborted,true);assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});

test('actual5s deadline bounds headers and cancels a late settings response',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const fixture=held();let resolveFetch,signal;
 const task=loadSignInAvailability(env,async(_url,options)=>{signal=options.signal;return new Promise(resolve=>{resolveFetch=resolve;});});
 t.mock.timers.tick(5000);assert.deepEqual(await bounded(task),unavailable);assert.equal(signal.aborted,true);
 resolveFetch(response(fixture.body));await new Promise(setImmediate);assert.equal(fixture.cancels(),1);assert.equal(fixture.body.locked,false);
});
