import test from 'node:test';
import assert from 'node:assert/strict';
import { authInput, newPassword, readAuthBody, passwordSetupToken, validPasswordSetup, passwordRecoveryToken, validPasswordRecovery, readPasswordRecovery } from '../lib/signin-security.ts';
import { signInAvailability, loadSignInAvailability } from '../lib/signin-config.ts';

const secret='test-only-signature-secret-not-a-provider-key';
test('guest password-setup authorization is signed, owner-bound and expires',()=>{
  const now=1700000000000,token=passwordSetupToken('guest-owner',secret,now);
  assert.equal(validPasswordSetup(token,'guest-owner',secret,now+1000),true);
  for(const [candidate,owner,key,at] of [[token,'different-owner',secret,now],[`${token}x`,'guest-owner',secret,now],[token,'guest-owner','different-secret',now],[token,'guest-owner',secret,now+86400000],[token,'guest-owner',secret,now-1],[undefined,'guest-owner',secret,now]])assert.equal(validPasswordSetup(candidate,owner,key,at),false);
  assert.equal(token.includes('password'),false);
});
test('recovery authorization is purpose-bound, signed, email-bound, private and short-lived',()=>{
  const now=1700000000000,email='person@example.org',token=passwordRecoveryToken(email,secret,now);
  assert.equal(validPasswordRecovery(token,'PERSON@example.org',secret,now+1),true);
  assert.equal(Buffer.from(token.split('.')[0],'base64url').toString().includes(email),false);
  for(const [candidate,mail,key,at] of [[token,'other@example.org',secret,now],[token,email,'wrong-key',now],[`${token}x`,email,secret,now],[token,email,secret,now+900000],[token,email,secret,now-1],[passwordSetupToken(email,secret,now),email,secret,now]])assert.equal(validPasswordRecovery(candidate,mail,key,at),false);
  assert.equal(readPasswordRecovery(undefined,secret,now),null);
  assert.equal(validPasswordSetup(token,email,secret,now),false);
});
test('remember is optional and strictly boolean on supported sign-in methods',()=>{
  for(const remember of [true,false])assert.equal(authInput.safeParse({action:'signin',email:'person@example.org',password:'existing-password',remember}).success,true);
  for(const remember of ['false',0,null,{}])assert.equal(authInput.safeParse({action:'signin',email:'person@example.org',password:'existing-password',remember}).success,false);
  assert.equal(authInput.safeParse({action:'recover',email:'person@example.org',next:'/'}).success,true);
  assert.equal(authInput.safeParse({action:'recover',email:'person@example.org',password:'not-accepted'}).success,false);
});
test('new passwords allow passphrases but reject short, empty and unbounded values',()=>{
  assert.equal(newPassword.safeParse('a memorable phrase').success,true);
  assert.equal(newPassword.safeParse('كلمة مرور عربية طويلة').success,true);
  for(const password of ['short',' '.repeat(12),'a'.repeat(129)])assert.equal(newPassword.safeParse(password).success,false);
  assert.equal(authInput.safeParse({action:'signin',email:'person@example.org',password:'oldpass'}).success,true,'existing valid shorter passwords are accepted by sign-in');
  assert.equal(authInput.safeParse({action:'guest',password:'unexpected'}).success,false);
});
test('OAuth input accepts only Google and rejects retired providers and new guest entry',()=>{
  assert.equal(authInput.safeParse({action:'oauth',provider:'google'}).success,true);
  for(const provider of ['apple','x','github','twitter','Apple','custom:untrusted','github.com','',null])assert.equal(authInput.safeParse({action:'oauth',provider}).success,false,String(provider));
  assert.equal(authInput.safeParse({action:'guest'}).success,false);
});
test('auth payload rejects wrong content types, unknown fields and oversized streamed bodies',async()=>{
  const req=(body,type='application/json')=>new Request('https://hessara.example/api/auth',{method:'POST',headers:{'content-type':type},body});
  assert.deepEqual(await readAuthBody(req('{"action":"signout"}')),{action:'signout'});
  for(const request of [req('{"action":"signout"}','text/plain'),req('{"action":"signout"}','application/jsonp'),req('{"action":"signout","admin":true}'),req('{'),req(' '.repeat(4097))])await assert.rejects(readAuthBody(request));
});
test('email delivery and verified existing-account login have independent readiness',()=>{
  const env={HESSARA_ALLOW_GUESTS:'true',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
  const readiness=signInAvailability({external:{email:true,google:false,apple:false,x:false,github:false},mailer_autoconfirm:false},env);
  assert.equal(Object.hasOwn(readiness,'guest'),false);assert.equal(readiness.password,true);assert.equal(readiness.email,false);assert.equal(readiness.linking,false);
  assert.deepEqual(readiness.providers,{google:false});
  assert.equal(signInAvailability({external:{email:true},disable_signup:true},{...env,HESSARA_EMAIL_AUTH_ENABLED:'true'}).email,false);
  assert.equal(signInAvailability({external:{google:true}},env).providers.google,true);
});
test('only an explicit Google enabled boolean exposes OAuth regardless of retired provider settings',()=>{
  assert.deepEqual(signInAvailability({external:{google:true,apple:true,x:true,github:true}}).providers,{google:true});
  for(const google of [false,'true',1,{},null,undefined]){
    assert.deepEqual(signInAvailability({external:{google,apple:true,x:true,github:true}}).providers,{google:false});
  }
  assert.deepEqual(signInAvailability({external:{twitter:true,custom:true,google_client_id:'fixture',google_secret:'fixture'}}).providers,{google:false});
});
test('provider readiness is verified with a bounded settings request and fails closed',async()=>{
  const env={NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
  let called=0;
  const state=await loadSignInAvailability(env,async(url,options)=>{called++;assert.equal(String(url),'https://project.supabase.co/auth/v1/settings');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal);return Response.json({external:{email:true,google:true,apple:true,x:true,github:true}});});
  assert.equal(called,1);assert.equal(state.password,true);assert.deepEqual(state.providers,{google:true});
  for(const response of [Response.json({}, {status:503}),new Response('x'.repeat(16385)),new Response('bad JSON')]){
    const failed=await loadSignInAvailability(env,async()=>response);assert.equal(failed.password,false);assert.deepEqual(failed.providers,{google:false});
  }
  called=0;const failed=await loadSignInAvailability({...env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1'},async()=>{called++;return Response.json({external:{google:true}});});
  assert.equal(called,0);assert.deepEqual(failed.providers,{google:false});
});

test('explicit development and test can verify isolated local Supabase over IPv4, IPv6 and localhost',async()=>{
  for(const NODE_ENV of ['development','test'])for(const host of ['127.0.0.1','localhost','[::1]'])for(const protocol of ['http:','https:']){
    const endpoint=`${protocol}//${host}:54321`;
    const env={NODE_ENV,NEXT_PUBLIC_SUPABASE_URL:endpoint,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_EMAIL_AUTH_ENABLED:'true',HESSARA_PASSWORD_AUTH_ENABLED:'true',SUPABASE_AUTH_SECRET_KEY:'sb_secret_fixture_must_not_be_sent'};
    let called=0;
    const availability=await loadSignInAvailability(env,async(url,options)=>{
      called++;assert.equal(String(url),endpoint+'/auth/v1/settings');
      assert.deepEqual(options.headers,{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
      assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);assert.equal(options.signal.aborted,false);
      return Response.json({external:{email:true,google:false},disable_signup:false});
    });
    assert.equal(called,1,`${NODE_ENV}: ${endpoint}`);assert.deepEqual(availability,{email:true,password:true,linking:false,providers:{google:false}});
  }
});

test('local readiness rejects ambiguous environments, non-loopback targets and malformed endpoint shapes before any request',async()=>{
  const base={NODE_ENV:'development',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_EMAIL_AUTH_ENABLED:'true',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
  const urls=[
    'http://192.168.1.1:54321','http://10.0.0.1:54321','http://172.16.0.1:54321','http://169.254.169.254',
    'http://127.0.0.2:54321','http://localhost.evil.example:54321','http://auth.internal:54321','http://[::2]:54321',
    'ftp://127.0.0.1:54321','http://user:password@127.0.0.1:54321','http://127.0.0.1:54321/path',
    'http://localhost:54321?token=fixture','http://[::1]:54321#fragment','not a URL',
  ];
  const cases=urls.map(NEXT_PUBLIC_SUPABASE_URL=>({...base,NEXT_PUBLIC_SUPABASE_URL}));
  for(const NODE_ENV of [undefined,'production','staging',''])for(const NEXT_PUBLIC_SUPABASE_URL of ['http://127.0.0.1:54321','https://localhost:54321','http://[::1]:54321'])cases.push({...base,NODE_ENV,NEXT_PUBLIC_SUPABASE_URL});
  for(const NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY of [undefined,'','   '])cases.push({...base,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
  for(const env of cases){let called=0;const availability=await loadSignInAvailability(env,async()=>{called++;return Response.json({external:{email:true,google:true}})});assert.equal(called,0,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(availability.email,false);assert.equal(availability.password,false);assert.deepEqual(availability.providers,{google:false});}
});

test('hosted readiness retains HTTPS Supabase boundaries and rejects path, credentials, query and fragment configuration',async()=>{
  const env={NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
  for(const NEXT_PUBLIC_SUPABASE_URL of [
    'http://project.supabase.co','https://project.supabase.co:444','https://project.supabase.co.evil.example','https://supabase.co',
    'https://user:password@project.supabase.co','https://project.supabase.co/path','https://project.supabase.co?token=fixture','https://project.supabase.co#fragment',
  ]){let called=0;const availability=await loadSignInAvailability({...env,NEXT_PUBLIC_SUPABASE_URL},async()=>{called++;return Response.json({external:{email:true,google:true}})});assert.equal(called,0,NEXT_PUBLIC_SUPABASE_URL);assert.equal(availability.password,false);assert.deepEqual(availability.providers,{google:false});}
  let called=0;const availability=await loadSignInAvailability({...env,NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co/'},async(url)=>{called++;assert.equal(String(url),'https://project.supabase.co/auth/v1/settings');return Response.json({external:{email:true,google:true},disable_signup:true})});
  assert.equal(called,1);assert.equal(availability.password,true);assert.equal(availability.email,false);assert.deepEqual(availability.providers,{google:true});
});

test('local endpoint permission never substitutes for provider settings, feature flags or a successful bounded response',async()=>{
  const env={NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',HESSARA_EMAIL_AUTH_ENABLED:'true',HESSARA_PASSWORD_AUTH_ENABLED:'true'};
  const noFlags=await loadSignInAvailability({...env,HESSARA_EMAIL_AUTH_ENABLED:undefined,HESSARA_PASSWORD_AUTH_ENABLED:undefined},async()=>Response.json({external:{email:true,google:false}}));
  assert.equal(noFlags.email,false);assert.equal(noFlags.password,false);
  const signupDisabled=await loadSignInAvailability(env,async()=>Response.json({external:{email:true,google:false},disable_signup:true}));
  assert.equal(signupDisabled.email,false);assert.equal(signupDisabled.password,true);
  const emailDisabled=await loadSignInAvailability(env,async()=>Response.json({external:{email:false,google:false}}));
  assert.equal(emailDisabled.email,false);assert.equal(emailDisabled.password,false);
  const nonBoolean=await loadSignInAvailability(env,async()=>Response.json({external:{email:'true',google:'true'}}));
  assert.equal(nonBoolean.email,false);assert.equal(nonBoolean.password,false);assert.deepEqual(nonBoolean.providers,{google:false});
  for(const fetcher of [
    async()=>Response.json({external:{email:true,google:true}},{status:503}),
    async()=>new Response('x'.repeat(16385)),async()=>new Response('invalid JSON'),async()=>new Response(null,{status:204}),
    async()=>{throw new DOMException('fixture cancellation','AbortError')},
  ]){const unavailable=await loadSignInAvailability(env,fetcher);assert.equal(unavailable.email,false);assert.equal(unavailable.password,false);assert.deepEqual(unavailable.providers,{google:false});}
});
