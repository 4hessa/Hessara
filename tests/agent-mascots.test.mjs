import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AGENTS} from '../lib/agent-catalog.ts';
import {FEATURED_ASSISTANTS} from '../lib/featured-assistants.ts';
import {AGENT_MASCOTS,agentMascotFor,mascotMotionLabel} from '../lib/agent-mascot-config.ts';

const directory=await mkdtemp(resolve('.mascot-test-')),output=join(directory,'ui.mjs');
let ui;
try{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {SuperAgentMascot} from './app/super-agent-mascot';export {setHost,takeEffects} from 'mascot-test-hooks';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,loader:{'.css':'empty'},jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'mascot-test-runtime',setup(builder){
    builder.onResolve({filter:/^(react|mascot-test-hooks)$/},args=>{if(args.path==='mascot-test-hooks'||/super-agent-mascot\.tsx$/.test(args.importer))return{path:'hooks',namespace:'mascot-hooks'};});
    builder.onLoad({filter:/.*/,namespace:'mascot-hooks'},()=>({contents:"let host=null,effects=[];export function memo(fn){return fn;}export function useRef(initial){return{current:initial===null?host:initial};}export function useEffect(fn){effects.push(fn);}export function setHost(value){host=value;}export function takeEffects(){const found=effects;effects=[];return found;}",loader:'js'}));
    builder.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'next-image'}));
    builder.onLoad({filter:/.*/,namespace:'next-image'},()=>({contents:"import React from 'react';export default function Image(props){return React.createElement('img',props);}",loader:'js',resolveDir:process.cwd()}));
  }}]});
  await writeFile(output,result.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
}finally{await unlink(output).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}

test('all 25 HESSARA-managed agents have stable distinct character assets and individual timings',()=>{
  const expected=new Set([...AGENTS.filter(agent=>agent.mode!=='external').map(agent=>agent.id),'lindy','hermes',...FEATURED_ASSISTANTS.map(agent=>agent.id)]);
  assert.equal(expected.size,25);assert.equal(AGENT_MASCOTS.length,25);
  assert.deepEqual(new Set(AGENT_MASCOTS.map(config=>config.agentId)),expected);
  assert.equal(new Set(AGENT_MASCOTS.map(config=>config.asset)).size,25);
  assert.equal(new Set(AGENT_MASCOTS.map(config=>config.idleDuration)).size,25);
  assert.equal(new Set(AGENT_MASCOTS.map(config=>config.danceDuration)).size,25);
  assert.equal(new Set(AGENT_MASCOTS.map(config=>config.gestureStrength)).size,25);
  for(const [index,config]of AGENT_MASCOTS.entries()){
    assert.equal(agentMascotFor(config.agentId),config);
    assert.equal(config.sourceIndex,index+1);
    assert.equal(config.asset,'/mascots/mascot-'+String(index+1).padStart(2,'0')+'.webp');
    assert.ok(config.amplitude<=3 && config.tilt<=3 && config.danceDelay>=15000);
  }
  assert.equal(agentMascotFor('unknown-new-agent'),undefined);
  for(const locale of ['ar','en','fr','es','zh','ko','ur','fa','pt','it','ru','de','nl']){
    assert.ok(mascotMotionLabel(locale,false));assert.ok(mascotMotionLabel(locale,true));
    assert.notEqual(mascotMotionLabel(locale,false),mascotMotionLabel(locale,true));
  }
});

