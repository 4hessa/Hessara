import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp,writeFile,unlink,rmdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { signinLayoutCopy } from '../lib/signin-layout-copy.ts';

const directory=await mkdtemp(resolve('.signin-ui-test-')),output=join(directory,'signin.mjs');
let ui;
try{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export { SignInForm } from './app/signin/signin-form'; export { AuthLayout } from './app/signin/auth-layout'; export { signinExperienceCopy } from './lib/signin-experience-copy'; export { LANGUAGES } from './lib/i18n';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,loader:{'.css':'empty'},platform:'node',format:'esm',write:false,packages:'external',jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'native-link-image',setup(builder){builder.onResolve({filter:/^next\/(link|image)$/},args=>({path:args.path,namespace:'test-next'}));builder.onLoad({filter:/.*/,namespace:'test-next'},args=>({contents:args.path.endsWith('link')?"import React from 'react';export default function Link(props){return React.createElement('a',props);}":"import React from 'react';export default function Image({fill,priority,preload,unoptimized,...props}){return React.createElement('img',props);}",loader:'js',resolveDir:process.cwd()}));}}]});
  await writeFile(output,result.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
}finally{await unlink(output).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
const availability={email:false,password:true,linking:false,providers:{google:true}};
const props={configured:true,availability,session:'none',next:'/',expired:false};
test('sign-in copy and account creation are explicit and complete for all thirteen languages',()=>{
  const keys=Object.keys(ui.signinExperienceCopy('en'));
  for(const [locale] of ui.LANGUAGES){const copy=ui.signinExperienceCopy(locale);assert.deepEqual(Object.keys(copy),keys);for(const [key,value] of Object.entries(copy)){assert.equal(typeof value,'string',`${locale}.${key}`);assert.ok(value.trim(),`${locale}.${key}`);}
    if(!['ar','ur','fa'].includes(locale))for(const value of Object.values(copy))assert.ok(!/[\u0600-\u06ff]/u.test(value),`${locale}: no Arabic fallback`);
    const layout=signinLayoutCopy(locale);for(const value of Object.values(layout)){assert.equal(typeof value,'string');assert.ok(value.trim());}
    for(const mode of ['signin','signup']){const markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale,initialMode:mode}));assert.ok(markup.includes(copy.email));assert.ok(markup.includes(copy.password));assert.ok(markup.includes(copy.continueGoogle));assert.ok(!markup.includes(layout.welcome));assert.ok(!markup.includes(layout.description));assert.ok(!markup.includes(copy.signupHint));assert.ok(!markup.includes('class="signin-guest"'));assert.ok(markup.includes('HESSARA'));assert.ok(markup.includes('autoComplete="'+(mode==='signin'?'current-password':'new-password')+'"'));}
  }
});
test('only Google is offered and email registration waits for delivery while existing password login remains available',()=>{
  const markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en'}));
  assert.equal((markup.match(/class="signin-provider"/g)||[]).length,1);
  assert.equal((markup.match(/class="signin-provider"[^>]*disabled=""/g)||[]).length,0);
  for(const retired of ['Apple','GitHub','>X<'])assert.ok(!markup.includes(retired));
  assert.ok(!markup.includes('class="signin-guest"'));
  assert.ok(!markup.includes('<fieldset disabled=""'));
  const signup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en',initialMode:'signup'}));
  assert.ok(signup.includes('<fieldset disabled=""'));assert.ok(signup.includes(ui.signinExperienceCopy('en').emailSetup));
  assert.ok(!signup.includes(ui.signinExperienceCopy('en').guest));
  const disabled=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en',availability:{...availability,providers:{google:false}}}));
  assert.equal((disabled.match(/class="signin-provider"/g)||[]).length,0,'unavailable Google is omitted rather than shown as a dead button');
});

test('unconfigured authentication never recommends an unavailable alternative in any locale',()=>{
  for(const [locale] of ui.LANGUAGES)for(const mode of ['signin','signup'])for(const configured of [false,true]){
    const markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale,initialMode:mode,configured,availability:{email:false,password:false,linking:false,providers:{google:false}}}));
    const copy=ui.signinExperienceCopy(locale);
    assert.ok(markup.includes(copy.methodsUnavailable));
    assert.ok(!markup.includes(copy.emailSetup));
    assert.ok(!markup.includes(copy.unavailable));
    assert.ok(!markup.includes('class="signin-provider"'));
    assert.ok(markup.includes('<fieldset disabled=""'));
  }
});

