import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, unlink, rmdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const dir = await mkdtemp(resolve('.landing-test-')), file = join(dir, 'ui.mjs');
let ui;
try {
  const result = await build({absWorkingDir:process.cwd(), stdin:{contents:"export {LandingHero} from './app/landing-hero'; export {LandingHeader} from './app/landing-header'; export {LANGUAGES} from './lib/i18n'; export {refs,resetRefs} from 'header-test-refs';", resolveDir:process.cwd(), loader:'tsx'}, bundle:true, write:false, format:'esm', platform:'node', packages:'external', jsx:'automatic', loader:{'.css':'empty'}, tsconfig:resolve('tsconfig.json'), plugins:[{name:'native-next', setup(b){
    b.onResolve({filter:/^(react|header-test-refs)$/}, a=>{if(a.path==='header-test-refs'||/(landing-header|editions-landing)\.tsx$/.test(a.importer))return{path:'refs',namespace:'header-refs'};});
    b.onLoad({filter:/.*/,namespace:'header-refs'},()=>({contents:"export const refs=[];export function resetRefs(){refs.length=0;}export function useRef(current){const ref={current};refs.push(ref);return ref;}export function useEffect(){}export function useState(value){return[value,()=>{}];}",loader:'js'}));
    b.onResolve({filter:/^next\/(link|image)$/}, a=>({path:a.path, namespace:'next-test'}));
    b.onLoad({filter:/.*/,namespace:'next-test'}, a=>({contents:a.path.endsWith('link')?"import React from 'react';export default function Link(p){return React.createElement('a',p);}":"import React from 'react';export default function Image({preload,quality,...p}){return React.createElement('img',p);}",loader:'js',resolveDir:process.cwd()}));
  }}]});
  await writeFile(file,result.outputFiles[0].text); ui = await import(pathToFileURL(file).href);
} finally {await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(dir);}

test('landing preserves every destination alongside four original scientific concepts and localized controls',()=>{
  for(const [locale] of ui.LANGUAGES){
    const html=renderToStaticMarkup(React.createElement(ui.LandingHero,{locale,disabled:false,onExplore(){},onHow(){}}));
    assert.ok(!html.includes('/brand/landing-hand-assistant.png'));
    assert.ok(!html.includes('/media/neural-field'));
    assert.ok(!html.includes('<video'));
    assert.equal((html.match(/<figcaption/g)||[]).length,3,'opening neural caption is removed; other conceptual plates retain explanations');
    for(const kind of ['network','attention','embedding','language'])assert.ok(html.includes('scientific-visual--'+kind),kind);
    assert.ok(html.includes(locale==='ar'?'ليس بيانات تشغيل':'not live telemetry'));
    assert.ok(!html.includes('NEURAL STUDY'));
    assert.ok(html.includes('id="workspace-paths"'));
    assert.ok(html.includes(`href="/?lang=${locale}&amp;view=personal-lab"`));
    assert.ok(html.includes(`href="/?lang=${locale}&amp;view=code-workspace"`));
    assert.equal((html.match(/<button/g)||[]).length,3,'primary actions and the page motion control');
    assert.ok(html.includes('id="all-sections"'));
    for(const destination of ['llms','agents','personal-lab','code-workspace','runs','tools','benchmarks','models','how','method'])assert.ok(html.includes(`view=${destination}`),destination);
    assert.ok(html.includes(`/reverse-engineering?lang=${locale}`));
    assert.ok(html.includes('id="landing-title"'));
    assert.ok(html.includes(`dir="${['ar','fa','ur'].includes(locale)?'rtl':'ltr'}"`));
    assert.ok(!html.includes('<canvas'));
    if(locale==='ar'){assert.ok(html.includes('ذكاء تختبره'));assert.ok(html.includes('وآفاق تكتشفها'));}
  }
});

test('hero actions invoke the existing navigation callbacks and respect active execution',()=>{
  const calls=[], tree=ui.LandingHero({locale:'ar',disabled:true,onExplore:()=>calls.push('llms'),onHow:()=>calls.push('how')});
  const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)];
  const buttons=walk(tree).filter(n=>n.type==='button');
  assert.equal(buttons[0].props.disabled,true);
  buttons[0].props.onClick();buttons[1].props.onClick();
  assert.deepEqual(calls,['llms','how']);
});

test('masthead preserves accessible navigation and a real top-level Reverse Engineering URL',()=>{
  const html=renderToStaticMarkup(React.createElement(ui.LandingHeader,{primary:[{id:'overview',label:'Overview'},{id:'llms',label:'Models'}],secondary:[{id:'method',label:'Method'}],moreLabel:'More',menuLabel:'Platform sections',onNavigate(){},onHome(){}},React.createElement('a',{href:'/signin?lang=en'},'Account')));
  assert.ok(html.includes('aria-current="page"'));
  assert.ok(html.includes('href="/reverse-engineering"'));
  assert.ok(html.includes('href="/?view=llms"'));
  assert.ok(html.includes('href="/?view=method"'));
  assert.ok(html.includes('href="/signin?lang=en"'));
  assert.ok(html.includes('<summary aria-label="Platform sections"'));
  assert.ok(!html.includes('role="tab"'),'masthead does not duplicate Radix tab IDs');
});

test('closing the current mobile destination restores keyboard focus before navigation',()=>{
  ui.resetRefs();const events=[];
  const tree=ui.LandingHeader({primary:[{id:'overview',label:'Overview'}],secondary:[],moreLabel:'More',menuLabel:'Sections',onNavigate:id=>events.push(id),onHome(){}});
  ui.refs[0].current={open:true,querySelector:()=>({focus:()=>events.push('summary-focus')})};
  const walk=n=>!n||typeof n!=='object'?[]:[n,...React.Children.toArray(n.props?.children).flatMap(walk)];
  const links=walk(tree).filter(n=>n.type==='a'&&n.props['aria-current']==='page');
  links.at(-1).props.onClick({button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,defaultPrevented:false,preventDefault(){events.push('prevent-default');}});
  assert.equal(ui.refs[0].current.open,false);
  assert.deepEqual(events,['prevent-default','summary-focus','overview']);
});


