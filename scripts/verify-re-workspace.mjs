/** Actual RE workspace/hook in an isolated browser fixture; never an engine or authenticated API test. */
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(resolve(process.env.HESSARA_PLAYWRIGHT_MODULE||'.vercel/rea-tool/node_modules/playwright-core/index.mjs')).href);
const origin='http://127.0.0.1:5173',output=resolve('docs/re-workspace-ui');await mkdir(output,{recursive:true});
const axe=await readFile('node_modules/axe-core/axe.min.js','utf8');
const css=(await Promise.all((await readdir('.next/static/css')).filter(name=>name.endsWith('.css')).map(name=>readFile('.next/static/css/'+name,'utf8')))).join('\n');
const id='e7302610-1234-4234-8234-123456789abc';
async function bundle(baseline=false){
 const result=await build({absWorkingDir:process.cwd(),stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{JobWorkspace}from'./app/reverse-engineering/workspace/[jobId]/workspace';const locale=new URLSearchParams(location.search).get('lang')==='ar'?'ar':'en';document.documentElement.lang=locale;document.documentElement.dir=locale==='ar'?'rtl':'ltr';const root=createRoot(document.getElementById('root'));window.__qaUnmount=()=>root.unmount();root.render(<div className="re-app" dir={locale==='ar'?'rtl':'ltr'}><main className="re-main"><JobWorkspace jobId="${id}"/></main></div>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',minify:true,define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'},plugins:[{name:'owned-presentation-boundaries',setup(builder){
  builder.onResolve({filter:/^next\/(link|navigation|dynamic)$/},args=>({path:args.path,namespace:'qa-next'}));
  builder.onLoad({filter:/.*/,namespace:'qa-next'},args=>({contents:args.path.endsWith('link')?"import React from 'react';export default function Link(props){return React.createElement('a',props)}":args.path.endsWith('navigation')?"export function useRouter(){return {push(){throw Error('Unexpected fixture navigation')}}}":"export default function dynamic(){return function UnusedCodeViewer(){return null}}",loader:'js',resolveDir:process.cwd()}));
  builder.onResolve({filter:/^(\.\/|\.\.\/)*shell$/},args=>args.importer.replaceAll('\\','/').includes('/app/reverse-engineering/')?{path:'shell',namespace:'qa-shell'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'qa-shell'},()=>({contents:"export function useReverseEngineering(){const locale=new URLSearchParams(location.search).get('lang')==='ar'?'ar':'en';return {locale,t:(ar,en)=>locale==='ar'?ar:en}}",loader:'js'}));
  if(baseline)builder.onLoad({filter:/app[\\/]reverse-engineering[\\/](client\.tsx|workspace[\\/]\[jobId\][\\/]workspace\.tsx)$/},async args=>({contents:await readFile(resolve('.vercel/backups/re-workspace-build-20261026',args.path.slice(process.cwd().length+1)),'utf8'),loader:'tsx',resolveDir:resolve(args.path,'..')}));
 }}]});
 return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owned RE workspace fixture — no engine execution</title><style>${css.replace(/<\/style/gi,'<\\/style')}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
}
const fixtures={before:await bundle(true),after:await bundle(false)};
const report={date:new Date().toISOString(),origin,scope:'Actual JobWorkspace and shared useResource bundled into an owned presentation fixture. Controlled in-memory GET responses; shell/router boundaries isolated. No real account, database, engine execution, uploaded artifact, analysis result or provider success.',baseline:[],checks:[],scenarios:[],failures:[]};
const check=(name,passed,evidence)=>report.checks.push({name,passed:!!passed,evidence});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-extensions','--disable-background-networking'],timeout:60000});
async function setup(version,locale='en',device='desktop'){
 const viewport=device==='desktop'?{width:1536,height:900}:{width:390,height:844};
 const context=await browser.newContext({viewport,locale:locale==='ar'?'ar-SA':'en-US',isMobile:device==='mobile',hasTouch:device==='mobile'});
 const state={status:'queued',ready:false,version:1,resultFailure:false,total:1,requests:[],unexpected:[],writes:[],errors:[],consoleErrors:[]};
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){state.unexpected.push(url.href);return route.abort()}
  if(url.pathname==='/__qa/re-workspace')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixtures[version]});
  if(url.pathname.startsWith('/fonts/')&&/^\/fonts\/[a-zA-Z0-9._-]+$/.test(url.pathname)){try{return route.fulfill({status:200,body:await readFile(resolve('public',url.pathname.slice(1)))});}catch{return route.abort()}}
  if(request.method()!=='GET'){state.writes.push(url.pathname);return route.abort()}
  if(url.pathname.startsWith('/api/reverse-engineering/jobs/'+id)){
   const part=url.pathname.slice(('/api/reverse-engineering/jobs/'+id).length).replace(/^\//,'');state.requests.push({part:part||'job',query:url.search,status:state.status,version:state.version,time:Date.now()});
   if(!part)return route.fulfill({json:{job:{id,projectId:'fixture-project',artifactName:'fixture-only-no-engine.bin',engineId:'rizin',status:state.status,stage:'controlled-fixture-stage',createdAt:1700000000000,...(['failed','timed_out'].includes(state.status)?{errorCode:state.status==='failed'?'TOOL_FAILURE':'TIMEOUT'}:{})},artifact:{name:'fixture-only-no-engine.bin',sizeBytes:1024,sha256:'a'.repeat(64)}}});
   if(!['findings','evidence','functions','symbols','strings','dependencies','code','logs'].includes(part)){state.unexpected.push(url.pathname);return route.abort()}
   if(state.resultFailure)return route.fulfill({status:503,json:{error:'STORAGE_UNAVAILABLE'}});
   const title=`Controlled fixture ${part} v${state.version}`;
   const record=part==='logs'?{id:'fixture-result',message:title,createdAt:1700000000000}:{id:'fixture-result',title,description:'Controlled UI test data; not engine output.',confidence:'unknown'};
   return route.fulfill({json:{items:state.ready?[record]:[],total:state.ready?state.total:0}});
  }
  state.unexpected.push(url.pathname);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',error=>state.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')state.consoleErrors.push(message.text())});
 const open=()=>page.goto(origin+'/__qa/re-workspace?lang='+locale,{waitUntil:'networkidle'});
 return {page,context,state,open,viewport};
}
try{
 const old=await setup('before');await old.open();await old.page.locator('.re-status-queued').waitFor();await old.page.locator('.re-empty').waitFor();old.state.status='completed';old.state.ready=true;await old.page.locator('.re-status-completed').waitFor({timeout:8000});await old.page.waitForTimeout(100);
 report.baseline.push({name:'Old workspace completes while default findings remain stale',reproduced:await old.page.getByText('Controlled fixture findings v1',{exact:true}).count()===0&&await old.page.locator('.re-empty').count()===1,requests:old.state.requests.slice()});
 const oldCount=old.state.requests.filter(x=>x.part==='findings').length;await old.page.getByRole('button',{name:'Refresh',exact:true}).click();await old.page.locator('.re-status-completed').waitFor();await old.page.waitForTimeout(150);report.baseline.push({name:'Old header refresh does not request findings',reproduced:old.state.requests.filter(x=>x.part==='findings').length===oldCount});await old.context.close();
 for(const [locale,device]of[['en','desktop'],['ar','mobile']]){
  const {page,context,state,open,viewport}=await setup('after',locale,device);const name=locale+'/'+device,tx=(ar,en)=>locale==='ar'?ar:en;
  await open();await page.locator('.re-status-queued').waitFor();await page.locator('.re-empty').waitFor();
  check(name+': initial queued state is honest and report remains disabled',await page.getByRole('button',{name:tx('إنشاء تقرير','Generate report'),exact:true}).isDisabled()&&await page.locator('.re-empty').count()===1);
  state.status='completed';state.ready=true;await page.getByText('Controlled fixture findings v1',{exact:true}).waitFor({timeout:9000});
  check(name+': completion automatically fetches findings without changing tabs',await page.getByRole('tab',{name:tx('النتائج','Findings'),exact:true}).getAttribute('aria-selected')==='true'&&state.requests.filter(x=>x.part==='findings').length>=2,state.requests.slice());
  check(name+': completed state exposes reporting without a cancel control',await page.getByRole('button',{name:tx('إنشاء تقرير','Generate report'),exact:true}).isEnabled()&&await page.getByRole('button',{name:tx('إلغاء التحليل','Cancel analysis'),exact:true}).count()===0);
  const completedCount=state.requests.length;await page.waitForTimeout(5400);check(name+': settled completed workspace stops metadata and result polling',state.requests.length===completedCount,{before:completedCount,after:state.requests.length});
  const jobReads=state.requests.filter(x=>x.part==='job').length,findingsReads=state.requests.filter(x=>x.part==='findings').length;state.version=2;await page.getByRole('button',{name:tx('تحديث','Refresh'),exact:true}).click();await page.getByText('Controlled fixture findings v2',{exact:true}).waitFor();
  check(name+': manual refresh reloads job metadata and current findings',state.requests.filter(x=>x.part==='job').length>jobReads&&state.requests.filter(x=>x.part==='findings').length>findingsReads);
  await page.getByRole('tab',{name:tx('الأدلة','Evidence'),exact:true}).click();await page.getByText('Controlled fixture evidence v2',{exact:true}).waitFor();
  const search=page.getByRole('textbox',{name:tx('ابحث في النتائج','Search results'),exact:true});await search.fill('authorized');state.total=50;await page.getByRole('button',{name:tx('بحث','Search'),exact:true}).click();await page.getByRole('button',{name:tx('التالي','Next'),exact:true}).click();await page.waitForTimeout(100);
  state.version=3;await page.getByRole('button',{name:tx('تحديث','Refresh'),exact:true}).click();await page.getByText('Controlled fixture evidence v3',{exact:true}).waitFor();
  const lastEvidence=state.requests.filter(x=>x.part==='evidence').at(-1);check(name+': manual refresh preserves selected tab, search and page',new URLSearchParams(lastEvidence.query).get('offset')==='25'&&new URLSearchParams(lastEvidence.query).get('search')==='authorized'&&await search.inputValue()==='authorized',lastEvidence);
  state.resultFailure=true;await page.getByRole('button',{name:tx('تحديث','Refresh'),exact:true}).click();await page.getByRole('alert').waitFor();check(name+': result failure is displayed instead of stale success',await page.getByText('Controlled fixture evidence v3',{exact:true}).count()===0&&await page.getByRole('alert').count()===1);
  state.resultFailure=false;state.version=4;await page.getByRole('button',{name:tx('إعادة المحاولة','Retry'),exact:true}).click();await page.getByText('Controlled fixture evidence v4',{exact:true}).waitFor();check(name+': result retry recovers real selected collection state',await page.getByRole('alert').count()===0);
  await page.addScriptTag({content:axe});const violations=await page.evaluate(async()=>{const result=await axe.run(document.querySelector('.re-app'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.map(x=>({id:x.id,impact:x.impact,nodes:x.nodes.map(n=>({target:n.target,failureSummary:n.failureSummary}))}))});check(name+': scoped workspace accessibility',violations.length===0,violations);
  check(name+': workspace has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),viewport);await page.screenshot({path:resolve(output,'completed-'+device+'.png')});
  for(const terminal of ['failed','cancelled','timed_out']){
   state.status='running';state.ready=false;state.version++;state.total=1;await open();await page.locator('.re-status-running').waitFor();await page.getByRole('tab',{name:terminal==='cancelled'?tx('سجل التنفيذ','Execution logs'):tx('الأدلة','Evidence'),exact:true}).click();await page.locator('.re-empty').waitFor();state.status=terminal;state.ready=true;
   const part=terminal==='cancelled'?'logs':'evidence';await page.getByText(`Controlled fixture ${part} v${state.version}`,{exact:true}).waitFor({timeout:9000});
   await page.locator('.re-status-'+terminal).waitFor(); await page.waitForTimeout(200);
   check(name+': '+terminal+' refreshes final selected output and never enables reporting',await page.locator('.re-status-'+terminal).count()===1&&await page.getByRole('button',{name:tx('إنشاء تقرير','Generate report'),exact:true}).isDisabled()&&await page.getByRole('button',{name:tx('إلغاء التحليل','Cancel analysis'),exact:true}).count()===0);
   const terminalCount=state.requests.length;await page.waitForTimeout(5300);check(name+': '+terminal+' stops job/log polling',state.requests.length===terminalCount,{before:terminalCount,after:state.requests.length});
  }
  state.status='running';state.ready=false;await open();await page.locator('.re-status-running').waitFor();await page.evaluate(()=>window.__qaUnmount());const unmountedCount=state.requests.length;await page.waitForTimeout(5300);check(name+': unmount cleans up pending polling',state.requests.length===unmountedCount);
  const unexpectedErrors=state.consoleErrors.filter(x=>!x.includes('the server responded with a status of 503'));
  check(name+': no unexpected runtime, console, external or mutation activity',state.errors.length===0&&unexpectedErrors.length===0&&state.unexpected.length===0&&state.writes.length===0,{runtime:state.errors,unexpectedConsole:unexpectedErrors,expectedInjected503:state.consoleErrors.filter(x=>x.includes('status of 503')).length,unexpectedRequests:state.unexpected,writes:state.writes});
  report.scenarios.push({name,viewport,requests:state.requests,violations,errors:state.errors,console:state.consoleErrors,unexpected:state.unexpected,writes:state.writes});await context.close();
 }
}catch(error){report.failures.push({message:error.message,stack:error.stack})}finally{await browser.close()}
report.passed=report.checks.filter(x=>x.passed).length;report.failed=report.checks.length-report.passed+report.failures.length+(report.baseline.some(x=>!x.reproduced)?1:0);await writeFile(resolve(output,'verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({baseline:report.baseline.map(x=>({name:x.name,reproduced:x.reproduced})),passed:report.passed,failed:report.failed,failedChecks:report.checks.filter(x=>!x.passed),failures:report.failures},null,2));process.exitCode=report.failed?1:0;


