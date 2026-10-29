import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const windows=process.platform==='win32';
const environment={...process.env};
if(windows){
  // NODE_OPTIONS parses backslashes as escapes, including inside quotes.
  const preload=path.join(root,'scripts','windows-build-filesystem.cjs').replaceAll('\\','/');
  environment.HESSARA_LOCAL_WINDOWS_BUILD='1';
  // Defaults come first so explicit caller options retain Node's normal last-option precedence.
  environment.NODE_OPTIONS=['--max-old-space-size=768','--max-semi-space-size=4','--v8-pool-size=1',environment.NODE_OPTIONS??'',`--require="${preload}"`].join(' ').trim();
}
const child=spawn(process.execPath,[path.join(root,'node_modules','next','dist','bin','next'),'build','--webpack'],{cwd:root,env:environment,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)process.exitCode=1;else process.exitCode=code??1;});

