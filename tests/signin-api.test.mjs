import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {passwordSetupToken,validPasswordSetup,PASSWORD_SETUP_COOKIE,PASSWORD_RECOVERY_COOKIE,validPasswordRecovery} from '../lib/signin-security.ts';
import {SESSION_PREFERENCE_COOKIE} from '../lib/signin-session.ts';
const directory=await mkdtemp(resolve('.signin-api-test-')),output=join(directory,'auth.mjs');let api;
const source=`
  export const state={};
  export function reset(){Object.assign(state,{configured:true,user:null,allow:true,calls:[],cookie:new Map(),writes:[],clientPreferences:[],limits:[],availability:{email:false,password:true,linking:true,providers:{google:true}},error:null,session:null,resultUrl:'https://auth-fixture.supabase.co/auth/v1/authorize'});}
  reset();
  const auth={};
  for(const name of ['signUp','signInWithPassword','signInWithOAuth','linkIdentity','updateUser','signInWithOtp','resetPasswordForEmail','signOut'])auth[name]=async(...args)=>{state.calls.push({name,args});return {error:state.error,data:{user:state.user??{id:'new-user'},session:state.session,url:state.resultUrl}};};
  auth.getUser=async()=>({data:{user:state.user},error:null});
  export async function authClient(remember){state.clientPreferences.push(remember);return {auth};}
  export async function authConfigured(){state.calls.push({name:'configured'});return state.configured;}
  export {safeReturnPath} from './lib/return-path';
  export function database(){return {prepare:()=>({bind:(...values)=>{if(values.length===6)state.limits.push(values.at(-1));return {first:async()=>state.allow?{used:1}:null,run:async()=>({})};}})};}
  export function trustedClientIp(){return '192.0.2.1';}
  export async function loadSignInAvailability(){return state.availability;}
  export async function cookies(){return {get:name=>state.cookie.has(name)?{value:state.cookie.get(name)}:undefined,set:(name,value,options)=>{state.cookie.set(name,value);state.writes.push({name,value,options});},delete:name=>state.cookie.delete(name)};}
`;
try{const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {POST} from './app/api/auth/route';export {state,reset} from 'auth-test-harness';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,packages:'external',tsconfig:resolve('tsconfig.json'),plugins:[{name:'auth-no-external-services',setup(builder){builder.onResolve({filter:/^(auth-test-harness|next\/headers|@\/lib\/(auth|postgres-database|auth-transport|signin-config))$/},()=>({path:'auth-harness',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},()=>({contents:source,loader:'ts',resolveDir:process.cwd()}));}}]});await writeFile(output,result.outputFiles[0].text);api=await import(pathToFileURL(output).href);}finally{await unlink(output).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
const secret=btoa('k'.repeat(32));
const original={HESSARA_ENCRYPTION_KEY:process.env.HESSARA_ENCRYPTION_KEY,NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,NODE_ENV:process.env.NODE_ENV,DATABASE_URL:process.env.DATABASE_URL,POSTGRES_URL:process.env.POSTGRES_URL};
process.env.DATABASE_URL='postgres://runtime:fixture-only@localhost/hessara';process.env.HESSARA_ENCRYPTION_KEY=secret;process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth-fixture.supabase.co';process.env.NODE_ENV='production';
test.after(()=>{for(const [key,value] of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;});
const request=(body,origin='https://hessara.example')=>new Request('https://hessara.example/api/auth',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const call=async(body)=>{const response=await api.POST(request(body));return {status:response.status,body:await response.json()};};
const providerCalls=()=>api.state.calls.filter(item=>item.name!=='configured');
test('cross-origin and unbounded input are rejected before authentication or database work',async()=>{
  api.reset();assert.equal((await api.POST(request({action:'oauth',provider:'google'},'https://untrusted.example'))).status,403);assert.equal(api.state.calls.length,0);
  assert.equal((await call({action:'signin',email:'person@example.org',password:'a'.repeat(5000)})).status,400);assert.equal(api.state.calls.length,0);
});
test('public signup stays unavailable until mail delivery is configured and guest replacement signup is refused',async()=>{
  api.reset();const payload={action:'signup',email:'person@example.org',password:'a long passphrase'};
  assert.equal((await call(payload)).status,403);assert.equal(providerCalls().length,0);
  api.state.availability.email=true;api.state.user={id:'guest-owner',is_anonymous:true};
  assert.equal((await call(payload)).status,400);assert.equal(providerCalls().length,0);
});
test('password sign-in uses one generic failure and a local safe redirect on success',async()=>{
  api.reset();api.state.error={code:'invalid_credentials',message:'raw provider information must not leak'};
  const payload={action:'signin',email:'person@example.org',password:'existing-password',next:'//untrusted.example'};
  const rejected=await call(payload);assert.equal(rejected.status,401);assert.equal(rejected.body.code,'credentialsFailed');assert.ok(!JSON.stringify(rejected).includes('raw provider'));
  api.state.error=null;const accepted=await call(payload);assert.deepEqual(accepted,{status:200,body:{redirect:'/'}});assert.equal(providerCalls().at(-1).name,'signInWithPassword');
});
test('guest email conversion updates the original owner and stores only a signed HttpOnly setup ticket',async()=>{
  api.reset();api.state.user={id:'guest-owner',is_anonymous:true};api.state.availability.email=true;
  const result=await call({action:'email',email:'person@example.org',next:'/'});assert.equal(result.status,200);assert.equal(result.body.code,'confirmation');
  assert.deepEqual(providerCalls().map(item=>item.name),['updateUser']);assert.deepEqual(providerCalls()[0].args[0],{email:'person@example.org'});
  const cookie=api.state.writes[0];assert.equal(cookie.name,PASSWORD_SETUP_COOKIE);assert.equal(cookie.options.httpOnly,true);assert.equal(cookie.options.secure,true);assert.equal(cookie.options.sameSite,'lax');assert.equal(validPasswordSetup(cookie.value,'guest-owner',secret),true);assert.ok(!cookie.value.includes('person@example.org'));
});
test('retired OAuth providers and new guest entry are rejected before authentication even if old settings remain enabled',async()=>{
  for(const payload of [...['apple','x','github','twitter','custom:untrusted'].map(provider=>({action:'oauth',provider})),{action:'guest'}]){
    api.reset();Object.assign(api.state.availability.providers,{apple:true,x:true,github:true,twitter:true});
    const result=await call(payload);assert.equal(result.status,400);assert.equal(result.body.code,'invalid');assert.equal(api.state.calls.length,0);
  }
});
test('Google OAuth preserves an existing guest owner and uses normal sign-in without a session',async()=>{
  for(const guest of [false,true]){
    api.reset();const owner=guest?{id:'guest-owner',is_anonymous:true}:null;
    api.state.user=owner;api.state.availability.linking=guest;
    const result=await call({action:'oauth',provider:'google',next:'/lab?lang=ar'});
    assert.equal(result.status,200);assert.equal(result.body.redirect,api.state.resultUrl);
    const calls=providerCalls();assert.deepEqual(calls.map(item=>item.name),[guest?'linkIdentity':'signInWithOAuth']);
    const [credentials]=calls[0].args;assert.equal(credentials.provider,'google');assert.equal(credentials.options.skipBrowserRedirect,true);
    const callback=new URL(credentials.options.redirectTo);
    assert.equal(callback.origin,'https://hessara.example');assert.equal(callback.pathname,'/auth/callback');assert.equal(callback.searchParams.get('next'),'/lab?lang=ar');
    assert.equal(api.state.user,owner);assert.equal(api.state.cookie.size,0);
  }
});
test('Google OAuth fails closed when Google or existing guest identity linking is disabled',async()=>{
  for(const user of [null,{id:'guest-owner',is_anonymous:true}]){
    api.reset();api.state.user=user;api.state.availability.providers.google=false;
    const result=await call({action:'oauth',provider:'google'});assert.equal(result.status,403);assert.equal(result.body.code,'unavailable');
    assert.equal(providerCalls().length,0);assert.equal(api.state.user,user);
  }
  api.reset();api.state.user={id:'guest-owner',is_anonymous:true};api.state.availability.linking=false;
  const result=await call({action:'oauth',provider:'google'});assert.equal(result.status,403);assert.equal(result.body.code,'unavailable');
  assert.equal(providerCalls().length,0);assert.equal(api.state.user.id,'guest-owner');assert.equal(api.state.cookie.size,0);
});
test('Google OAuth accepts Google and the configured Supabase origin',async()=>{
  for(const destination of ['https://auth-fixture.supabase.co/auth/v1/authorize','https://accounts.google.com/o/oauth2/v2/auth']){
    api.reset();api.state.resultUrl=destination;
    assert.deepEqual(await call({action:'oauth',provider:'google'}),{status:200,body:{redirect:destination}});
  }
});
test('Google OAuth rejects unsafe schemes, lookalikes and retired provider origins',async()=>{
  for(const destination of [
    'http://accounts.google.com/authorize','https://accounts.google.com.evil.example/authorize','https://evil.example/accounts.google.com',
    'https://attacker@accounts.google.com/authorize','https://user:password@accounts.google.com/authorize','https://accounts.google.com:444/authorize',
    'https://auth-fixture.supabase.co.evil.example/auth/v1/authorize','https://other-fixture.supabase.co/auth/v1/authorize',
    'https://appleid.apple.com/auth/authorize','https://x.com/i/oauth2/authorize','https://api.x.com/2/oauth2/authorize','https://github.com/login/oauth/authorize',
    'javascript:alert(1)','data:text/html,untrusted','/relative/authorize',
  ]){
    api.reset();api.state.resultUrl=destination;
    const result=await call({action:'oauth',provider:'google'});
    assert.equal(result.status,503,destination);assert.equal(result.body.code,'failed',destination);assert.equal(result.body.redirect,undefined,destination);
    assert.deepEqual(providerCalls().map(item=>item.name),['signInWithOAuth']);
  }
});

test('password completion needs a confirmed account and a valid ticket for that exact owner',async()=>{
  const payload={action:'set-password',password:'a long passphrase'};
  for(const user of [null,{id:'guest-owner',is_anonymous:true},{id:'guest-owner',is_anonymous:false},{id:'different-owner',is_anonymous:false,email_confirmed_at:'2026-01-01'}]){
    api.reset();api.state.user=user;api.state.cookie.set(PASSWORD_SETUP_COOKIE,passwordSetupToken('guest-owner',secret));assert.equal((await call(payload)).status,403);assert.equal(providerCalls().length,0);
  }
  api.reset();api.state.user={id:'guest-owner',is_anonymous:false,email_confirmed_at:'2026-01-01'};api.state.cookie.set(PASSWORD_SETUP_COOKIE,passwordSetupToken('guest-owner',secret));
  assert.equal((await call(payload)).status,200);assert.deepEqual(providerCalls()[0].args[0],{password:'a long passphrase'});assert.equal(api.state.cookie.has(PASSWORD_SETUP_COOKIE),false);
});
test('rate limits prevent provider calls and account existence is not disclosed by signup notices',async()=>{
  api.reset();api.state.allow=false;assert.equal((await call({action:'signin',email:'person@example.org',password:'existing-password'})).status,429);assert.equal(providerCalls().length,0);
  api.reset();api.state.availability.email=true;const payload={action:'signup',email:'person@example.org',password:'a long passphrase'};
  const newAccount=await call(payload);api.state.error={code:'user_already_exists'};const existingAccount=await call(payload);assert.deepEqual(existingAccount,newAccount);assert.deepEqual(newAccount,{status:200,body:{code:'confirmation'}});
});

test('recovery sends the actual reset API with a same-origin PKCE callback and a private email-bound ticket',async()=>{
  api.reset();
  const result=await call({action:'recover',email:'person@example.org',next:'//untrusted.example'});
  assert.deepEqual(result,{status:200,body:{code:'recoverySent'}});
  assert.deepEqual(providerCalls().map(item=>item.name),['resetPasswordForEmail']);
  const [email,options]=providerCalls()[0].args;assert.equal(email,'person@example.org');
  const target=new URL(options.redirectTo);assert.equal(target.origin,'https://hessara.example');assert.equal(target.pathname,'/auth/callback');assert.equal(target.searchParams.get('intent'),'recovery');assert.equal(target.searchParams.get('next'),'/');
  assert.deepEqual(api.state.limits,[3]);
  const cookie=api.state.writes.find(item=>item.name===PASSWORD_RECOVERY_COOKIE);
  assert.ok(cookie);assert.equal(cookie.options.httpOnly,true);assert.equal(cookie.options.secure,true);assert.equal(cookie.options.sameSite,'lax');assert.equal(cookie.options.maxAge,900);
  assert.equal(validPasswordRecovery(cookie.value,email,secret),true);assert.equal(cookie.value.includes(email),false);
  assert.equal(api.state.cookie.has(PASSWORD_SETUP_COOKIE),false,'requesting an email cannot authorize a password update');
  api.state.error={code:'user_not_found'};assert.deepEqual(await call({action:'recover',email:'absent@example.org'}),result);
});

test('recovery preserves guest ownership, rate limits requests, and does not reveal provider diagnostics',async()=>{
  for(const state of [{user:{id:'guest-owner',is_anonymous:true}},{allow:false},{availability:{email:true,password:false,linking:true,providers:{google:true}}}]){
    api.reset();Object.assign(api.state,state);const result=await call({action:'recover',email:'person@example.org'});assert.ok(result.status>=400);assert.equal(providerCalls().length,0);assert.equal(api.state.cookie.has(PASSWORD_SETUP_COOKIE),false);
  }
  api.reset();api.state.error={code:'smtp_error',message:'private provider diagnostic'};
  const failure=await call({action:'recover',email:'person@example.org'});assert.equal(failure.status,503);assert.ok(!JSON.stringify(failure).includes('private provider'));assert.equal(api.state.cookie.has(PASSWORD_RECOVERY_COOKIE),false);
});

test('remember choice reaches the auth adapter and persists only after a successful account action',async()=>{
  for(const remember of [false,true]){
    api.reset();const result=await call({action:'signin',email:'person@example.org',password:'existing-password',remember});
    assert.equal(result.status,200);assert.deepEqual(api.state.clientPreferences,[remember]);
    const cookie=api.state.writes.find(item=>item.name===SESSION_PREFERENCE_COOKIE);assert.ok(cookie);assert.equal(cookie.value,remember?'persistent':'session');assert.equal(cookie.options.httpOnly,true);assert.equal(cookie.options.secure,true);assert.equal(Object.hasOwn(cookie.options,'maxAge'),remember);
  }
  api.reset();api.state.error={code:'invalid_credentials'};assert.equal((await call({action:'signin',email:'person@example.org',password:'wrong',remember:false})).status,401);assert.equal(api.state.cookie.has(SESSION_PREFERENCE_COOKIE),false);
  api.reset();assert.equal((await call({action:'oauth',provider:'google',remember:false})).status,200);assert.equal(api.state.cookie.get(SESSION_PREFERENCE_COOKIE),'session');
});

test('missing mutation storage fails truthfully before provider work but never blocks sign-out',async()=>{
 const connection=process.env.DATABASE_URL,alternative=process.env.POSTGRES_URL;
 try{
  delete process.env.DATABASE_URL;delete process.env.POSTGRES_URL;api.reset();
  const blocked=await call({action:'signin',email:'person@example.org',password:'existing-password'});
  assert.deepEqual(blocked,{status:503,body:{code:'unavailable',error:'تعذّر إكمال الطلب. يرجى المحاولة لاحقًا.'}});
  assert.equal(providerCalls().length,0);assert.equal(api.state.clientPreferences.length,0);assert.equal(api.state.limits.length,0);
  const loggedOut=await call({action:'signout'});assert.equal(loggedOut.status,200);assert.equal(providerCalls().at(-1).name,'signOut');
 }finally{if(connection===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=connection;if(alternative===undefined)delete process.env.POSTGRES_URL;else process.env.POSTGRES_URL=alternative;}
});

