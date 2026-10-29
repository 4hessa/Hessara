import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

// Exercise the real locale hook with a small browser/history fixture; no provider calls.
const bundle = await build({
  stdin: {contents:"export { useLocale } from './hooks/use-locale'; export { reset, render, subscriptions, serverValue } from 'react';",resolveDir:process.cwd(),loader:'ts'},
  bundle:true,platform:'node',format:'esm',write:false,tsconfig:resolve('tsconfig.json'),
  plugins:[{name:'locale-hook-harness',setup(b){
    b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`
      let values=[],cursor=0,unsubscribe;
      export let subscriptions=0,serverValue;
      export function reset(){unsubscribe?.();unsubscribe=undefined;values=[];cursor=0;subscriptions=0;}
      export function render(fn){cursor=0;return fn();}
      export function useState(initial){const i=cursor++;if(!(i in values))values[i]=initial;return[values[i],next=>{values[i]=next}];}
      export function useCallback(fn){return fn;}
      export function useSyncExternalStore(subscribe,snapshot,server){unsubscribe?.();unsubscribe=subscribe(()=>{subscriptions++});serverValue=server();return snapshot();}
    `}));
  }}]
});
const hook=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

function browser(t,href,saved='ar') {
  const target=new EventTarget();let location=new URL(href),preference=saved;
  const fixture={get location(){return location},history:{replaceState(_state,_title,url){location=new URL(url,location)}},addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target)};
  const storage={getItem(){return preference},setItem(_key,value){preference=value}};
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'window',{value:fixture,configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  t.after(()=>{hook.reset();if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete globalThis.localStorage});
  hook.reset();
  return {fixture,storage,navigate(url){location=new URL(url,location);target.dispatchEvent(new Event('popstate'))}};
}

test('an English link overrides a saved Arabic preference, including the server snapshot',t=>{
  browser(t,'https://hessara.example/?lang=en&view=llms','ar');
  assert.equal(hook.render(()=>hook.useLocale('en'))[0],'en');
  assert.equal(hook.serverValue,'en');
});
test('changing language preserves the workspace route, selected run and fragment',t=>{
  const {fixture}=browser(t,'https://hessara.example/?view=runs&run=owned-run&lang=ar#result','ar');
  const [,change]=hook.render(()=>hook.useLocale('ar'));change('en');
  assert.equal(fixture.location.searchParams.get('lang'),'en');
  assert.equal(fixture.location.searchParams.get('view'),'runs');
  assert.equal(fixture.location.searchParams.get('run'),'owned-run');
  assert.equal(fixture.location.hash,'#result');
  assert.equal(hook.render(()=>hook.useLocale('ar'))[0],'en');
});
test('back and forward navigation re-read the explicit language and clean up listeners',t=>{
  const b=browser(t,'https://hessara.example/?lang=en','ar');
  hook.render(()=>hook.useLocale('en'));b.navigate('/?lang=fr');
  assert.equal(hook.subscriptions,1);assert.equal(hook.render(()=>hook.useLocale('en'))[0],'fr');
  b.navigate('/?lang=en');assert.equal(hook.render(()=>hook.useLocale('en'))[0],'en');
  hook.reset();b.navigate('/?lang=ar');assert.equal(hook.subscriptions,0);
});
test('invalid language falls back safely, and blocked storage does not prevent switching',t=>{
  const b=browser(t,'https://hessara.example/?lang=invalid','fr');
  assert.equal(hook.render(()=>hook.useLocale('ar'))[0],'fr');
  b.storage.getItem=()=>{throw new Error('storage blocked')};b.storage.setItem=()=>{throw new Error('storage blocked')};
  const [locale,change]=hook.render(()=>hook.useLocale('ar'));assert.equal(locale,'ar');
  change('en');assert.equal(hook.render(()=>hook.useLocale('ar'))[0],'en');
  change('invalid');assert.equal(b.fixture.location.searchParams.get('lang'),'en');
});
