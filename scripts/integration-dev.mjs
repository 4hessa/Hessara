import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createIntegrationChallenge, validateIntegrationTarget } from './integration-target.mjs';
import { integrationChallenge } from '../lib/integration-attestation.ts';

export function integrationServerEnvironment(profile, inherited, dotenvContents = []) {
 if (inherited.VERCEL || profile.VERCEL) throw Error('INTEGRATION_LOCAL_ONLY');
 const env = {...inherited};
 // Explicit blanks prevent Next dotenv fallback and inherited service credentials.
 for (const content of dotenvContents) for (const name of Object.keys(parseEnv(content))) env[name]='';
 for (const name of Object.keys(env)) if (/^(HESSARA_|NEXT_PUBLIC_|SUPABASE_|OPENAI_|ANTHROPIC_|GEMINI_|OPENROUTER_|NVIDIA_|PAPERCLIP_|DATABASE_|POSTGRES_|CRON_SECRET$)/.test(name)) env[name]='';
 Object.assign(env,{DATABASE_URL:'',POSTGRES_URL:'',DATABASE_SSL_CA:''},profile,{NODE_ENV:'development'});
 return env;
}
export function integrationListenHost(origin) { return new URL(origin).hostname.replace(/^\[|\]$/g,''); }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 // Fresh dev compilation prevents NEXT_PUBLIC values from a different build being reused.
 const root=fileURLToPath(new URL('../',import.meta.url));
 const profile=parseEnv(readFileSync(new URL('../.env.integration.local',import.meta.url),'utf8'));
 const contents=[];
 for (const filename of ['.env.example','.env','.env.local','.env.development','.env.development.local']) {
  try { contents.push(readFileSync(new URL('../'+filename,import.meta.url),'utf8')); }
  catch (error) { if(error.code!=='ENOENT')throw error; }
 }
 const env=integrationServerEnvironment(profile,process.env,contents);
 const validation=validateIntegrationTarget(env);
 if(!validation.configured)throw Error('INTEGRATION_PROFILE_INCOMPLETE: '+validation.issues.join(','));
 const challenge=createIntegrationChallenge(validation.target,env.HESSARA_TEST_ATTESTATION_KEY);
 if(!integrationChallenge(new Request(validation.target.origin+'/api/health',{headers:challenge.headers}),env))throw Error('INTEGRATION_SERVER_TARGET_INVALID');
 const url=new URL(validation.target.origin);
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname',integrationListenHost(url.origin),'--port',url.port||'80'],{cwd:root,env,stdio:'inherit'});
 child.on('error',()=>{console.error('INTEGRATION_SERVER_START_FAILED');process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
}
