import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const windows=process.platform==='win32';
const project=path.resolve(import.meta.dirname,'..');
const marker='HESSARA_BUILD_RUNNER_FIXTURE=';

/** Exercise the real launcher against a tiny Next executable, never a Next build. */
async function fixture() {
  const root=await fs.mkdtemp(path.join(tmpdir(),'hessara build runner '));
  const scripts=path.join(root,'scripts'),next=path.join(root,'node_modules','next','dist','bin');
  await fs.mkdir(scripts,{recursive:true});await fs.mkdir(next,{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}\n');
  await fs.copyFile(path.join(project,'scripts','build-local.mjs'),path.join(scripts,'build-local.mjs'));
  const shim=path.join(scripts,'windows-build-filesystem.cjs');
  // Instrument the actual copied shim to count executions; retain its real guard behavior.
  await fs.writeFile(shim,'globalThis.__hessaraBuildPreloadCount=(globalThis.__hessaraBuildPreloadCount??0)+1;\n'+await fs.readFile(path.join(project,'scripts','windows-build-filesystem.cjs'),'utf8'));
  await fs.writeFile(path.join(next,'next'),String.raw`
import {getHeapStatistics} from 'node:v8';
import {spawnSync} from 'node:child_process';
const result={argv:process.argv.slice(2),cwd:process.cwd(),nodeOptions:process.env.NODE_OPTIONS??null,gate:process.env.HESSARA_LOCAL_WINDOWS_BUILD??null,heapLimit:getHeapStatistics().heap_size_limit,preloadCount:globalThis.__hessaraBuildPreloadCount??0};
if(process.env.HESSARA_BUILD_FIXTURE_DESCENDANT==='1'){
 const child=spawnSync(process.execPath,['--input-type=commonjs','-e','process.stdout.write(JSON.stringify({gate:process.env.HESSARA_LOCAL_WINDOWS_BUILD??null,preloadCount:globalThis.__hessaraBuildPreloadCount??0,options:process.env.NODE_OPTIONS??null}))'],{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true,timeout:10000});
 if(child.error||child.status!==0)throw child.error??Error(child.stderr||'Descendant failed');
 result.descendant=JSON.parse(child.stdout);
}
console.log('HESSARA_BUILD_RUNNER_FIXTURE='+JSON.stringify(result));
process.exitCode=Number(process.env.HESSARA_BUILD_FIXTURE_EXIT??0);
`);
  const run=(options={})=>{
    const env={...process.env};
    delete env.NODE_OPTIONS;delete env.HESSARA_LOCAL_WINDOWS_BUILD;
    delete env.HESSARA_BUILD_FIXTURE_DESCENDANT;delete env.HESSARA_BUILD_FIXTURE_EXIT;
    Object.assign(env,options);
    const child=spawnSync(process.execPath,[path.join(scripts,'build-local.mjs')],{cwd:tmpdir(),env,encoding:'utf8',windowsHide:true,timeout:20000});
    assert.ifError(child.error);
    const line=child.stdout.split(/\r?\n/).find(value=>value.startsWith(marker));
    assert.ok(line,child.stderr||child.stdout||'The real launcher did not reach the fixture');
    return {status:child.status,signal:child.signal,stderr:child.stderr,result:JSON.parse(line.slice(marker.length))};
  };
  const cleanup=async()=>{
    // Verify the recursive target is exactly one owned temporary fixture directory.
    const resolved=path.resolve(root),temporaryRoot=path.resolve(tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(),temporaryRoot.toLowerCase());
    assert.match(path.basename(resolved),/^hessara build runner /);
    await fs.rm(resolved,{recursive:true,force:true});
  };
  return {root,shim,run,cleanup};
}

const mib=value=>value*1024*1024;

test('local build launcher uses its own project root, fixed webpack args and real child exit status',async()=>{
  const example=await fixture();
  try{
    const {status,signal,result}=example.run({HESSARA_BUILD_FIXTURE_EXIT:'7'});
    assert.equal(status,7);assert.equal(signal,null);
    assert.deepEqual(result.argv,['build','--webpack']);
    assert.equal(path.resolve(result.cwd),example.root);
    assert.equal(result.gate,windows?'1':null);
  }finally{await example.cleanup()}
});

test('Windows build defaults use the tested768MB budget and quoted preload in a root containing spaces',{skip:!windows},async()=>{
  const example=await fixture();
  try{
    const {status,result}=example.run();
    assert.equal(status,0);assert.equal(result.preloadCount,1);
    assert.ok(result.nodeOptions.startsWith('--max-old-space-size=768 --max-semi-space-size=4 --v8-pool-size=1 '));
    assert.ok(result.nodeOptions.endsWith(`--require="${example.shim.replaceAll('\\','/')}"`));
    assert.ok(result.heapLimit>=mib(768)&&result.heapLimit<mib(800),`Actual child heap limit: ${result.heapLimit}`);
  }finally{await example.cleanup()}
});

test('Windows caller memory options remain verbatim and win over defaults in the actual Node process',{skip:!windows},async()=>{
  const example=await fixture();
  try{
    for(const [options,heap] of [
      ['--max-old-space-size=96 --max-semi-space-size=2 --v8-pool-size=2',96],
      ['--max_old_space_size="112" --max_semi_space_size="1" --v8_pool_size="2"',112],
    ]){
      const {status,result}=example.run({NODE_OPTIONS:options});
      assert.equal(status,0);assert.ok(result.nodeOptions.includes(options));
      assert.ok(result.heapLimit>=mib(heap)&&result.heapLimit<mib(heap+16),`Caller ${options}; actual heap limit ${result.heapLimit}`);
      assert.equal(result.preloadCount,1);
    }
  }finally{await example.cleanup()}
});

test('identical duplicate shim preloads execute once and the guard options reach a real Node descendant',{skip:!windows},async()=>{
  const example=await fixture();
  try{
    const options=`--require="${example.shim.replaceAll('\\','/')}" --max-old-space-size=96`;
    const {status,result}=example.run({NODE_OPTIONS:options,HESSARA_BUILD_FIXTURE_DESCENDANT:'1'});
    assert.equal(status,0);assert.equal(result.preloadCount,1);assert.ok(result.nodeOptions.includes(options));
    assert.equal(result.descendant.preloadCount,1);assert.equal(result.descendant.gate,'1');
    assert.equal(result.descendant.options,result.nodeOptions);
  }finally{await example.cleanup()}
});
