import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import guardModule from '../scripts/windows-build-filesystem.cjs';
const {createBuildMkdir}=guardModule;
const root=path.resolve('.next');
const target=path.join(root,'output');
const denied=()=>Object.assign(new Error('denied'),{code:'EPERM'});
const directory=async()=>({isDirectory:()=>true});

test('existing output directory is idempotent only for recursive mkdir; atomic locks still fail',async()=>{
  const guard=createBuildMkdir({root,mkdir:async()=>{throw denied();},stat:directory,writable:async()=>true});
  assert.equal(await guard(target,{recursive:true}),undefined);
  await assert.rejects(guard(target),error=>error.code==='EEXIST');
});

test('real permission and disk errors propagate; retries are bounded and restricted to build output',async()=>{
  let calls=0,waits=0;
  const guard=createBuildMkdir({root,mkdir:async()=>{calls++;throw denied();},stat:async()=>{throw denied();},writable:async()=>false,wait:async()=>{waits++;}});
  await assert.rejects(guard(target,{recursive:true}),error=>error.code==='EPERM');
  assert.equal(calls,3);assert.equal(waits,2);
  calls=0;waits=0;
  await assert.rejects(guard(path.resolve('public/output'),{recursive:true}),error=>error.code==='EPERM');
  assert.equal(calls,1);assert.equal(waits,0);
  const io=Object.assign(new Error('disk'),{code:'EIO'});
  const failed=createBuildMkdir({root,mkdir:async()=>{throw io;},stat:directory,writable:async()=>true});
  await assert.rejects(failed(target,{recursive:true}),error=>error===io);
});

test('files and unwritable directories never become successful directory operations',async()=>{
  for(const scenario of ['file','unwritable']){
    const guard=createBuildMkdir({root,mkdir:async()=>{throw denied();},stat:async()=>({isDirectory:()=>scenario!=='file'}),writable:async()=>scenario!=='unwritable',wait:async()=>{}});
    await assert.rejects(guard(target,{recursive:true}),error=>error.code==='EPERM');
  }
});

test('retry actually creates a missing directory rather than returning synthetic success',async()=>{
  const base=await fs.mkdtemp(path.join(tmpdir(),'hessara-mkdir-integration-'));
  const destination=path.join(base,'parent','child');let calls=0;
  const guard=createBuildMkdir({root:base,mkdir:async(...args)=>{if(calls++===0)throw denied();return fs.mkdir(...args);},stat:fs.lstat,writable:async()=>true,wait:async()=>{}});
  try{await guard(destination,{recursive:true});assert.equal((await fs.stat(destination)).isDirectory(),true);assert.equal(calls,2);}
  finally{await fs.rmdir(destination);await fs.rmdir(path.dirname(destination));await fs.rmdir(base);}
});
