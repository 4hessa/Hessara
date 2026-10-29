import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NVIDIA_MODELS} from '../lib/nvidia.ts';
const directory=await mkdtemp(resolve('.nvidia-availability-test-'));
let ui;
try{
 const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {NvidiaStart} from './app/nvidia-start';export {begin,commit,reset} from 'catalog-hooks';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'esm',platform:'node',packages:'external',write:false,jsx:'automatic',loader:{'.css':'empty'},tsconfig:resolve('tsconfig.json'),plugins:[{name:'catalog-lifecycle',setup(builder){
  builder.onResolve({filter:/^(react|catalog-hooks)$/},args=>args.path==='catalog-hooks'||/nvidia-start\.tsx$/.test(args.importer)?{path:'hooks',namespace:'catalog-hooks'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'catalog-hooks'},()=>({contents:`let values=[],effects=[],pending=[],cursor=0;export function begin(){cursor=0;}export function reset(){for(const effect of effects)effect?.cleanup?.();values=[];effects=[];pending=[];cursor=0;}export function commit(){for(const run of pending.splice(0))run();}export function useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],value=>values[index]=typeof value==='function'?value(values[index]):value];}export function useEffect(callback,deps){const index=cursor++;const previous=effects[index];if(!previous||deps.some((v,i)=>v!==previous.deps[i]))pending.push(()=>{previous?.cleanup?.();effects[index]={deps,cleanup:callback()};});}`,loader:'js'}));
 }}]});
 const file=join(directory,'ui.mjs');await writeFile(file,result.outputFiles[0].text);ui=await import(pathToFileURL(file).href);
}finally{assert.ok(directory.startsWith(resolve('.nvidia-availability-test-')));await rm(directory,{recursive:true,force:true});}
function elements(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)];}
const text=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(text).join(''):typeof node==='object'?text(node.props?.children):String(node);
function render(onLinked=()=>{}){ui.begin();const tree=ui.NvidiaStart({locale:'en',onLinked});ui.commit();return tree;}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<30;i++){await settle();if(check())return;}assert.fail('catalog UI did not settle');}
const catalog={models:NVIDIA_MODELS.map(model=>({...model,available:model.id!=='moonshotai/kimi-k3'})),catalogStatus:'checked',checkedAt:'2026-10-24T10:00:00Z'};

test('NVIDIA UI waits for current discovery and excludes unavailable presets from its default real request',async t=>{
 ui.reset();t.after(()=>ui.reset());let release;const waiting=new Promise(resolve=>release=resolve);const posts=[];let linked;
 t.mock.method(globalThis,'fetch',async(_url,options)=>{if(options?.method==='POST'){posts.push(JSON.parse(options.body));return Response.json({ids:['saved-profile'],models:[]},{status:201});}await waiting;return Response.json(catalog);});
 const initial=render();assert.ok(text(initial).includes('Checking the provider catalog'));assert.ok(elements(initial).filter(node=>node.props?.type==='checkbox').every(node=>!node.props.checked&&node.props.disabled));
 release();await until(()=>elements(render()).filter(node=>node.props?.type==='checkbox'&&node.props.checked).length===3);
 let tree=render(value=>{linked=value;});const checkboxes=elements(tree).filter(node=>node.props?.type==='checkbox');assert.equal(checkboxes[2].props.checked,false);assert.equal(checkboxes[2].props.disabled,true);assert.ok(text(tree).includes('Not currently listed'));
 elements(tree).find(node=>node.props?.id==='nvidia-key').props.onChange({target:{value:'safe-fixture-key'}});
 tree=render(value=>{linked=value;});elements(tree).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 await until(()=>linked!==undefined);assert.deepEqual(linked,['saved-profile']);assert.equal(posts.length,1);assert.equal(posts[0].ids.length,3);assert.ok(!posts[0].ids.includes('moonshotai/kimi-k3'));
});

test('catalog outage disables selection and exposes a refresh path without sending inference',async t=>{
 ui.reset();t.after(()=>ui.reset());let posts=0;t.mock.method(globalThis,'fetch',async(_url,options)=>{if(options?.method==='POST')posts++;return Response.json({models:NVIDIA_MODELS,catalogStatus:'unavailable',checkedAt:null});});
 render();await until(()=>text(render()).includes('Availability is currently unverified'));
 const tree=render();assert.ok(elements(tree).find(node=>node.props?.type==='submit').props.disabled);assert.ok(elements(tree).some(node=>node.props?.role==='alert'&&text(node).includes('no inference request was sent')));assert.ok(elements(tree).some(node=>node.type==='button'&&text(node)==='Refresh availability'&&!node.props.disabled));assert.equal(posts,0);
});

test('leaving the NVIDIA connection view aborts its outstanding catalog request',async t=>{
 ui.reset();let signal;t.mock.method(globalThis,'fetch',async(_url,options)=>{signal=options.signal;return new Promise(()=>{});});render();assert.equal(signal.aborted,false);ui.reset();assert.equal(signal.aborted,true);
});
