import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { engineDiagnosticCode } from '../lib/reverse-engineering/engine-messages.ts';

const directory=await mkdtemp(resolve('.reverse-readiness-test-'));
const output=join(directory,'readiness.mjs');
let ui;
try {
  const result=await build({
    absWorkingDir:process.cwd(),stdin:{contents:"export {EngineReadinessNotice} from './app/reverse-engineering/engine-readiness-notice';",resolveDir:process.cwd(),loader:'tsx'},
    bundle:true,platform:'node',format:'esm',packages:'external',write:false,jsx:'automatic',tsconfig:resolve('tsconfig.json'),
    plugins:[{name:'native-link',setup(builder){
      builder.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'test-next'}));
      builder.onLoad({filter:/.*/,namespace:'test-next'},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props);}",loader:'js',resolveDir:process.cwd()}));
    }}],
  });
  await writeFile(output,result.outputFiles[0].text);
  ui=await import(pathToFileURL(output).href);
} finally {
  await unlink(output).catch(error=>{if(error.code!=='ENOENT')throw error;});
  await rmdir(directory);
}
const blocked=(id,name,reasonCode='NO_WORKER')=>({id,name,operational:false,reasonCode});
const render=(engines,locale='en')=>renderToStaticMarkup(React.createElement(ui.EngineReadinessNotice,{engines,locale}));

test('readiness diagnostics expose only recognized status codes',()=>{
  for(const code of ['NO_WORKER','IMAGE_UNPINNED','VERIFIED_SAMPLE_REQUIRED','BENCHMARK_REQUIRED','WORKER_STALE','HEALTH_CHECK_FAILED'])assert.equal(engineDiagnosticCode(code),code);
  for(const code of [undefined,null,{},123,'token=private-value','/private/worker/path','<script>stderr</script>'])assert.equal(engineDiagnosticCode(code),'READINESS_UNVERIFIED');
});

test('pre-upload guidance groups real blockers and distinguishes storage from engine execution',()=>{
  const html=render([blocked('rea','REA'),blocked('ghidra','Ghidra'),blocked('jadx','JADX','IMAGE_UNPINNED')]);
  assert.ok(html.includes('No engine is ready to start analysis'));
  assert.ok(html.includes('Artifact storage and upload availability are checked separately'));
  assert.equal((html.match(/>NO_WORKER</g)||[]).length,1);
  assert.ok(html.includes('REA · Ghidra'));
  assert.ok(html.includes('IMAGE_UNPINNED'));
  assert.ok(html.includes('Linux/Docker worker'));
  assert.ok(html.includes('href="/reverse-engineering/tools"'));
  assert.ok(!html.includes('<button'));assert.ok(!html.includes('<form'));
});

test('available engines do not receive an all-unavailable warning and no data is not a status claim',()=>{
  assert.equal(render([]),'');
  assert.equal(render([{...blocked('rea','REA'),operational:true},blocked('ghidra','Ghidra')]),'');
});

test('Arabic guidance is localized while unknown worker failure details never cross the public boundary',()=>{
  const privateReason='private-worker-token=do-not-show';
  const html=render([blocked('rea','REA',privateReason)],'ar');
  assert.ok(html.includes('لا يوجد محرك جاهز'));
  assert.ok(html.includes('READINESS_UNVERIFIED'));
  assert.ok(!html.includes(privateReason));
  assert.ok(!html.includes('No engine is ready'));
});