test('authentication retains its real methods and visible heading without promotional artwork or motion',()=>{
  for(const [locale] of ui.LANGUAGES)for(const mode of ['signin','signup']){
    const markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale,initialMode:mode}));
    assert.ok(markup.includes('hessara-brand-lockup'));assert.ok(markup.includes('id="signin-title" class="signin-title"'));
    assert.ok(!markup.includes('<aside'));assert.ok(!markup.includes('signin-editorial'));assert.ok(!markup.includes('signin-shell'));assert.ok(!markup.includes('class="signin-sr-only"'));
    assert.ok(!markup.includes('/brand/signin-blue-character.png'));assert.ok(!markup.includes('signin-waves'));assert.ok(!markup.includes('/brand/signin-blue-waves.png'));
    assert.ok(!markup.includes('<canvas'));assert.ok(!markup.includes('<video'));assert.ok(!markup.includes('/media/neural-field.mp4'));assert.ok(!markup.includes('/media/intelligence-architecture.svg'));assert.ok(!markup.includes('signin-artwork-motion'));
    assert.ok(markup.indexOf('id="signin-email"')<markup.indexOf('class="signin-provider"'),'email form precedes Google');
    if(mode==='signin'){assert.ok(!markup.includes(signinLayoutCopy(locale).welcome));assert.ok(markup.includes('name="remember"'));assert.ok(markup.includes(signinLayoutCopy(locale).forgot));}
  }
});

test('visible labels remain associated with validated credential fields and the password toggle',()=>{
  for(const [locale] of ui.LANGUAGES){
    const c=ui.signinExperienceCopy(locale),markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale}));
    for(const [id,label] of [['signin-email',c.email],['signin-password',c.password]])assert.ok(markup.includes(`class="signin-field-label" for="${id}">${label}</label>`));
    const email=markup.match(/<input[^>]*id="signin-email"[^>]*>/)?.[0];assert.ok(email);
    assert.match(email,/type="email"/);assert.match(email,/inputMode="email"/);assert.match(email,/required=""/);assert.match(email,/maxLength="254"/);assert.match(email,/autoComplete="email"/);assert.match(email,/dir="ltr"/);
    const password=markup.match(/<input[^>]*id="signin-password"[^>]*>/)?.[0];assert.ok(password);assert.match(password,/type="password"/);assert.match(password,/autoComplete="current-password"/);
    assert.ok(markup.includes(`aria-label="${c.showPassword}" aria-pressed="false"`));
  }
});

test('the shared transparent vector replaces the old emblem without promotional media',()=>{
  const markup=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'ar'}));
  const logo=markup.match(/<span[^>]*class="hessara-brand-mark signin-new-emblem"[^>]*>/)?.[0];assert.ok(logo);assert.match(logo,/aria-hidden="true"/);
  assert.equal((markup.match(/class="hessara-brand-mark\b/g)||[]).length,1,'one decorative mark accompanies the accessible wordmark');
  assert.ok(!markup.includes('hessara-emblem-512.png'));
  assert.ok(!markup.includes('<video'));
  const css=readFileSync(resolve('app/signin/signin.css'),'utf8');
  for(const retired of ['signin-character','signin-waves','signin-editorial','signin-architecture','signin-shell','signin-welcome','--figure-left','--email-center'])assert.ok(!css.includes(retired),'obsolete positioning is removed');
  const vector=readFileSync(resolve('public/brand/hessara-monogram.svg'),'utf8');assert.match(vector,/<svg\b/);assert.match(vector,/<path\b/);assert.ok(!vector.includes('<image'));assert.ok(!vector.includes('<rect'));
});
test('the shared authentication layout keeps decorative branding separate from its labelled form in RTL and LTR',()=>{
  for(const locale of ['ar','en']){
    const markup=renderToStaticMarkup(React.createElement(ui.AuthLayout,{locale,backLabel:'Back'},React.createElement(ui.SignInForm,{...props,locale})));
    assert.match(markup,new RegExp(`<main[^>]*class="signin-page"[^>]*dir="${locale==='ar'?'rtl':'ltr'}"`));
    assert.match(markup,/<div class="signin-art" aria-hidden="true">/);
    assert.match(markup,/<section class="signin-panel" aria-labelledby="signin-title">/);
    assert.ok(markup.indexOf('class="signin-art"')<markup.indexOf('class="signin-panel"'));
    assert.ok(markup.includes('class="signin-art-mark')||markup.includes('hessara-brand-mark signin-art-mark'));
    assert.ok(!markup.includes('<canvas'));assert.ok(!markup.includes('<video'));
  }
});
test('only guests see session-loss notices and guest conversion verifies email before requesting a password',()=>{
  const c=ui.signinExperienceCopy('en');
  const account=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en',session:'account'}));assert.ok(!account.includes(c.guestWarning));assert.ok(!account.includes('<input'));
  const guest=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en',session:'guest',initialMode:'signup',availability:{...availability,email:true,linking:true}}));
  assert.ok(guest.includes(c.guestWarning));assert.ok(guest.includes(c.guestLinkNotice));assert.ok(!guest.includes('id="signin-password"'));
  const ready=renderToStaticMarkup(React.createElement(ui.SignInForm,{...props,locale:'en',session:'account',passwordSetup:true}));assert.ok(!ready.includes(signinLayoutCopy('en').passwordBody));assert.ok(ready.includes(c.setPassword));assert.ok(ready.includes('id="signin-password"'));assert.ok(!ready.includes('id="signin-email"'));
});





