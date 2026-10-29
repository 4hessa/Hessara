import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,unlink,rmdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const directory=await mkdtemp(resolve('.cinematic-test-')),output=join(directory,'media.mjs');
let ui;
try{
  const result=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {CinematicMedia} from './app/cinematic-media';export {refs,effects,begin,reset} from 'media-hooks';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,loader:{'.css':'empty'},jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'media-lifecycle-fixture',setup(builder){
    builder.onResolve({filter:/^(react|media-hooks)$/},args=>{if(args.path==='media-hooks'||/cinematic-media\.tsx$/.test(args.importer))return{path:'hooks',namespace:'media-hooks'};});
    builder.onLoad({filter:/.*/,namespace:'media-hooks'},()=>({contents:`export const refs=[],effects=[];let states=[],cursor=0,reduced=false;export function begin(){cursor=0;refs.length=0;effects.length=0;}export function reset(value=false){states=[];reduced=value;begin();}export function useRef(current){const ref={current};refs.push(ref);return ref;}export function useEffect(effect){effects.push(effect);}export function useSyncExternalStore(){return reduced;}export function useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=value];}`,loader:'js'}));
  }}]});
  await writeFile(output,result.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
}finally{await unlink(output).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);}

function elements(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)];}
function render(props={}){ui.begin();return ui.CinematicMedia(props);}
function browserFixture(t,{rejected=false}={}){
  const originals=new Map(['document','IntersectionObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const listeners=new Map();let observer;
  const document={hidden:false,addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener:(name,listener)=>{if(listeners.get(name)===listener)listeners.delete(name);}};
  function Observer(callback){observer={connected:true,observe(target){this.target=target;},disconnect(){this.connected=false;},emit(visible){callback([{isIntersecting:visible}]);}};return observer;}
  Object.defineProperty(globalThis,'document',{value:document,configurable:true});
  Object.defineProperty(globalThis,'IntersectionObserver',{value:Observer,configurable:true});
  t.after(()=>{for(const[key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const calls={plays:0,pauses:0};
  const video={muted:false,play(){calls.plays++;return rejected?Promise.reject(new Error('autoplay blocked')):Promise.resolve();},pause(){calls.pauses++;}};
  ui.refs[0].current=video;ui.refs[1].current={};
  return{calls,video,document,listeners,start:()=>ui.effects[0](),visible:value=>observer.emit(value),isConnected:()=>observer.connected,visibility:hidden=>{document.hidden=hidden;listeners.get('visibilitychange')?.();}};
}

test('normal-motion media never renders an overlay, caption, play icon or native player controls',()=>{
  ui.reset(false);const tree=render(),nodes=elements(tree),video=nodes.find(node=>node.type==='video');
  assert.ok(video);assert.equal(video.props.controls,false);assert.equal(video.props.muted,true);assert.equal(video.props.loop,true);assert.equal(video.props.playsInline,true);
  assert.equal(video.props.disablePictureInPicture,true);assert.equal(video.props.disableRemotePlayback,true);
  assert.equal(nodes.filter(node=>['button','svg','figcaption'].includes(node.type)).length,0);
  assert.equal(nodes.filter(node=>node.type==='img').length,1,'poster is retained without a fabricated play prompt');
});

test('visibility starts the real video automatically, pauses hidden media and cleans up every listener',t=>{
  ui.reset(false);render();const fixture=browserFixture(t),cleanup=fixture.start();
  assert.equal(fixture.calls.plays,0);fixture.visible(true);assert.equal(fixture.calls.plays,1);assert.equal(fixture.video.muted,true);
  fixture.visible(false);assert.equal(fixture.calls.pauses,1);
  fixture.visibility(true);fixture.visible(true);assert.equal(fixture.calls.plays,1);
  fixture.visibility(false);assert.equal(fixture.calls.plays,2);
  cleanup();assert.equal(fixture.listeners.size,0);assert.equal(fixture.isConnected(),false);
  fixture.visible(true);assert.equal(fixture.calls.plays,2,'a stale observer cannot restart unmounted media');
});

for(const[label,reduced,motionPaused]of[['system reduced motion',true,false],['external page preference',false,true]])test(`${label} prevents autoplay`,t=>{
  ui.reset(reduced);const tree=render({motionPaused}),fixture=browserFixture(t),cleanup=fixture.start();
  fixture.visible(true);assert.equal(fixture.calls.plays,0);assert.equal(fixture.calls.pauses,1);
  if(reduced)assert.equal(elements(tree).find(node=>node.type==='video').props['data-ready'],false);
  cleanup();
});

test('autoplay rejection and loading errors retain the poster without restoring an overlay',async t=>{
  ui.reset(false);let tree=render();const fixture=browserFixture(t,{rejected:true}),cleanup=fixture.start();
  fixture.visible(true);await new Promise(resolve=>setImmediate(resolve));
  elements(tree).find(node=>node.type==='video').props.onLoadedData();
  tree=render();assert.equal(elements(tree).find(node=>node.type==='video').props['data-ready'],true);
  elements(tree).find(node=>node.type==='video').props.onError();
  tree=render();assert.equal(elements(tree).find(node=>node.type==='video').props['data-ready'],false);
  assert.equal(elements(tree).filter(node=>node.type==='button').length,0);assert.ok(elements(tree).find(node=>node.type==='img'));
  cleanup();
});


test('shared decorative renderers cannot reintroduce retired media overlays',async()=>{
  for(const source of ['app/cinematic-media.tsx','app/workspace-visual.tsx','app/auth-fluid-visual.tsx']){
    const code=await readFile(source,'utf8');
    assert.ok(!code.includes('cinematic-motion'),source);
    assert.ok(!code.includes('hessara-scene-toggle'),source);
  }
});


test('the same controller supports an original science film with a reserved uncropped ratio',()=>{
  ui.reset(false);const tree=render({src:'/science/gradient-descent.mp4',poster:'/science/gradient-descent-poster.webp',width:1280,height:720});
  const nodes=elements(tree),video=nodes.find(node=>node.type==='video'),poster=nodes.find(node=>node.type==='img');
  assert.equal(video.props.src,'/science/gradient-descent.mp4');assert.equal(video.props.poster,poster.props.src);
  assert.equal(tree.props.style.aspectRatio,'1280 / 720');assert.equal(poster.props.width,1280);assert.equal(video.props.preload,'none');
});

test('unsupported visibility observation keeps a static poster instead of crashing the page',t=>{
  ui.reset(false);const tree=render();const fixture=browserFixture(t);
  Object.defineProperty(globalThis,'IntersectionObserver',{value:undefined,configurable:true});
  assert.doesNotThrow(()=>fixture.start());assert.equal(fixture.calls.plays,0);assert.equal(fixture.calls.pauses,1);
  assert.equal(elements(tree).find(node=>node.type==='video').props['data-ready'],false);
});