test('mascots reserve their own decorative image slot, keep real activity distinct, and never add controls',async()=>{
  for(const config of AGENT_MASCOTS){
    const markup=renderToStaticMarkup(React.createElement(ui.SuperAgentMascot,{agentId:config.agentId,activity:'loading',selected:true}));
    assert.match(markup,/aria-hidden="true"/);assert.match(markup,/data-activity="loading"/);assert.match(markup,/data-running="false"/);
    assert.ok(markup.includes('src="'+config.asset+'"'));assert.match(markup,/loading="lazy"/);assert.match(markup,/width="512"/);assert.match(markup,/height="640"/);
    assert.match(markup,/alt=""/);assert.ok(!markup.includes('<button'));assert.ok(!markup.includes('<canvas'));
  }
  assert.equal(renderToStaticMarkup(React.createElement(ui.SuperAgentMascot,{agentId:'unknown-new-agent'})),'');
  ui.takeEffects();
  const css=await readFile(resolve('app/super-agent-mascot.css'),'utf8');
  assert.ok(css.includes('prefers-reduced-motion:reduce'));assert.ok(css.includes('contain:layout paint'));
});

test('motion responds to real visibility and preferences, preserves card actions, and releases every listener',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const handlers=new Map(),documentHandlers=new Map(),mediaHandlers=new Map(),styles=new Map(),frames=new Map(),animations=[];
  let frameId=0,observer;
  const card={addEventListener:(name,callback)=>handlers.set(name,callback),removeEventListener:name=>handlers.delete(name),getBoundingClientRect:()=>({left:0,top:0,width:400,height:300}),matches:()=>false};
  const character={animate:(keyframes,options)=>{const animation={keyframes,options,playState:'running',cancel(){this.playState='idle';this.cancelled=true;}};animations.push(animation);return animation;}};
  const host={dataset:{},style:{setProperty:(key,value)=>styles.set(key,value)},closest:()=>card,querySelector:()=>character};
  const media={matches:false,addEventListener:(name,callback)=>mediaHandlers.set(name,callback),removeEventListener:name=>mediaHandlers.delete(name)};
  const doc={hidden:false,addEventListener:(name,callback)=>documentHandlers.set(name,callback),removeEventListener:name=>documentHandlers.delete(name)};
  const replacements={document:doc,window:{matchMedia:()=>media},Element:class{},IntersectionObserver:function(callback){observer={callback,observe(){},disconnect(){this.disconnected=true;}};return observer;},requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id)};
  const descriptors=new Map(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let cleanup;
  try{
    for(const[key,value]of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    ui.setHost(host);ui.SuperAgentMascot({agentId:'jev'});const effects=ui.takeEffects();cleanup=effects[0]();effects[1]();
    assert.equal(host.dataset.running,'false');
    observer.callback([{isIntersecting:true}]);assert.equal(host.dataset.running,'true');
    t.mock.timers.tick(agentMascotFor('jev').danceDelay);
    assert.equal(host.dataset.reaction,'dance');assert.equal(animations.length,1);
    animations[0].playState='finished';
    handlers.get('pointerenter')({pointerType:'mouse'});
    handlers.get('pointermove')({pointerType:'mouse',clientX:400,clientY:300});
    const next=frames.entries().next().value;frames.delete(next[0]);next[1]();
    assert.ok(Number(styles.get('--mascot-pointer-x'))>0);
    let prevented=false;
    handlers.get('click')({target:null,preventDefault(){prevented=true;}});
    assert.equal(prevented,false);assert.equal(host.dataset.reaction,'celebrate');
    media.matches=true;mediaHandlers.get('change')();
    assert.equal(host.dataset.running,'false');assert.equal(frames.size,0);assert.equal(styles.get('--mascot-pointer-x'),'0');
    assert.ok(animations.at(-1).cancelled);
    media.matches=false;mediaHandlers.get('change')();assert.equal(host.dataset.running,'true');
    doc.hidden=true;documentHandlers.get('visibilitychange')();assert.equal(host.dataset.running,'false');
    cleanup();cleanup=undefined;
    assert.equal(handlers.size,0);assert.equal(documentHandlers.size,0);assert.equal(mediaHandlers.size,0);assert.ok(observer.disconnected);
  }finally{
    cleanup?.();ui.setHost(null);ui.takeEffects();
    for(const[key,descriptor]of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
});




