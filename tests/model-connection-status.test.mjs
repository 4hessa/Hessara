import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';

const directory=await mkdtemp(resolve('.model-connection-test-'));
let ui;
try {
  const bundled=await build({absWorkingDir:process.cwd(),stdin:{contents:"export {ModelConnectionStatus} from './app/model-connection-status';export {modelConnectionCopy} from './lib/model-connection-copy';export {LANGUAGES} from './lib/i18n';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,loader:{'.css':'empty'},jsx:'automatic',tsconfig:resolve('tsconfig.json'),plugins:[{name:'stable-test-id',setup(builder){builder.onResolve({filter:/^react$/},args=>/model-connection-status\.tsx$/.test(args.importer)?{path:'id',namespace:'connection-test'}:undefined);builder.onLoad({filter:/.*/,namespace:'connection-test'},()=>({contents:"let id=0;export function useId(){return 'model-connection-'+(++id);}"}));}}]});
  const output=join(directory,'component.mjs');await writeFile(output,bundled.outputFiles[0].text);ui=await import(pathToFileURL(output).href);
} finally {await rm(directory,{recursive:true,force:true});}

const props={locale:'ar',connectedCount:0,onConnect:()=>{},onRefresh:()=>{}};
function elements(node){if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(elements);return[node,...elements(node.props?.children)];}
function content(node){if(node==null||typeof node==='boolean')return'';if(Array.isArray(node))return node.map(content).join('');return typeof node==='object'?content(node.props?.children):String(node);}

test('empty state explains missing setup and routes only an explicit user action to NVIDIA or another supported provider',()=>{
  const selected=[];let refreshed=0;
  const node=ui.ModelConnectionStatus({...props,onConnect:id=>selected.push(id),onRefresh:()=>{refreshed++;}});
  const copy=ui.modelConnectionCopy('ar');
  assert.ok(content(node).includes(copy.empty)&&content(node).includes(copy.definition)&&content(node).includes(copy.subscription));
  assert.equal(elements(node).filter(element=>element.type==='li').length,3);
  assert.deepEqual(selected,[]);
  elements(node).find(element=>element.type==='button'&&element.props.className==='model-connection-start').props.onClick();
  assert.deepEqual(selected,['nvidia']);
  const providerBoxes=elements(node).filter(element=>element.props?.className==='model-connection-provider');
  assert.equal(providerBoxes.length,5);
  for(const box of providerBoxes)elements(box).find(element=>element.type==='button').props.onClick();
  assert.deepEqual(selected,['nvidia','openai','anthropic','gemini','nvidia','openrouter']);
  elements(node).find(element=>element.props?.className==='model-connection-refresh').props.onClick();assert.equal(refreshed,1);
  const links=elements(node).filter(element=>element.type==='a');
  assert.deepEqual(links.map(link=>link.props.href),['https://platform.openai.com/api-keys','https://platform.claude.com/settings/keys','https://aistudio.google.com/apikey','https://build.nvidia.com/settings/api-keys','https://openrouter.ai/settings/keys']);
  assert.ok(links.every(link=>link.props.target==='_blank'&&link.props.rel==='noopener noreferrer'));
  assert.ok(!elements(node).some(element=>element.type==='input'||element.type==='form'),'this guide never requests or submits credentials itself');
});

test('saved count is distinguished from live verification and loading never falsely reports an empty account',()=>{
  const copy=ui.modelConnectionCopy('en');
  const saved=ui.ModelConnectionStatus({...props,locale:'en',connectedCount:3});
  assert.ok(content(saved).includes(copy.ready)&&content(saved).includes(copy.unverified));
  assert.ok(content(saved).includes('3'));
  assert.ok(!content(saved).includes(copy.empty));
  assert.ok(!elements(saved).some(element=>element.props?.className==='model-connection-start'));
  const loading=ui.ModelConnectionStatus({...props,locale:'en',loading:true});
  assert.equal(loading.props['aria-busy'],true);
  assert.ok(content(loading).includes(copy.loading)&&!content(loading).includes(copy.empty));
  assert.equal(elements(loading).find(element=>element.type==='button').props.disabled,true);
  const refreshing=ui.ModelConnectionStatus({...props,locale:'en',connectedCount:3,refreshing:true});
  assert.ok(content(refreshing).includes(copy.refreshing));
  assert.equal(elements(refreshing).find(element=>element.type==='button').props.disabled,true);
});

test('every platform language renders complete localized empty and saved states with native accessible controls',()=>{
  for(const[locale]of ui.LANGUAGES){
    const copy=ui.modelConnectionCopy(locale);assert.equal(Object.values(copy).length,21);assert.ok(Object.values(copy).every(value=>typeof value==='string'&&value.trim()));
    if(locale!=='en')assert.notEqual(copy.empty,ui.modelConnectionCopy('en').empty);
    const node=ui.ModelConnectionStatus({...props,locale});const markup=renderToStaticMarkup(node);
    assert.ok(markup.includes(`lang="${locale}"`));
    assert.equal(node.props.dir,['ar','ur','fa'].includes(locale)?'rtl':'ltr');
    assert.ok(content(node).includes(copy.empty));assert.ok(content(ui.ModelConnectionStatus({...props,locale,connectedCount:2})).includes(copy.ready));
    assert.ok(elements(node).filter(element=>element.type==='button').every(element=>element.props.type==='button'));
    assert.ok(elements(node).filter(element=>element.type==='a').every(element=>typeof element.props['aria-label']==='string'));
  }
});

test('platform models are displayed separately from saved owner connections in every locale',()=>{
  for(const[locale]of ui.LANGUAGES){
    const copy=ui.modelConnectionCopy(locale);
    const included=ui.ModelConnectionStatus({...props,locale,platformCount:3});
    assert.ok(content(included).includes(copy.platformReady));
    assert.ok(content(included).includes(copy.platformAllowance));
    assert.ok(!content(included).includes(copy.empty));
    assert.ok(!content(included).includes(copy.saved));
    assert.ok(!content(included).includes(copy.unverified));
    assert.ok(!elements(included).some(element=>element.props?.className==='model-connection-start'));
    const mixed=ui.ModelConnectionStatus({...props,locale,connectedCount:1,platformCount:3});
    assert.ok(content(mixed).includes(copy.saved)&&content(mixed).includes(copy.platform)&&content(mixed).includes(copy.unverified));
    const countRows=elements(mixed).filter(element=>element.props?.className==='model-connection-count');
    assert.equal(countRows.length,2);
    assert.ok(content(countRows[0]).includes(new Intl.NumberFormat(locale).format(1)));
    assert.ok(content(countRows[1]).includes(new Intl.NumberFormat(locale).format(3)));
  }
});
