import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const directory=await mkdtemp(resolve('.scientific-test-')),output=join(directory,'ui.mjs');
let ui;
try{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {ScientificVisual} from './app/scientific-visual';export {refs,effects,reset} from 'science-hooks';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,loader:{'.css':'empty'},jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'science-lifecycle-fixture',setup(builder){
    builder.onResolve({filter:/^(react|science-hooks)$/},args=>{if(args.path==='science-hooks'||/scientific-visual\.tsx$/.test(args.importer))return{path:'hooks',namespace:'science-hooks'};});
    builder.onLoad({filter:/.*/,namespace:'science-hooks'},()=>({contents:"export const refs=[],effects=[];let id=0;export function reset(){refs.length=0;effects.length=0;}export function useRef(current){const ref={current};refs.push(ref);return ref;}export function useEffect(effect){effects.push(effect);}export function useId(){return 'science-test-'+id++;}",loader:'js'}));
  }}]});
  await writeFile(output,result.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
}finally{await unlink(output).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}

function fixture(t,{reduced=false,motionPaused=false,compact=false}={}){
  const descriptors=new Map(['window','document','IntersectionObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const listeners=new Map(),preferenceListeners=new Map(),qualityListeners=new Map();
  const quality={matches:compact,addEventListener:(name,callback)=>qualityListeners.set(name,callback),removeEventListener:(name,callback)=>{if(qualityListeners.get(name)===callback)qualityListeners.delete(name);}};
  const media={matches:reduced,addEventListener:(name,callback)=>preferenceListeners.set(name,callback),removeEventListener:(name,callback)=>{if(preferenceListeners.get(name)===callback)preferenceListeners.delete(name);}};
  const document={hidden:false,addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:(name,callback)=>{if(listeners.get(name)===callback)listeners.delete(name);}};
  let observer;
  function Observer(callback){observer={connected:true,observe(){},disconnect(){this.connected=false;},emit(visible){callback([{isIntersecting:visible}]);}};return observer;}
  Object.defineProperty(globalThis,'window',{value:{matchMedia:query=>query.includes('prefers-reduced-motion')?media:quality},configurable:true});
  Object.defineProperty(globalThis,'document',{value:document,configurable:true});
  Object.defineProperty(globalThis,'IntersectionObserver',{value:Observer,configurable:true});
  t.after(()=>{for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  ui.reset();ui.ScientificVisual({kind:'network',locale:'ar',motionPaused});
  const node={dataset:{running:'false'}};ui.refs[0].current=node;
  const cleanup=ui.effects[0]();
  return{node,cleanup,listeners,preferenceListeners,qualityListeners,quality:value=>{quality.matches=value;qualityListeners.get('change')?.();},observer,visible:value=>observer.emit(value),visibility:hidden=>{document.hidden=hidden;listeners.get('visibilitychange')?.();},reduce:value=>{media.matches=value;preferenceListeners.get('change')?.();}};
}

test('all four scientific plates render meaningful accessible static content without movie decoding',()=>{
  const expected={network:'Conceptual signal propagation',attention:'Attention architecture',language:'Language processing',embedding:'Embedding space'};
  for(const[kind,label]of Object.entries(expected)){
    ui.reset();
    const html=renderToStaticMarkup(React.createElement(ui.ScientificVisual,{kind,locale:'en'}));
    assert.equal(html.includes('<figcaption'),kind!=='network','the opening caption is removed from actual markup');
    assert.ok(html.includes(label));
    assert.ok(html.includes(kind==='network'?'not live model activity':'not live telemetry'));
    assert.ok(!html.includes('Connected layers. Directed signals.'));
    assert.ok(html.includes('var(--overview-art)'));
    assert.ok(html.includes('viewBox="0 0 700 460"'));
    assert.ok(html.includes('data-running="false"'),'server markup is motionless until lifecycle checks run');
    assert.ok(!html.includes('<video')&&!html.includes('<canvas')&&!html.includes('<button'));
  }
  const arabic=renderToStaticMarkup(React.createElement(ui.ScientificVisual,{kind:'attention',locale:'ar'}));
  assert.ok(arabic.includes('ليست أوزان نموذج حقيقي'));
  assert.ok(arabic.includes('رؤوس انتباه متوازية'));
  assert.equal((arabic.match(/class="science-attention-head" style="--science-stage:1"/g)||[]).length,3,'attention heads share a compute phase before context merge');
});

test('scientific motion follows visibility, document state, system preference and cleanup',t=>{
  const f=fixture(t);
  assert.equal(f.node.dataset.running,'false');
  assert.equal(f.node.dataset.quality,'full');
  f.quality(true);assert.equal(f.node.dataset.quality,'compact');
  f.quality(false);assert.equal(f.node.dataset.quality,'full');
  f.visible(true);assert.equal(f.node.dataset.running,'true');
  f.visibility(true);assert.equal(f.node.dataset.running,'false');
  f.visibility(false);assert.equal(f.node.dataset.running,'true');
  f.reduce(true);assert.equal(f.node.dataset.running,'false');
  f.reduce(false);assert.equal(f.node.dataset.running,'true');
  f.visible(false);assert.equal(f.node.dataset.running,'false');
  f.visible(true);f.cleanup();
  assert.equal(f.node.dataset.running,'false');
  assert.equal(f.observer.connected,false);
  assert.equal(f.listeners.size,0);assert.equal(f.preferenceListeners.size,0);assert.equal(f.qualityListeners.size,0);
  f.visible(true);assert.equal(f.node.dataset.running,'false','late observer callbacks cannot restart unmounted artwork');
});

for(const[label,options]of[['reduced motion',{reduced:true}],['page pause',{motionPaused:true}]])test(label+' keeps the scientific artwork static',t=>{
  const f=fixture(t,options);
  f.visible(true);assert.equal(f.node.dataset.running,'false');
  f.visibility(true);f.visibility(false);assert.equal(f.node.dataset.running,'false');
  f.cleanup();
});


